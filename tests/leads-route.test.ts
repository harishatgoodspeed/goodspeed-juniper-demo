import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";

async function start() {
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, db, base };
}

function closeServer(server: { close: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => server.close(resolve));
}

async function login(base: string): Promise<{ cookie: string; csrf: string }> {
  const res = await fetch(`${base}/api/session`);
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const combined = setCookies.join("; ");
  const sessionMatch = combined.match(/gs_session=([^;]+)/);
  const csrfMatch = combined.match(/gs_csrf=([^;]+)/);
  assert.ok(sessionMatch && csrfMatch);
  return {
    cookie: `gs_session=${sessionMatch![1]}; gs_csrf=${csrfMatch![1]}`,
    csrf: decodeURIComponent(csrfMatch![1]),
  };
}

async function createBrandFor(base: string, cookie: string, csrf: string): Promise<string> {
  const res = await fetch(`${base}/api/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
  });
  const { brand } = (await res.json()) as { brand: { id: string } };
  return brand.id;
}

test("POST /api/brands/:id/leads stores a lead given a valid email and consent", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandFor(base, cookie, csrf);

    const res = await fetch(`${base}/api/brands/${brandId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ email: "person@example.com", preferredTool: "Figma", notes: "Mostly decks.", consent: true }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { ok: boolean; id: string };
    assert.equal(body.ok, true);
    assert.ok(body.id);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/leads rejects an invalid email", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandFor(base, cookie, csrf);

    const res = await fetch(`${base}/api/brands/${brandId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ email: "not-an-email", consent: true }),
    });
    assert.equal(res.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/leads requires explicit consent, not just a valid email", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandFor(base, cookie, csrf);

    const res = await fetch(`${base}/api/brands/${brandId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ email: "person@example.com", consent: false }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "consent_required");
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/leads is 404 for a brand belonging to a different anonymous visitor", async () => {
  const { server, base } = await start();
  try {
    const owner = await login(base);
    const brandId = await createBrandFor(base, owner.cookie, owner.csrf);

    const other = await login(base);
    const res = await fetch(`${base}/api/brands/${brandId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie, "X-CSRF-Token": other.csrf },
      body: JSON.stringify({ email: "person@example.com", consent: true }),
    });
    assert.equal(res.status, 404);
  } finally {
    await closeServer(server);
  }
});
