export interface LogoCandidate {
  url: string;
  kind: "favicon" | "og_image" | "header_img" | "header_svg";
  confidence: number; // heuristic, 0-1 — see extract.ts for how each kind is scored
  method: string; // short human-readable description of how it was found
}

export interface ColourCandidate {
  hex: string;
  /** How many separate declarations used this value. Not a claim about visual prominence. */
  declarationCount: number;
  /** CSS property names it appeared on, e.g. "background-color", "--brand-accent". */
  properties: string[];
}

export interface FontCandidate {
  family: string;
  source: "font-family" | "@font-face" | "google-fonts-link";
  weight?: string;
  url?: string;
}

export interface ContentImage {
  url: string;
  alt: string;
}

export interface BrandContext {
  sourceUrl: string;
  fetchedAt: string;
  extractionMethod: "static-html-css";
  title: string | null;
  siteName: string | null;
  description: string | null;
  logoCandidates: LogoCandidate[];
  colours: ColourCandidate[];
  cssCustomProperties: { name: string; value: string }[];
  fonts: FontCandidate[];
  googleFontsLinks: string[];
  images: ContentImage[];
  /** Bounded, truncated readable copy for later LLM summarisation. Not the full page. */
  textExcerpt: string;
  textTruncated: boolean;
  stylesheetsFetched: number;
  stylesheetsSkipped: number;
  unknowns: string[];
}
