/**
 * Renders an AuditResult to a branded A4 PDF.
 *
 * Uses the same Playwright path as src/generate/render.ts: an isolated
 * Chromium context, the file:// network guard, and page.pdf() with
 * preferCSSPageSize so the @page rule is the paper size. Brand copy is
 * untrusted, so the document is static HTML with scripts disabled and no
 * remote fetches.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import type { AuditResult } from "./types";
import { AUDIT_PAGE, buildAuditReportHtml } from "./report-html";
import { installNetworkGuard } from "../generate/network-guard";

export interface AuditPdfRender {
  pdf: Buffer;
  /** One PNG per sheet, in order. Empty unless requested. */
  screenshots: Buffer[];
  /** Visible text of the report, for tests. */
  text: string;
  /** True when a sheet's content is taller than its page box. */
  overflow: boolean[];
}

export async function renderAuditPdf(
  result: AuditResult,
  options?: { screenshots?: boolean; scale?: number }
): Promise<AuditPdfRender> {
  const html = buildAuditReportHtml(result);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-pdf-"));
  const htmlPath = path.join(dir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: AUDIT_PAGE.width, height: AUDIT_PAGE.height },
      deviceScaleFactor: options?.scale && options.scale > 0 ? options.scale : 1,
      javaScriptEnabled: false,
    });
    installNetworkGuard(context);
    try {
      const page = await context.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 20_000 });
      await page.emulateMedia({ media: "print" });

      const text = await page.evaluate(() => document.body.innerText);
      const overflow = await page.evaluate(() => {
        const nodes = document.querySelectorAll(".sheet");
        const flags: boolean[] = [];
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          flags.push(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
        }
        return flags;
      });

      const screenshots: Buffer[] = [];
      if (options?.screenshots) {
        const sheets = await page.locator(".sheet").all();
        for (const sheet of sheets) {
          screenshots.push(await sheet.screenshot({ type: "png" }));
        }
      }

      const widthIn = `${(AUDIT_PAGE.width / 96).toFixed(4)}in`;
      const heightIn = `${(AUDIT_PAGE.height / 96).toFixed(4)}in`;
      const pdf = Buffer.from(
        await page.pdf({
          width: widthIn,
          height: heightIn,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: "0", bottom: "0", left: "0", right: "0" },
        })
      );

      return { pdf, screenshots, text, overflow };
    } finally {
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
