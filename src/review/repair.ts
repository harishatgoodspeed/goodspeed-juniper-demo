import { reviewOutput, type ReviewOptions } from "./review";
import type { Brief, RenderEvidence, RepairAttempt, ReviewResult, ReviewWithRepairResult } from "../pipeline-types";

/**
 * Only a failing *colour* check is modelled as repairable here: the
 * realistic fix this phase can make is "the brief specified the wrong
 * palette hex" — correcting `paletteTokenHexes` and asking Phase 3 to
 * re-render. A failing typography/logo/copy check isn't something this brief
 * change can fix, so it's left unresolved rather than papered over.
 */
function computeFix(
  brief: Brief,
  review: ReviewResult
): { brief: Brief; changedFields: Record<string, { from: unknown; to: unknown }> } | null {
  const failure = review.checks.find((c) => c.kind === "colour" && c.status === "fail");
  if (!failure) return null;

  const wrongHex = failure.observed.toLowerCase();
  const correctHex = failure.approved;
  const newHexes = brief.paletteTokenHexes.map((h) => (h.toLowerCase() === wrongHex ? correctHex : h));

  return {
    brief: { ...brief, paletteTokenHexes: newHexes },
    changedFields: { paletteTokenHexes: { from: brief.paletteTokenHexes, to: newHexes } },
  };
}

export async function reviewWithRepair(
  evidence: RenderEvidence,
  brief: Brief,
  render: (brief: Brief) => Promise<RenderEvidence>,
  maxAttempts = 2,
  options: ReviewOptions = {}
): Promise<ReviewWithRepairResult> {
  let currentBrief = brief;
  let review = reviewOutput(evidence, currentBrief, options);

  if (review.overallPass) {
    // If everything passed first time, say so — never manufacture a failure.
    return { finalReview: review, repairs: [], unresolved: false };
  }

  const repairs: RepairAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const fix = computeFix(currentBrief, review);
    if (!fix) break; // nothing this phase knows how to repair

    const before = review;
    currentBrief = fix.brief;
    const newEvidence = await render(currentBrief);
    const after = reviewOutput(newEvidence, currentBrief, options);

    repairs.push({ attempt, changedFields: fix.changedFields, before, after });
    review = after;

    if (review.overallPass) break;
  }

  return { finalReview: review, repairs, unresolved: !review.overallPass };
}
