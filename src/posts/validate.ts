import { unsupportedNumericTokens, verifyCitedClaims, type LedgerEntry } from "../ledger";
import type { EnglishChoice, FormatFamily, PostDraft } from "./types";
import { LINKEDIN_CHAR_LIMIT } from "./types";

export class PostDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostDraftError";
  }
}

const CAROUSEL = new Set(["carousel-steps", "carousel-checklist"]);

export interface DraftContext {
  colours: string[];
  fonts: string[];
  logoAssetId: string | null;
  ledger: LedgerEntry[];
  englishVariant: EnglishChoice;
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

function compositionFor(draft: PostDraft): string {
  if (draft.formatFamily === "carousel") {
    return CAROUSEL.has(draft.compositionId) ? draft.compositionId : "carousel-steps";
  }
  if (draft.formatFamily === "explainer") return "explainer-framework";
  if (draft.formatFamily === "hook") return "hook-text";
  throw new PostDraftError("This free tool does not draft proof posts or screenshots.");
}

export function normalisePostDrafts(raw: PostDraft[], context: DraftContext): PostDraft[] {
  if (raw.length !== 3) {
    throw new PostDraftError("A free run needs exactly three posts: a carousel, a checklist image, and a text hook.");
  }
  const families = new Set(raw.map((post) => post.formatFamily));
  if (!families.has("hook")) throw new PostDraftError("Missing the hook post.");
  for (const family of ["carousel", "explainer"] as FormatFamily[]) {
    if (!families.has(family)) throw new PostDraftError(`Missing the ${family} post.`);
  }
  if (families.size !== 3) {
    throw new PostDraftError("Each post must be a different format. A resized file is not a new post.");
  }

  return raw.map((draft, index) => {
    const compositionId = compositionFor(draft);
    const next: PostDraft = {
      ...draft,
      compositionId,
      hookAlternatives: draft.hookAlternatives.slice(0, 3),
      pages: draft.formatFamily === "hook" ? [] : draft.pages,
      imageAssetIds: [],
    };

    if (!next.hookAlternatives.includes(next.hook)) next.hookAlternatives.unshift(next.hook);
    next.hookAlternatives = next.hookAlternatives.slice(0, 3);
    if (next.hookAlternatives.length < 2) {
      throw new PostDraftError(`Post ${index + 1} needs at least two hook alternatives.`);
    }
    if (!next.hook.trim() || !next.caption.trim()) {
      throw new PostDraftError(`Post ${index + 1} needs a hook and a LinkedIn caption.`);
    }
    const visibleBits = [next.caption, next.hook, next.title, ...next.pages.map((p) => `${p.heading}${p.body}`)];
    if (visibleBits.some((text) => text.includes("!"))) {
      throw new PostDraftError(`Post ${index + 1} contains an exclamation mark.`);
    }
    if (next.caption.length > LINKEDIN_CHAR_LIMIT) {
      throw new PostDraftError(`Post ${index + 1} caption is over the LinkedIn character limit.`);
    }
    if (next.formatFamily === "carousel" && (next.pages.length < 6 || next.pages.length > 8)) {
      throw new PostDraftError(`The carousel needs 6 to 8 pages. This one has ${next.pages.length}.`);
    }
    if (next.formatFamily === "explainer" && next.pages.length < 3) {
      throw new PostDraftError(`The checklist needs at least three short points.`);
    }
    if (next.formatFamily !== "hook" && !next.altText.trim()) {
      throw new PostDraftError(`Post ${index + 1} needs alt text for its image.`);
    }
    if (next.logoAssetId && next.logoAssetId !== context.logoAssetId) {
      throw new PostDraftError(`Post ${index + 1} referenced a logo that was not approved.`);
    }
    assertPalette(next, context.colours, index);
    assertFonts(next, context.fonts, index);

    const cited = verifyCitedClaims(next.claims, context.ledger);
    if (!cited.ok) throw new PostDraftError(cited.reason);

    const visible = [next.caption, next.hook, next.title, ...next.pages.map((p) => `${p.heading} ${p.body}`)].join("\n");
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
