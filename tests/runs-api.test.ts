import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { setBrandContext, setApprovedContext } from "../src/brands";
import type { BrandContext } from "../src/import/types";

function minimalContext(): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: new Date().toISOString(),
    extractionMethod: "static-html-css",
    title: "Example",
    siteName: null,
    description: "Example Co sells artisanal walking boots.",
    logoCandidates: [],
    colours: [],
    cssCustomProperties: [],
    fonts: [],
    googleFontsLinks: [],
    images: [],
    textExcerpt: "Example Co has been making boots since 1998.",
    textTruncated: false,
    stylesheetsFetched: 0,
    stylesheetsSkipped: 0,
    unknowns: [],
  };
}

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
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "test-access-code" }),
  });
  assert.equal(res.status, 200);
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

async function createReadyBrand(base: string, cookie: string, csrf: string, db: ReturnType<typeof createApp>["db"]) {
  const res = await fetch(`${base}/api/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
  });
  const { brand } = (await res.json()) as { brand: { id: string } };
  // The import job will fail against this host (DNS won't resolve) — for
  // these tests we only need a brand row to exist with approved context, not
  // a real completed import, so set its state directly.
  setBrandContext(db, brand.id, minimalContext());
  setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [] });
  db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);
  return brand.id;
}

test("POST /api/brands/:id/runs rejects a brand that isn't ready/approved yet", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const res = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
    });
    const { brand } = (await res.json()) as { brand: { id: string } };

    const runRes = await fetch(`${base}/api/brands/${brand.id}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Launch announcement" }),
    });
    assert.equal(runRes.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/runs on a ready+approved brand creates a run and a brief job", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);

    const runRes = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Launch announcement" }),
    });
    assert.equal(runRes.status, 202);
    const { run, jobId } = (await runRes.json()) as { run: { id: string }; jobId: string };
    assert.ok(run.id);
    assert.ok(jobId);

    const getRunRes = await fetch(`${base}/api/runs/${run.id}`, { headers: { Cookie: cookie } });
    assert.equal(getRunRes.status, 200);
    const body = (await getRunRes.json()) as { outputs: unknown[]; task: string };
    assert.equal(body.task, "Launch announcement");
    assert.deepEqual(body.outputs, []);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/runs rejects a missing task", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);
    const res = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("an owner cannot read another owner's run (ownership check / IDOR)", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);
    const runRes = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Launch announcement" }),
    });
    const { run } = (await runRes.json()) as { run: { id: string } };

    // Move the brand to a different owner directly, simulating the ownership
    // check the same way a future multi-user mode (or a bug reusing another
    // owner's id) would exercise it.
    const otherOwnerId = "owner_other_test";
    db.prepare("INSERT OR IGNORE INTO owners (id) VALUES (?)").run(otherOwnerId);
    db.prepare("UPDATE brands SET owner_id = ? WHERE id = ?").run(otherOwnerId, brandId);

    const getRes = await fetch(`${base}/api/runs/${run.id}`, { headers: { Cookie: cookie } });
    assert.equal(getRes.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("only one active run per owner is allowed at a time", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);

    const first = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "First run" }),
    });
    assert.equal(first.status, 202);

    const second = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Second run while the first is still in flight" }),
    });
    assert.equal(second.status, 409);
  } finally {
    await closeServer(server);
  }
});

test("GET /api/outputs/:id/file 404s for a nonexistent output rather than 500ing", async () => {
  const { server, base } = await start();
  try {
    const { cookie } = await login(base);
    const res = await fetch(`${base}/api/outputs/output_doesnotexist/file`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404);
  } finally {
    await closeServer(server);
  }
});
