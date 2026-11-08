/**
 * Renders one post package: ordered PNGs, and a real multipage PDF for carousels.
 * Layout measurements (overflow, overlap, contrast, type size) are taken from
 * the rendered page, not assumed.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { newId } from "../ids";
import { installNetworkGuard } from "./network-guard";
import { pagesForDraft, type PostTemplateAssets } from "./post-templates";
import type { PostChannel, PostDraft } from "../posts/types";
import { HOOK_COMPOSITION_ID } from "../posts/types";

export interface LayoutReport {
  overflow: boolean;
  overlap: boolean;
  minBodyPx: number;
  contrastRatio: number;
  problems: string[];
}

export interface RenderedPage {
  index: number;
  filePath: string;
  width: number;
  height: number;
  text: string;
  layout: LayoutReport;
}

export interface RenderedPostPackage {
  pages: RenderedPage[];
  pdfPath: string | null;
  text: string;
  compositionId: string;
  layout: LayoutReport;
}

const MIN_BODY_PX = 30;
const MIN_CONTRAST = 3;

function rel(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = (rgb: [number, number, number]) => 0.2126 * rel(rgb[0]) + 0.7152 * rel(rgb[1]) + 0.0722 * rel(rgb[2]);
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseRgb(input: string): [number, number, number] | null {
  const match = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

interface Measured {
  overflow: boolean;
  overlap: boolean;
  minBodyPx: number;
  headingColor: string;
  pageBackground: string;
}

function reportFrom(measured: Measured): LayoutReport {
  const heading = parseRgb(measured.headingColor);
  const background = parseRgb(measured.pageBackground);
  const ratio = heading && background ? contrastRatio(heading, background) : 0;
  const problems: string[] = [];
  if (measured.overflow) problems.push("Text or artwork overflows the page.");
  if (measured.overlap) problems.push("Text blocks overlap.");
  if (measured.minBodyPx > 0 && measured.minBodyPx < MIN_BODY_PX) {
    problems.push(`Body type is ${measured.minBodyPx.toFixed(0)}px, under the ${MIN_BODY_PX}px legibility minimum for this canvas.`);
  }
  if (ratio > 0 && ratio < MIN_CONTRAST) {
    problems.push(`Contrast is ${ratio.toFixed(2)}, under ${MIN_CONTRAST}.`);
  }
  return {
    overflow: measured.overflow,
    overlap: measured.overlap,
    minBodyPx: measured.minBodyPx,
    contrastRatio: ratio,
    problems,
  };
}

function mergeLayout(reports: LayoutReport[]): LayoutReport {
  return {
    overflow: reports.some((r) => r.overflow),
    overlap: reports.some((r) => r.overlap),
    minBodyPx: Math.min(...reports.map((r) => r.minBodyPx || Number.POSITIVE_INFINITY)),
    contrastRatio: Math.min(...reports.map((r) => r.contrastRatio || Number.POSITIVE_INFINITY)),
    problems: reports.flatMap((r) => r.problems),
  };
}

async function measure(page: import("playwright").Page): Promise<Measured> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-role="page"]') as HTMLElement | null;
    const overflow = root
      ? root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1
      : false;
    const blocks = Array.from(document.querySelectorAll("[data-block]")).map((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    });
    let overlap = false;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 8 && iy > 8) overlap = true;
      }
    }
    const bodies = Array.from(document.querySelectorAll('[data-role="body"]'));
    const sizes = bodies.map((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
    const heading = document.querySelector('[data-role="heading"]') as HTMLElement | null;
    const headingColor = heading ? getComputedStyle(heading).color : "";
    const pageBackground = root ? getComputedStyle(root).backgroundColor : "";
    return {
      overflow,
      overlap,
      minBodyPx: sizes.length ? Math.min(...sizes) : 0,
      headingColor,
      pageBackground,
    };
  });
}

export async function renderPostPackage(
  draft: PostDraft,
  assets: PostTemplateAssets,
  outDir: string,
  channel: PostChannel
): Promise<RenderedPostPackage> {
  const built = pagesForDraft(draft, assets, channel);
  if (built.length === 0) {
    // Hook posts, and any legacy proof row, are copy only. No browser, no PNG, no PDF.
    return {
      pages: [],
      pdfPath: null,
      text: [draft.hook, draft.caption].filter(Boolean).join("\n\n"),
      compositionId: draft.formatFamily === "hook" ? HOOK_COMPOSITION_ID : draft.compositionId,
      layout: {
        overflow: false,
        overlap: false,
        minBodyPx: 0,
        contrastRatio: 0,
        problems: [],
      },
    };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const pages: RenderedPage[] = [];
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    installNetworkGuard(context);
    try {
      for (let index = 0; index < built.length; index++) {
        const pageSpec = built[index];
        const htmlPath = path.join(outDir, `${newId("src")}.html`);
        fs.writeFileSync(htmlPath, pageSpec.html, "utf8");
        const page = await context.newPage();
        await page.setViewportSize({ width: pageSpec.width, height: pageSpec.height });
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const layout = reportFrom(await measure(page));
        const filePath = path.join(outDir, `page-${String(index + 1).padStart(2, "0")}.png`);
        await page.screenshot({ path: filePath, type: "png" });
        await page.close();
        fs.rmSync(htmlPath, { force: true });
        pages.push({ index, filePath, width: pageSpec.width, height: pageSpec.height, text: pageSpec.text, layout });
      }
    } finally {
      await context.close();
    }

    let pdfPath: string | null = null;
    if (draft.formatFamily === "carousel" && pages.length >= 2) {
      const width = pages[0].width;
      const height = pages[0].height;
      const images = pages
        .map(
          (item) =>
            `<img src="${pathToFileURL(item.filePath).href}" width="${width}" height="${height}" alt="" />`
        )
        .join("");
      const pdfHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: ${width}px ${height}px; margin: 0; }
        html, body { margin: 0; padding: 0; }
        img { display: block; width: ${width}px; height: ${height}px; page-break-after: always; }
        img:last-child { page-break-after: auto; }
      </style></head><body>${images}</body></html>`;
      const htmlPath = path.join(outDir, `${newId("pdfsrc")}.html`);
      fs.writeFileSync(htmlPath, pdfHtml, "utf8");
      const context = await browser.newContext({ javaScriptEnabled: false });
      installNetworkGuard(context);
      try {
        const page = await context.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        const widthIn = `${(width / 96).toFixed(4)}in`;
        const heightIn = `${(height / 96).toFixed(4)}in`;
        const pdf = await page.pdf({
          width: widthIn,
          height: heightIn,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "0", bottom: "0", left: "0", right: "0" },
        });
        pdfPath = path.join(outDir, "carousel.pdf");
        fs.writeFileSync(pdfPath, pdf);
      } finally {
        await context.close();
        fs.rmSync(htmlPath, { force: true });
      }
    }

    const layout = mergeLayout(pages.map((page) => page.layout));
    return {
      pages,
      pdfPath,
      text: pages.map((page) => page.text).join("\n"),
      compositionId: built[0]?.compositionId ?? draft.compositionId,
      layout,
    };
  } finally {
    await browser.close();
  }
}
