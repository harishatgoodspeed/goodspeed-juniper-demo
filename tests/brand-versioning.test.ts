import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import { setBrandContext, setApprovedContext, getBrand } from "../src/brands";
import { createRun } from "../src/runs";
import { createOutput, setOutputReady, createReview } from "../src/outputs";
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

const PASSING_FINDINGS = [
  { kind: "colour", status: "not_applicable", observed: "n/a", approved: "n/a", explanation: "n/a" },
  { kind: "typography", status: "not_applicable", observed: "n/a", approved: "n/a", explanation: "n/a" },
  { kind: "logo", status: "not_applicable", observed: "n/a", approved: "n/a", explanation: "n/a" },
  { kind: "copy", status: "not_applicable", observed: "n/a", approved: "n/a", explanation: "n/a" },
];

const FAILING_FINDINGS = [
  { kind: "colour", status: "fail", observed: "#000000", approved: "#ffffff", explanation: "wrong" },
];

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

test("an output whose review fully passed, built against the brand's current approved version, is labelled Brand approved", async () => {
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
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [], voiceNotes: "" });
    db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);

    const run = createRun(db, brand.id, "Launch post", null, getBrand(db, brand.id)!.approved_context_version);
    const output = createOutput(db, run.id, "post_copy", JSON.stringify({ postCopyText: "We are live." }));
    setOutputReady(db, output.id, null);
    createReview(db, output.id, output.version, JSON.stringify(PASSING_FINDINGS), null);

    const runRes = await fetch(`${base}/api/runs/${run.id}`, { headers: { Cookie: cookie } });
    const body = (await runRes.json()) as { outputs: Array<{ needsReview: boolean; label: string }> };
    assert.equal(body.outputs[0].needsReview, false);
    assert.equal(body.outputs[0].label, "Brand approved");
  } finally {
    await closeServer(server);
  }
});

test("an output whose review failed is labelled Draft, never Brand approved", async () => {
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
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [], voiceNotes: "" });
    db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);

    const run = createRun(db, brand.id, "Launch post", null, getBrand(db, brand.id)!.approved_context_version);
    const output = createOutput(db, run.id, "linkedin_image", JSON.stringify({}));
    setOutputReady(db, output.id, null);
    createReview(db, output.id, output.version, JSON.stringify(FAILING_FINDINGS), null);

    const runRes = await fetch(`${base}/api/runs/${run.id}`, { headers: { Cookie: cookie } });
    const body = (await runRes.json()) as { outputs: Array<{ needsReview: boolean; label: string }> };
    assert.equal(body.outputs[0].label, "Draft");
  } finally {
    await closeServer(server);
  }
});

test("an output built against an older approved-context version is labelled Needs review, even though its own review once passed", async () => {
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
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [], voiceNotes: "" });
    db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);
    const versionAtRunTime = getBrand(db, brand.id)!.approved_context_version;

    const run = createRun(db, brand.id, "Launch post", null, versionAtRunTime);
    const output = createOutput(db, run.id, "post_copy", JSON.stringify({ postCopyText: "We are live." }));
    setOutputReady(db, output.id, null);
    createReview(db, output.id, output.version, JSON.stringify(PASSING_FINDINGS), null);

    // Now the brand's approved colours change — this run's stamped version falls behind.
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#000000"], fonts: [], voiceNotes: "" });

    const runRes = await fetch(`${base}/api/runs/${run.id}`, { headers: { Cookie: cookie } });
    const body = (await runRes.json()) as { outputs: Array<{ needsReview: boolean; label: string }> };
    assert.equal(body.outputs[0].needsReview, true);
    assert.equal(body.outputs[0].label, "Needs review");
  } finally {
    await closeServer(server);
  }
});

test("the public share page shows Needs review once the approved brand has moved on, and Brand approved when it genuinely passed and is current", async () => {
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
    setApprovedContext(db, brand.id, { logoAssetId: null, colours: [], fonts: [], voiceNotes: "" });
    db.prepare("UPDATE brands SET status = 'ready' WHERE id = ?").run(brand.id);

    const run = createRun(db, brand.id, "Launch post", null, getBrand(db, brand.id)!.approved_context_version);
    const output = createOutput(db, run.id, "post_copy", JSON.stringify({ postCopyText: "We are live." }));
    setOutputReady(db, output.id, null);
    createReview(db, output.id, output.version, JSON.stringify(PASSING_FINDINGS), null);

    const before = await fetch(`${base}/b/${brand.id}`, { headers: { Cookie: cookie } });
    const beforeHtml = await before.text();
    assert.match(beforeHtml, />Brand approved</);

    setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#111111"], fonts: [], voiceNotes: "" });

    const after = await fetch(`${base}/b/${brand.id}`, { headers: { Cookie: cookie } });
    const afterHtml = await after.text();
    assert.match(afterHtml, />Needs review</);
    assert.doesNotMatch(afterHtml, />Brand approved</);
  } finally {
    await closeServer(server);
  }
});
