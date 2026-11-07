// Environment (NODE_ENV=test, DATABASE_PATH=:memory:, ASSET_DIR) comes from
// .env.test via `node --env-file=.env.test` in the "test" script — see the
// comment at the top of auth.test.ts for why this isn't done with an in-file
// process.env assignment. The access code used below ("test-access-code") is
// config.ts's own NODE_ENV=test fallback, not a value we set.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { createBrand } from "../src/brands";
import { newId } from "../src/ids";

async function start() {
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  // server.address() is null until the underlying bind completes — awaiting
  // "listening" here (once, for every test) avoids a whole class of bug where
  // a helper reads the port too early, throws, and — because that throw
  // lands outside any try/finally — leaks the server and hangs the test
  // runner's process exit indefinitely.
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, db, base };
}

// No login step: any request auto-provisions an isolated, anonymous session
// (see attachSession in auth-middleware.ts). Hitting GET /api/session is
// enough to get one and read its cookies back — kept the name "login" here
// only to minimise churn across this file's many call sites.
async function login(base: string): Promise<{ cookie: string; csrf: string }> {
  const res = await fetch(`${base}/api/session`);
  assert.equal(res.status, 200);
  // Node's fetch (undici) exposes multiple Set-Cookie headers via
  // getSetCookie(); headers.get('set-cookie') would only return one of them.
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const combined = setCookies.join("; ");
  const sessionMatch = combined.match(/gs_session=([^;]+)/);
  const csrfMatch = combined.match(/gs_csrf=([^;]+)/);
  assert.ok(sessionMatch && csrfMatch, `expected both cookies in: ${combined}`);
  return {
    cookie: `gs_session=${sessionMatch![1]}; gs_csrf=${csrfMatch![1]}`,
    csrf: decodeURIComponent(csrfMatch![1]),
  };
}

function closeServer(server: { close: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

test("a request with no session cookie is silently given a fresh, isolated workspace rather than rejected", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/api/brands`); // no cookie at all
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("set-cookie"), "a new session cookie should be issued");
    const { brands } = (await res.json()) as { brands: unknown[] };
    assert.equal(brands.length, 0, "a brand-new anonymous owner should start with no brands");
  } finally {
    await closeServer(server);
  }
});

test("two visitors who never share a cookie get two different, isolated owner ids", async () => {
  const { server, base } = await start();
  try {
    const first = await fetch(`${base}/api/session`);
    const second = await fetch(`${base}/api/session`);
    const { ownerId: a } = (await first.json()) as { ownerId: string };
    const { ownerId: b } = (await second.json()) as { ownerId: string };
    assert.notEqual(a, b);
  } finally {
    await closeServer(server);
  }
});

test("a mutating request without a matching CSRF header is rejected even with a valid session", async () => {
  const { server, base } = await start();
  try {
    const { cookie } = await login(base);
    const res = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie }, // no X-CSRF-Token
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(res.status, 403);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands rejects a non-http(s) URL before ever touching the network", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const res = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("an owner cannot read another owner's brand (ownership check / IDOR)", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie } = await login(base);

    // A brand belonging to a different owner, inserted directly — the
    // product's single shared access code always resolves to one owner, so
    // this exercises the ownership check the same way a future multi-user
    // mode (or a bug reusing another owner's id) would.
    const otherOwnerId = newId("owner");
    db.prepare("INSERT INTO owners (id) VALUES (?)").run(otherOwnerId);
    const othersBrand = createBrand(db, otherOwnerId, "https://not-yours.example");

    const res = await fetch(`${base}/api/brands/${othersBrand.id}`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404, "must not leak existence of another owner's brand");
  } finally {
    await closeServer(server);
  }
});

test("GET /api/brands/:id for a nonexistent id returns 404, not a 500", async () => {
  const { server, base } = await start();
  try {
    const { cookie } = await login(base);
    const res = await fetch(`${base}/api/brands/brand_doesnotexist`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("logout abandons the workspace: the old cookie no longer resolves to the same owner", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const before = await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
    const { ownerId: originalOwnerId } = (await before.json()) as { ownerId: string };

    const logoutRes = await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    assert.equal(logoutRes.status, 200);

    // Reusing the destroyed session's cookie value no longer validates, so a
    // fresh workspace gets silently provisioned instead — never the old one.
    const after = await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
    const { ownerId: afterOwnerId } = (await after.json()) as { ownerId: string };
    assert.notEqual(afterOwnerId, originalOwnerId);
  } finally {
    await closeServer(server);
  }
});
