/// <reference lib="dom" />
/**
 * Phase 3 rendering: turns a Brief + approved local asset paths into a real
 * downloadable file (PNG for linkedin_image/slide, PDF for one_pager_pdf,
 * plain text for post_copy) plus the RenderEvidence Phase 4 needs to review
 * it, using an isolated Playwright Chromium instance per render.
 *
 * The `/// <reference lib="dom" />` above only pulls in DOM type
 * declarations for *this file*, so the in-page `page.evaluate()` callbacks
 * below can reference `document`/`getComputedStyle`/etc. — it does not
 * touch tsconfig.json's own `lib` setting (this phase's files are
 * create-only, no edits to existing config).
 */

import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { newId } from "../ids";
import type { Brief, FontCheckEvidence, LogoCheckEvidence, RenderEvidence } from "../pipeline-types";
import { buildTemplate, SELECTORS, type FontRoleExpectation, type TemplateAssets } from "./templates";

export type RenderAssets = TemplateAssets;

/**
 * Allows only `file:`/`data:` requests (plus the `about:blank` Playwright
 * issues for a fresh page) through a context; aborts everything else before
 * it ever leaves the process. Brand-sourced copy and layout directives are
 * untrusted, so even though our own templates only ever reference local
 * asset paths (see templates.ts's `toLocalFileUrl`), rendering must not
 * depend on that alone — this is the independent network-layer guarantee.
 *
 * Exported (not just used internally by `renderOutput`) so
 * tests/generate.test.ts can attach it to a context directly and prove a
 * request to a non-resolving external host is actually aborted, not just
 * intended to be.
 */
export function installNetworkGuard(context: BrowserContext): void {
  void context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url === "about:blank") {
      void route.continue();
    } else {
      void route.abort("blockedbyclient");
    }
  });
}

/**
 * Whether `family` actually rendered as itself rather than silently falling
 * back to a generic font. We do NOT use `document.fonts.check()` for this —
 * verified empirically (see tests/generate.test.ts) that headless Chromium
 * returns `true` from `document.fonts.check()` even for a font name that
 * doesn't exist anywhere on the system and was never registered via
 * `@font-face`, which would make the check worthless for exactly the
 * failure mode it's supposed to catch. Instead we use the standard
 * canvas-measureText technique (as used by e.g. Font Face Observer):
 * measure a test string against each generic fallback alone, then against
 * `"family", fallback`; if the measured width never changes, the browser
 * had nothing but the fallback to render with.
 */
async function isFontAvailable(page: Page, family: string): Promise<boolean> {
  // Deliberately written as a flat loop with no inner named helper function:
  // esbuild (via tsx, which transpiles this file at test/dev time) can inject
  // a `__name(...)` call to preserve a nested function's `.name` property,
  // and Playwright serialises this whole callback's source to run inside the
  // page — where `__name` doesn't exist, throwing a ReferenceError. Keeping
  // this callback free of nested named functions avoids that entirely.
  return page.evaluate((fam: string) => {
    const testString = "mmmmmmmmmmlli";
    const testSize = "72px";
    const fallbacks = ["monospace", "serif", "sans-serif"];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    for (const fallback of fallbacks) {
      ctx.font = `${testSize} ${fallback}`;
      const fallbackWidth = ctx.measureText(testString).width;
      ctx.font = `${testSize} "${fam}", ${fallback}`;
      const testWidth = ctx.measureText(testString).width;
      if (testWidth !== fallbackWidth) return true;
    }
    return false;
  }, family);
}

async function evaluateFontChecks(page: Page, fontRoles: FontRoleExpectation[]): Promise<FontCheckEvidence[]> {
  const checks: FontCheckEvidence[] = [];
  for (const role of fontRoles) {
    const selector = role.role === "heading" ? SELECTORS.heading : SELECTORS.body;
    const computedFamily = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontFamily : "";
    }, selector);
    const loaded = await isFontAvailable(page, role.expectedFamily);
    checks.push({
      role: role.role,
      expectedFamily: role.expectedFamily,
      expectedFamilyApproved: role.expectedFamilyApproved,
      computedFamily,
      loaded,
    });
  }
  return checks;
}

async function evaluateLogoCheck(page: Page, brief: Brief): Promise<LogoCheckEvidence | null> {
  if (brief.logoAssetId === null) return null;
  const result = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return { rendered: false, boundingBoxNonEmpty: false };
    const rect = el.getBoundingClientRect();
    return { rendered: true, boundingBoxNonEmpty: rect.width > 0 && rect.height > 0 };
  }, SELECTORS.logo);
  return { expectedAssetId: brief.logoAssetId, rendered: result.rendered, boundingBoxNonEmpty: result.boundingBoxNonEmpty };
}

/** True if the page's fixed-size root container had to clip content that grew past its declared box. */
async function evaluateOverflow(page: Page): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    // +1px tolerance for sub-pixel layout rounding, which is not "real" overflow.
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  }, SELECTORS.page);
}

/**
 * Renders one Brief to a real file plus evidence of what was actually
 * rendered. Pure function of its inputs (brief, assets, outDir) — no module
 * state carries between calls — so Phase 4's repair loop can call this
 * again with an adjusted `brief` (e.g. different `paletteTokenHexes`) and
 * get an independent, correct re-render every time.
 */
export async function renderOutput(brief: Brief, assets: RenderAssets, outDir: string): Promise<RenderEvidence> {
  if (brief.outputType === "post_copy") {
    // No Playwright, no file — just the sourced copy itself. Per
    // pipeline-types.ts, filePath/regions/fontChecks/logoCheck are "not
    // applicable" here, not failures; Phase 4 is expected to treat them
    // that way.
    return {
      outputType: "post_copy",
      filePath: null,
      width: 0,
      height: 0,
      regions: [],
      fontChecks: [],
      logoCheck: null,
      overflow: false,
      text: brief.postCopyText ?? "",
    };
  }

  const template = buildTemplate(brief, assets);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    // Fresh, isolated context per render: untrusted brand content must
    // never carry cookies/storage/cache state between renders, brands, or
    // repair attempts.
    const context = await browser.newContext({
      viewport: { width: template.width, height: template.height },
      // Our templates are pure HTML/CSS and need no script of their own.
      // Disabling JS here removes a whole class of attack surface for
      // untrusted brand text ever being interpreted as script, on top of
      // every interpolated string already being HTML-escaped in
      // templates.ts. This does NOT block Playwright's own
      // `page.evaluate()` calls below — verified empirically that a
      // CDP-driven evaluate still runs against the DOM with
      // `javaScriptEnabled: false` — which is what the checks below rely on.
      javaScriptEnabled: false,
    });

    installNetworkGuard(context);

    try {
      const page = await context.newPage();
      await page.setContent(template.html, { waitUntil: "load" });
      // Any @font-face declared from a real embedded font file (see
      // font-assets.ts) must actually finish loading before we check or
      // screenshot — document.fonts.ready still works via CDP evaluate even
      // with javaScriptEnabled: false, same as the other evaluate() calls
      // in this file (see the comment on isFontAvailable above).
      await page.evaluate(() => document.fonts.ready);

      const fontChecks = await evaluateFontChecks(page, template.fontRoles);
      const logoCheck = await evaluateLogoCheck(page, brief);
      const overflow = await evaluateOverflow(page);

      const id = newId("render");
      let filePath: string;

      if (brief.outputType === "one_pager_pdf") {
        filePath = path.join(outDir, `${id}.pdf`);
        // Convert our CSS-pixel page dimensions (96 CSS px/in) to inches —
        // empirically the reliable unit for page.pdf()'s width/height, and
        // matched by the `@page { size: ... }` rule in the one-pager
        // template itself via `preferCSSPageSize`.
        const widthIn = `${(template.width / 96).toFixed(4)}in`;
        const heightIn = `${(template.height / 96).toFixed(4)}in`;
        const pdfBuffer = await page.pdf({
          width: widthIn,
          height: heightIn,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "0", bottom: "0", left: "0", right: "0" },
        });
        fs.writeFileSync(filePath, pdfBuffer);
      } else {
        filePath = path.join(outDir, `${id}.png`);
        // Viewport-clipped (not `fullPage`) so the PNG is exactly
        // template.width x template.height regardless of any overflow —
        // overflow is reported separately via `overflow`, not by growing
        // the exported image past its intended resolution.
        await page.screenshot({ path: filePath, type: "png" });
      }

      return {
        outputType: brief.outputType,
        filePath,
        width: template.width,
        height: template.height,
        regions: template.regions,
        fontChecks,
        logoCheck,
        overflow,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
