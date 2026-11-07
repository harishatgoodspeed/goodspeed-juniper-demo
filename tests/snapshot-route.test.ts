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
    title: "Example Co",
    siteName: null,
    description: "Example Co sells artisanal walking boots, made in Vermont.",
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
  const res = await fetch(`${base}/api/session`);
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

test("GET /api/brands/:id/snapshot.md returns a Claude-ready brand.md once a brand is approved", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const res = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
    });
    const { brand } = (await res.json()) as { brand: { id: string } };
    setBrandContext(db, brand.id, minimalContext());
    setApprovedContext(db, brand.id, {
      logoAssetId: null,
      colours: ["#C6DD66"],
      fonts: ["Inter"],
      voiceNotes: "Confident, no exclamation points.",
    });

    const snapshotRes = await fetch(`${base}/api/brands/${brand.id}/snapshot.md`, { headers: { Cookie: cookie } });
    assert.equal(snapshotRes.status, 200);
    assert.match(snapshotRes.headers.get("content-type") ?? "", /text\/markdown/);
    assert.match(snapshotRes.headers.get("content-disposition") ?? "", /attachment/);
    const body = await snapshotRes.text();
    assert.match(body, /Example Co/);
    assert.match(body, /#C6DD66/);
    assert.match(body, /Inter/);
    assert.match(body, /Confident, no exclamation points\./);
    assert.match(body, /goodspeed\.studio\/contact/);
  } finally {
    await closeServer(server);
  }
});

test("GET /api/brands/:id/snapshot.md is 409 before a brand has an approved selection — never a snapshot of nothing", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const res = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
    });
    const { brand } = (await res.json()) as { brand: { id: string } };
    setBrandContext(db, brand.id, minimalContext());

    const snapshotRes = await fetch(`${base}/api/brands/${brand.id}/snapshot.md`, { headers: { Cookie: cookie } });
    assert.equal(snapshotRes.status, 409);
  } finally {
    await closeServer(server);
  }
});

test("GET /api/brands/:id/snapshot.md is 404 for a brand belonging to a different anonymous visitor", async () => {
  const { server, db, base } = await start();
  try {
    const owner = await login(base);
    const res = await fetch(`${base}/api/brands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie, "X-CSRF-Token": owner.csrf },
      body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
    });
    const { brand } = (await res.json()) as { brand: { id: string } };
    setBrandContext(db, brand.id, minimalContext());
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [], voiceNotes: "" });

    const otherVisitor = await fetch(`${base}/api/session`); // a fresh, cookie-less request is a different anonymous visitor
    const snapshotRes = await fetch(`${base}/api/brands/${brand.id}/snapshot.md`);
    assert.equal(snapshotRes.status, 404);
    void otherVisitor;
  } finally {
    await closeServer(server);
  }
});
