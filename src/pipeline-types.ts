/**
 * Shared contracts between Phase 2 (briefs), Phase 3 (rendering), and
 * Phase 4 (review). Each phase is being built in its own isolated worktree
 * in parallel; this file is the one thing all three agree on ahead of time
 * so their work integrates without having seen each other's code.
 *
 * Do not invent fields outside this contract without updating it here first —
 * the whole point is that the three phases don't silently drift apart.
 */

export type OutputType = "linkedin_image" | "x_image" | "instagram_image" | "one_pager_pdf" | "slide" | "post_copy";

/**
 * One brief, as returned by Phase 2 and consumed by Phase 3 and Phase 4.
 * Every reference field (paletteTokenHexes, fontFamilies, logoAssetId,
 * imageAssetIds) MUST be validated by Phase 2 against the brand's actual
 * approved_context_json and source_assets before this object is trusted —
 * never pass through an LLM-invented ID or hex unchecked.
 */
export interface Brief {
  outputType: OutputType;
  purpose: string;
  audience: string;
  /** Short factual statements. Each one must be traceable to the approved brand context (description/textExcerpt) — never invented. */
  sourcedFactualCopy: string[];
  layoutDirection: string;
  /** Must be a subset of the approved context's palette hexes. */
  paletteTokenHexes: string[];
  /** Must be a subset of the approved context's font families. */
  fontFamilies: string[];
  /** Must reference an approved source_assets.id, or null if none was approved. */
  logoAssetId: string | null;
  /** Must reference approved source_assets.id values. */
  imageAssetIds: string[];
  voiceGuidance: string;
  unknowns: string[];
  /** Present only when outputType === "post_copy". Sourced facts only, no invented quotes/metrics/offers. */
  postCopyText?: string;
}

export interface BriefSet {
  briefs: Brief[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
}

/** A sampled region of a rendered PNG, for colour review. Coordinates are pixels in the rendered image. */
export interface RenderRegion {
  label: string; // e.g. "background", "headline-text", "cta-button"
  x: number;
  y: number;
  width: number;
  height: number;
  /** The approved colour token (hex) this region is supposed to match, or null if this region isn't a colour check target. */
  expectedHex: string | null;
  /**
   * False when expectedHex came from the renderer's internal neutral default
   * (see templates.ts's DEFAULT_PALETTE) because no approved colour filled
   * this role, rather than from the brief's own paletteTokenHexes. Review
   * must not report a "pass" against a value nothing was actually approved
   * against — that would be checking the render against itself.
   */
  expectedHexApproved: boolean;
}

export interface FontCheckEvidence {
  role: string; // e.g. "heading", "body"
  expectedFamily: string;
  /** False when expectedFamily is the renderer's internal fallback (Georgia/Arial) because no approved font filled this role, not a real approved family. */
  expectedFamilyApproved: boolean;
  /** The actual computed font-family at render time (from getComputedStyle), not just the CSS declaration. */
  computedFamily: string;
  /** From document.fonts — a declared font-family alone does not prove the font loaded. */
  loaded: boolean;
}

export interface LogoCheckEvidence {
  expectedAssetId: string | null;
  /** The logo element was present in the rendered output at all. */
  rendered: boolean;
  /** Non-empty CSS bounding box. Every template sets an explicit width/height on the logo element, so this alone is true even when the image never actually decoded — see naturalWidth/naturalHeight for that. */
  boundingBoxNonEmpty: boolean;
  /** The image's actual decoded pixel dimensions (HTMLImageElement.naturalWidth/Height). Zero means the browser never decoded real image data from the src — a broken file, a 404, or a corrupt asset — even though boundingBoxNonEmpty is still true. */
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Real visual fidelity, beyond presence: 0-1 pixel similarity between the
   * rendered logo region and a fresh, independent reference render of the
   * *same* approved asset file at the same box size/background (see
   * src/generate/logo-fidelity.ts). Null when it couldn't be computed (e.g.
   * no render evidence, or the image never decoded in the main render) —
   * never a fabricated score.
   */
  similarity: number | null;
}

/**
 * What Phase 3's renderer produces for one output, and what Phase 4's
 * reviewer consumes. `render()` itself is exposed as a plain async function
 * (see each phase's own module) so Phase 4's repair loop can call it again
 * with adjusted templateInputs without importing anything Phase 3-specific.
 */
export interface RenderEvidence {
  outputType: OutputType;
  /** Absolute path to the rendered file (PNG for linkedin_image/slide, PDF for one_pager_pdf; post_copy has no file, just text). */
  filePath: string | null;
  width: number;
  height: number;
  regions: RenderRegion[];
  fontChecks: FontCheckEvidence[];
  logoCheck: LogoCheckEvidence | null;
  /** True if content overflowed its container at render time — must be checked, not assumed false. */
  overflow: boolean;
  /** For post_copy: the literal text produced, so review's copy check has something to assess. */
  text?: string;
}

export type CheckStatus = "pass" | "fail" | "not_applicable" | "not_verified";

export interface ReviewCheck {
  kind: "colour" | "typography" | "logo" | "copy";
  status: CheckStatus;
  observed: string;
  approved: string;
  explanation: string;
  /** Colour checks only: CIEDE2000 distance between observed and approved. */
  deltaE?: number;
}

export interface ReviewResult {
  checks: ReviewCheck[];
  /** True only if every *applicable* check is "pass" (not_applicable/not_verified don't count against this, but don't count for it either — see each check's own status). */
  overallPass: boolean;
}

export interface RepairAttempt {
  attempt: number;
  changedFields: Record<string, { from: unknown; to: unknown }>;
  before: ReviewResult;
  after: ReviewResult;
}

export interface ReviewWithRepairResult {
  finalReview: ReviewResult;
  /** Empty if the first review already passed — "If everything passed first time, say so," never a manufactured failure. */
  repairs: RepairAttempt[];
  /** True if finalReview.overallPass is false after exhausting repair attempts — the run is partial, not silently successful. */
  unresolved: boolean;
}
