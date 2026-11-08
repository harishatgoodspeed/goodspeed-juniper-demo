/** Checklist images stay `explainer` internally. `hook` is the text-only post. */
export type FormatFamily = "carousel" | "explainer" | "hook";
export type PostChannel = "linkedin" | "x";
export type EnglishChoice = "uk" | "us";

export const HOOK_COMPOSITION_ID = "hook-text";

export interface PostPageCopy {
  heading: string;
  body: string;
}

export interface SourceClaim {
  text: string;
  ledgerIds: string[];
  kind: "fact" | "draft_opinion";
}

export interface PostDraft {
  formatFamily: FormatFamily;
  compositionId: string;
  title: string;
  hook: string;
  hookAlternatives: string[];
  caption: string;
  /**
   * Kept so older rows still read. New drafts leave it empty.
   * LinkedIn is the only network these formats are written for.
   */
  xCaption?: string;
  altText: string;
  pages: PostPageCopy[];
  claims: SourceClaim[];
  imageAssetIds: string[];
  rationale: string;
  cta: string;
  paletteTokenHexes: string[];
  fontFamilies: string[];
  logoAssetId: string | null;
}

export interface PostPackageSet {
  posts: PostDraft[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
}

export const X_CHAR_LIMIT = 280;
export const LINKEDIN_CHAR_LIMIT = 3000;
export const CAROUSEL_WIDTH = 1080;
export const CAROUSEL_HEIGHT = 1350;
export const X_IMAGE_WIDTH = 1200;
export const X_IMAGE_HEIGHT = 675;
