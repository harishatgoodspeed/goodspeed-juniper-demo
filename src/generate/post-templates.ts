/**
 * LinkedIn formats: a document carousel, a checklist carousel, and one
 * saveable checklist image. The text hook post is not rendered.
 * Portrait canvas is 1080 × 1350. Colour and type come from the approved
 * brand lists. Nothing here is a coloured top bar plus a Learn more pill.
 */

import { pathToFileURL } from "node:url";
import { fontFaceCss, type ResolvedFontFace } from "./font-assets";
import type { PostDraft, PostPageCopy } from "../posts/types";
import { CAROUSEL_HEIGHT, CAROUSEL_WIDTH } from "../posts/types";

export interface PostTemplateAssets {
  logoPath?: string;
  imagePaths: string[];
  fontFaces?: Map<string, ResolvedFontFace>;
}

export interface BuiltPage {
  html: string;
  width: number;
  height: number;
  compositionId: string;
  text: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexChannels(hex: string): [number, number, number] | null {
  const match = hex.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  const h = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rel(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = hexChannels(hex);
  if (!rgb) return 0;
  return 0.2126 * rel(rgb[0]) + 0.7152 * rel(rgb[1]) + 0.0722 * rel(rgb[2]);
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function safeHex(value: string | undefined, fallback: string): string {
  return value && hexChannels(value) ? value : fallback;
}

function safeFamily(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? "").replace(/[^a-zA-Z0-9 \-]/g, "").trim();
  return cleaned || fallback;
}

/** First preferred colour that can be read on the background, otherwise the strongest pair. */
function readable(background: string, preferred: string[], fallback: string): string {
  const pool = [...preferred.filter((hex) => hexChannels(hex)), fallback];
  const passing = pool.filter((hex) => contrast(background, hex) >= 4.5);
  if (passing.length > 0) return passing[0];
  return [...pool].sort((a, b) => contrast(background, b) - contrast(background, a))[0] ?? fallback;
}

function accentOrInk(background: string, accent: string, ink: string): string {
  return contrast(background, accent) >= 3 ? accent : ink;
}

interface Palette {
  paper: string;
  field: string;
  ink: string;
  onField: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
}

function paletteFor(draft: PostDraft): Palette {
  const hex = draft.paletteTokenHexes;
  const paper = safeHex(hex[0], "#F4F1EA");
  const field = safeHex(hex[1], hex[0] ?? "#1C1C1C");
  const text = safeHex(hex[2], "#1C1C1C");
  const accent = safeHex(hex[3], field);
  return {
    paper,
    field,
    ink: readable(paper, [text, field, "#1C1C1C", "#F7F4EE"], "#1C1C1C"),
    onField: readable(field, [paper, "#F7F4EE", text, "#1C1C1C"], "#F7F4EE"),
    accent,
    headingFont: safeFamily(draft.fontFamilies[0], "Georgia"),
    bodyFont: safeFamily(draft.fontFamilies[1] ?? draft.fontFamilies[0], "Georgia"),
  };
}

function fontCss(draft: PostDraft, assets: PostTemplateAssets): string {
  const faces = assets.fontFaces;
  if (!faces) return "";
  const resolved = draft.fontFamilies
    .map((family) => faces.get(family))
    .filter((face): face is ResolvedFontFace => Boolean(face));
  return resolved.length ? fontFaceCss(resolved) : "";
}

function logo(assets: PostTemplateAssets): string {
  if (!assets.logoPath) return "";
  const src = pathToFileURL(assets.logoPath).href;
  return `<img data-role="logo" alt="" src="${esc(src)}" class="logo"/>`;
}

function pageText(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function countLabel(index: number, total: number): string {
  return `${index + 1} of ${total}`;
}

interface Frame {
  bg: string;
  fg: string;
  mark: string;
  edge: boolean;
}

function frameFor(palette: Palette, dark: boolean): Frame {
  const bg = dark ? palette.field : palette.paper;
  const fg = dark ? palette.onField : palette.ink;
  const mark = dark
    ? accentOrInk(bg, palette.accent, fg)
    : contrast(bg, palette.field) >= 3
      ? palette.field
      : fg;
  return { bg, fg, mark, edge: true };
}

function shell(options: {
  compositionId: string;
  pageClass: string;
  css: string;
  body: string;
  fontCss: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    ${options.fontCss}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    [data-role="page"] { width: ${CAROUSEL_WIDTH}px; height: ${CAROUSEL_HEIGHT}px; overflow: hidden; position: relative; }
    ${options.css}
  </style></head><body>
    <div data-role="page" class="${esc(options.pageClass)}" data-composition="${esc(options.compositionId)}">${options.body}</div>
  </body></html>`;
}

function frameCss(palette: Palette, frame: Frame): string {
  const heading = palette.headingFont;
  const body = palette.bodyFont;
  return `
    [data-role="page"] {
      background: ${frame.bg};
      color: ${frame.fg};
      font-family: "${body}", Georgia, "Times New Roman", serif;
      display: flex;
      flex-direction: column;
      padding: ${frame.edge ? "88px 88px 72px 108px" : "88px 84px 72px"};
      -webkit-font-smoothing: antialiased;
    }
    ${
      frame.edge
        ? `[data-role="page"]::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 18px; background: ${frame.mark}; }`
        : ""
    }
    h1, h2, p, .num { margin: 0; overflow-wrap: anywhere; }
    h1, h2, .num, .kicker, .n { font-family: "${heading}", Georgia, "Times New Roman", serif; font-weight: 400; }
    h1 { letter-spacing: -0.032em; line-height: 1.02; font-size: 76px; }
    .steps-inside h1, .list-inside h1, .list-close h1 { font-size: 62px; }
    .list-cover h1, .list-inside h1, .list-close h1 { margin-bottom: 20px; }
    .checklist h1 { font-size: 48px; line-height: 1.05; }
    [data-role="body"] { font-size: 34px; line-height: 1.36; max-width: 900px; }
    .kicker { color: ${frame.mark}; font-size: 22px; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 28px; }
    .rule { width: 112px; height: 6px; background: ${frame.mark}; margin: 32px 0; }
    .num { color: ${frame.mark}; font-size: 124px; line-height: 0.82; letter-spacing: -0.05em; margin-bottom: 28px; }
    .foot { margin-top: auto; padding-top: 32px; }
    .foot-row, .foot-end { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
    .logo { width: 156px; height: 64px; object-fit: contain; object-position: right center; display: block; }
    .count { font-size: 22px; letter-spacing: 0.14em; text-transform: uppercase; }
    .track { height: 8px; width: 100%; background: ${frame.fg}26; margin-top: 20px; }
    .fill { height: 8px; background: ${frame.fg}; }
    .pips { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .pips i { display: block; width: 14px; height: 14px; border: 3px solid currentColor; }
    .pips i.on { background: currentColor; }
    .box { width: 78px; height: 78px; border: 6px solid currentColor; flex: none; }
    .list-inside .box, .list-close .box { margin-bottom: 36px; }
    .box.lg { width: 108px; height: 108px; margin-bottom: 32px; }
    .cta { margin-top: 28px; }
    .checklist { padding: 72px 80px 60px 104px; }
    .rows { list-style: none; margin: 28px 0 0; padding: 0; display: flex; flex-direction: column; flex: 1; justify-content: space-between; }
    .rows li { display: flex; gap: 18px; align-items: flex-start; border-top: 2px solid ${frame.fg}33; padding: 14px 0 12px; }
    .rows h2 { font-size: 32px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 4px; }
    .rows [data-role="body"] { font-size: 30px; line-height: 1.3; }
    .n { color: ${frame.mark}; font-size: 26px; line-height: 1.2; width: 56px; flex: none; padding-top: 2px; }
    .checklist .kicker { margin-bottom: 16px; }
    .checklist .foot { padding-top: 18px; }
    .checklist .logo { width: 56px; height: 56px; }
    [data-block] { flex-shrink: 0; max-width: 100%; }
  `;
}

function progressBar(index: number, total: number): string {
  const width = Math.round(((index + 1) / total) * 1000) / 10;
  return `<div class="track" aria-hidden="true"><div class="fill" style="width:${width}%"></div></div>`;
}

function pips(index: number, total: number): string {
  const marks = Array.from({ length: total }, (_, i) => `<i class="${i <= index ? "on" : ""}"></i>`).join("");
  return `<div class="pips" aria-hidden="true">${marks}</div>`;
}

function footer(index: number, total: number, assets: PostTemplateAssets, mode: "bar" | "pips"): string {
  const count = `<span class="count">${countLabel(index, total)}</span>`;
  if (mode === "pips") {
    return `<div class="foot" data-block="foot"><div class="foot-row">${pips(index, total)}<div class="foot-end">${count}${logo(assets)}</div></div></div>`;
  }
  return `<div class="foot" data-block="foot"><div class="foot-row">${count}${logo(assets)}</div>${progressBar(index, total)}</div>`;
}

function ctaLine(draft: PostDraft, show: boolean): string {
  const cta = draft.cta.trim();
  if (!show || !cta) return "";
  return `<p class="cta" data-role="body" data-block="cta">${esc(cta)}</p>`;
}

function built(options: {
  draft: PostDraft;
  compositionId: string;
  pageClass: string;
  frame: Frame;
  palette: Palette;
  body: string;
  assets: PostTemplateAssets;
  text: string;
}): BuiltPage {
  return {
    html: shell({
      compositionId: options.compositionId,
      pageClass: options.pageClass,
      css: frameCss(options.palette, options.frame),
      body: options.body,
      fontCss: fontCss(options.draft, options.assets),
    }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: options.compositionId,
    text: options.text,
  };
}

function carouselSteps(
  draft: PostDraft,
  page: PostPageCopy,
  index: number,
  total: number,
  assets: PostTemplateAssets
): BuiltPage {
  const palette = paletteFor(draft);
  const kind = index === 0 ? "cover" : index === total - 1 ? "close" : "inside";
  const frame = frameFor(palette, kind !== "inside");
  const indexLabel = String(index + 1).padStart(2, "0");
  const showAsk = kind === "close";
  const hero =
    kind === "inside"
      ? `<p class="num" data-block="num">${indexLabel}</p>`
      : `<p class="kicker" data-block="kicker">${indexLabel}</p>`;
  const body = `
    ${hero}
    <h1 data-role="heading" data-block="heading">${esc(page.heading)}</h1>
    <div class="rule" data-block="rule"></div>
    <p data-role="body" data-block="body">${esc(page.body)}</p>
    ${ctaLine(draft, showAsk)}
    ${footer(index, total, assets, "bar")}
  `;
  return built({
    draft,
    compositionId: "carousel-steps",
    pageClass: `steps-${kind}`,
    frame,
    palette,
    body,
    assets,
    text: pageText([page.heading, page.body, showAsk ? draft.cta : "", countLabel(index, total)]),
  });
}

function carouselChecklist(
  draft: PostDraft,
  page: PostPageCopy,
  index: number,
  total: number,
  assets: PostTemplateAssets
): BuiltPage {
  const palette = paletteFor(draft);
  const kind = index === 0 ? "cover" : index === total - 1 ? "close" : "inside";
  const frame = frameFor(palette, kind === "cover");
  frame.edge = false;
  const showAsk = kind === "close";
  const mark =
    kind === "cover"
      ? `<div class="box lg" data-block="mark"></div><p class="kicker" data-block="kicker">Checklist</p>`
      : `<div class="box" data-block="mark"></div>`;
  const body = `
    ${mark}
    <h1 data-role="heading" data-block="heading">${esc(page.heading)}</h1>
    <p data-role="body" data-block="body">${esc(page.body)}</p>
    ${ctaLine(draft, showAsk)}
    ${footer(index, total, assets, "pips")}
  `;
  return built({
    draft,
    compositionId: "carousel-checklist",
    pageClass: `list-${kind}`,
    frame,
    palette,
    body,
    assets,
    text: pageText([page.heading, page.body, showAsk ? draft.cta : "", countLabel(index, total)]),
  });
}

function explainerFramework(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const palette = paletteFor(draft);
  const frame = frameFor(palette, false);
  const rows = draft.pages
    .map(
      (page, index) => `
      <li data-block="item-${index}">
        <span class="n">${String(index + 1).padStart(2, "0")}</span>
        <span>
          <h2>${esc(page.heading)}</h2>
          <p data-role="body">${esc(page.body)}</p>
        </span>
      </li>`
    )
    .join("");
  const body = `
    <p class="kicker" data-block="kicker">Checklist</p>
    <h1 data-role="heading" data-block="heading">${esc(draft.title)}</h1>
    <ol class="rows">${rows}</ol>
    <div class="foot" data-block="foot"><div class="foot-row"><span class="count">${draft.pages.length} points</span>${logo(assets)}</div></div>
  `;
  return built({
    draft,
    compositionId: "explainer-framework",
    pageClass: "checklist",
    frame,
    palette,
    body,
    assets,
    text: pageText([draft.title, ...draft.pages.flatMap((page) => [page.heading, page.body])]),
  });
}

export function pagesForDraft(draft: PostDraft, assets: PostTemplateAssets, _channel: "linkedin" | "x"): BuiltPage[] {
  if (draft.formatFamily === "carousel") {
    const build = draft.compositionId === "carousel-checklist" ? carouselChecklist : carouselSteps;
    return draft.pages.map((page, index) => build(draft, page, index, draft.pages.length, assets));
  }
  if (draft.formatFamily === "explainer") return [explainerFramework(draft, assets)];
  return [];
}

export function combinedPdfHtml(pages: BuiltPage[]): string {
  const width = pages[0]?.width ?? CAROUSEL_WIDTH;
  const height = pages[0]?.height ?? CAROUSEL_HEIGHT;
  const sheets = pages
    .map((page) => {
      const inner = page.html.replace(/^[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*$/, "");
      return `<section class="sheet">${inner}</section>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${width}px ${height}px; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .sheet { width: ${width}px; height: ${height}px; page-break-after: always; overflow: hidden; }
    .sheet:last-child { page-break-after: auto; }
  </style></head><body>${sheets}</body></html>`;
}
