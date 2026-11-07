import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewOutput } from "../src/review/review";
import { compareHex } from "../src/review/colour";
import { writeSolidPng } from "./helpers/png";
import type { Brief, RenderEvidence } from "../src/pipeline-types";

function fixtureBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    outputType: "linkedin_image",
    purpose: "Announce the new collection",
    audience: "Wholesale buyers",
    sourcedFactualCopy: ["Launching in six retail partners this spring."],
    layoutDirection: "Bold headline over a solid brand-colour background.",
    paletteTokenHexes: ["#C6DD66", "#1F3A2E"],
    fontFamilies: ["Inter"],
    logoAssetId: "asset_logo_1",
    imageAssetIds: [],
    voiceGuidance: "Confident, no exclamation points.",
    unknowns: [],
    ...overrides,
  };
}

function fixtureEvidence(overrides: Partial<RenderEvidence> = {}): RenderEvidence {
  return {
    outputType: "linkedin_image",
    filePath: null,
    width: 1200,
    height: 627,
    regions: [],
    fontChecks: [],
    logoCheck: null,
    overflow: false,
    ...overrides,
  };
}

test("compareHex returns 0 for identical colours and a large value for very different ones", () => {
  assert.equal(compareHex("#C6DD66", "#C6DD66"), 0);
  assert.ok(compareHex("#C6DD66", "#1F3A2E") > 10);
});

test("colour check passes when the rendered region matches the approved hex", () => {
  const filePath = writeSolidPng(40, 40, "#C6DD66");
  const evidence = fixtureEvidence({
    filePath,
    regions: [{ label: "background", x: 0, y: 0, width: 40, height: 40, expectedHex: "#C6DD66", expectedHexApproved: true }],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const colour = result.checks.find((c) => c.kind === "colour" && c.observed !== "n/a");
  assert.equal(colour?.status, "pass");
  assert.equal(colour?.deltaE, 0);
});

test("colour check fails when the rendered region does not match, with a real deltaE", () => {
  const filePath = writeSolidPng(40, 40, "#6680DD");
  const evidence = fixtureEvidence({
    filePath,
    regions: [{ label: "background", x: 0, y: 0, width: 40, height: 40, expectedHex: "#C6DD66", expectedHexApproved: true }],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const colour = result.checks.find((c) => c.kind === "colour" && c.observed !== "n/a");
  assert.equal(colour?.status, "fail");
  assert.ok((colour?.deltaE ?? 0) > 4, `expected a large deltaE, got ${colour?.deltaE}`);
  assert.equal(result.overallPass, false);
});

test("colour checks are not_applicable (never silently absent) when there are no regions", () => {
  const evidence = fixtureEvidence({ outputType: "one_pager_pdf" });
  const result = reviewOutput(evidence, fixtureBrief({ outputType: "one_pager_pdf" }));
  const colour = result.checks.find((c) => c.kind === "colour");
  assert.ok(colour, "expected a colour check row to exist even when not applicable");
  assert.equal(colour!.status, "not_applicable");
});

test("colour check is not_applicable, never a fabricated pass, when the region used the renderer's internal fallback instead of an approved colour", () => {
  const filePath = writeSolidPng(40, 40, "#1F3A2E"); // the renderer's own DEFAULT_PALETTE.primary
  const evidence = fixtureEvidence({
    filePath,
    regions: [{ label: "brand-bar", x: 0, y: 0, width: 40, height: 40, expectedHex: "#1F3A2E", expectedHexApproved: false }],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const colour = result.checks.find((c) => c.kind === "colour");
  assert.equal(colour?.status, "not_applicable");
  assert.match(colour!.explanation, /internal neutral default/);
});

test("typography: missing evidence is not_verified, never pass", () => {
  const evidence = fixtureEvidence({
    fontChecks: [{ role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "", loaded: false }],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "not_verified");
});

test("typography: a loaded, matching computed font passes", () => {
  const evidence = fixtureEvidence({
    fontChecks: [
      { role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "Inter, sans-serif", loaded: true },
    ],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "pass");
});

test("typography: loaded but a different font fails", () => {
  const evidence = fixtureEvidence({
    fontChecks: [{ role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "Arial", loaded: true }],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "fail");
});

test("typography is not_applicable, never a fabricated pass, when the role used the renderer's internal fallback font instead of an approved one", () => {
  const evidence = fixtureEvidence({
    fontChecks: [
      { role: "heading", expectedFamily: "Georgia", expectedFamilyApproved: false, computedFamily: "Georgia, serif", loaded: true },
    ],
  });
  const result = reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "not_applicable");
  assert.match(typo!.explanation, /internal fallback font/);
});

test("logo: no approved logo is not_applicable", () => {
  const evidence = fixtureEvidence();
  const result = reviewOutput(evidence, fixtureBrief({ logoAssetId: null }));
  const logo = result.checks.find((c) => c.kind === "logo");
  assert.equal(logo?.status, "not_applicable");
});

test("logo: approved logo set but no render evidence is not_verified, never pass", () => {
  const evidence = fixtureEvidence({ logoCheck: null });
  const result = reviewOutput(evidence, fixtureBrief({ logoAssetId: "asset_logo_1" }));
  const logo = result.checks.find((c) => c.kind === "logo");
  assert.equal(logo?.status, "not_verified");
});

test("logo: rendered with a non-empty bounding box passes", () => {
  const evidence = fixtureEvidence({
    logoCheck: { expectedAssetId: "asset_logo_1", rendered: true, boundingBoxNonEmpty: true },
  });
  const result = reviewOutput(evidence, fixtureBrief({ logoAssetId: "asset_logo_1" }));
  const logo = result.checks.find((c) => c.kind === "logo");
  assert.equal(logo?.status, "pass");
});

test("copy: non-post_copy outputs are not_applicable", () => {
  const evidence = fixtureEvidence({ outputType: "slide" });
  const result = reviewOutput(evidence, fixtureBrief({ outputType: "slide" }));
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "not_applicable");
});

test("copy: post_copy with an exclamation mark fails the mechanical sub-check", () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We're live now!" });
  const result = reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }));
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "fail");
  assert.match(copy!.explanation, /exclamation/i);
});

test("copy: post_copy with no exclamation mark is not_verified (full assessment pending), sub-check noted", () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We are now live." });
  const result = reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }));
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "not_verified");
  assert.match(copy!.explanation, /passes the seeded voice rule/i);
});

test("overallPass: a not_verified copy check does not block overallPass by default (requireCopyVerified=false)", () => {
  const filePath = writeSolidPng(40, 40, "#C6DD66");
  const evidence = fixtureEvidence({
    outputType: "post_copy",
    filePath: null,
    text: "We are now live.",
    regions: [],
  });
  const result = reviewOutput(evidence, fixtureBrief({ outputType: "post_copy", logoAssetId: null }));
  assert.equal(result.overallPass, true, "expected a clean post_copy fixture to pass end to end");
});

test("overallPass: with requireCopyVerified=true, a not_verified copy check does block overallPass", () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We are now live." });
  const result = reviewOutput(evidence, fixtureBrief({ outputType: "post_copy", logoAssetId: null }), {
    requireCopyVerified: true,
  });
  assert.equal(result.overallPass, false);
});

test("overallPass: a not_verified logo check always blocks overallPass (no special-casing beyond copy)", () => {
  const evidence = fixtureEvidence({ logoCheck: null });
  const result = reviewOutput(evidence, fixtureBrief({ logoAssetId: "asset_logo_1" }));
  assert.equal(result.overallPass, false);
});
