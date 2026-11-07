import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Writes a real PNG file, entirely filled with one solid colour, and returns its path. */
export function writeSolidPng(width: number, height: number, hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "review-test-")), "fixture.png");
  fs.writeFileSync(filePath, PNG.sync.write(png));
  return filePath;
}

/** Reads back the raw bytes of a region (no border trim) so a test can prove two renders genuinely differ. */
export function readRegionBytes(filePath: string, x: number, y: number, width: number, height: number): Buffer {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const out = Buffer.alloc(width * height * 4);
  let o = 0;
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      const idx = (png.width * yy + xx) << 2;
      out[o++] = png.data[idx];
      out[o++] = png.data[idx + 1];
      out[o++] = png.data[idx + 2];
      out[o++] = png.data[idx + 3];
    }
  }
  return out;
}
