import { compareHex, sampleRegionHex } from "./colour";
import { assessCopy, type CopyAssessmentClient } from "./copy-assessment";
import { config } from "../config";
import { unsupportedNumericTokens, verifyCitedClaims, type CitedClaim, type LedgerEntry } from "../ledger";
import type { Brief, CheckStatus, RenderEvidence, ReviewCheck, ReviewResult } from "../pipeline-types";

export interface ReviewOptions {
  colourDeltaEThreshold?: number;
  /** Minimum pixel similarity (0-1) a logo's reference-render comparison must meet to pass — see src/generate/logo-fidelity.ts. */
  logoSimilarityThreshold?: number;
  /**
   * Real, public free-tool launch: a copy check sitting at not_verified now
   * blocks overallPass by default, same as any other unverified check — see
   * DEFAULT_REQUIRE_COPY_VERIFIED. Override to false only to deliberately
   * reproduce the old "copy assessment is best-effort" behaviour.
   */
  requireCopyVerified?: boolean;
  /** Injectable for tests, so copy review never needs a real ANTHROPIC_API_KEY to exercise offline. */
  copyAssessmentClient?: CopyAssessmentClient;
  /** Fetched page excerpts. Facts are checked against this, never against a model written whitelist. */
  ledger?: LedgerEntry[];
  claims?: CitedClaim[];
  /** Called with token usage from the copy auditor, including failed parses that still returned usage. */
  onUsage?: (usage: { promptTokens: number; completionTokens: number; kind: string }) => void;
}

export async function reviewOutput(evidence: RenderEvidence, brief: Brief, options: ReviewOptions = {}): Promise<ReviewResult> {
  const threshold = options.colourDeltaEThreshold ?? config.COLOUR_DELTA_E_THRESHOLD;
  const logoSimilarityThreshold = options.logoSimilarityThreshold ?? config.LOGO_SIMILARITY_THRESHOLD;
  const requireCopyVerified = options.requireCopyVerified ?? DEFAULT_REQUIRE_COPY_VERIFIED;

  const checks: ReviewCheck[] = [
    ...colourChecks(evidence, threshold),
    ...typographyChecks(evidence),
    logoCheck(evidence, brief, logoSimilarityThreshold),
    layoutCheck(evidence),
    await copyCheck(evidence, brief, options),
  ];

  return { checks, overallPass: computeOverallPass(checks, requireCopyVerified) };
}

/**
 * Real, public free-tool launch: a copy check sitting at not_verified is no
 * longer given a pass by default — "Brand approved" must mean every check
 * actually passed, copy included, now that copyCheck() below runs a real
 * assessment rather than the earlier stub.
 */
export const DEFAULT_REQUIRE_COPY_VERIFIED = true;

/**
 * The one rule for whether a set of checks counts as fully approved —
 * exported so anything reading already-stored findings back out of the
 * database (the API, the share page) derives the exact same "Draft" vs
 * "Brand approved" answer `reviewOutput` would give, instead of
 * re-implementing or drifting from this rule.
 */
export function computeOverallPass(checks: ReviewCheck[], requireCopyVerified = DEFAULT_REQUIRE_COPY_VERIFIED): boolean {
  if (checks.length === 0) return false;
  return checks.every((c) => {
    if (c.status === "not_applicable") return true;
    if (c.status === "not_verified" && c.kind === "copy" && !requireCopyVerified) return true;
    return c.status === "pass";
  });
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

function logoCheck(evidence: RenderEvidence, brief: Brief, similarityThreshold: number): ReviewCheck {
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
      explanation: "No confirmed evidence that the approved logo rendered with a non-empty bounding box, so this is not verified rather than failed or passed.",
    };
  }

  // A non-empty CSS box proves nothing about whether the image actually
  // decoded — every template sets an explicit width/height on the logo
  // element regardless. naturalWidth/naturalHeight is the real decode proof.
  if (ev.naturalWidth === 0 || ev.naturalHeight === 0) {
    return {
      kind: "logo",
      status: "fail",
      observed: `rendered a non-empty box, but the image never actually decoded (naturalWidth=${ev.naturalWidth}, naturalHeight=${ev.naturalHeight})`,
      approved: brief.logoAssetId,
      explanation: "The logo element had a non-empty CSS box, but the browser never decoded real image data for it — the asset file is likely broken, missing, or corrupt.",
    };
  }

  if (ev.similarity === null) {
    return {
      kind: "logo",
      status: "not_verified",
      observed: `decoded (${ev.naturalWidth}x${ev.naturalHeight}), but fidelity could not be computed against a reference render`,
      approved: brief.logoAssetId,
      explanation: "The logo decoded, but comparing it against an independent reference render of the same approved file failed, so visual fidelity is not verified.",
    };
  }

  if (ev.similarity < similarityThreshold) {
    return {
      kind: "logo",
      status: "fail",
      observed: `pixel similarity ${ev.similarity.toFixed(3)} against a reference render of the approved file (threshold ${similarityThreshold})`,
      approved: brief.logoAssetId,
      explanation: "The rendered logo does not visually match an independent reference render of the same approved asset — this is more than a presence check, and it failed.",
    };
  }

  return {
    kind: "logo",
    status: "pass",
    observed: `decoded (${ev.naturalWidth}x${ev.naturalHeight}) with pixel similarity ${ev.similarity.toFixed(3)} against a reference render of the approved file`,
    approved: brief.logoAssetId,
    explanation: "The approved logo rendered, decoded real image data, and visually matched an independent reference render of the same asset file — real fidelity, not just presence.",
  };
}

function layoutCheck(evidence: RenderEvidence): ReviewCheck {
  if (!evidence.layout) {
    return {
      kind: "layout",
      status: "not_applicable",
      observed: "n/a",
      approved: "n/a",
      explanation: "No layout measurements were recorded for this output. Font and logo checks do not stand in for that.",
    };
  }
  if (evidence.layout.problems.length === 0 && !evidence.overflow) {
    return {
      kind: "layout",
      status: "pass",
      observed: `contrast ${evidence.layout.contrastRatio.toFixed(2)}, body ${evidence.layout.minBodyPx}px`,
      approved: "no overflow, no overlap, readable contrast and type size",
      explanation: "Overflow, overlap, contrast and type size were measured on the rendered page and passed.",
    };
  }
  const problems = [...evidence.layout.problems];
  if (evidence.overflow && !problems.some((p) => /overflow/i.test(p))) problems.push("The page overflowed its frame.");
  return {
    kind: "layout",
    status: "fail",
    observed: problems.join(" "),
    approved: "no overflow, no overlap, readable contrast and type size",
    explanation: problems.join(" "),
  };
}

async function copyCheck(evidence: RenderEvidence, brief: Brief, options: ReviewOptions): Promise<ReviewCheck> {
  const captured = typeof evidence.text === "string" ? evidence.text : evidence.outputType === "post_copy" ? "" : null;
  if (captured === null) {
    return {
      kind: "copy",
      status: "not_applicable",
      observed: "n/a",
      approved: "n/a",
      explanation: "No rendered words were captured for this output, so copy was not checked. This is not a pass.",
    };
  }

  const text = captured;

  if (text.includes("!")) {
    return {
      kind: "copy",
      status: "fail",
      observed: text || "(empty)",
      approved: "no exclamation points (seeded voice rule)",
      explanation: 'Fails the seeded voice rule "no exclamation points": the copy contains an exclamation mark.',
    };
  }

  const ledger = options.ledger ?? [];
  const ledgerBlob = ledger.map((entry) => entry.excerpt).join("\n");
  const missingNumbers = unsupportedNumericTokens(text, ledgerBlob);
  if (missingNumbers.length > 0) {
    return {
      kind: "copy",
      status: "fail",
      observed: text || "(empty)",
      approved: "figures must appear in the source ledger",
      explanation: `Uses ${missingNumbers.join(", ")}, which is not in the source ledger. ${text}`,
    };
  }
  if (options.claims && options.claims.length > 0) {
    const cited = verifyCitedClaims(options.claims, ledger);
    if (!cited.ok) {
      return {
        kind: "copy",
        status: "fail",
        observed: text || "(empty)",
        approved: "claims must cite a real ledger excerpt",
        explanation: cited.reason,
      };
    }
  }

  const assessment = await assessCopy(
    {
      allowedSourceExcerpts: ledger.map((entry) => entry.excerpt),
      voiceGuidance: brief.voiceGuidance,
      text,
    },
    { client: options.copyAssessmentClient }
  );
  options.onUsage?.({
    promptTokens: assessment.promptTokens,
    completionTokens: assessment.completionTokens,
    kind: "copy_review",
  });
  return {
    kind: "copy",
    status: assessment.status,
    observed: text || "(empty)",
    approved: "source ledger only, voice guidance followed",
    explanation: assessment.explanation,
  };
}

/** Re-exported for callers that only need the status union type. */
export type { CheckStatus };
