/**
 * Reads a visitor's screenshot of a blocked channel.
 * Palette comes from the real pixels. Name and tagline come from OCR
 * when tesseract is available. Nothing is invented when a field is missing.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { paletteFromUpload } from "../review/upload-check";

export interface ScreenshotRead {
  colours: string[];
  /** A small PNG of the upload, for the side by side. */
  previewDataUrl: string | null;
  name: string | null;
  tagline: string | null;
}

const MAX_BYTES = 4 * 1024 * 1024;

export async function readChannelScreenshot(base64: string, mimeType: string): Promise<ScreenshotRead> {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    return { colours: [], previewDataUrl: null, name: null, tagline: null };
  }
  const colours = await paletteFromUpload(buffer, mimeType).catch(() => []);
  const text = await ocr(buffer, mimeType);
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1);
  const name = lines[0] && lines[0].length <= 80 ? lines[0] : null;
  const tagline = lines.slice(name ? 1 : 0, 4).join(" ").slice(0, 280) || null;
  const preview = buffer.length <= 80_000 ? `data:${mimeType};base64,${buffer.toString("base64")}` : null;
  return { colours, previewDataUrl: preview && preview.length <= 180_000 ? preview : null, name, tagline };
}

function ocr(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "img";
  const file = path.join(os.tmpdir(), `audit-shot-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  return new Promise((resolve) => {
    execFile("tesseract", [file, "stdout", "-l", "eng"], { timeout: 20_000 }, (err, stdout) => {
      fs.unlink(file, () => undefined);
      resolve(err ? "" : String(stdout || "").trim());
    });
  });
}
