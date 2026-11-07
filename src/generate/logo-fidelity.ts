/**
 * Real visual-fidelity check for an approved logo, beyond mere presence.
 *
 * render.ts's evaluateLogoCheck already proves the logo element existed
 * with a non-empty box and that the browser actually decoded real image
 * bytes (naturalWidth/naturalHeight > 0) — neither of which a CSS box alone
 * proves, since every template sets an explicit CSS width/height on the
 * `<img>` that would still report a non-empty bounding box even if the
 * image never decoded at all (a broken/corrupt file, a 404'd src, etc.).
 *
 * This file goes one step further: it renders the *same* approved asset
 * file on its own, in an isolated page, at the exact box size and
 * background colour the main template used for its logo element, then
 * compares that reference render pixel-for-pixel against a screenshot of
 * the same region cropped from the actual main render. A high match proves
 * the pixels actually on screen really are the approved file — not some
 * other, wrong, or substituted asset that still happens to decode cleanly.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import type { Browser } from "playwright";
import { PNG } from "pngjs";
import { installNetworkGuard } from "./network-guard";
import { toLocalFileUrl } from "./templates";

export interface LogoBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mean per-channel pixel similarity between two same-sized PNGs, from 0
 * (totally different) to 1 (identical). Returns null when the buffers
 * aren't both decodable PNGs of identical, non-zero dimensions — a
 * meaningless comparison is reported as "couldn't verify", never a score.
 */
export function pixelSimilarity(a: Buffer, b: Buffer): number | null {
  let pa: PNG;
  let pb: PNG;
  try {
    pa = PNG.sync.read(a);
    pb = PNG.sync.read(b);
  } catch {
    return null;
  }
  if (pa.width !== pb.width || pa.height !== pb.height || pa.width === 0 || pa.height === 0) return null;

  let diffSum = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    diffSum +=
      Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
  }
  const maxDiff = pa.width * pa.height * 3 * 255;
  return maxDiff === 0 ? 1 : 1 - diffSum / maxDiff;
}

/**
 * Renders `logoPath` alone, at `box`'s exact pixel size against
 * `backgroundColor`, and returns a PNG screenshot clipped to that box — the
 * same box geometry the main template used for its own logo element, so the
 * two screenshots are directly, pixel-for-pixel comparable. Returns null
 * (never throws) on any failure — logo-fidelity becomes "not verified",
 * never a fabricated score.
 */
export async function renderLogoReference(
  browser: Browser,
  logoPath: string,
  box: LogoBoxRect,
  backgroundColor: string
): Promise<Buffer | null> {
  const logoUrl = toLocalFileUrl(logoPath);
  if (!logoUrl) return null;
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));

  let context;
  try {
    context = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false });
  } catch {
    return null;
  }
  installNetworkGuard(context);

  // Same reason render.ts writes its template to a real file instead of
  // page.setContent(): Chromium refuses to load a file:// <img src> from a
  // document that isn't itself file:// in origin. Navigating to a real
  // temp file gives this reference page a genuine file:// origin, so the
  // comparison this module exists for can actually see the logo at all.
  const htmlPath = path.join(os.tmpdir(), `logo-ref-${crypto.randomBytes(8).toString("hex")}.html`);
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;">
  <div style="width:${width}px;height:${height}px;background:${backgroundColor};display:flex;align-items:center;justify-content:center;overflow:hidden;">
    <img src="${logoUrl}" style="width:100%;height:100%;object-fit:contain;" alt="" />
  </div>
</body>
</html>`;

  try {
    fs.writeFileSync(htmlPath, html, "utf8");
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    return await page.screenshot({ clip: { x: 0, y: 0, width, height }, type: "png" });
  } catch {
    return null;
  } finally {
    await context.close();
    fs.rmSync(htmlPath, { force: true });
  }
}
