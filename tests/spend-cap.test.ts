import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { setBrandContext, setApprovedContext } from "../src/brands";
import { createRun, setRunBriefs } from "../src/runs";
import { config, estimateUsdCost } from "../src/config";
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

async function createReadyBrand(base: string, cookie: string, csrf: string, db: ReturnType<typeof createApp>["db"]) {
  const res = await fetch(`${base}/api/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
    body: JSON.stringify({ url: "https://not-a-real-host.invalid.example" }),
  });
  const { brand } = (await res.json()) as { brand: { id: string } };
  setBrandContext(db, brand.id, minimalContext());
  setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [], voiceNotes: "" });
  db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);
  return brand.id;
}

/** Simulates a prior run that already spent `usd` worth of (real) tokens, by giving it all prompt tokens for simplicity. */
function recordPriorSpend(db: ReturnType<typeof createApp>["db"], brandId: string, usd: number): void {
  // estimateUsdCost(promptTokens, 0) = promptTokens / 1_000_000 * inputPrice, so solve for promptTokens.
  const promptTokens = Math.ceil(usd / estimateUsdCost(1, 0));
  const run = createRun(db, brandId, "prior run", null, 1);
  setRunBriefs(db, run.id, {
    briefsJson: "[]",
    unknownsJson: "[]",
    model: config.ANTHROPIC_MODEL,
    promptTokens,
    completionTokens: 0,
    elapsedMs: 1,
  });
}

test("estimateUsdCost matches Sonnet 5.5 list pricing ($2/$10 per million tokens)", () => {
  assert.ok(Math.abs(estimateUsdCost(1_000_000, 0) - 2.0) < 1e-9);
  assert.ok(Math.abs(estimateUsdCost(0, 1_000_000) - 10.0) < 1e-9);
});

test("a visitor who has already spent at or above their daily cap cannot start another run", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);
    recordPriorSpend(db, brandId, config.PER_VISITOR_DAILY_SPEND_USD); // exactly at the cap

    const res = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Launch announcement" }),
    });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "spend_cap_reached");
  } finally {
    await closeServer(server);
  }
});

test("a visitor well under their own cap is still blocked once the global daily cap is reached by other visitors", async () => {
  const { server, db, base } = await start();
  try {
    // A different visitor (own workspace, own brand) spends right up to the global cap.
    const { cookie: spenderCookie, csrf: spenderCsrf } = await login(base);
    const spenderBrandId = await createReadyBrand(base, spenderCookie, spenderCsrf, db);
    recordPriorSpend(db, spenderBrandId, config.GLOBAL_DAILY_SPEND_USD);

    // A second, fresh visitor who has spent nothing themselves.
    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);

    const res = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Launch announcement" }),
    });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "spend_cap_reached");
  } finally {
    await closeServer(server);
  }
});

test("spend from one visitor's prior runs never counts against a different visitor's own daily cap", async () => {
  const { server, db, base } = await start();
  try {
    const { cookie: otherCookie, csrf: otherCsrf } = await login(base);
    const otherBrandId = await createReadyBrand(base, otherCookie, otherCsrf, db);
    // Spends a lot, but nowhere near the global cap, and is a different owner.
    recordPriorSpend(db, otherBrandId, config.PER_VISITOR_DAILY_SPEND_USD * 5);

    const { cookie, csrf } = await login(base);
    const brandId = await createReadyBrand(base, cookie, csrf, db);
    const res = await fetch(`${base}/api/brands/${brandId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ task: "Launch announcement" }),
    });
    assert.equal(res.status, 202, "a fresh visitor's own cap must not be affected by another visitor's spend");
  } finally {
    await closeServer(server);
  }
});
