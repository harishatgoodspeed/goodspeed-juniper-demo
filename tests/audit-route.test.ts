import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildZip } from "../src/zip-safe";
import { createApp } from "../src/server";
import { ImportBlockedError } from "../src/import/fetch";
import type { AuditResult } from "../src/audit/types";

const SITE = `<!doctype html><html><head>
  <title>Northwind Studio | Brand systems</title>
  <meta name="description" content="Northwind Studio designs brand systems for founders.">
  <link rel="icon" href="/favicon.png">
  <!-- Made in Framer · framer.com -->
  <style>
    body { color: #1F3A2E; background: #F4F1EA; font-family: Georgia, serif; }
  </style>
</head><body>
  <header><img src="/logo.svg" alt="Northwind logo"></header>
  <main><p>Northwind Studio designs brand systems for founders. We keep every page calm and specific for the people who hire us.</p></main>
</body></html>`;

const BLOG = `<!doctype html><html><head><title>Blog</title>
  <style>body { color: #ff00aa; background: #00e5ff; font-family: Papyrus, Comic Sans MS, cursive; }</style>
</head><body><main><p>You will love this offer!!! Buy it now!!! You should click today!!! You need this deal right now before it vanishes!!!</p></main></body></html>`;

async function start(fetchSource?: (url: string) => Promise<{ html: string; stylesheets: []; stylesheetsSkipped: number; bytesUsed: number }>) {
  const { app } = createApp(fetchSource ? { auditDeps: { fetchSource, now: () => new Date("2026-11-09T12:00:00.000Z") } } : undefined);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

async function login(base: string) {
  const res = await fetch(`${base}/api/session`);
  const cookies = res.headers.getSetCookie().join("; ");
  const session = cookies.match(/gs_session=([^;]+)/)![1];
  const csrf = decodeURIComponent(cookies.match(/gs_csrf=([^;]+)/)![1]);
  return { cookie: `gs_session=${session}; gs_csrf=${csrf}`, csrf };
}

function close(server: { close: (cb: () => void) => void }) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

test("GET /api/audit/sample is the Bent Pixels example and invents no money", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/api/audit/sample`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as AuditResult;
    assert.equal(body.brand.name, "Bent Pixels");
    assert.equal(body.brand.siteUrl, "https://www.bentpixels.com/");
    assert.deepEqual(
      body.checks.map((check) => check.id),
      ["palette", "logo", "type", "voice", "message", "formats"]
    );
    assert.ok(body.overallScore >= 0 && body.overallScore <= 100);
    assert.ok(body.topBreaks.length >= 1 && body.topBreaks.length <= 5);
    assert.equal(body.topBreaks[0].rank, 1);
    assert.equal(body.toolsAndFormats.detected.includes("Framer"), true);
    const blob = JSON.stringify(body);
    assert.equal(blob.includes("@"), false);
    assert.doesNotMatch(blob, /[£$€]|competitor|D2C/i);
    for (const item of body.topBreaks) {
      assert.doesNotMatch(item.cost, /\d/);
    }
  } finally {
    await close(server);
  }
});

test("POST /api/audit scores a fetched site, blog, and deck and does not fetch LinkedIn", async () => {
  const calls: string[] = [];
  const { server, base } = await start(async (url) => {
    calls.push(url);
    const html = url.includes("/journal") ? BLOG : SITE;
    return { html, stylesheets: [], stylesheetsSkipped: 0, bytesUsed: html.length };
  });
  try {
    const { cookie, csrf } = await login(base);
    const deck = buildZip([
      {
        name: "ppt/slides/slide1.xml",
        data: `<p:sld><a:t>Northwind Studio designs brand systems for founders and keeps the work calm.</a:t><a:srgbClr val="1F3A2E"/></p:sld>`,
      },
      { name: "ppt/presentation.xml", data: `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>` },
    ]).toString("base64");

    const missing = await fetch(`${base}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ siteUrl: "https://northwind.example" }),
    });
    assert.equal(missing.status, 400);

    const denied = await fetch(`${base}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        siteUrl: "https://northwind.example",
        tools: ["Figma"],
        formats: ["LinkedIn posts"],
      }),
    });
    assert.equal(denied.status, 403);

    const res = await fetch(`${base}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({
        siteUrl: "https://northwind.example",
        blogUrl: "https://northwind.example/journal",
        linkedinText: "https://www.linkedin.com/company/northwind",
        tools: ["Figma", "Claude"],
        formats: ["LinkedIn posts"],
        deckFile: {
          filename: "sales.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          base64: deck,
        },
        email: "founder@example.com",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as AuditResult & { email?: string };
    assert.equal(body.email, undefined);
    assert.equal(body.brand.name, "Northwind Studio");
    assert.equal(body.brand.logoUrl, "https://northwind.example/logo.svg");
    assert.ok(body.brand.palette.includes("#1f3a2e"));
    assert.ok(body.brand.fonts.includes("Georgia"));
    assert.deepEqual(body.toolsAndFormats.detected, ["Framer"]);
    assert.deepEqual(body.toolsAndFormats.requested, ["Figma", "Claude", "LinkedIn posts"]);
    assert.equal(body.generatedAt, "2026-11-09T12:00:00.000Z");
    assert.equal(body.checks.length, 6);
    assert.equal(body.topBreaks.length <= 5, true);
    const palette = body.checks.find((check) => check.id === "palette")!;
    assert.equal(palette.status, "break");
    const linkedinSkip = body.skippedSurfaces.find((item) => item.surface === "linkedin");
    assert.match(linkedinSkip?.reason ?? "", /not fetched/i);
    assert.deepEqual(calls, ["https://northwind.example", "https://northwind.example/journal"]);
    const posts = await fetch(`${base}/api/posts/post_123/package.zip`, { headers: { Cookie: cookie } });
    assert.equal(posts.status, 404);
  } finally {
    await close(server);
  }
});

test("a blog that cannot be fetched is skipped and the site audit still returns", async () => {
  const { server, base } = await start(async (url) => {
    if (url.includes("blog")) throw new ImportBlockedError("robots.txt disallows fetching /blog for our user agent.");
    return { html: SITE, stylesheets: [], stylesheetsSkipped: 0, bytesUsed: SITE.length };
  });
  try {
    const { cookie, csrf } = await login(base);
    const res = await fetch(`${base}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({
        siteUrl: "https://northwind.example",
        blogUrl: "https://northwind.example/blog",
        linkedinText: "We design brand systems for founders and we keep every page calm and specific.",
        tools: ["Figma"],
        formats: ["sales deck"],
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as AuditResult;
    assert.match(body.skippedSurfaces.find((item) => item.surface === "blog")?.reason ?? "", /robots\.txt/);
    assert.equal(body.checks.find((check) => check.id === "voice")?.status, "ok");
  } finally {
    await close(server);
  }
});
