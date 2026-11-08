/**
 * New drafts are carousel, checklist (stored as explainer) or a text hook.
 * `proof` remains so rows written before this MVP still type-check when read.
 */
export type FormatFamily = "carousel" | "explainer" | "hook" | "proof";
export type PostChannel = "linkedin" | "x";
export type EnglishChoice = "uk" | "us";

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

export const LINKEDIN_CHAR_LIMIT = 3000;
export const CAROUSEL_WIDTH = 1080;
export const CAROUSEL_HEIGHT = 1350;
/** Kept so older template code can still measure an X canvas. New runs do not render one. */
export const X_IMAGE_WIDTH = 1200;
export const X_IMAGE_HEIGHT = 675;

export const FREE_POST_FAMILIES = ["carousel", "explainer", "hook"] as const;
