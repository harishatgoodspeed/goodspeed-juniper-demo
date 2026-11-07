import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Brief } from "../src/pipeline-types";
import { renderOutput } from "../src/generate/render";
import type { ResolvedFontFace } from "../src/generate/font-assets";

/**
 * End-to-end proof (real Playwright, no mocks) that an @font-face declared
 * from a real embedded font file actually gets used by the renderer and is
 * detected as loaded — not just that font-assets.ts can parse CSS and build
 * a data URI (tests/font-assets.test.ts already proves that in isolation).
 *
 * Uses a real local TTF from this machine's own font library, registered
 * under a family name nothing on the system actually has, so a pass can
 * only mean our @font-face/data-URI wiring in templates.ts + render.ts
 * genuinely works — never that the OS happened to resolve the name itself.
 * Skips (never fails) when that font file isn't present, since it's a
 * machine-local fixture, not a repo asset.
 */
const CANDIDATE_FONT_PATHS = [
  "/System/Library/Fonts/Supplemental/Apple Chancery.ttf",
  "/System/Library/Fonts/Supplemental/Zapfino.ttf",
];

const FAKE_FAMILY = "Goodspeed Embedded Test Font";

function findRealFontFile(): string | null {
  return CANDIDATE_FONT_PATHS.find((p) => fs.existsSync(p)) ?? null;
}

function tmpOutDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "font-embedding-test-"));
}

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    outputType: "linkedin_image",
    purpose: "Announce the new collection",
    audience: "Wholesale buyers",
    sourcedFactualCopy: ["Launching in six retail partners this spring."],
    layoutDirection: "text-only, centred",
    paletteTokenHexes: ["#F2ECDF", "#1F3A2E", "#2B2B28", "#C97B4A"],
    fontFamilies: [FAKE_FAMILY, FAKE_FAMILY],
    logoAssetId: null,
    imageAssetIds: [],
    voiceGuidance: "Confident.",
    unknowns: [],
    ...overrides,
  };
}

test("a real embedded font file is actually used by the renderer and detected as loaded", async (t) => {
  const fontPath = findRealFontFile();
  if (!fontPath) {
    t.skip("no real local TTF fixture available on this machine");
    return;
  }

  const dataUri = `data:font/ttf;base64,${fs.readFileSync(fontPath).toString("base64")}`;
  const fontFaces = new Map<string, ResolvedFontFace>([[FAKE_FAMILY, { family: FAKE_FAMILY, format: "ttf", dataUri }]]);

  const outDir = tmpOutDir();
  const brief = makeBrief();
  const evidence = await renderOutput(brief, { imagePaths: [], fontFaces }, outDir);

  const heading = evidence.fontChecks.find((c) => c.role === "heading");
  assert.ok(heading, "expected a heading font check");
  assert.equal(heading!.expectedFamily, FAKE_FAMILY);
  assert.equal(heading!.loaded, true, "a real @font-face embed must be detected as loaded, not silently falling back");
});

test("without a resolved font face, the same unrecognised family honestly fails to load", async () => {
  const outDir = tmpOutDir();
  const brief = makeBrief();
  // No fontFaces at all this time — proves the control case: an approved
  // family name with no real file behind it still fails to load, exactly as
  // it did before this phase.
  const evidence = await renderOutput(brief, { imagePaths: [] }, outDir);

  const heading = evidence.fontChecks.find((c) => c.role === "heading");
  assert.ok(heading);
  assert.equal(heading!.loaded, false);
});
