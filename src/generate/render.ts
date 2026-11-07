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
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { newId } from "../ids";
import type { Brief, FontCheckEvidence, LogoCheckEvidence, RenderEvidence } from "../pipeline-types";
import { buildTemplate, SELECTORS, type FontRoleExpectation, type TemplateAssets } from "./templates";
import { installNetworkGuard } from "./network-guard";
import { pixelSimilarity, renderLogoReference } from "./logo-fidelity";

export type RenderAssets = TemplateAssets;

// Re-exported for tests/generate.test.ts, which attaches this to a context
// directly to prove a request to a non-resolving external host is actually
// aborted, not just intended to be. Lives in network-guard.ts so
// logo-fidelity.ts can use the same guard without a circular import.
export { installNetworkGuard } from "./network-guard";

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

interface LogoPresenceResult {
  rendered: boolean;
  boundingBoxNonEmpty: boolean;
  naturalWidth: number;
  naturalHeight: number;
  rect: { x: number; y: number; width: number; height: number } | null;
}

async function evaluateLogoPresence(page: Page): Promise<LogoPresenceResult> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLImageElement | null;
    if (!el) return { rendered: false, boundingBoxNonEmpty: false, naturalWidth: 0, naturalHeight: 0, rect: null };
    const r = el.getBoundingClientRect();
    return {
      rendered: true,
      boundingBoxNonEmpty: r.width > 0 && r.height > 0,
      naturalWidth: el.naturalWidth ?? 0,
      naturalHeight: el.naturalHeight ?? 0,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  }, SELECTORS.logo);
}

/**
 * Presence (does the logo element exist, with a decoded image behind it)
 * plus real visual fidelity (do the pixels actually on screen match an
 * independent reference render of the same approved file) — see
 * logo-fidelity.ts for why presence alone isn't enough. `logoPath` and
 * `backgroundHex` are optional only because not every caller has them (e.g.
 * no approved logo at all); without them fidelity is simply not computed,
 * never guessed at.
 */
async function evaluateLogoCheck(
  page: Page,
  browser: Browser,
  brief: Brief,
  logoPath: string | undefined,
  backgroundHex: string
): Promise<LogoCheckEvidence | null> {
  if (brief.logoAssetId === null) return null;
  const presence = await evaluateLogoPresence(page);

  let similarity: number | null = null;
  if (presence.rendered && presence.naturalWidth > 0 && presence.naturalHeight > 0 && presence.rect && logoPath) {
    try {
      const clip = {
        x: Math.round(presence.rect.x),
        y: Math.round(presence.rect.y),
        width: Math.max(1, Math.round(presence.rect.width)),
        height: Math.max(1, Math.round(presence.rect.height)),
      };
      const mainClip = await page.screenshot({ clip, type: "png" });
      const reference = await renderLogoReference(browser, logoPath, clip, backgroundHex);
      similarity = reference ? pixelSimilarity(mainClip, reference) : null;
    } catch {
      similarity = null; // genuinely couldn't verify — never fabricate a score
    }
  }

  return {
    expectedAssetId: brief.logoAssetId,
    rendered: presence.rendered,
    boundingBoxNonEmpty: presence.boundingBoxNonEmpty,
    naturalWidth: presence.naturalWidth,
    naturalHeight: presence.naturalHeight,
    similarity,
  };
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

    const id = newId("render");
    // Chromium refuses to load local file:// subresources (images, in
    // particular an approved logo/image path) from a document whose own
    // origin ISN'T itself file:// — a document built via page.setContent()
    // has no such origin, so every <img src="file://..."> in it silently
    // fails to decode (confirmed empirically: naturalWidth stays 0, no
    // error is thrown, nothing in the DOM reveals it — see
    // tests/generate.test.ts's logo-fidelity assertions, which is what
    // caught this). Writing the template to a real file and navigating to
    // it gives the document a genuine file:// origin, so file:// siblings
    // (same directory tree) load exactly as a real browser would load them.
    const htmlPath = path.join(outDir, `${id}.src.html`);
    fs.writeFileSync(htmlPath, template.html, "utf8");

    try {
      const page = await context.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      // Any @font-face declared from a real embedded font file (see
      // font-assets.ts) must actually finish loading before we check or
      // screenshot — document.fonts.ready still works via CDP evaluate even
      // with javaScriptEnabled: false, same as the other evaluate() calls
      // in this file (see the comment on isFontAvailable above).
      await page.evaluate(() => document.fonts.ready);

      const fontChecks = await evaluateFontChecks(page, template.fontRoles);
      // The "background" region is the logo's actual backdrop in every
      // current template; falling back to white only when a template ever
      // declares none, so fidelity comparison still has something to composite against.
      const backgroundHex = template.regions.find((r) => r.label === "background")?.expectedHex ?? "#ffffff";
      const logoCheck = await evaluateLogoCheck(page, browser, brief, assets.logoPath, backgroundHex);
      const overflow = await evaluateOverflow(page);
      const text = await page.evaluate(() => document.body.innerText);

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
        text,
      };
    } finally {
      await context.close();
      fs.rmSync(htmlPath, { force: true });
    }
  } finally {
    await browser.close();
  }
}
