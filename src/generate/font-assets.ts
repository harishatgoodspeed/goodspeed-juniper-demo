/**
 * Fetches real, embeddable font files for approved brand fonts so the
 * renderer can genuinely load them via @font-face, instead of every
 * typography check either passing against the renderer's own fallback
 * (Georgia/Arial — see expectedFamilyApproved in review.ts) or honestly
 * failing for every real brand font because nothing was ever embedded.
 *
 * Two sources, tried in order, both already found during import
 * (src/import/extract.ts) and never fetched from anywhere the brand itself
 * didn't point us at:
 *   1. A direct @font-face `url(...)` the import step captured from the
 *      brand's own stylesheets (BrandContext.fonts).
 *   2. A Google Fonts stylesheet link the brand's page included
 *      (BrandContext.googleFontsLinks) — fetched with a modern desktop
 *      User-Agent so Google serves woff2 (the format headless Chromium
 *      itself prefers), then its own @font-face rules are parsed for a file
 *      URL.
 *
 * Every fetch goes through safeFetch (src/security/url.ts), the same
 * SSRF-guarded fetcher src/import/assets.ts uses for logos/images — no new
 * trust boundary is introduced here. A family that can't be resolved to a
 * real file returns null rather than a fabricated embed, so the typography
 * check in review.ts continues to fail honestly for it.
 */

import type { BrandContext } from "../import/types";
import { safeFetch, type SafeFetchResult } from "../security/url";

const MAX_FONT_BYTES = 2 * 1024 * 1024; // one weight of one family — generous for woff2/woff
const FONT_MIME_BY_FORMAT: Record<FontFormat, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};
const FORMAT_PREFERENCE: FontFormat[] = ["woff2", "woff", "ttf", "otf"];

// A modern desktop Chrome UA — Google Fonts' CSS2 endpoint keys its response
// format on User-Agent, and without this it can hand back legacy formats
// instead of the woff2 that headless Chromium (our renderer) actually wants.
const MODERN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export type FontFormat = "woff2" | "woff" | "ttf" | "otf";

export interface ResolvedFontFace {
  family: string;
  format: FontFormat;
  dataUri: string;
}

export interface FontFetchDeps {
  /** Injectable for tests — defaults to the real SSRF-guarded fetch. */
  fetch?: typeof safeFetch;
}

function extensionFormat(url: string): FontFormat | null {
  const match = /\.(woff2|woff|ttf|otf)(?:[?#]|$)/i.exec(url);
  return match ? (match[1].toLowerCase() as FontFormat) : null;
}

/** Pulls every `url(...)` out of @font-face blocks in raw CSS text, most-preferred format first. */
export function extractFontFaceUrls(css: string): string[] {
  const urls: string[] = [];
  const blockRe = /@font-face\s*\{([^}]*)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css))) {
    const srcRe = /url\((['"]?)([^'")]+)\1\)/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(block[1]))) {
      urls.push(m[2]);
    }
  }
  return urls
    .filter((u) => extensionFormat(u) !== null)
    .sort((a, b) => FORMAT_PREFERENCE.indexOf(extensionFormat(a)!) - FORMAT_PREFERENCE.indexOf(extensionFormat(b)!));
}

async function downloadFontFile(
  url: string,
  fetchFn: typeof safeFetch
): Promise<{ buffer: Buffer; format: FontFormat } | null> {
  const format = extensionFormat(url);
  if (!format) return null;
  let res: SafeFetchResult;
  try {
    res = await fetchFn(url, { maxBytes: MAX_FONT_BYTES, headers: { "User-Agent": MODERN_UA } });
  } catch {
    return null; // a font file the brand's own site can't actually serve today is honestly "not available", not a hard failure
  }
  if (res.statusCode >= 400 || res.body.length === 0 || res.body.length > MAX_FONT_BYTES) return null;
  return { buffer: res.body, format };
}

function toDataUri(buffer: Buffer, format: FontFormat): string {
  return `data:${FONT_MIME_BY_FORMAT[format]};base64,${buffer.toString("base64")}`;
}

function matchesFamily(googleFontsLink: string, family: string): boolean {
  try {
    const params = new URL(googleFontsLink).searchParams.get("family") ?? "";
    const wanted = family.trim().toLowerCase().replace(/\s+/g, "+");
    return params.toLowerCase().includes(wanted);
  } catch {
    return false;
  }
}

/** Resolves one approved font family to a real, downloadable font file, or null if none could be fetched. */
export async function resolveFontFace(
  family: string,
  rawContext: BrandContext,
  deps: FontFetchDeps = {}
): Promise<ResolvedFontFace | null> {
  const fetchFn = deps.fetch ?? safeFetch;

  const direct = rawContext.fonts.find(
    (f) => f.source === "@font-face" && f.url && f.family.toLowerCase() === family.toLowerCase()
  );
  if (direct?.url) {
    const downloaded = await downloadFontFile(direct.url, fetchFn);
    if (downloaded) return { family, format: downloaded.format, dataUri: toDataUri(downloaded.buffer, downloaded.format) };
  }

  const googleLink = rawContext.googleFontsLinks.find((link) => matchesFamily(link, family));
  if (googleLink) {
    try {
      const cssRes = await fetchFn(googleLink, { headers: { "User-Agent": MODERN_UA } });
      if (cssRes.statusCode < 400) {
        for (const fontUrl of extractFontFaceUrls(cssRes.body.toString("utf8"))) {
          const downloaded = await downloadFontFile(fontUrl, fetchFn);
          if (downloaded) {
            return { family, format: downloaded.format, dataUri: toDataUri(downloaded.buffer, downloaded.format) };
          }
        }
      }
    } catch {
      // Falls through to null below — nothing real could be fetched.
    }
  }

  return null;
}

/** Resolves a set of approved families in parallel, deduplicated, keyed by family name. Families that can't be resolved are simply absent — never a fabricated entry. */
export async function resolveFontFaces(
  families: string[],
  rawContext: BrandContext,
  deps: FontFetchDeps = {}
): Promise<Map<string, ResolvedFontFace>> {
  const unique = [...new Set(families.filter((f) => f.trim().length > 0))];
  const resolved = await Promise.all(unique.map((family) => resolveFontFace(family, rawContext, deps)));
  const map = new Map<string, ResolvedFontFace>();
  unique.forEach((family, i) => {
    const face = resolved[i];
    if (face) map.set(family, face);
  });
  return map;
}

/** Renders @font-face CSS declarations for every resolved font, to be inlined into a template's <style>. */
export function fontFaceCss(faces: ResolvedFontFace[]): string {
  return faces
    .map(
      (f) => `@font-face {
    font-family: "${f.family.replace(/"/g, "'")}";
    src: url("${f.dataUri}") format("${f.format === "woff2" ? "woff2" : f.format === "woff" ? "woff" : f.format === "otf" ? "opentype" : "truetype"}");
    font-weight: normal;
    font-style: normal;
    font-display: block;
  }`
    )
    .join("\n");
}
