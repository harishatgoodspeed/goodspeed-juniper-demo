import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { setBrandContext, setApprovedContext, addSourceAsset } from "../src/brands";
import type { BrandContext } from "../src/import/types";

function minimalContext(): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: new Date().toISOString(),
    extractionMethod: "static-html-css",
    title: "Example Co",
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

async function createBrandWithContext(base: string, cookie: string, csrf: string, db: ReturnType<typeof createApp>["db"]) {
  const res = await fetch(`${base}/api/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
  });
  const { brand } = (await res.json()) as { brand: { id: string } };
  setBrandContext(db, brand.id, minimalContext());
  setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [] });
  db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);
  return brand.id;
}

test("GET /b/:id is 404 for someone with no session and no token", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    const res = await fetch(`${base}/b/${brandId}`); // no cookie at all
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(body.includes("not exist") || body.includes("Page not found"));
  } finally {
    await closeServer(server);
  }
});

test("the owner can view /b/:id directly, with no token needed", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    const res = await fetch(`${base}/b/${brandId}`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Example Co"));
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  } finally {
    await closeServer(server);
  }
});

test("enabling sharing returns a one-time token that then grants anonymous access to /b/:id", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    const shareRes = await fetch(`${base}/api/brands/${brandId}/share`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    assert.equal(shareRes.status, 201);
    const shareBody = (await shareRes.json()) as { token: string; url: string; warning: string };
    assert.ok(shareBody.token.length >= 32);
    assert.match(shareBody.warning, /anyone with this link/i);

    // No cookie at all — a genuinely anonymous visitor.
    const anonRes = await fetch(`${base}/b/${brandId}?token=${shareBody.token}`);
    assert.equal(anonRes.status, 200);
    const html = await anonRes.text();
    assert.ok(html.includes("Example Co"));
  } finally {
    await closeServer(server);
  }
});

test("a wrong token never grants access", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);
    await fetch(`${base}/api/brands/${brandId}/share`, { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrf } });

    const res = await fetch(`${base}/b/${brandId}?token=totally-made-up-token`);
    assert.equal(res.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("revoking a share immediately stops that token from working", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    const shareRes = await fetch(`${base}/api/brands/${brandId}/share`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    const { id: shareId, token } = (await shareRes.json()) as { id: string; token: string };

    const before = await fetch(`${base}/b/${brandId}?token=${token}`);
    assert.equal(before.status, 200);

    const revokeRes = await fetch(`${base}/api/brands/${brandId}/share/${shareId}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    assert.equal(revokeRes.status, 200);

    const after = await fetch(`${base}/b/${brandId}?token=${token}`);
    assert.equal(after.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("GET /api/brands/:id/shares lists active shares without ever exposing the raw token", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);
    await fetch(`${base}/api/brands/${brandId}/share`, { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrf } });

    const res = await fetch(`${base}/api/brands/${brandId}/shares`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const { shares } = (await res.json()) as { shares: Array<Record<string, unknown>> };
    assert.equal(shares.length, 1);
    assert.ok(!("token" in shares[0]));
    assert.ok(!("token_hash" in shares[0]));
  } finally {
    await closeServer(server);
  }
});

test("someone who isn't the owner cannot create or revoke a share for another owner's brand", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    // Move the brand to a different owner, simulating a future multi-user mode.
    db.prepare("INSERT OR IGNORE INTO owners (id) VALUES ('owner_other_test')").run();
    db.prepare("UPDATE brands SET owner_id = 'owner_other_test' WHERE id = ?").run(brandId);

    const createRes = await fetch(`${base}/api/brands/${brandId}/share`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    assert.equal(createRes.status, 404);
  } finally {
    await closeServer(server);
  }
});

test("the rendered /b/:id page's logo <img src> actually resolves (regression: share-page.ts once pointed at /api/assets/:id/file, a route that doesn't exist — only /api/outputs/:id/file has that suffix)", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "share-logo-")), "logo.svg");
    fs.writeFileSync(filePath, "<svg></svg>");
    const asset = addSourceAsset(db, brandId, {
      origin_url: "https://example.com/logo.svg",
      kind: "logo",
      mime_type: "image/svg+xml",
      local_path: filePath,
      byte_size: 11,
      sha256: null,
      confidence: 0.8,
      extraction_method: "test fixture",
    });
    setApprovedContext(db, brandId, { logoAssetId: asset.id, colours: [], fonts: [] });

    const pageRes = await fetch(`${base}/b/${brandId}`, { headers: { Cookie: cookie } });
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();
    const srcMatch = html.match(/<img class="logo" src="([^"]+)"/);
    assert.ok(srcMatch, "expected a logo <img> in the rendered page");

    const imgRes = await fetch(`${base}${srcMatch![1]}`, { headers: { Cookie: cookie } });
    assert.equal(imgRes.status, 200, `logo image URL ${srcMatch![1]} must actually resolve`);
    assert.equal(await imgRes.text(), "<svg></svg>");
  } finally {
    await closeServer(server);
  }
});

test("a shared asset is downloadable by an anonymous token holder but not by a random visitor", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createBrandWithContext(base, cookie, csrf, db);

    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "share-asset-")), "logo.svg");
    fs.writeFileSync(filePath, "<svg></svg>");
    const asset = addSourceAsset(db, brandId, {
      origin_url: "https://example.com/logo.svg",
      kind: "logo",
      mime_type: "image/svg+xml",
      local_path: filePath,
      byte_size: 11,
      sha256: null,
      confidence: 0.8,
      extraction_method: "test fixture",
    });

    const anonBefore = await fetch(`${base}/api/assets/${asset.id}`);
    assert.equal(anonBefore.status, 404);

    const shareRes = await fetch(`${base}/api/brands/${brandId}/share`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrf },
    });
    const { token } = (await shareRes.json()) as { token: string };

    const anonWithToken = await fetch(`${base}/api/assets/${asset.id}?token=${token}`);
    assert.equal(anonWithToken.status, 200);
    assert.equal(await anonWithToken.text(), "<svg></svg>");
  } finally {
    await closeServer(server);
  }
});
