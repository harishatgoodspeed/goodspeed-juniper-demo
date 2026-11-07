import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewOutput } from "../src/review/review";
import { compareHex } from "../src/review/colour";
import { writeSolidPng } from "./helpers/png";
import type { Brief, RenderEvidence } from "../src/pipeline-types";
import type { CopyAssessmentClient } from "../src/review/copy-assessment";

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

function mockCopyClient(parsedOutput: unknown): CopyAssessmentClient {
  return { messages: { parse: async () => ({ parsed_output: parsedOutput }) } };
}

test("compareHex returns 0 for identical colours and a large value for very different ones", () => {
  assert.equal(compareHex("#C6DD66", "#C6DD66"), 0);
  assert.ok(compareHex("#C6DD66", "#1F3A2E") > 10);
});

test("colour check passes when the rendered region matches the approved hex", async () => {
  const filePath = writeSolidPng(40, 40, "#C6DD66");
  const evidence = fixtureEvidence({
    filePath,
    regions: [{ label: "background", x: 0, y: 0, width: 40, height: 40, expectedHex: "#C6DD66", expectedHexApproved: true }],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const colour = result.checks.find((c) => c.kind === "colour" && c.observed !== "n/a");
  assert.equal(colour?.status, "pass");
  assert.equal(colour?.deltaE, 0);
});

test("colour check fails when the rendered region does not match, with a real deltaE", async () => {
  const filePath = writeSolidPng(40, 40, "#6680DD");
  const evidence = fixtureEvidence({
    filePath,
    regions: [{ label: "background", x: 0, y: 0, width: 40, height: 40, expectedHex: "#C6DD66", expectedHexApproved: true }],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const colour = result.checks.find((c) => c.kind === "colour" && c.observed !== "n/a");
  assert.equal(colour?.status, "fail");
  assert.ok((colour?.deltaE ?? 0) > 4, `expected a large deltaE, got ${colour?.deltaE}`);
  assert.equal(result.overallPass, false);
});

test("colour checks are not_applicable (never silently absent) when there are no regions", async () => {
  const evidence = fixtureEvidence({ outputType: "one_pager_pdf" });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "one_pager_pdf" }));
  const colour = result.checks.find((c) => c.kind === "colour");
  assert.ok(colour, "expected a colour check row to exist even when not applicable");
  assert.equal(colour!.status, "not_applicable");
});

test("colour check is not_applicable, never a fabricated pass, when the region used the renderer's internal fallback instead of an approved colour", async () => {
  const filePath = writeSolidPng(40, 40, "#1F3A2E"); // the renderer's own DEFAULT_PALETTE.primary
  const evidence = fixtureEvidence({
    filePath,
    regions: [{ label: "brand-bar", x: 0, y: 0, width: 40, height: 40, expectedHex: "#1F3A2E", expectedHexApproved: false }],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const colour = result.checks.find((c) => c.kind === "colour");
  assert.equal(colour?.status, "not_applicable");
  assert.match(colour!.explanation, /internal neutral default/);
});

test("typography: missing evidence is not_verified, never pass", async () => {
  const evidence = fixtureEvidence({
    fontChecks: [{ role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "", loaded: false }],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "not_verified");
});

test("typography: a loaded, matching computed font passes", async () => {
  const evidence = fixtureEvidence({
    fontChecks: [
      { role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "Inter, sans-serif", loaded: true },
    ],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "pass");
});

test("typography: loaded but a different font fails", async () => {
  const evidence = fixtureEvidence({
    fontChecks: [{ role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "Arial", loaded: true }],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "fail");
});

test("typography is not_applicable, never a fabricated pass, when the role used the renderer's internal fallback font instead of an approved one", async () => {
  const evidence = fixtureEvidence({
    fontChecks: [
      { role: "heading", expectedFamily: "Georgia", expectedFamilyApproved: false, computedFamily: "Georgia, serif", loaded: true },
    ],
  });
  const result = await reviewOutput(evidence, fixtureBrief());
  const typo = result.checks.find((c) => c.kind === "typography");
  assert.equal(typo?.status, "not_applicable");
  assert.match(typo!.explanation, /internal fallback font/);
});

test("logo: no approved logo is not_applicable", async () => {
  const evidence = fixtureEvidence();
  const result = await reviewOutput(evidence, fixtureBrief({ logoAssetId: null }));
  const logo = result.checks.find((c) => c.kind === "logo");
  assert.equal(logo?.status, "not_applicable");
});

test("logo: approved logo set but no render evidence is not_verified, never pass", async () => {
  const evidence = fixtureEvidence({ logoCheck: null });
  const result = await reviewOutput(evidence, fixtureBrief({ logoAssetId: "asset_logo_1" }));
  const logo = result.checks.find((c) => c.kind === "logo");
  assert.equal(logo?.status, "not_verified");
});

test("logo: rendered with a non-empty bounding box passes", async () => {
  const evidence = fixtureEvidence({
    logoCheck: { expectedAssetId: "asset_logo_1", rendered: true, boundingBoxNonEmpty: true },
  });
  const result = await reviewOutput(evidence, fixtureBrief({ logoAssetId: "asset_logo_1" }));
  const logo = result.checks.find((c) => c.kind === "logo");
  assert.equal(logo?.status, "pass");
});

test("copy: non-post_copy outputs are not_applicable", async () => {
  const evidence = fixtureEvidence({ outputType: "slide" });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "slide" }));
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "not_applicable");
});

test("copy: post_copy with an exclamation mark fails the mechanical sub-check without even calling the model", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We're live now!" });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }));
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "fail");
  assert.match(copy!.explanation, /exclamation/i);
});

test("copy: with no client injected and no ANTHROPIC_API_KEY configured, falls back to not_verified rather than crashing or guessing", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We are now live." });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }));
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "not_verified");
  assert.match(copy!.explanation, /ANTHROPIC_API_KEY is not configured/);
});

test("copy: a real (mocked) assessment that confirms every fact is sourced and the voice matches reports pass", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We are launching in six retail partners this spring." });
  const client = mockCopyClient({
    factsAreAllSourced: true,
    inventedOrUnsupportedClaims: [],
    matchesVoiceGuidance: true,
    voiceMismatchExplanation: "",
  });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }), { copyAssessmentClient: client });
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "pass");
});

test("copy: a (mocked) assessment that finds an invented claim reports fail, never a silent pass", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We've helped over 10,000 brands this year." });
  const client = mockCopyClient({
    factsAreAllSourced: false,
    inventedOrUnsupportedClaims: ["\"over 10,000 brands\" is not in the sourced facts"],
    matchesVoiceGuidance: true,
    voiceMismatchExplanation: "",
  });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }), { copyAssessmentClient: client });
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "fail");
  assert.match(copy!.explanation, /10,000 brands/);
});

test("copy: a (mocked) assessment that finds a voice mismatch reports fail with the model's own explanation", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "Yo, we're kind of a big deal now, check it." });
  const client = mockCopyClient({
    factsAreAllSourced: true,
    inventedOrUnsupportedClaims: [],
    matchesVoiceGuidance: false,
    voiceMismatchExplanation: "The requested voice is confident and professional; this copy reads as casual slang.",
  });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy" }), { copyAssessmentClient: client });
  const copy = result.checks.find((c) => c.kind === "copy");
  assert.equal(copy?.status, "fail");
  assert.match(copy!.explanation, /casual slang/);
});

test("overallPass: by default, a not_verified copy check now blocks overallPass (requireCopyVerified defaults to true)", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We are now live.", regions: [] });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy", logoAssetId: null }));
  assert.equal(result.overallPass, false, "an unverified copy check must not be waved through by default any more");
});

test("overallPass: explicitly opting back into requireCopyVerified=false restores the old best-effort behaviour", async () => {
  const evidence = fixtureEvidence({ outputType: "post_copy", filePath: null, text: "We are now live.", regions: [] });
  const result = await reviewOutput(evidence, fixtureBrief({ outputType: "post_copy", logoAssetId: null }), {
    requireCopyVerified: false,
  });
  assert.equal(result.overallPass, true);
});

test("overallPass: a not_verified logo check always blocks overallPass (no special-casing beyond copy)", async () => {
  const evidence = fixtureEvidence({ logoCheck: null });
  const result = await reviewOutput(evidence, fixtureBrief({ logoAssetId: "asset_logo_1" }));
  assert.equal(result.overallPass, false);
});
