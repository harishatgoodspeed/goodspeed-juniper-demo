import { reviewOutput, type ReviewOptions } from "./review";
import type { Brief, RenderEvidence, RepairAttempt, ReviewResult, ReviewWithRepairResult } from "../pipeline-types";

/**
 * What this phase can actually repair by changing the brief and
 * re-rendering — deliberately narrow, and deliberately never an LLM call
 * (an LLM-based "try again" would spend real money per repair attempt,
 * against a free tool's per-visitor/global daily spend caps, for a fix this
 * phase can't even verify will land before spending it):
 *
 * - colour: the realistic fix is "the brief specified the wrong palette
 *   hex" — swap it for the approved one and re-render.
 * - copy, but only the mechanical "no exclamation points" rule
 *   (review.ts's copyCheck fails this without even calling the model): a
 *   deterministic text fix, not a judgement call, so no re-assessment risk.
 *
 * Everything else (typography, logo, copy failures the model actually had
 * to judge — an invented claim, a voice mismatch) isn't something a brief
 * field can deterministically fix, so it's left unresolved rather than
 * papered over or silently retried.
 */
function computeFix(
  brief: Brief,
  review: ReviewResult
): { brief: Brief; changedFields: Record<string, { from: unknown; to: unknown }> } | null {
  const colourFailure = review.checks.find((c) => c.kind === "colour" && c.status === "fail");
  if (colourFailure) {
    const wrongHex = colourFailure.observed.toLowerCase();
    const correctHex = colourFailure.approved;
    const newHexes = brief.paletteTokenHexes.map((h) => (h.toLowerCase() === wrongHex ? correctHex : h));

    return {
      brief: { ...brief, paletteTokenHexes: newHexes },
      changedFields: { paletteTokenHexes: { from: brief.paletteTokenHexes, to: newHexes } },
    };
  }

  const exclamationFailure = review.checks.find(
    (c) => c.kind === "copy" && c.status === "fail" && /exclamation/i.test(c.explanation)
  );
  if (exclamationFailure && brief.postCopyText && brief.postCopyText.includes("!")) {
    const fixedText = brief.postCopyText.replace(/!+/g, ".");
    return {
      brief: { ...brief, postCopyText: fixedText },
      changedFields: { postCopyText: { from: brief.postCopyText, to: fixedText } },
    };
  }

  return null;
}

export async function reviewWithRepair(
  evidence: RenderEvidence,
  brief: Brief,
  render: (brief: Brief) => Promise<RenderEvidence>,
  maxAttempts = 2,
  options: ReviewOptions = {}
): Promise<ReviewWithRepairResult> {
  let currentBrief = brief;
  let review = await reviewOutput(evidence, currentBrief, options);

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
    const after = await reviewOutput(newEvidence, currentBrief, options);

    repairs.push({ attempt, changedFields: fix.changedFields, before, after });
    review = after;

    if (review.overallPass) break;
  }

  return { finalReview: review, repairs, unresolved: !review.overallPass };
}
