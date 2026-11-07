import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewWithRepair } from "../src/review/repair";
import { reviewOutput } from "../src/review/review";
import { writeSolidPng, readRegionBytes } from "./helpers/png";
import type { Brief, RenderEvidence } from "../src/pipeline-types";

const APPROVED_HEX = "#C6DD66";
const WRONG_HEX = "#6680DD";

function fixtureBrief(paletteTokenHexes: string[]): Brief {
  return {
    outputType: "linkedin_image",
    purpose: "Announce the new collection",
    audience: "Wholesale buyers",
    sourcedFactualCopy: ["Launching in six retail partners this spring."],
    layoutDirection: "Bold headline over a solid brand-colour background.",
    paletteTokenHexes,
    fontFamilies: ["Inter"],
    logoAssetId: null,
    imageAssetIds: [],
    voiceGuidance: "Confident, no exclamation points.",
    unknowns: [],
  };
}

function evidenceWithRegionColour(hex: string): RenderEvidence {
  return {
    outputType: "linkedin_image",
    filePath: writeSolidPng(40, 40, hex),
    width: 1200,
    height: 627,
    regions: [{ label: "background", x: 0, y: 0, width: 40, height: 40, expectedHex: APPROVED_HEX, expectedHexApproved: true }],
    fontChecks: [],
    logoCheck: null,
    overflow: false,
  };
}

test("deterministic wrong-palette-token fixture: fail -> repair -> pass, with a real computed deltaE and changed pixels", async () => {
  const beforeEvidence = evidenceWithRegionColour(WRONG_HEX);
  const afterEvidence = evidenceWithRegionColour(APPROVED_HEX);

  // Prove the two fixture files really differ before trusting anything else.
  const beforeBytes = readRegionBytes(beforeEvidence.filePath!, 10, 10, 5, 5);
  const afterBytes = readRegionBytes(afterEvidence.filePath!, 10, 10, 5, 5);
  assert.notDeepEqual(beforeBytes, afterBytes, "fixture bug: before/after PNGs must actually differ");

  const brief = fixtureBrief([WRONG_HEX, "#1F3A2E"]);

  // The repair loop's own render() calls happen only *after* the initial
  // (failing) review of beforeEvidence, so every call inside the loop
  // represents a re-render after a fix — here, the fix always succeeds.
  let renderCalls = 0;
  const render = async (_b: Brief): Promise<RenderEvidence> => {
    renderCalls++;
    return afterEvidence;
  };

  // Sanity: the first review genuinely fails with a real, non-trivial deltaE.
  const firstReview = await reviewOutput(beforeEvidence, brief);
  const firstColour = firstReview.checks.find((c) => c.kind === "colour");
  assert.equal(firstColour?.status, "fail");
  assert.ok((firstColour?.deltaE ?? 0) > 10, `expected a large deltaE for a clearly wrong colour, got ${firstColour?.deltaE}`);

  const result = await reviewWithRepair(beforeEvidence, brief, render, 2);

  assert.equal(renderCalls, 1, "a single successful repair should re-render exactly once");
  assert.equal(result.repairs.length, 1);
  assert.equal(result.unresolved, false);
  assert.equal(result.finalReview.overallPass, true);
  assert.equal(result.repairs[0].before.overallPass, false);
  assert.equal(result.repairs[0].after.overallPass, true);
  assert.deepEqual(result.repairs[0].changedFields.paletteTokenHexes.to, [APPROVED_HEX, "#1F3A2E"]);
  assert.deepEqual(result.repairs[0].changedFields.paletteTokenHexes.from, [WRONG_HEX, "#1F3A2E"]);
});

test("exhausted repair: a renderer that keeps producing the wrong colour stays unresolved, never a false pass", async () => {
  const stillWrong = evidenceWithRegionColour(WRONG_HEX);
  const brief = fixtureBrief([WRONG_HEX]);

  let calls = 0;
  const render = async (_b: Brief): Promise<RenderEvidence> => {
    calls++;
    return stillWrong; // always wrong, no matter what the (corrected) brief says
  };

  const result = await reviewWithRepair(stillWrong, brief, render, 2);

  assert.equal(result.unresolved, true);
  assert.equal(result.finalReview.overallPass, false, "must never flip to a false pass");
  assert.equal(result.repairs.length, 2, "should attempt up to maxAttempts, not give up early or loop forever");
  assert.equal(calls, 2);
});

test("a passing first review returns immediately with no manufactured failure", async () => {
  const goodEvidence = evidenceWithRegionColour(APPROVED_HEX);
  const brief = fixtureBrief([APPROVED_HEX]);
  const render = async (): Promise<RenderEvidence> => {
    throw new Error("render should never be called when the first review already passes");
  };

  const result = await reviewWithRepair(goodEvidence, brief, render, 2);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.unresolved, false);
  assert.equal(result.finalReview.overallPass, true);
});

test("a non-colour failure (e.g. typography) is left unresolved with zero repair attempts — not something this phase can fix", async () => {
  const evidence: RenderEvidence = {
    outputType: "linkedin_image",
    filePath: null,
    width: 1200,
    height: 627,
    regions: [],
    fontChecks: [{ role: "heading", expectedFamily: "Inter", expectedFamilyApproved: true, computedFamily: "Arial", loaded: true }],
    logoCheck: null,
    overflow: false,
  };
  const brief = fixtureBrief(["#C6DD66"]);
  const render = async (): Promise<RenderEvidence> => {
    throw new Error("render should never be called — nothing actionable to repair");
  };

  const result = await reviewWithRepair(evidence, brief, render, 2);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.unresolved, true);
  assert.equal(result.finalReview.overallPass, false);
});
