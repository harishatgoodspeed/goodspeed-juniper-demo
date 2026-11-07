import { compareHex, sampleRegionHex } from "./colour";
import { config } from "../config";
import type { Brief, CheckStatus, RenderEvidence, ReviewCheck, ReviewResult } from "../pipeline-types";

export interface ReviewOptions {
  colourDeltaEThreshold?: number;
  /**
   * The copy check is a "not_verified" stub until Phase 2's real AI voice/fact
   * assessment is wired in (see README) — defaulting this to false means a
   * missing copy assessment doesn't block overallPass in the meantime.
   * Flip to true once a real assessment exists, so an unverified copy claim
   * once again counts against overallPass like every other check kind.
   */
  requireCopyVerified?: boolean;
}

export function reviewOutput(evidence: RenderEvidence, brief: Brief, options: ReviewOptions = {}): ReviewResult {
  const threshold = options.colourDeltaEThreshold ?? config.COLOUR_DELTA_E_THRESHOLD;
  const requireCopyVerified = options.requireCopyVerified ?? false;

  const checks: ReviewCheck[] = [
    ...colourChecks(evidence, threshold),
    ...typographyChecks(evidence),
    logoCheck(evidence, brief),
    copyCheck(evidence),
  ];

  const overallPass = checks.every((c) => {
    if (c.status === "not_applicable") return true;
    if (c.status === "not_verified" && c.kind === "copy" && !requireCopyVerified) return true;
    return c.status === "pass";
  });

  return { checks, overallPass };
}

function colourChecks(evidence: RenderEvidence, threshold: number): ReviewCheck[] {
  if (evidence.regions.length === 0) {
    return [
      {
        kind: "colour",
        status: "not_applicable",
        observed: "n/a",
        approved: "n/a",
        explanation:
          evidence.outputType === "one_pager_pdf"
            ? "No colour regions were supplied for this PDF output; colour review does not apply here."
            : "This output has no colour regions to check.",
      },
    ];
  }

  return evidence.regions
    .filter((r) => r.expectedHex !== null)
    .map((region): ReviewCheck => {
      if (!region.expectedHexApproved) {
        return {
          kind: "colour",
          status: "not_applicable",
          observed: "n/a",
          approved: "n/a",
          explanation: `Region "${region.label}" rendered with the renderer's internal neutral default (${region.expectedHex}), not an approved brand colour — no colour was approved for this role, so there is nothing to validate against.`,
        };
      }
      if (!evidence.filePath) {
        return {
          kind: "colour",
          status: "not_applicable",
          observed: "n/a",
          approved: region.expectedHex!,
          explanation: `Region "${region.label}" has an expected colour but no rendered file exists to sample it from.`,
        };
      }
      let observedHex: string;
      try {
        observedHex = sampleRegionHex(evidence.filePath, region);
      } catch (err) {
        return {
          kind: "colour",
          status: "not_verified",
          observed: "unreadable",
          approved: region.expectedHex!,
          explanation: `Could not sample region "${region.label}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      const deltaE = compareHex(observedHex, region.expectedHex!);
      const pass = deltaE <= threshold;
      return {
        kind: "colour",
        status: pass ? "pass" : "fail",
        observed: observedHex,
        approved: region.expectedHex!,
        deltaE,
        explanation: pass
          ? `Region "${region.label}" matches the approved colour (ΔE2000 ${deltaE.toFixed(2)}, threshold ${threshold}).`
          : `Region "${region.label}" does not match the approved colour (ΔE2000 ${deltaE.toFixed(2)} exceeds threshold ${threshold}). Sampled from the interior of the region, excluding edge pixels, to avoid antialiasing.`,
      };
    });
}

function typographyChecks(evidence: RenderEvidence): ReviewCheck[] {
  if (evidence.fontChecks.length === 0) {
    return [
      {
        kind: "typography",
        status: "not_applicable",
        observed: "n/a",
        approved: "n/a",
        explanation: "No typography evidence applies to this output.",
      },
    ];
  }
  return evidence.fontChecks.map((f): ReviewCheck => {
    if (!f.expectedFamilyApproved) {
      return {
        kind: "typography",
        status: "not_applicable",
        observed: "n/a",
        approved: "n/a",
        explanation: `"${f.role}" rendered with the renderer's internal fallback font (${f.expectedFamily}), not an approved brand font — no font was approved for this role, so there is nothing to validate against.`,
      };
    }
    if (!f.loaded && !f.computedFamily) {
      return {
        kind: "typography",
        status: "not_verified",
        observed: "no evidence recorded",
        approved: f.expectedFamily,
        explanation: `No render-time evidence that "${f.role}" actually used ${f.expectedFamily} — a CSS declaration alone does not prove the font loaded. Not verified, not failed or passed.`,
      };
    }
    const matches = f.loaded && f.computedFamily.toLowerCase().includes(f.expectedFamily.toLowerCase());
    return {
      kind: "typography",
      status: matches ? "pass" : "fail",
      observed: f.computedFamily || "(no font loaded)",
      approved: f.expectedFamily,
      explanation: matches
        ? `"${f.role}" computed to ${f.computedFamily}, matching the approved ${f.expectedFamily}.`
        : `"${f.role}" computed to "${f.computedFamily || "nothing"}" (loaded: ${f.loaded}), not the approved ${f.expectedFamily}.`,
    };
  });
}

function logoCheck(evidence: RenderEvidence, brief: Brief): ReviewCheck {
  if (brief.logoAssetId === null) {
    return {
      kind: "logo",
      status: "not_applicable",
      observed: "no logo expected",
      approved: "none",
      explanation: "No approved logo was supplied for this brief, so no logo is expected in the output.",
    };
  }

  const ev = evidence.logoCheck;
  if (!ev || ev.expectedAssetId !== brief.logoAssetId || !ev.rendered || !ev.boundingBoxNonEmpty) {
    return {
      kind: "logo",
      status: "not_verified",
      observed: ev ? `rendered=${ev.rendered}, boundingBoxNonEmpty=${ev.boundingBoxNonEmpty}` : "no render evidence",
      approved: brief.logoAssetId,
      explanation:
        "This is a presence check, not proof of exact visual fidelity. No confirmed evidence that the approved logo rendered with a non-empty bounding box, so this is not verified rather than failed or passed.",
    };
  }

  return {
    kind: "logo",
    status: "pass",
    observed: `rendered with a non-empty bounding box (asset ${ev.expectedAssetId})`,
    approved: brief.logoAssetId,
    explanation: "This is a presence check, not proof of exact visual fidelity: the approved logo asset rendered with a non-empty bounding box.",
  };
}

function copyCheck(evidence: RenderEvidence): ReviewCheck {
  if (evidence.outputType !== "post_copy") {
    return {
      kind: "copy",
      status: "not_applicable",
      observed: "n/a",
      approved: "n/a",
      explanation: "Copy review applies to the post_copy output only.",
    };
  }

  const text = evidence.text ?? "";
  const hasExclamation = text.includes("!");
  const phase2Note =
    "A full AI voice/fact assessment against the brief's sourced copy and voice guidance is Phase 2+ work, not yet wired in here — when it exists it is an AI assessment, not a guarantee.";

  if (hasExclamation) {
    // This one sub-check is real and mechanical (not an LLM judgement), so it
    // can genuinely fail rather than sit at not_verified like the rest of the
    // copy assessment.
    return {
      kind: "copy",
      status: "fail",
      observed: text || "(empty)",
      approved: "no exclamation points (seeded voice rule)",
      explanation: `Fails the seeded voice rule "no exclamation points": the copy contains an exclamation mark. ${phase2Note}`,
    };
  }

  return {
    kind: "copy",
    status: "not_verified",
    observed: text || "(empty)",
    approved: "sourced facts only, voice guidance followed",
    explanation: `${phase2Note} One mechanical sub-check did run: the copy passes the seeded voice rule "no exclamation points".`,
  };
}

/** Re-exported for callers that only need the status union type. */
export type { CheckStatus };
