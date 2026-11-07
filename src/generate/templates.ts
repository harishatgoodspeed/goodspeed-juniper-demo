/**
 * HTML template functions for Phase 3 rendering, one per OutputType (minus
 * "post_copy", which has no HTML — render.ts returns brief.postCopyText
 * directly for that case). Every template is self-contained (inline
 * <style>, no external network requests) and uses absolute pixel layout so
 * the RenderRegion coordinates returned alongside each template are exact
 * for the HTML/CSS actually written here, at the resolution it's rendered
 * at — Phase 4's reviewer depends on that being true.
 *
 * `paletteTokenHexes`, `fontFamilies`, `sourcedFactualCopy`, and
 * `layoutDirection` are read from the Brief and actually drive the output:
 * colours come from the approved palette (never hardcoded brand colours),
 * fonts come from the approved font list, body copy comes from the sourced
 * facts (never invented), and layoutDirection toggles real layout choices
 * (image side, text alignment, whether a supporting image shows at all).
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Brief, RenderRegion } from "../pipeline-types";
import { fontFaceCss, type ResolvedFontFace } from "./font-assets";

export const LINKEDIN_IMAGE_DIMENSIONS = { width: 1200, height: 627 };
export const ONE_PAGER_DIMENSIONS = { width: 794, height: 1123 }; // A4 @ 96dpi
export const SLIDE_DIMENSIONS = { width: 1280, height: 720 }; // 16:9

/** Stable selectors render.ts queries after render — part of the contract between the two files. */
export const SELECTORS = {
  page: '[data-role="page"]',
  heading: '[data-role="heading"]',
  body: '[data-role="body"]',
  logo: '[data-role="logo"]',
} as const;

export interface TemplateAssets {
  logoPath?: string;
  imagePaths: string[];
  /** Real font files resolved for approved families (src/generate/font-assets.ts), keyed by family name. Absent or missing entries simply mean no real file could be fetched — the template still references the family by name, so the typography check fails honestly rather than silently. */
  fontFaces?: Map<string, ResolvedFontFace>;
}

export interface FontRoleExpectation {
  role: "heading" | "body";
  expectedFamily: string;
  expectedFamilyApproved: boolean;
}

export interface TemplateResult {
  html: string;
  width: number;
  height: number;
  regions: RenderRegion[];
  fontRoles: FontRoleExpectation[];
}

const DEFAULT_PALETTE = { bg: "#F2ECDF", primary: "#1F3A2E", text: "#2B2B28", accent: "#C97B4A" };

/**
 * paletteTokenHexes has no declared semantic order in pipeline-types.ts, so
 * we assign one here: [background, primary/brand, body text, accent/CTA].
 * Missing slots fall back to a neutral default rather than guessing at a
 * brand colour that wasn't approved.
 */
interface ResolvedPalette {
  bg: string;
  bgApproved: boolean;
  primary: string;
  primaryApproved: boolean;
  text: string;
  textApproved: boolean;
  accent: string;
  accentApproved: boolean;
}

function pickPalette(hexes: string[]): ResolvedPalette {
  return {
    bg: hexes[0] ?? DEFAULT_PALETTE.bg,
    bgApproved: hexes[0] !== undefined,
    primary: hexes[1] ?? DEFAULT_PALETTE.primary,
    primaryApproved: hexes[1] !== undefined,
    text: hexes[2] ?? DEFAULT_PALETTE.text,
    textApproved: hexes[2] !== undefined,
    accent: hexes[3] ?? hexes[1] ?? DEFAULT_PALETTE.accent,
    accentApproved: hexes[3] !== undefined || hexes[1] !== undefined,
  };
}

/** fontFamilies[0] drives headings, [1] drives body (falls back to [0]). Exported so render.ts builds FontCheckEvidence against the same families the CSS actually used. */
export function resolveFontRoles(
  fontFamilies: string[]
): { heading: string; headingApproved: boolean; body: string; bodyApproved: boolean } {
  const heading = fontFamilies[0] ?? "Georgia";
  const headingApproved = fontFamilies[0] !== undefined;
  const body = fontFamilies[1] ?? fontFamilies[0] ?? "Arial";
  const bodyApproved = fontFamilies[1] !== undefined || fontFamilies[0] !== undefined;
  return { heading, headingApproved, body, bodyApproved };
}

function headingFontStack(family: string): string {
  return `"${family.replace(/"/g, "'")}", Georgia, serif`;
}

function bodyFontStack(family: string): string {
  return `"${family.replace(/"/g, "'")}", Arial, sans-serif`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Only ever turns an absolute local filesystem path into a `file://` URL
 * (or passes through an already-local `file://`/`data:` URI). Anything else
 * — an http(s) URL, a protocol-relative URL, a relative path — is rejected
 * outright rather than being emitted into `src=`.
 *
 * This is a deliberate, independent layer on top of the network-level
 * blocking in render.ts: brand-sourced asset paths are supposed to always
 * be local files written by Phase 1 (src/import/assets.ts), but if a caller
 * ever passed a remote URL through by mistake, the template itself must
 * never reference it — it shouldn't depend on the request-blocking in
 * render.ts being the only thing standing between untrusted brand content
 * and an outbound request.
 */
export function toLocalFileUrl(candidate: string | undefined): string | null {
  if (!candidate) return null;
  if (candidate.startsWith("file://") || candidate.startsWith("data:")) return candidate;
  // Reject protocol-relative URLs ("//host/path") explicitly — on POSIX,
  // path.isAbsolute("//host/path") is (correctly, per POSIX) true, but this
  // is a browser-resolved network URL, not a local path.
  if (candidate.startsWith("//")) return null;
  if (!path.isAbsolute(candidate)) return null;
  return pathToFileURL(candidate).href;
}

function wantsImage(layoutDirection: string, imagePaths: string[]): string | null {
  if (/no[-\s]?image|text[-\s]?only/i.test(layoutDirection)) return null;
  for (const candidate of imagePaths) {
    const url = toLocalFileUrl(candidate);
    if (url) return url;
  }
  return null;
}

function imageOnLeft(layoutDirection: string): boolean {
  return /\bleft\b/i.test(layoutDirection) && !/\bright\b/i.test(layoutDirection);
}

function isCentered(layoutDirection: string): boolean {
  return /\bcent(er|re)d?\b/i.test(layoutDirection);
}

function pickHeadline(brief: Brief): string {
  return brief.sourcedFactualCopy[0] ?? brief.purpose;
}

function pickSupportingLine(brief: Brief): string {
  return brief.sourcedFactualCopy.slice(1).join(" ") || brief.audience;
}

function pickBulletLines(brief: Brief): string[] {
  const rest = brief.sourcedFactualCopy.slice(1);
  return rest.length > 0 ? rest : [brief.audience];
}

/** @font-face CSS for whichever of the heading/body families actually resolved to a real font file. */
function fontFaceStyles(assets: TemplateAssets, families: string[]): string {
  if (!assets.fontFaces) return "";
  const faces = [...new Set(families)]
    .map((family) => assets.fontFaces!.get(family))
    .filter((face): face is ResolvedFontFace => Boolean(face));
  return faces.length > 0 ? fontFaceCss(faces) : "";
}

function baseStyles(): string {
  // box-sizing: border-box keeps padded elements' declared width/height
  // exact, which matters for reasoning about the fixed-size `.page`
  // container's own box — the only box we measure for overflow.
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    .page { position: relative; overflow: hidden; }
    img { display: block; }
  `;
}

function logoImgTag(logoUrl: string | null, style: string): string {
  if (!logoUrl) return "";
  return `<img data-role="logo" src="${escapeHtml(logoUrl)}" style="${style}" alt="" />`;
}

// ---------------------------------------------------------------------------
// LinkedIn image — 1200x627
// ---------------------------------------------------------------------------

export function buildLinkedinImageTemplate(brief: Brief, assets: TemplateAssets): TemplateResult {
  const { width, height } = LINKEDIN_IMAGE_DIMENSIONS;
  const palette = pickPalette(brief.paletteTokenHexes);
  const fonts = resolveFontRoles(brief.fontFamilies);
  const logoUrl = toLocalFileUrl(assets.logoPath);
  const imageUrl = wantsImage(brief.layoutDirection, assets.imagePaths);
  const onLeft = imageOnLeft(brief.layoutDirection);
  const centered = isCentered(brief.layoutDirection);
  const textAlign = centered ? "center" : "left";

  const hasImage = Boolean(imageUrl);
  const textLeft = hasImage && !onLeft ? 64 : hasImage && onLeft ? 616 : 64;
  const textWidth = hasImage ? 520 : 1072;
  const imageLeft = onLeft ? 64 : 616;

  const headline = escapeHtml(pickHeadline(brief));
  const supporting = escapeHtml(pickSupportingLine(brief));

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${baseStyles()}
${fontFaceStyles(assets, [fonts.heading, fonts.body])}
  .page {
    width: ${width}px; height: ${height}px;
    background: ${palette.bg};
    font-family: ${bodyFontStack(fonts.body)};
  }
  .brand-bar { position: absolute; top: 0; left: 0; width: ${width}px; height: 48px; background: ${palette.primary}; }
  .logo { position: absolute; top: 80px; left: 64px; width: 140px; height: 140px; object-fit: contain; }
  .supporting-image { position: absolute; top: 100px; left: ${imageLeft}px; width: 520px; height: 380px; object-fit: cover; border-radius: 12px; border: 4px solid ${palette.accent}; }
  .heading { position: absolute; top: 110px; left: ${textLeft}px; width: ${textWidth}px; margin: 0;
    font-family: ${headingFontStack(fonts.heading)}; font-size: 50px; line-height: 1.15; font-weight: 700;
    color: ${palette.text}; text-align: ${textAlign}; }
  .supporting { position: absolute; top: 300px; left: ${textLeft}px; width: ${textWidth}px;
    font-size: 20px; line-height: 1.4; color: ${palette.text}; text-align: ${textAlign}; }
  .cta { position: absolute; left: 64px; bottom: 56px; width: 220px; height: 64px; border-radius: 12px;
    background: ${palette.accent}; color: ${palette.bg}; display: flex; align-items: center; justify-content: flex-start;
    padding-left: 20px; font-size: 18px; font-weight: 600; font-family: ${bodyFontStack(fonts.body)}; }
</style>
</head>
<body>
  <div class="page" data-role="page">
    <div class="brand-bar"></div>
    ${logoImgTag(logoUrl, "position:absolute;top:80px;left:64px;width:140px;height:140px;object-fit:contain;")}
    ${hasImage ? `<img class="supporting-image" src="${escapeHtml(imageUrl as string)}" alt="" />` : ""}
    <h1 class="heading" data-role="heading">${headline}</h1>
    <p class="supporting" data-role="body">${supporting}</p>
    <div class="cta">Learn more</div>
  </div>
</body>
</html>`;

  const regions: RenderRegion[] = [
    { label: "brand-bar", x: 560, y: 14, width: 80, height: 20, expectedHex: palette.primary, expectedHexApproved: palette.primaryApproved },
    // The CTA label is left-aligned with 20px padding (see .cta above)
    // specifically so the button's right-hand portion stays a clean solid
    // fill — this sample point is chosen there, clear of any glyph.
    { label: "cta-button", x: 230, y: 530, width: 40, height: 20, expectedHex: palette.accent, expectedHexApproved: palette.accentApproved },
    { label: "background", x: 1140, y: 580, width: 40, height: 20, expectedHex: palette.bg, expectedHexApproved: palette.bgApproved },
  ];

  return {
    html,
    width,
    height,
    regions,
    fontRoles: [
      { role: "heading", expectedFamily: fonts.heading, expectedFamilyApproved: fonts.headingApproved },
      { role: "body", expectedFamily: fonts.body, expectedFamilyApproved: fonts.bodyApproved },
    ],
  };
}

// ---------------------------------------------------------------------------
// One-pager PDF — A4 proportions (794x1123 @ 96dpi)
// ---------------------------------------------------------------------------

export function buildOnePagerTemplate(brief: Brief, assets: TemplateAssets): TemplateResult {
  const { width, height } = ONE_PAGER_DIMENSIONS;
  const palette = pickPalette(brief.paletteTokenHexes);
  const fonts = resolveFontRoles(brief.fontFamilies);
  const logoUrl = toLocalFileUrl(assets.logoPath);
  const imageUrl = wantsImage(brief.layoutDirection, assets.imagePaths);
  const centered = isCentered(brief.layoutDirection);
  const textAlign = centered ? "center" : "left";
  const contentLeft = 88; // clears the 32px side bar + margin
  const contentWidth = width - contentLeft - 56;

  const headline = escapeHtml(pickHeadline(brief));
  const bullets = pickBulletLines(brief)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("\n        ");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${baseStyles()}
${fontFaceStyles(assets, [fonts.heading, fonts.body])}
  /* Pins the PDF paper size to exactly our layout's pixel dimensions (one
     page) via Playwright's preferCSSPageSize, instead of relying only on
     the width/height passed to page.pdf(). */
  @page { size: ${width}px ${height}px; margin: 0; }
  .page {
    width: ${width}px; height: ${height}px;
    background: ${palette.bg};
    font-family: ${bodyFontStack(fonts.body)};
  }
  .side-bar { position: absolute; top: 0; left: 0; width: 32px; height: ${height}px; background: ${palette.primary}; }
  .logo { position: absolute; top: 56px; left: ${contentLeft}px; width: 100px; height: 100px; object-fit: contain; }
  .supporting-image { position: absolute; top: 56px; left: ${contentLeft + 120}px; width: ${contentWidth - 120}px; height: 180px; object-fit: cover; border-radius: 8px; }
  .heading { position: absolute; top: 190px; left: ${contentLeft}px; width: ${contentWidth}px; margin: 0;
    font-family: ${headingFontStack(fonts.heading)}; font-size: 34px; line-height: 1.25; font-weight: 700;
    color: ${palette.text}; text-align: ${textAlign}; }
  .facts { position: absolute; top: 320px; left: ${contentLeft}px; width: ${contentWidth}px;
    font-size: 18px; line-height: 1.6; color: ${palette.text}; padding-left: 20px; text-align: ${textAlign}; }
  .facts li::marker { color: ${palette.accent}; }
  .cta { position: absolute; left: ${contentLeft}px; bottom: 64px; width: 300px; height: 56px; border-radius: 8px;
    background: ${palette.accent}; color: ${palette.bg}; display: flex; align-items: center; justify-content: flex-start;
    padding-left: 20px; font-size: 18px; font-weight: 600; font-family: ${bodyFontStack(fonts.body)}; }
</style>
</head>
<body>
  <div class="page" data-role="page">
    <div class="side-bar"></div>
    ${logoImgTag(logoUrl, `position:absolute;top:56px;left:${contentLeft}px;width:100px;height:100px;object-fit:contain;`)}
    ${imageUrl ? `<img class="supporting-image" src="${escapeHtml(imageUrl)}" alt="" />` : ""}
    <h1 class="heading" data-role="heading">${headline}</h1>
    <ul class="facts" data-role="body">
        ${bullets}
    </ul>
    <div class="cta">Get in touch</div>
  </div>
</body>
</html>`;

  const regions: RenderRegion[] = [
    { label: "brand-bar", x: 6, y: 550, width: 20, height: 20, expectedHex: palette.primary, expectedHexApproved: palette.primaryApproved },
    // Sampled on the button's right-hand portion, clear of the
    // left-aligned, left-padded CTA label (see .cta above).
    { label: "cta-button", x: contentLeft + 220, y: height - 64 - 56 + 17, width: 40, height: 20, expectedHex: palette.accent, expectedHexApproved: palette.accentApproved },
    { label: "background", x: 700, y: 90, width: 40, height: 20, expectedHex: palette.bg, expectedHexApproved: palette.bgApproved },
  ];

  return {
    html,
    width,
    height,
    regions,
    fontRoles: [
      { role: "heading", expectedFamily: fonts.heading, expectedFamilyApproved: fonts.headingApproved },
      { role: "body", expectedFamily: fonts.body, expectedFamilyApproved: fonts.bodyApproved },
    ],
  };
}

// ---------------------------------------------------------------------------
// Slide — 16:9 (1280x720)
// ---------------------------------------------------------------------------

export function buildSlideTemplate(brief: Brief, assets: TemplateAssets): TemplateResult {
  const { width, height } = SLIDE_DIMENSIONS;
  const palette = pickPalette(brief.paletteTokenHexes);
  const fonts = resolveFontRoles(brief.fontFamilies);
  const logoUrl = toLocalFileUrl(assets.logoPath);
  const centered = isCentered(brief.layoutDirection);
  const textAlign = centered ? "center" : "left";
  const contentLeft = 80;
  const contentWidth = 760;

  const headline = escapeHtml(pickHeadline(brief));
  const bullets = pickBulletLines(brief)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("\n        ");

  const barTop = height - 80;
  const ctaTop = barTop + 12;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${baseStyles()}
${fontFaceStyles(assets, [fonts.heading, fonts.body])}
  .page {
    width: ${width}px; height: ${height}px;
    background: ${palette.bg};
    font-family: ${bodyFontStack(fonts.body)};
  }
  .logo { position: absolute; top: 56px; right: 56px; width: 110px; height: 110px; object-fit: contain; }
  .heading { position: absolute; top: 140px; left: ${contentLeft}px; width: ${contentWidth}px; margin: 0;
    font-family: ${headingFontStack(fonts.heading)}; font-size: 48px; line-height: 1.2; font-weight: 700;
    color: ${palette.text}; text-align: ${textAlign}; }
  .facts { position: absolute; top: 300px; left: ${contentLeft}px; width: ${contentWidth}px;
    font-size: 22px; line-height: 1.6; color: ${palette.text}; padding-left: 22px; text-align: ${textAlign}; }
  .facts li::marker { color: ${palette.accent}; }
  .brand-bar { position: absolute; top: ${barTop}px; left: 0; width: ${width}px; height: 80px; background: ${palette.primary}; }
  .cta { position: absolute; left: ${contentLeft}px; top: ${ctaTop}px; width: 240px; height: 56px; border-radius: 8px;
    background: ${palette.accent}; color: ${palette.bg}; display: flex; align-items: center; justify-content: flex-start;
    padding-left: 20px; font-size: 18px; font-weight: 600; font-family: ${bodyFontStack(fonts.body)}; }
</style>
</head>
<body>
  <div class="page" data-role="page">
    ${logoImgTag(logoUrl, "position:absolute;top:56px;right:56px;width:110px;height:110px;object-fit:contain;")}
    <h1 class="heading" data-role="heading">${headline}</h1>
    <ul class="facts" data-role="body">
        ${bullets}
    </ul>
    <div class="brand-bar"></div>
    <div class="cta">Learn more</div>
  </div>
</body>
</html>`;

  const regions: RenderRegion[] = [
    { label: "brand-bar", x: 600, y: barTop + 25, width: 80, height: 20, expectedHex: palette.primary, expectedHexApproved: palette.primaryApproved },
    // Sampled on the button's right-hand portion, clear of the
    // left-aligned, left-padded CTA label (see .cta above).
    { label: "cta-button", x: contentLeft + 180, y: ctaTop + 18, width: 40, height: 20, expectedHex: palette.accent, expectedHexApproved: palette.accentApproved },
    { label: "background", x: 900, y: 90, width: 40, height: 20, expectedHex: palette.bg, expectedHexApproved: palette.bgApproved },
  ];

  return {
    html,
    width,
    height,
    regions,
    fontRoles: [
      { role: "heading", expectedFamily: fonts.heading, expectedFamilyApproved: fonts.headingApproved },
      { role: "body", expectedFamily: fonts.body, expectedFamilyApproved: fonts.bodyApproved },
    ],
  };
}

export function buildTemplate(brief: Brief, assets: TemplateAssets): TemplateResult {
  switch (brief.outputType) {
    case "linkedin_image":
      return buildLinkedinImageTemplate(brief, assets);
    case "one_pager_pdf":
      return buildOnePagerTemplate(brief, assets);
    case "slide":
      return buildSlideTemplate(brief, assets);
    case "post_copy":
      throw new Error('buildTemplate does not handle "post_copy" — render.ts returns brief.postCopyText directly without Playwright.');
  }
}
