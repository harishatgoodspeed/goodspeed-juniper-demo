import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { setBrandContext, setApprovedContext } from "../src/brands";
import type { BrandContext } from "../src/import/types";
import { writeSolidPng } from "./helpers/png";

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

async function createApprovedBrand(base: string, db: ReturnType<typeof createApp>["db"], cookie: string, csrf: string, colours: string[]) {
  const res = await fetch(`${base}/api/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
  });
  const { brand } = (await res.json()) as { brand: { id: string } };
  setBrandContext(db, brand.id, minimalContext());
  setApprovedContext(db, brand.id, { logoAssetId: null, colours, fonts: [], voiceNotes: "" });
  return brand.id as string;
}

test("POST /api/brands/:id/check-upload reports a real per-colour match for a matching solid-colour upload", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createApprovedBrand(base, db, cookie, csrf, ["#C6DD66", "#36493C"]);
    const imageBase64 = fs.readFileSync(writeSolidPng(32, 32, "#C6DD66")).toString("base64");

    const res = await fetch(`${base}/api/brands/${brandId}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { foundCount: number; totalApproved: number; matches: Array<{ approvedHex: string; found: boolean }> };
    assert.equal(body.totalApproved, 2);
    assert.equal(body.foundCount, 1);
    assert.equal(body.matches.find((m) => m.approvedHex === "#C6DD66")?.found, true);
    assert.equal(body.matches.find((m) => m.approvedHex === "#36493C")?.found, false);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/check-upload is 409 when the brand has no approved colours yet", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createApprovedBrand(base, db, cookie, csrf, []);
    const imageBase64 = fs.readFileSync(writeSolidPng(16, 16, "#FFFFFF")).toString("base64");

    const res = await fetch(`${base}/api/brands/${brandId}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64 }),
    });
    assert.equal(res.status, 409);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/check-upload rejects a disallowed mime type", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createApprovedBrand(base, db, cookie, csrf, ["#C6DD66"]);

    const res = await fetch(`${base}/api/brands/${brandId}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "application/pdf", imageBase64: "AAAA" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/check-upload is 400, never a crash, for bytes that aren't a real image", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createApprovedBrand(base, db, cookie, csrf, ["#C6DD66"]);

    const res = await fetch(`${base}/api/brands/${brandId}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64: Buffer.from("not an image").toString("base64") }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "undecodable_image");
  } finally {
    await closeServer(server);
  }
});

test("POST /api/brands/:id/check-upload is 404 for a brand belonging to a different anonymous visitor", async () => {
  const { server, db, base } = await start();
  try {
    const owner = await login(base);
    const brandId = await createApprovedBrand(base, db, owner.cookie, owner.csrf, ["#C6DD66"]);

    const other = await login(base);
    const imageBase64 = fs.readFileSync(writeSolidPng(16, 16, "#C6DD66")).toString("base64");
    const res = await fetch(`${base}/api/brands/${brandId}/check-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie, "X-CSRF-Token": other.csrf },
      body: JSON.stringify({ mimeType: "image/png", imageBase64 }),
    });
    assert.equal(res.status, 404);
  } finally {
    await closeServer(server);
  }
});
