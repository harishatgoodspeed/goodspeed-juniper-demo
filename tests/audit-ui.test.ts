import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server";
import type { AuditResult } from "../src/audit/types";

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const mockJs = fs.readFileSync(path.join(root, "public/audit-mock.js"), "utf8");

function loadMock() {
  const sandbox = { TextEncoder, console };
  vm.createContext(sandbox);
  vm.runInContext(mockJs, sandbox);
  const mock = (sandbox as unknown as { BrandAuditMock: {
    sample: () => AuditResult;
    previewFromRequest: (body: Record<string, unknown>, brand: Record<string, unknown>, detected: string[]) => AuditResult;
    buildPreviewPdfBytes: (result: AuditResult, preview: boolean) => Uint8Array;
    isAuditResult: (value: unknown) => boolean;
    costs: Record<string, string>;
  } }).BrandAuditMock;
  const previewFromRequest = mock.previewFromRequest;
  const sample = mock.sample;
  return {
    ...mock,
    sample: () => JSON.parse(JSON.stringify(sample())) as AuditResult,
    previewFromRequest: (body: Record<string, unknown>, brand: Record<string, unknown>, detected: string[]) =>
      JSON.parse(JSON.stringify(previewFromRequest(body, brand, detected))) as AuditResult,
    costs: JSON.parse(JSON.stringify(mock.costs)) as Record<string, string>,
  };
}

test("the public page is an audit, with no email gate and no posts generator", () => {
  assert.match(html, /See where your brand is breaking/);
  assert.match(html, /For SaaS and AI founders, and for marketing leads/);
  assert.match(html, /Run free brand audit/);
  assert.match(html, /https:\/\/goodspeed\.studio\/contact/);
  assert.match(html, /Bent Pixels is the only sample brand/);
  assert.match(html, /We cannot read LinkedIn pages automatically/);
  assert.match(html, /No email and no sign-up/);
  assert.match(html, /6 audits an hour/);
  assert.match(html, /PDF or PPTX, up to 6 MB/);
  assert.match(appJs, /mimeType/);
  assert.match(appJs, /X-CSRF-Token/);
  assert.match(appJs, /\/api\/session/);
  assert.match(appJs, /Not assessed/);
  assert.match(html, /id="toolChoices"/);
  assert.match(html, /id="formatChoices"/);
  for (const label of ["Canva", "Figma", "Google Slides", "Gamma", "PowerPoint", "Notion"]) {
    assert.match(appJs, new RegExp(label));
  }
  for (const label of ["LinkedIn posts", "Decks", "One-pagers", "Blog images", "Ads"]) {
    assert.match(appJs, new RegExp(label.replace("-", "\\-")));
  }
  assert.doesNotMatch(html, /type="email"/);
  assert.doesNotMatch(html + appJs, /leadForm|Make my posts|carousel|editorView|regenerate|package\.zip|\/api\/posts/);
  assert.doesNotMatch(html + appJs + mockJs, /D2C|competitor/i);
  assert.doesNotMatch(html + appJs, /[—–]/);
});

test("Bent Pixels sample matches the audit contract and invents no money", () => {
  const mock = loadMock();
  const sample = mock.sample();
  assert.equal(mock.isAuditResult(sample), true);
  assert.equal(sample.brand.name, "Bent Pixels");
  assert.equal(sample.brand.siteUrl, "https://www.bentpixels.com/");
  assert.ok(sample.overallScore >= 0 && sample.overallScore <= 100);
  assert.deepEqual(sample.checks.map((check) => check.id), ["palette", "logo", "type", "voice", "message", "formats"]);
  sample.checks.forEach((check) => {
    assert.ok(check.score >= 0 && check.score <= 100);
    assert.ok(["ok", "warn", "break"].includes(check.status));
  });
  assert.ok(sample.topBreaks.length >= 2 && sample.topBreaks.length <= 3);
  assert.equal(sample.overallScore, 62);
  assert.equal(sample.topBreaks[0].rank, 1);
  assert.equal(sample.topBreaks[0].title, "Core message");
  assert.deepEqual(sample.toolsAndFormats.requested, ["Claude", "Figma", "LinkedIn posts", "sales deck"]);
  const voice = sample.checks.find((check) => check.id === "voice");
  const formats = sample.checks.find((check) => check.id === "formats");
  assert.equal(voice?.score, 60);
  assert.equal(voice?.status, "warn");
  assert.match(voice?.findings[0].detail || "", /^Not assessed/);
  assert.match(formats?.findings[0].detail || "", /^Not assessed/);
  assert.equal(sample.topBreaks.some((item) => item.title === "Voice and tone" || item.title === "Formats and templates"), false);
  const blob = JSON.stringify(sample) + JSON.stringify(mock.costs);
  assert.doesNotMatch(blob, /[£$€]/);
  const bytes = mock.buildPreviewPdfBytes(sample, true);
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString("utf8"), "%PDF-1.4");
  assert.match(Buffer.from(bytes).toString("latin1"), /Bent Pixels/);
  assert.match(Buffer.from(bytes).toString("latin1"), /goodspeed\.studio\/contact/);
});

test("a preview audit skips LinkedIn when nothing was pasted and flags a divergent paste", () => {
  const mock = loadMock();
  const brand = {
    name: "Northwind",
    siteUrl: "https://northwind.example",
    palette: ["#112233"],
    fonts: ["Source Serif"],
    voiceSummary: "We build communities for creators, not impressions.",
  };
  const skipped = mock.previewFromRequest(
    { siteUrl: brand.siteUrl, tools: ["Figma"], formats: ["Decks"] },
    brand,
    ["Google Fonts"]
  );
  assert.equal(skipped.skippedSurfaces.some((item) => item.surface === "linkedin" && /cannot read LinkedIn/i.test(item.reason)), true);
  assert.equal(skipped.skippedSurfaces.some((item) => item.surface === "blog"), true);
  assert.equal(skipped.skippedSurfaces.some((item) => item.surface === "deck"), true);
  assert.deepEqual(skipped.toolsAndFormats.detected, ["Google Fonts"]);
  assert.deepEqual(skipped.toolsAndFormats.requested, ["Figma", "Decks"]);
  const voice = skipped.checks.find((check) => check.id === "voice");
  const formats = skipped.checks.find((check) => check.id === "formats");
  assert.equal(voice?.score, 60);
  assert.equal(voice?.status, "warn");
  assert.match(voice?.findings[0].detail || "", /^Not assessed/);
  assert.match(formats?.findings[0].detail || "", /^Not assessed/);
  assert.equal(skipped.topBreaks.some((item) => item.title === "Voice and tone" || item.title === "Formats and templates"), false);

  const divergent = mock.previewFromRequest(
    {
      siteUrl: brand.siteUrl,
      linkedinText: "Hiring a growth lead this quarter. Pipeline targets and outbound sequences for the next campaign.",
      tools: ["Canva"],
      formats: ["Ads"],
    },
    brand,
    []
  );
  const message = divergent.checks.find((check) => check.id === "message");
  assert.equal(message?.status, "break");
  assert.equal(divergent.skippedSurfaces.some((item) => item.surface === "linkedin"), false);
  assert.ok(divergent.topBreaks.some((item) => item.surface === "linkedin"));
});

test("the audit page, script, and Bent Pixels wordmark are served", async () => {
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.match(body, /See where your brand is breaking/);
    assert.match(body, /audit-mock\.js/);
    const script = await fetch(`${base}/audit-mock.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") || "", /javascript/);
    const logo = await fetch(`${base}/bent-pixels-wordmark.png`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get("content-type") || "", /png/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
