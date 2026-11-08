import { unsupportedNumericTokens, verifyCitedClaims, type LedgerEntry } from "../ledger";
import type { EnglishChoice, FormatFamily, PostChannel, PostDraft } from "./types";
import { HOOK_COMPOSITION_ID, LINKEDIN_CHAR_LIMIT } from "./types";

export class PostDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostDraftError";
  }
}

const CAROUSEL = new Set(["carousel-steps", "carousel-checklist"]);
const REQUIRED: FormatFamily[] = ["carousel", "explainer", "hook"];

/** Lengths the portrait layouts can hold without clipping or shrinking type below 30px. */
const CAROUSEL_HEADING = 72;
const CAROUSEL_BODY = 180;
const CHECKLIST_TITLE = 64;
const CHECKLIST_HEADING = 40;
const CHECKLIST_BODY = 90;

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

function assertMax(value: string, max: number, label: string): void {
  if (value.length > max) {
    throw new PostDraftError(`${label} is ${value.length} characters. Keep it under ${max} so it fits the page.`);
  }
}

function compositionFor(draft: PostDraft): string {
  if (draft.formatFamily === "carousel") {
    return CAROUSEL.has(draft.compositionId) ? draft.compositionId : "carousel-steps";
  }
  if (draft.formatFamily === "explainer") return "explainer-framework";
  return HOOK_COMPOSITION_ID;
}

export function normalisePostDrafts(raw: PostDraft[], context: DraftContext): PostDraft[] {
  if (raw.length !== 3) {
    throw new PostDraftError("A free run needs exactly three posts: a carousel, a checklist image, and a text hook.");
  }
  const families = new Set(raw.map((post) => post.formatFamily));
  for (const family of REQUIRED) {
    if (!families.has(family)) throw new PostDraftError(`Missing the ${family} post.`);
  }
  if (families.size !== raw.length) {
    throw new PostDraftError("Each post must be a different format. A resized file is not a new post.");
  }

  return raw.map((draft, index) => {
    const compositionId = compositionFor(draft);
    const hook = draft.formatFamily === "hook";
    const next: PostDraft = {
      ...draft,
      compositionId,
      hookAlternatives: draft.hookAlternatives.slice(0, 3),
      pages: hook ? [] : draft.pages,
      imageAssetIds: [],
      logoAssetId: hook ? null : draft.logoAssetId,
      altText: hook ? "" : draft.altText,
      xCaption: "",
    };

    if (!next.hookAlternatives.includes(next.hook)) next.hookAlternatives.unshift(next.hook);
    next.hookAlternatives = next.hookAlternatives.slice(0, 3);
    if (next.hookAlternatives.length < 2) {
      throw new PostDraftError(`Post ${index + 1} needs at least two hook alternatives.`);
    }

    const spoken = [
      next.caption,
      next.hook,
      next.title,
      next.cta,
      ...next.hookAlternatives,
      ...next.pages.flatMap((page) => [page.heading, page.body]),
    ];
    if (spoken.some((line) => line.includes("!"))) {
      throw new PostDraftError(`Post ${index + 1} contains an exclamation mark.`);
    }
    if (next.caption.length > LINKEDIN_CHAR_LIMIT) {
      throw new PostDraftError(`Post ${index + 1} caption is over the LinkedIn character limit.`);
    }
    if (!hook && !next.altText.trim()) {
      throw new PostDraftError(`Post ${index + 1} needs alt text for the image.`);
    }
    if (next.formatFamily === "carousel") {
      if (next.pages.length < 6 || next.pages.length > 8) {
        throw new PostDraftError(`The carousel needs 6 to 8 pages. This one has ${next.pages.length}.`);
      }
      next.pages.forEach((page, pageIndex) => {
        assertMax(page.heading, CAROUSEL_HEADING, `Carousel page ${pageIndex + 1} heading`);
        assertMax(page.body, CAROUSEL_BODY, `Carousel page ${pageIndex + 1} body`);
      });
    }
    if (next.formatFamily === "explainer") {
      if (next.pages.length < 4 || next.pages.length > 6) {
        throw new PostDraftError(`The checklist image needs 4 to 6 points. This one has ${next.pages.length}.`);
      }
      assertMax(next.title, CHECKLIST_TITLE, "Checklist title");
      next.pages.forEach((page, pageIndex) => {
        assertMax(page.heading, CHECKLIST_HEADING, `Checklist item ${pageIndex + 1} heading`);
        assertMax(page.body, CHECKLIST_BODY, `Checklist item ${pageIndex + 1} body`);
      });
    }
    if (hook && next.pages.length !== 0) {
      throw new PostDraftError("A text hook post has no pages to render.");
    }
    if (next.logoAssetId && next.logoAssetId !== context.logoAssetId) {
      throw new PostDraftError(`Post ${index + 1} referenced a logo that was not approved.`);
    }
    assertPalette(next, context.colours, index);
    assertFonts(next, context.fonts, index);

    const cited = verifyCitedClaims(next.claims, context.ledger);
    if (!cited.ok) throw new PostDraftError(cited.reason);

    const visible = spoken.join("\n");
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
