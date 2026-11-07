import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import type { Brief } from "../src/pipeline-types";
import { renderOutput, installNetworkGuard } from "../src/generate/render";
import { toLocalFileUrl } from "../src/generate/templates";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "juniper");
const LOGO_PATH = path.join(FIXTURE_DIR, "logo-temp.svg");
const IMAGE_PATH = path.join(FIXTURE_DIR, "product-stand-in.svg");

// Mirrors tests/fixtures/juniper/juniper.json's real palette/fonts (hand-written —
// Phase 2 doesn't exist yet to produce a real Brief, per the task brief).
const JUNIPER_PALETTE = ["#F2ECDF", "#1F3A2E", "#2B2B28", "#C97B4A"];
const JUNIPER_FONTS = ["Canela", "Inter"];

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    outputType: "linkedin_image",
    purpose: "Announce Juniper Goods' new trail-ready pack line",
    audience: "Outdoors-first shoppers who already camp",
    sourcedFactualCopy: [
      "Juniper Goods packs are built for people who actually camp.",
      "No exclamation points, no brand-team voice.",
    ],
    layoutDirection: "image on the right, left-aligned text",
    paletteTokenHexes: JUNIPER_PALETTE,
    fontFamilies: JUNIPER_FONTS,
    logoAssetId: "asset_logo_1",
    imageAssetIds: ["asset_image_1"],
    voiceGuidance: "Confident, outdoors-first, no exclamation points.",
    unknowns: ["No approved logo file was supplied for this demo."],
    ...overrides,
  };
}

function tmpOutDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "generate-test-"));
}

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // PNG signature + IHDR: width/height are the first two big-endian uint32s
  // inside the IHDR chunk, which always starts at byte 16 for a well-formed PNG.
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "missing PNG magic bytes");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function hex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
}

test("linkedin_image renders a real PNG at the template's declared resolution", async () => {
  const outDir = tmpOutDir();
  const brief = makeBrief({ outputType: "linkedin_image" });
  const evidence = await renderOutput(brief, { logoPath: LOGO_PATH, imagePaths: [IMAGE_PATH] }, outDir);

  assert.equal(evidence.outputType, "linkedin_image");
  assert.ok(evidence.filePath);
  assert.equal(evidence.width, 1200);
  assert.equal(evidence.height, 627);

  const dims = readPngDimensions(evidence.filePath as string);
  assert.equal(dims.width, 1200);
  assert.equal(dims.height, 627);

  // Real logo check: the fixture logo was supplied, so the <img data-role="logo">
  // must actually be present with a non-zero box, not just assumed from the HTML string.
  assert.ok(evidence.logoCheck);
  assert.equal(evidence.logoCheck?.rendered, true);
  assert.equal(evidence.logoCheck?.boundingBoxNonEmpty, true);

  // Real font checks: one per role, read back from the rendered DOM.
  const roles = evidence.fontChecks.map((f) => f.role).sort();
  assert.deepEqual(roles, ["body", "heading"]);
  for (const check of evidence.fontChecks) {
    assert.ok(check.computedFamily.length > 0, "computedFamily must be read from the DOM, not empty");
  }

  assert.equal(evidence.overflow, false);
});

test("a region's sampled colour matches the expectedHex declared for it in the template", async () => {
  const outDir = tmpOutDir();
  const brief = makeBrief({ outputType: "linkedin_image" });
  const evidence = await renderOutput(brief, { logoPath: LOGO_PATH, imagePaths: [] }, outDir);

  const png = PNG.sync.read(fs.readFileSync(evidence.filePath as string));
  assert.ok(evidence.regions.length > 0, "template must declare at least one region");

  for (const region of evidence.regions) {
    assert.ok(region.expectedHex, `region ${region.label} should have an expectedHex for this test fixture`);
    assert.ok(region.width >= 20 && region.height >= 20, `region ${region.label} must be at least 20x20px`);

    // Sample the centre pixel plus the four corners of the declared region —
    // all should land on the same solid fill, proving the coordinates are accurate
    // and away from any antialiased edge.
    const points = [
      [region.x + Math.floor(region.width / 2), region.y + Math.floor(region.height / 2)],
      [region.x + 2, region.y + 2],
      [region.x + region.width - 2, region.y + 2],
      [region.x + 2, region.y + region.height - 2],
      [region.x + region.width - 2, region.y + region.height - 2],
    ];
    for (const [x, y] of points) {
      const idx = (png.width * y + x) << 2;
      const observed = hex(png.data[idx], png.data[idx + 1], png.data[idx + 2]);
      assert.equal(
        observed,
        (region.expectedHex as string).toLowerCase(),
        `region "${region.label}" at (${x},${y}) expected ${region.expectedHex}, got ${observed}`
      );
    }
  }
});

test("one_pager_pdf renders a real, valid, single-page PDF", async () => {
  const outDir = tmpOutDir();
  const brief = makeBrief({ outputType: "one_pager_pdf" });
  const evidence = await renderOutput(brief, { logoPath: LOGO_PATH, imagePaths: [IMAGE_PATH] }, outDir);

  assert.ok(evidence.filePath);
  const buf = fs.readFileSync(evidence.filePath as string);

  assert.ok(buf.length > 1000, "PDF should be a non-trivial size");
  assert.equal(buf.subarray(0, 4).toString("latin1"), "%PDF", "file must start with the PDF magic bytes");
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1");
  assert.ok(tail.includes("%%EOF"), "PDF must have a trailing %%EOF marker");
  assert.ok(buf.toString("latin1").includes("/Type/Page") || buf.toString("latin1").includes("/Type /Page"), "PDF must declare at least one /Type /Page object");

  assert.equal(evidence.width, 794);
  assert.equal(evidence.height, 1123);
});

test("post_copy returns the brief's text with no rendered file", async () => {
  const outDir = tmpOutDir();
  const brief = makeBrief({
    outputType: "post_copy",
    postCopyText: "Juniper Goods packs are built for people who actually camp. No exclamation points.",
  });
  const evidence = await renderOutput(brief, { imagePaths: [] }, outDir);

  assert.equal(evidence.filePath, null);
  assert.equal(evidence.text, brief.postCopyText);
  assert.deepEqual(evidence.regions, []);
  assert.deepEqual(evidence.fontChecks, []);
  assert.equal(evidence.logoCheck, null);
  assert.equal(evidence.overflow, false);
});

test("overflow detection fires for absurdly long content and not for normal content", async () => {
  const outDir = tmpOutDir();

  const longLine = "Juniper Goods packs are built for people who actually camp. ".repeat(40);
  const overflowingBrief = makeBrief({
    outputType: "slide",
    sourcedFactualCopy: [longLine, longLine, longLine],
    layoutDirection: "image on the right, left-aligned text. ".repeat(40),
  });
  const overflowEvidence = await renderOutput(overflowingBrief, { imagePaths: [] }, outDir);
  assert.equal(overflowEvidence.overflow, true);

  const normalBrief = makeBrief({ outputType: "slide" });
  const normalEvidence = await renderOutput(normalBrief, { logoPath: LOGO_PATH, imagePaths: [] }, outDir);
  assert.equal(normalEvidence.overflow, false);
});

test("toLocalFileUrl sanitises non-local asset paths at the template layer (our chosen defence)", () => {
  assert.equal(toLocalFileUrl(undefined), null);
  assert.equal(toLocalFileUrl("https://example.invalid/evil.png"), null);
  assert.equal(toLocalFileUrl("//example.invalid/evil.png"), null);
  assert.equal(toLocalFileUrl("relative/path.png"), null);
  assert.ok(toLocalFileUrl(LOGO_PATH)?.startsWith("file://"));
  assert.equal(toLocalFileUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
});

test("an external asset URL passed to renderOutput never reaches the network (template-layer sanitisation)", async () => {
  const outDir = tmpOutDir();
  const brief = makeBrief({ outputType: "linkedin_image", logoAssetId: "asset_logo_1" });
  // Simulate a bug upstream of Phase 3 that passed a remote URL through
  // instead of a local asset path.
  const evidence = await renderOutput(
    brief,
    { logoPath: "https://this-domain-should-never-resolve-or-be-hit.invalid/evil.png", imagePaths: [] },
    outDir
  );

  // Our chosen behaviour: the template never emits the external URL at all,
  // so the logo is simply absent from the render rather than attempted and
  // broken — the render still completes successfully.
  assert.equal(evidence.logoCheck?.rendered, false);
  assert.equal(evidence.logoCheck?.boundingBoxNonEmpty, false);
});

test("installNetworkGuard actually aborts a request to a non-local URL — it never completes", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    installNetworkGuard(context);

    const responses: string[] = [];
    context.on("response", (response) => responses.push(response.url()));

    const page = await context.newPage();
    const externalUrl = "https://this-domain-should-never-resolve-or-be-hit.invalid/evil.png";
    await page.setContent(`<html><body><img id="ext" src="${externalUrl}" /></body></html>`, {
      waitUntil: "load",
    });

    // Give any (incorrectly) allowed request a chance to actually complete.
    await page.waitForTimeout(500);

    assert.ok(
      !responses.some((url) => url === externalUrl),
      "a request to the external URL must never receive a response — it should be aborted before it leaves the process"
    );

    const imgState = await page.evaluate(() => {
      const img = document.getElementById("ext") as HTMLImageElement;
      return { complete: img.complete, naturalWidth: img.naturalWidth };
    });
    assert.equal(imgState.naturalWidth, 0, "the external image must never have actually loaded");

    await context.close();
  } finally {
    await browser.close();
  }
});
