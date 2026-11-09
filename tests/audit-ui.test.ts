import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

test("the public page calls the real audit routes and has no preview mock", () => {
  assert.match(html, /See where your brand is breaking/);
  assert.match(html, /For SaaS and AI founders, and for marketing leads/);
  assert.match(html, /What's your website/);
  assert.match(html, /Read my site/);
  assert.match(html, /Are these your channels/);
  assert.match(html, /See an example report/);
  assert.doesNotMatch(html, /No website\? Start without one/);
  assert.match(html, /Your brand/);
  assert.match(html, /https:\/\/goodspeed\.studio\/contact/);
  assert.match(html, /Bent Pixels is the only sample brand/);
  assert.match(html, /marked Couldn't read/);
  assert.match(html, /only covers ads shown in the EU/);
  assert.match(html, /No email and no sign-up/);
  assert.match(html, /6 audits an hour/);
  assert.match(html, /Download PDF/);
  assert.match(html, /id="downloadPdf"/);
  assert.match(appJs, /\/api\/audit\/sample/);
  assert.match(appJs, /\/api\/audit"/);
  assert.match(appJs, /\/api\/audit\/pdf/);
  assert.match(appJs, /X-CSRF-Token/);
  assert.match(appJs, /\/api\/session/);
  assert.match(appJs, /Not assessed/);
  assert.doesNotMatch(html, /audit-mock\.js/);
  assert.doesNotMatch(html + appJs, /BrandAuditMock|previewFromRequest|buildPreviewPdfBytes/);
  assert.doesNotMatch(html, /type="email"/);
  assert.doesNotMatch(html + appJs, /leadForm|Make my posts|carousel|editorView|regenerate|package\.zip|\/api\/posts/);
  assert.doesNotMatch(html + appJs, /D2C|competitor/i);
  assert.doesNotMatch(html + appJs, /[—–]/);
  assert.equal(fs.existsSync(path.join(root, "public/audit-mock.js")), false);
});

test("the page, sample audit, and wordmark are served", async () => {
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.match(body, /See where your brand is breaking/);
    assert.doesNotMatch(body, /audit-mock\.js/);
    const missing = await fetch(`${base}/audit-mock.js`);
    assert.equal(missing.status, 404);

    const sampleRes = await fetch(`${base}/api/audit/sample`);
    assert.equal(sampleRes.status, 200);
    const sample = (await sampleRes.json()) as {
      brand: { name: string; siteUrl: string };
      overallScore: number;
      checks: Array<{ id: string; score: number; status: string; findings: Array<{ detail: string }> }>;
      topBreaks: Array<{ title: string }>;
      toolsAndFormats: { requested: string[] };
    };
    assert.equal(sample.brand.name, "Bent Pixels");
    assert.equal(sample.brand.siteUrl, "https://www.bentpixels.com/");
    assert.equal(sample.overallScore, 62);
    assert.deepEqual(
      sample.checks.map((check) => check.id),
      ["palette", "logo", "type", "voice", "message", "formats"]
    );
    const voice = sample.checks.find((check) => check.id === "voice");
    const formats = sample.checks.find((check) => check.id === "formats");
    assert.match(voice?.findings[0].detail || "", /^Not assessed/);
    assert.match(formats?.findings[0].detail || "", /^Not assessed/);
    assert.equal(sample.topBreaks.some((item) => item.title === "Voice and tone" || item.title === "Formats and templates"), false);
    assert.ok(Array.isArray(sample.toolsAndFormats.requested));

    const logo = await fetch(`${base}/bent-pixels-wordmark.png`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type") || "", /png/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
