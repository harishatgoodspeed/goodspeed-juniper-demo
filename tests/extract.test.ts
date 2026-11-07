import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBrandContext, normaliseToHex } from "../src/import/extract";

test("normaliseToHex handles 3/6/8-digit hex and rgb()/rgba()", () => {
  assert.equal(normaliseToHex("#fff"), "#ffffff");
  assert.equal(normaliseToHex("#C6DD66"), "#c6dd66");
  assert.equal(normaliseToHex("#C6DD66ff"), "#c6dd66"); // alpha dropped for grouping
  assert.equal(normaliseToHex("rgb(198, 221, 102)"), "#c6dd66");
  assert.equal(normaliseToHex("rgba(198, 221, 102, 0.5)"), "#c6dd66");
  assert.equal(normaliseToHex("not-a-colour"), null);
});

test("extractBrandContext counts colour declarations and keeps custom properties", () => {
  const html = `<!doctype html><html><head><title>Fixture</title>
    <style>
      :root { --brand-accent: #C6DD66; --brand-bg: #F9F2ED; }
      body { color: #242F28; background: var(--brand-bg); }
      a { color: #242F28; }
    </style>
  </head><body><main><p>Hello world, this is the readable copy.</p></main></body></html>`;

  const ctx = extractBrandContext({ sourceUrl: "https://example.com", html, stylesheets: [], stylesheetsSkipped: 0 });

  const ink = ctx.colours.find((c) => c.hex === "#242f28");
  assert.ok(ink, "expected #242f28 to be counted");
  assert.equal(ink!.declarationCount, 2); // body + a

  const accent = ctx.cssCustomProperties.find((p) => p.name === "--brand-accent");
  assert.equal(accent?.value, "#C6DD66");

  assert.equal(ctx.textExcerpt, "Hello world, this is the readable copy.");
  assert.equal(ctx.textTruncated, false);
});

test("extractBrandContext does not shred a font-family var() fallback chain into garbage fragments", () => {
  const html = `<!doctype html><html><head><title>Fixture</title>
    <style>
      h1 { font-family: var(--framer-font-family, "Inter", sans-serif); }
      p { font-family: "Open Sans", Arial, sans-serif; }
    </style>
  </head><body><main>Body copy.</main></body></html>`;

  const ctx = extractBrandContext({ sourceUrl: "https://example.com", html, stylesheets: [], stylesheetsSkipped: 0 });
  const names = ctx.fonts.map((f) => f.family);

  // The var()-driven declaration is left opaque (nothing extracted from it) —
  // correct, since we can't statically resolve a custom property — rather
  // than naively splitting its generated text on every comma and inventing
  // fragments like 'sans-serif)' or 'var(--framer-font-family'.
  assert.ok(!names.some((n) => n.includes("var(")), `found a var() fragment in ${JSON.stringify(names)}`);
  assert.ok(!names.some((n) => n.includes(")")), `found an unbalanced fragment in ${JSON.stringify(names)}`);

  assert.ok(names.includes("Open Sans"), "expected the literal 'Open Sans' declaration to be extracted");
  assert.ok(names.includes("Arial"), "expected the literal 'Arial' fallback to be extracted");
  assert.ok(!names.includes("sans-serif"), "generic keywords must be filtered out");
});

test("extractBrandContext dedupes logo candidates found by overlapping selectors", () => {
  const html = `<!doctype html><html><head>
    <title>Fixture</title>
    <link rel="icon" href="/favicon.png">
    <link rel="shortcut icon" href="/favicon.png">
  </head><body>
    <header><img src="/logo.svg" alt="Acme logo" class="site-logo"></header>
    <nav><img src="/logo.svg" alt="Acme logo" class="site-logo"></nav>
  </body></html>`;

  const ctx = extractBrandContext({ sourceUrl: "https://example.com", html, stylesheets: [], stylesheetsSkipped: 0 });

  const favicons = ctx.logoCandidates.filter((c) => c.kind === "favicon");
  const logos = ctx.logoCandidates.filter((c) => c.kind === "header_img");
  assert.equal(favicons.length, 1, `expected exactly one deduped favicon, got ${favicons.length}`);
  assert.equal(logos.length, 1, `expected exactly one deduped header image, got ${logos.length}`);
});

test("extractBrandContext records unknowns for a page with nothing to extract", () => {
  const html = `<!doctype html><html><head><title>Empty</title></head><body></body></html>`;
  const ctx = extractBrandContext({ sourceUrl: "https://example.com", html, stylesheets: [], stylesheetsSkipped: 0 });

  assert.ok(ctx.unknowns.some((u) => /logo/i.test(u)));
  assert.ok(ctx.unknowns.some((u) => /colour/i.test(u)));
  assert.ok(ctx.unknowns.some((u) => /font/i.test(u)));
  assert.ok(ctx.unknowns.some((u) => /readable body copy/i.test(u)));
});

test("extractBrandContext truncates very long readable copy and says so", () => {
  const longText = "word ".repeat(2000);
  const html = `<!doctype html><html><head><title>Long</title></head><body><main>${longText}</main></body></html>`;
  const ctx = extractBrandContext({ sourceUrl: "https://example.com", html, stylesheets: [], stylesheetsSkipped: 0 });
  assert.equal(ctx.textTruncated, true);
  assert.ok(ctx.textExcerpt.length <= 4000);
});
