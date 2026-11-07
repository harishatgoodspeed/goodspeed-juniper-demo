import { test } from "node:test";
import assert from "node:assert/strict";
import type { SafeFetchResult } from "../src/security/url";
import { extractFontFaceUrls, fontFaceCss, resolveFontFace, resolveFontFaces, type ResolvedFontFace } from "../src/generate/font-assets";
import type { BrandContext } from "../src/import/types";

function fixtureContext(overrides: Partial<BrandContext> = {}): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: new Date().toISOString(),
    extractionMethod: "static-html-css",
    title: "Example",
    siteName: null,
    description: null,
    logoCandidates: [],
    colours: [],
    cssCustomProperties: [],
    fonts: [],
    googleFontsLinks: [],
    images: [],
    textExcerpt: "",
    textTruncated: false,
    stylesheetsFetched: 0,
    stylesheetsSkipped: 0,
    unknowns: [],
    ...overrides,
  };
}

function fakeResult(overrides: Partial<SafeFetchResult> = {}): SafeFetchResult {
  return {
    statusCode: 200,
    headers: {},
    body: Buffer.from(""),
    finalUrl: "https://example.com",
    redirectChain: [],
    ...overrides,
  };
}

test("extractFontFaceUrls pulls url(...) out of @font-face blocks, preferring woff2 over woff/ttf", () => {
  const css = `
    @font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/x.ttf) format('truetype'), url(https://fonts.gstatic.com/x.woff2) format('woff2'); }
    .unrelated { background: url(https://example.com/bg.png); }
  `;
  const urls = extractFontFaceUrls(css);
  assert.deepEqual(urls, ["https://fonts.gstatic.com/x.woff2", "https://fonts.gstatic.com/x.ttf"]);
});

test("extractFontFaceUrls ignores non-font url()s entirely", () => {
  const css = `.hero { background-image: url(https://example.com/photo.jpg); }`;
  assert.deepEqual(extractFontFaceUrls(css), []);
});

test("resolveFontFace uses a direct @font-face URL captured at import time, without touching Google Fonts", async () => {
  const fontBytes = Buffer.from("fake-woff2-bytes");
  let calls = 0;
  const context = fixtureContext({
    fonts: [{ family: "Canela", source: "@font-face", url: "https://example.com/fonts/canela.woff2" }],
    googleFontsLinks: ["https://fonts.googleapis.com/css2?family=Canela"],
  });
  const face = await resolveFontFace("Canela", context, {
    fetch: async (url) => {
      calls++;
      assert.equal(url, "https://example.com/fonts/canela.woff2");
      return fakeResult({ body: fontBytes });
    },
  });
  assert.equal(calls, 1, "should resolve from the direct @font-face URL and never fall through to Google Fonts");
  assert.ok(face);
  assert.equal(face!.family, "Canela");
  assert.equal(face!.format, "woff2");
  assert.equal(face!.dataUri, `data:font/woff2;base64,${fontBytes.toString("base64")}`);
});

test("resolveFontFace falls back to the brand's Google Fonts link and parses its @font-face CSS", async () => {
  const fontBytes = Buffer.from("fake-woff2-bytes-2");
  const context = fixtureContext({
    fonts: [],
    googleFontsLinks: ["https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"],
  });
  const face = await resolveFontFace("Inter", context, {
    fetch: async (url) => {
      if (url.includes("fonts.googleapis.com")) {
        return fakeResult({
          body: Buffer.from(`@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/inter.woff2) format('woff2'); }`),
        });
      }
      if (url === "https://fonts.gstatic.com/inter.woff2") {
        return fakeResult({ body: fontBytes });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });
  assert.ok(face);
  assert.equal(face!.format, "woff2");
  assert.equal(face!.dataUri, `data:font/woff2;base64,${fontBytes.toString("base64")}`);
});

test("resolveFontFace returns null, never a fabricated embed, when no real file can be fetched", async () => {
  const context = fixtureContext({ fonts: [], googleFontsLinks: [] });
  const face = await resolveFontFace("SomeProprietaryFont", context, {
    fetch: async () => {
      throw new Error("should never be called — nothing to fetch from");
    },
  });
  assert.equal(face, null);
});

test("resolveFontFace returns null when the only candidate fetch fails, rather than throwing", async () => {
  const context = fixtureContext({
    fonts: [{ family: "Canela", source: "@font-face", url: "https://example.com/fonts/canela.woff2" }],
  });
  const face = await resolveFontFace("Canela", context, {
    fetch: async () => {
      throw new Error("network error");
    },
  });
  assert.equal(face, null);
});

test("resolveFontFaces deduplicates families and resolves them in parallel", async () => {
  const context = fixtureContext({
    fonts: [
      { family: "Canela", source: "@font-face", url: "https://example.com/fonts/canela.woff2" },
      { family: "Inter", source: "@font-face", url: "https://example.com/fonts/inter.woff" },
    ],
  });
  let fetchCount = 0;
  const map = await resolveFontFaces(["Canela", "Inter", "Canela"], context, {
    fetch: async (url) => {
      fetchCount++;
      return fakeResult({ body: Buffer.from(url) });
    },
  });
  assert.equal(fetchCount, 2, "deduplicated families must only be fetched once each");
  assert.equal(map.size, 2);
  assert.ok(map.get("Canela"));
  assert.ok(map.get("Inter"));
});

test("fontFaceCss emits one @font-face block per resolved face with the right format keyword", () => {
  const faces: ResolvedFontFace[] = [
    { family: "Canela", format: "woff2", dataUri: "data:font/woff2;base64,AAA" },
    { family: "Old Serif", format: "otf", dataUri: "data:font/otf;base64,BBB" },
  ];
  const css = fontFaceCss(faces);
  assert.match(css, /font-family: "Canela"/);
  assert.match(css, /format\("woff2"\)/);
  assert.match(css, /font-family: "Old Serif"/);
  assert.match(css, /format\("opentype"\)/);
});
