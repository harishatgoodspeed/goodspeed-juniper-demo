/**
 * Compositions for the three format families. Two layouts each.
 * None of them is a coloured top bar plus a Learn more pill.
 * Generated previews use the customer palette, not the app shell.
 */

import { pathToFileURL } from "node:url";
import { fontFaceCss, type ResolvedFontFace } from "./font-assets";
import type { PostDraft, PostPageCopy } from "../posts/types";
import { CAROUSEL_HEIGHT, CAROUSEL_WIDTH, X_IMAGE_HEIGHT, X_IMAGE_WIDTH } from "../posts/types";

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

interface Ink {
  bg: string;
  primary: string;
  text: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
}

function inkFor(draft: PostDraft): Ink {
  const hex = draft.paletteTokenHexes;
  return {
    bg: hex[0] ?? "#F4F1EA",
    primary: hex[1] ?? hex[0] ?? "#1C1C1C",
    text: hex[2] ?? "#1C1C1C",
    accent: hex[3] ?? hex[1] ?? hex[0] ?? "#1C1C1C",
    headingFont: draft.fontFamilies[0] ?? "Georgia",
    bodyFont: draft.fontFamilies[1] ?? draft.fontFamilies[0] ?? "Georgia",
  };
}

function shell(options: {
  width: number;
  height: number;
  compositionId: string;
  css: string;
  body: string;
  fontCss: string;
}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    ${options.fontCss}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    [data-role="page"] { width: ${options.width}px; height: ${options.height}px; overflow: hidden; position: relative; }
    ${options.css}
  </style></head><body>
    <div data-role="page" data-composition="${esc(options.compositionId)}">${options.body}</div>
  </body></html>`;
}

function fontCss(draft: PostDraft, assets: PostTemplateAssets): string {
  const faces = assets.fontFaces;
  if (!faces) return "";
  const resolved = draft.fontFamilies
    .map((family) => faces.get(family))
    .filter((face): face is ResolvedFontFace => Boolean(face));
  return resolved.length ? fontFaceCss(resolved) : "";
}

function logo(assets: PostTemplateAssets, style: string): string {
  if (!assets.logoPath) return "";
  const src = pathToFileURL(assets.logoPath).href;
  return `<img data-role="logo" alt="" src="${esc(src)}" style="${style}"/>`;
}

function pageText(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function carouselSteps(draft: PostDraft, page: PostPageCopy, index: number, total: number, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const css = `
    [data-role="page"] { background: ${ink.bg}; color: ${ink.text}; font-family: "${ink.bodyFont}", Georgia, serif; }
    .num { position: absolute; left: 72px; top: 180px; font-size: 140px; line-height: 1; font-family: "${ink.headingFont}", Georgia, serif; color: ${ink.primary}; }
    h1 { position: absolute; left: 420px; top: 220px; width: 580px; margin: 0; font-size: 64px; line-height: 1.05; font-family: "${ink.headingFont}", Georgia, serif; }
    p { position: absolute; left: 420px; top: 520px; width: 560px; margin: 0; font-size: 36px; line-height: 1.35; }
    .foot { position: absolute; left: 72px; bottom: 64px; font-size: 24px; letter-spacing: 0.04em; }
  `;
  const body = `
    ${logo(assets, "position:absolute;right:64px;bottom:56px;width:72px;height:72px;object-fit:contain;")}
    <div class="num" data-block="num">${String(index + 1).padStart(2, "0")}</div>
    <h1 data-role="heading" data-block="heading">${esc(page.heading)}</h1>
    <p data-role="body" data-block="body">${esc(page.body)}</p>
    <div class="foot" data-block="foot">${index + 1} of ${total}</div>
  `;
  return {
    html: shell({ width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT, compositionId: "carousel-steps", css, body, fontCss: fontCss(draft, assets) }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "carousel-steps",
    text: pageText([page.heading, page.body, `${index + 1} of ${total}`]),
  };
}

function carouselChecklist(draft: PostDraft, page: PostPageCopy, index: number, total: number, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const darkCover = index === 0;
  const bg = darkCover ? ink.primary : ink.bg;
  const fg = darkCover ? ink.bg : ink.text;
  const css = `
    [data-role="page"] { background: ${bg}; color: ${fg}; font-family: "${ink.bodyFont}", Georgia, serif; }
    h1 { position: absolute; left: 80px; top: 160px; width: 900px; margin: 0; font-size: 72px; line-height: 1.05; font-family: "${ink.headingFont}", Georgia, serif; }
    .row { position: absolute; left: 80px; top: 520px; width: 880px; display: flex; gap: 28px; align-items: flex-start; }
    .box { width: 36px; height: 36px; border: 4px solid ${fg}; flex: none; margin-top: 8px; }
    p { margin: 0; font-size: 40px; line-height: 1.3; }
    .foot { position: absolute; left: 80px; bottom: 72px; font-size: 24px; }
  `;
  const body = `
    ${logo(assets, "position:absolute;right:72px;top:72px;width:64px;height:64px;object-fit:contain;")}
    <h1 data-role="heading" data-block="heading">${esc(page.heading)}</h1>
    <div class="row" data-block="row"><div class="box"></div><p data-role="body">${esc(page.body)}</p></div>
    <div class="foot">${index + 1} of ${total}</div>
  `;
  return {
    html: shell({ width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT, compositionId: "carousel-checklist", css, body, fontCss: fontCss(draft, assets) }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "carousel-checklist",
    text: pageText([page.heading, page.body, `${index + 1} of ${total}`]),
  };
}

function explainerFramework(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const blocks = draft.pages.slice(0, 4);
  const cards = blocks
    .map(
      (block, index) => `
      <section data-block="card-${index}" style="position:absolute;left:${index % 2 === 0 ? 64 : 560}px;top:${index < 2 ? 360 : 820}px;width:450px;height:400px;">
        <h2 style="margin:0 0 16px;font-size:40px;font-family:'${ink.headingFont}',Georgia,serif;">${esc(block.heading)}</h2>
        <p data-role="body" style="margin:0;font-size:32px;line-height:1.3;">${esc(block.body)}</p>
      </section>`
    )
    .join("");
  const css = `[data-role="page"]{background:${ink.bg};color:${ink.text};font-family:"${ink.bodyFont}",Georgia,serif;} h1{position:absolute;left:64px;top:80px;width:900px;margin:0;font-size:64px;line-height:1.05;font-family:"${ink.headingFont}",Georgia,serif;}`;
  const body = `${logo(assets, "position:absolute;right:64px;bottom:48px;width:64px;height:64px;object-fit:contain;")}<h1 data-role="heading" data-block="title">${esc(draft.title)}</h1>${cards}`;
  return {
    html: shell({ width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT, compositionId: "explainer-framework", css, body, fontCss: fontCss(draft, assets) }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "explainer-framework",
    text: pageText([draft.title, ...blocks.flatMap((b) => [b.heading, b.body])]),
  };
}

function explainerComparison(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const left = draft.pages.filter((_, i) => i % 2 === 0).slice(0, 3);
  const right = draft.pages.filter((_, i) => i % 2 === 1).slice(0, 3);
  const column = (items: PostPageCopy[], x: number) =>
    items
      .map(
        (item, index) =>
          `<div data-block="col-${x}-${index}" style="position:absolute;left:${x}px;top:${340 + index * 280}px;width:440px;"><h2 style="margin:0 0 8px;font-size:32px;">${esc(item.heading)}</h2><p data-role="body" style="margin:0;font-size:32px;line-height:1.3;">${esc(item.body)}</p></div>`
      )
      .join("");
  const css = `[data-role="page"]{background:${ink.bg};color:${ink.text};font-family:"${ink.bodyFont}",Georgia,serif;} h1{position:absolute;left:64px;top:72px;width:950px;margin:0;font-size:60px;font-family:"${ink.headingFont}",Georgia,serif;} .rule{position:absolute;left:540px;top:320px;width:4px;height:900px;background:${ink.accent};}`;
  const body = `${logo(assets, "position:absolute;right:48px;top:48px;width:56px;height:56px;object-fit:contain;")}<h1 data-role="heading">${esc(draft.title)}</h1><div class="rule"></div>${column(left, 64)}${column(right, 600)}`;
  return {
    html: shell({ width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT, compositionId: "explainer-comparison", css, body, fontCss: fontCss(draft, assets) }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "explainer-comparison",
    text: pageText([draft.title, ...draft.pages.flatMap((b) => [b.heading, b.body])]),
  };
}

function proofAnnotation(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const shot = assets.imagePaths[0] ? pathToFileURL(assets.imagePaths[0]).href : "";
  const picture = shot
    ? `<img data-block="photo" src="${esc(shot)}" alt="" style="position:absolute;left:64px;top:64px;width:952px;height:620px;object-fit:cover;"/>`
    : "";
  const notes = draft.pages
    .slice(0, 3)
    .map(
      (page, index) =>
        `<p data-role="body" data-block="note-${index}" style="position:absolute;left:64px;top:${760 + index * 150}px;width:900px;margin:0;font-size:32px;line-height:1.3;"><strong>${esc(page.heading)}</strong> ${esc(page.body)}</p>`
    )
    .join("");
  const css = `[data-role="page"]{background:${ink.bg};color:${ink.text};font-family:"${ink.bodyFont}",Georgia,serif;}`;
  return {
    html: shell({
      width: CAROUSEL_WIDTH,
      height: CAROUSEL_HEIGHT,
      compositionId: "proof-annotation",
      css,
      body: `${picture}${notes}${logo(assets, "position:absolute;right:48px;bottom:36px;width:48px;height:48px;object-fit:contain;")}`,
      fontCss: fontCss(draft, assets),
    }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "proof-annotation",
    text: pageText(draft.pages.flatMap((p) => [p.heading, p.body])),
  };
}

function proofSplit(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const img = (file: string | undefined, x: number) =>
    file
      ? `<img data-block="photo" src="${esc(pathToFileURL(file).href)}" alt="" style="position:absolute;left:${x}px;top:80px;width:450px;height:620px;object-fit:cover;"/>`
      : "";
  const css = `[data-role="page"]{background:${ink.bg};color:${ink.text};font-family:"${ink.bodyFont}",Georgia,serif;} h1{position:absolute;left:64px;top:760px;width:950px;margin:0;font-size:48px;font-family:"${ink.headingFont}",Georgia,serif;} p{position:absolute;left:64px;top:900px;width:950px;margin:0;font-size:32px;line-height:1.35;}`;
  const body = `${img(assets.imagePaths[0], 64)}${img(assets.imagePaths[1], 566)}<h1 data-role="heading">${esc(draft.pages[0]?.heading ?? draft.title)}</h1><p data-role="body">${esc(draft.pages[0]?.body ?? "")}</p>`;
  return {
    html: shell({ width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT, compositionId: "proof-split", css, body, fontCss: fontCss(draft, assets) }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "proof-split",
    text: pageText([draft.pages[0]?.heading ?? "", draft.pages[0]?.body ?? ""]),
  };
}

function textPov(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const opinion = draft.claims.some((claim) => claim.kind === "draft_opinion");
  const label = opinion ? "Draft opinion" : "From the site";
  const css = `
    [data-role="page"] { background: ${ink.bg}; color: ${ink.text}; font-family: "${ink.bodyFont}", Georgia, serif; }
    .label { position: absolute; left: 80px; top: 120px; font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; color: ${ink.primary}; }
    h1 { position: absolute; left: 80px; top: 220px; width: 900px; margin: 0; font-size: 68px; line-height: 1.12; font-family: "${ink.headingFont}", Georgia, serif; }
    p { position: absolute; left: 80px; top: 780px; width: 860px; margin: 0; font-size: 32px; line-height: 1.4; }
  `;
  const body = `
    ${logo(assets, "position:absolute;left:80px;bottom:80px;width:64px;height:64px;object-fit:contain;")}
    <div class="label" data-block="label">${label}</div>
    <h1 data-role="heading" data-block="heading">${esc(draft.pages[0]?.heading ?? draft.title)}</h1>
    <p data-role="body" data-block="body">${esc(draft.pages[0]?.body ?? draft.hook)}</p>
  `;
  return {
    html: shell({ width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT, compositionId: "text-pov", css, body, fontCss: fontCss(draft, assets) }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "text-pov",
    text: pageText([label, draft.pages[0]?.heading ?? draft.title, draft.pages[0]?.body ?? draft.hook]),
  };
}

function textColumns(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const cols = draft.pages.slice(0, 3).map(
    (page, index) => `
      <section data-block="col-${index}" style="position:absolute;left:${64 + index * 330}px;top:360px;width:300px;">
        <h2 style="margin:0 0 16px;font-size:36px;font-family:'${ink.headingFont}',Georgia,serif;">${esc(page.heading)}</h2>
        <p data-role="body" style="margin:0;font-size:32px;line-height:1.3;">${esc(page.body)}</p>
      </section>`
  );
  const css = `[data-role="page"]{background:${ink.primary};color:${ink.bg};font-family:"${ink.bodyFont}",Georgia,serif;} h1{position:absolute;left:64px;top:80px;width:950px;margin:0;font-size:56px;font-family:"${ink.headingFont}",Georgia,serif;}`;
  return {
    html: shell({
      width: CAROUSEL_WIDTH,
      height: CAROUSEL_HEIGHT,
      compositionId: "text-columns",
      css,
      body: `<h1 data-role="heading">${esc(draft.title)}</h1>${cols.join("")}`,
      fontCss: fontCss(draft, assets),
    }),
    width: CAROUSEL_WIDTH,
    height: CAROUSEL_HEIGHT,
    compositionId: "text-columns",
    text: pageText([draft.title, ...draft.pages.flatMap((p) => [p.heading, p.body])]),
  };
}

function xReflow(draft: PostDraft, assets: PostTemplateAssets): BuiltPage {
  const ink = inkFor(draft);
  const lines = draft.pages.slice(0, 3);
  const css = `
    [data-role="page"] { background: ${ink.bg}; color: ${ink.text}; font-family: "${ink.bodyFont}", Georgia, serif; display: flex; }
    h1 { margin: 48px 48px 12px; font-size: 42px; font-family: "${ink.headingFont}", Georgia, serif; }
    ol { margin: 0 48px; padding-left: 28px; font-size: 28px; line-height: 1.3; }
  `;
  const body = `<div data-block="x"><h1 data-role="heading">${esc(draft.title)}</h1><ol>${lines
    .map((line) => `<li data-role="body">${esc(line.heading)}: ${esc(line.body)}</li>`)
    .join("")}</ol></div>`;
  return {
    html: shell({ width: X_IMAGE_WIDTH, height: X_IMAGE_HEIGHT, compositionId: `${draft.compositionId}-x`, css, body, fontCss: fontCss(draft, assets) }),
    width: X_IMAGE_WIDTH,
    height: X_IMAGE_HEIGHT,
    compositionId: `${draft.compositionId}-x`,
    text: pageText([draft.title, ...lines.flatMap((l) => [l.heading, l.body])]),
  };
}

export function pagesForDraft(draft: PostDraft, assets: PostTemplateAssets, channel: "linkedin" | "x"): BuiltPage[] {
  if (channel === "x") return [xReflow(draft, assets)];
  if (draft.formatFamily === "carousel") {
    const build = draft.compositionId === "carousel-checklist" ? carouselChecklist : carouselSteps;
    return draft.pages.map((page, index) => build(draft, page, index, draft.pages.length, assets));
  }
  if (draft.compositionId === "explainer-comparison") return [explainerComparison(draft, assets)];
  if (draft.formatFamily === "explainer") return [explainerFramework(draft, assets)];
  if (draft.compositionId === "proof-split" && assets.imagePaths.length >= 2) return [proofSplit(draft, assets)];
  if (draft.compositionId === "proof-annotation" && assets.imagePaths.length >= 1) return [proofAnnotation(draft, assets)];
  if (draft.compositionId === "text-columns") return [textColumns(draft, assets)];
  return [textPov(draft, assets)];
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
