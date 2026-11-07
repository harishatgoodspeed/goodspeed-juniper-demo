import { unsupportedNumericTokens, verifyCitedClaims, type LedgerEntry } from "../ledger";
import type { EnglishChoice, FormatFamily, PostChannel, PostDraft } from "./types";
import { LINKEDIN_CHAR_LIMIT, X_CHAR_LIMIT } from "./types";

export class PostDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostDraftError";
  }
}

const CAROUSEL = new Set(["carousel-steps", "carousel-checklist"]);
const EXPLAINER = new Set(["explainer-framework", "explainer-comparison"]);
const PROOF_WITH_IMAGES = new Set(["proof-annotation", "proof-split"]);
const PROOF_TEXT = new Set(["text-pov", "text-columns"]);

export interface DraftContext {
  colours: string[];
  fonts: string[];
  logoAssetId: string | null;
  approvedImageIds: string[];
  ledger: LedgerEntry[];
  channel: PostChannel;
  englishVariant: EnglishChoice;
  ownedImageCount: number;
}

function assertPalette(draft: PostDraft, colours: string[], index: number): void {
  const allowed = new Set(colours.map((hex) => hex.toLowerCase()));
  if (draft.paletteTokenHexes.length === 0) {
    throw new PostDraftError(`Post ${index + 1} has no palette colours.`);
  }
  for (const hex of draft.paletteTokenHexes) {
    if (!allowed.has(hex.toLowerCase())) {
      throw new PostDraftError(`Post ${index + 1} used an unapproved colour ${hex}.`);
    }
  }
}

function assertFonts(draft: PostDraft, fonts: string[], index: number): void {
  const allowed = new Set(fonts.map((font) => font.toLowerCase()));
  for (const font of draft.fontFamilies) {
    if (!allowed.has(font.toLowerCase())) {
      throw new PostDraftError(`Post ${index + 1} used an unapproved font ${font}.`);
    }
  }
}

function looksTruncated(longText: string, shortText: string): boolean {
  const long = longText.replace(/\s+/g, " ").trim();
  const short = shortText.replace(/\s+/g, " ").trim();
  if (!short || short.length >= long.length) return false;
  return long.startsWith(short);
}

function compositionFor(draft: PostDraft, ownedImageCount: number): string {
  if (draft.formatFamily === "carousel") {
    if (!CAROUSEL.has(draft.compositionId)) return "carousel-steps";
    return draft.compositionId;
  }
  if (draft.formatFamily === "explainer") {
    if (!EXPLAINER.has(draft.compositionId)) return "explainer-framework";
    return draft.compositionId;
  }
  if (PROOF_WITH_IMAGES.has(draft.compositionId)) {
    if (draft.compositionId === "proof-split" && ownedImageCount >= 2) return "proof-split";
    if (ownedImageCount >= 1 && (draft.compositionId === "proof-annotation" || draft.compositionId === "proof-split")) {
      return "proof-annotation";
    }
  }
  if (PROOF_TEXT.has(draft.compositionId)) return draft.compositionId;
  return ownedImageCount >= 1 ? "proof-annotation" : "text-pov";
}

export function normalisePostDrafts(raw: PostDraft[], context: DraftContext): PostDraft[] {
  if (raw.length < 3 || raw.length > 5) {
    throw new PostDraftError("A free run needs three posts, and never more than five.");
  }
  const families = new Set(raw.map((post) => post.formatFamily));
  for (const family of ["carousel", "explainer", "proof"] as FormatFamily[]) {
    if (!families.has(family)) throw new PostDraftError(`Missing the ${family} post.`);
  }
  if (new Set(raw.map((post) => post.formatFamily)).size !== raw.length) {
    throw new PostDraftError("Each post must be a different format. A resized file is not a new post.");
  }

  return raw.map((draft, index) => {
    const compositionId = compositionFor(draft, context.ownedImageCount);
    const substituted = draft.formatFamily === "proof" && compositionId !== draft.compositionId && PROOF_TEXT.has(compositionId);
    const next: PostDraft = {
      ...draft,
      compositionId,
      hookAlternatives: draft.hookAlternatives.slice(0, 3),
      imageAssetIds:
        compositionId === "proof-annotation" || compositionId === "proof-split" ? draft.imageAssetIds : [],
      rationale: substituted
        ? `${draft.rationale} Proof images were not available, so this is a text led post.`.trim()
        : draft.rationale,
    };

    if (!next.hookAlternatives.includes(next.hook)) next.hookAlternatives.unshift(next.hook);
    next.hookAlternatives = next.hookAlternatives.slice(0, 3);
    if (next.hookAlternatives.length < 2) {
      throw new PostDraftError(`Post ${index + 1} needs at least two hook alternatives.`);
    }
    if (next.caption.includes("!") || next.hook.includes("!") || next.xCaption.includes("!") || next.pages.some((p) => `${p.heading}${p.body}`.includes("!"))) {
      throw new PostDraftError(`Post ${index + 1} contains an exclamation mark.`);
    }
    if (next.caption.length > LINKEDIN_CHAR_LIMIT) {
      throw new PostDraftError(`Post ${index + 1} caption is over the LinkedIn character limit.`);
    }
    if (next.xCaption.length > X_CHAR_LIMIT) {
      throw new PostDraftError(`Post ${index + 1} X copy is over ${X_CHAR_LIMIT} characters.`);
    }
    if (looksTruncated(next.caption, next.xCaption)) {
      throw new PostDraftError(`Post ${index + 1} X copy is a shortened LinkedIn caption. Write it separately.`);
    }
    if (next.formatFamily === "carousel" && (next.pages.length < 6 || next.pages.length > 8)) {
      throw new PostDraftError(`The carousel needs 6 to 8 pages. This one has ${next.pages.length}.`);
    }
    if (next.formatFamily !== "carousel" && next.pages.length < 3) {
      throw new PostDraftError(`Post ${index + 1} needs at least three short points.`);
    }
    if (next.logoAssetId && next.logoAssetId !== context.logoAssetId) {
      throw new PostDraftError(`Post ${index + 1} referenced a logo that was not approved.`);
    }
    const allowedImages = new Set(context.approvedImageIds);
    for (const id of next.imageAssetIds) {
      if (!allowedImages.has(id)) {
        throw new PostDraftError(`Post ${index + 1} referenced an image that was not confirmed as yours.`);
      }
    }
    if (compositionId === "proof-split" && next.imageAssetIds.length < 2) {
      throw new PostDraftError("A before and after needs two confirmed images.");
    }
    assertPalette(next, context.colours, index);
    assertFonts(next, context.fonts, index);

    const cited = verifyCitedClaims(next.claims, context.ledger);
    if (!cited.ok) throw new PostDraftError(cited.reason);

    const visible = [next.caption, next.xCaption, next.hook, next.title, ...next.pages.map((p) => `${p.heading} ${p.body}`)].join("\n");
    const ledgerBlob = context.ledger.map((entry) => entry.excerpt).join("\n");
    const missing = unsupportedNumericTokens(visible, ledgerBlob);
    if (missing.length > 0) {
      throw new PostDraftError(`Post ${index + 1} uses ${missing.join(", ")} and that figure is not in the source ledger.`);
    }
    return next;
  });
}

export function englishChoiceInstruction(choice: EnglishChoice): string {
  if (choice === "us") {
    return "Write in American English. The visitor chose this explicitly. Do not switch back to British spelling.";
  }
  return "Write in British English. The visitor chose this explicitly. Do not switch to American spelling.";
}
