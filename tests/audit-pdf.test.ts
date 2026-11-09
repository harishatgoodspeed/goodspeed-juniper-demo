import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { bentPixelsAuditResult } from "../src/audit/bent-pixels";
import {
  GOODSPEED_CONTACT_URL,
  REPORT_COPY,
  buildAuditReportHtml,
  formatAuditDate,
  isAssessedCheck,
} from "../src/audit/report-html";
import { renderAuditPdf } from "../src/audit/render-pdf";
import { parseAuditResult } from "../src/audit/validate";
import { countPdfPages } from "../src/pdf-pages";
import { createApp } from "../src/server";

const HYPHEN = /[—–]| - | -/;

function proseFields(result: typeof bentPixelsAuditResult): string[] {
  return [
    result.brand.name,
    result.brand.voiceSummary,
    ...result.checks.flatMap((check) => [check.label, ...check.findings.map((finding) => finding.detail)]),
    ...result.topBreaks.flatMap((item) => [item.title, item.whyItMatters, item.cost]),
    ...result.toolsAndFormats.detected,
    ...result.toolsAndFormats.requested,
    ...result.skippedSurfaces.map((item) => item.reason),
  ];
}

test("the Bent Pixels fixture matches the engine sample contract", () => {
  const parsed = parseAuditResult(bentPixelsAuditResult);
  assert.equal(parsed.ok, true);
  assert.equal(bentPixelsAuditResult.brand.name, "Bent Pixels");
  assert.equal(bentPixelsAuditResult.checks.length, 6);
  assert.deepEqual(
    bentPixelsAuditResult.checks.map((check) => check.id),
    ["palette", "logo", "type", "voice", "message", "formats"]
  );
  assert.deepEqual(bentPixelsAuditResult.toolsAndFormats.requested, ["Claude", "Figma", "LinkedIn posts", "sales deck"]);
  assert.equal(bentPixelsAuditResult.overallScore, 62);
  assert.equal(formatAuditDate(bentPixelsAuditResult.generatedAt), "9 November 2026");

  const voice = bentPixelsAuditResult.checks.find((check) => check.id === "voice");
  const formats = bentPixelsAuditResult.checks.find((check) => check.id === "formats");
  assert.ok(voice && formats);
  assert.equal(voice.score, 60);
  assert.equal(voice.status, "warn");
  assert.equal(isAssessedCheck(voice), false);
  assert.equal(formats.score, 60);
  assert.equal(isAssessedCheck(formats), false);
  assert.equal(
    bentPixelsAuditResult.topBreaks.some((item) => item.title === "Voice and tone" || item.title === "Formats and templates"),
    false
  );

  const logo = bentPixelsAuditResult.checks.find((check) => check.id === "logo");
  assert.ok(logo);
  assert.deepEqual(
    logo.findings.map((finding) => finding.surface),
    ["site"]
  );
  assert.equal(/fidelity|deck/i.test(logo.findings.map((finding) => finding.detail).join(" ")), false);

  for (const line of proseFields(bentPixelsAuditResult)) {
    assert.equal(HYPHEN.test(line), false, line);
    assert.equal(/[£$€]/.test(line), false, line);
  }
});

test("report copy is British, has no dashed punctuation, and names no prices", () => {
  for (const line of Object.values(REPORT_COPY)) {
    assert.equal(HYPHEN.test(line), false, line);
    assert.equal(/-/.test(line), false, line);
    assert.equal(/[£$€]|email address|sign up/i.test(line), false, line);
  }
  assert.match(REPORT_COPY.colours, /colours/);
  assert.equal(REPORT_COPY.talk, "Talk to Goodspeed");
  assert.equal(REPORT_COPY.installNote, "Any install starts from your own approved designs.");
});

test("the report HTML shows the audit as given and does not fetch a remote logo", () => {
  const html = buildAuditReportHtml(bentPixelsAuditResult);
  assert.match(html, /Bent Pixels/);
  assert.match(html, />62</);
  assert.match(html, /Where your brand is breaking/);
  assert.match(html, /What we could not check/);
  assert.match(html, /Your tools and formats/);
  assert.match(html, /Framer/);
  assert.match(html, /Claude/);
  assert.match(html, /sales deck/);
  assert.match(html, /status-unassessed">Not assessed/);
  assert.match(html, /1 of 4 checks is breaking/);
  assert.match(html, /2 checks were not assessed/);
  assert.equal(html.includes(">60<"), false);
  const voiceBlock = html.match(/<section class="check unassessed">[\s\S]*?Voice and tone[\s\S]*?<\/section>/);
  assert.ok(voiceBlock);
  assert.equal(voiceBlock[0].includes("status-warn"), false);
  assert.match(voiceBlock[0], /Not assessed/);
  assert.match(html, new RegExp(GOODSPEED_CONTACT_URL.replace(/[.]/g, "\\.")));
  assert.equal(html.includes("mailto:"), false);
  assert.equal(html.includes("<form"), false);
  assert.equal(html.includes("<input"), false);
  assert.equal(html.includes("£"), false);
  assert.equal(html.includes("$"), false);

  const hostile = buildAuditReportHtml({
    ...bentPixelsAuditResult,
    brand: {
      ...bentPixelsAuditResult.brand,
      name: `<script>alert("x")</script>`,
      logoUrl: "https://example.com/logo.png",
    },
  });
  assert.equal(hostile.includes("<script>"), false);
  assert.match(hostile, /&lt;script&gt;/);
  assert.equal(hostile.includes("https://example.com/logo.png"), false);
  assert.match(hostile, /does not fetch remote files/);
});

test("a broken audit result is rejected before a PDF is rendered", () => {
  assert.equal(parseAuditResult({}).ok, false);
  assert.equal(parseAuditResult({ ...bentPixelsAuditResult, overallScore: 140 }).ok, false);
  assert.equal(parseAuditResult({ ...bentPixelsAuditResult, extra: true }).ok, false);
  const tooMany = {
    ...bentPixelsAuditResult,
    topBreaks: Array.from({ length: 6 }, (_, index) => ({
      rank: 1,
      title: "Break",
      surface: "site",
      whyItMatters: "It matters.",
      cost: "Trust.",
      rankOverride: index,
    })),
  };
  assert.equal(parseAuditResult(tooMany).ok, false);
  const duplicate = {
    ...bentPixelsAuditResult,
    checks: [bentPixelsAuditResult.checks[0], bentPixelsAuditResult.checks[0]],
  };
  assert.equal(parseAuditResult(duplicate).ok, false);
});

test("the Bent Pixels report is a 5 page PDF with no clipped sheet", async () => {
  const rendered = await renderAuditPdf(bentPixelsAuditResult);
  assert.equal(rendered.pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.equal(countPdfPages(rendered.pdf), 5);
  assert.deepEqual(rendered.overflow, [false, false, false, false, false]);
  assert.match(rendered.text, /Bent Pixels/);
  assert.match(rendered.text, /\b62\b/);
  assert.match(rendered.text, /Not assessed/);
  assert.match(rendered.text, /2 checks were not assessed/);
  assert.equal(/\b60\b/.test(rendered.text), false);
  assert.match(rendered.text, /Talk to Goodspeed/);
  assert.match(rendered.text, /goodspeed\.studio\/contact/);
  assert.match(rendered.text, /9 November 2026/);
  assert.match(rendered.text, /Any install starts from your own approved designs/);
  assert.equal(rendered.text.includes("£"), false);
  assert.equal(rendered.text.includes("$"), false);
  assert.equal(/[—–]/.test(rendered.text), false);
});

async function start() {
  const { app } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
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

test("POST /api/audit/pdf returns the Bent Pixels PDF and rejects a bad body", async () => {
  const { server, base } = await start();
  try {
    const { cookie, csrf } = await login(base);
    const denied = await fetch(`${base}/api/audit/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(bentPixelsAuditResult),
    });
    assert.equal(denied.status, 403);

    const bad = await fetch(`${base}/api/audit/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ brand: { name: "Bent Pixels" } }),
    });
    assert.equal(bad.status, 400);
    const badBody = (await bad.json()) as { error: string };
    assert.equal(badBody.error, "invalid_audit");

    const ok = await fetch(`${base}/api/audit/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify(bentPixelsAuditResult),
    });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /application\/pdf/);
    assert.match(ok.headers.get("content-disposition") ?? "", /Bent-Pixels-brand-audit\.pdf/);
    const bytes = Buffer.from(await ok.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.equal(countPdfPages(bytes), 5);
  } finally {
    await closeServer(server);
  }
});
