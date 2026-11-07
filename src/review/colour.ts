import fs from "node:fs";
import { PNG } from "pngjs";
import { differenceCiede2000 } from "culori";
import type { RenderRegion } from "../pipeline-types";

const ciede2000 = differenceCiede2000();

/** Perceptual colour distance (CIEDE2000) between two hex colours. 0 = identical; roughly >2-3 is a visibly different colour to most people. */
export function compareHex(observedHex: string, approvedHex: string): number {
  return ciede2000(normaliseHex(observedHex), normaliseHex(approvedHex));
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function normaliseHex(hex: string): string {
  const h = hex.trim();
  return h.startsWith("#") ? h : `#${h}`;
}

/**
 * Average RGB colour of a region, read from decoded PNG pixel data. Shrinks
 * the sampled rectangle inward by `borderPx` on every side before averaging,
 * so antialiased edge pixels (which blend the region's fill with whatever is
 * next to it) never pull the average toward a colour the fill itself isn't.
 * A region narrower than 2*borderPx+1 in either dimension throws rather than
 * silently sampling the whole thing including its edges.
 */
export function averageRegionColour(png: PNG, region: RenderRegion, borderPx = 3): { r: number; g: number; b: number } {
  const x0 = region.x + borderPx;
  const y0 = region.y + borderPx;
  const x1 = region.x + region.width - borderPx;
  const y1 = region.y + region.height - borderPx;

  if (x1 <= x0 || y1 <= y0) {
    throw new Error(
      `Region "${region.label}" (${region.width}x${region.height}) is too small to sample with a ${borderPx}px border`
    );
  }
  if (x1 > png.width || y1 > png.height || region.x < 0 || region.y < 0) {
    throw new Error(`Region "${region.label}" extends outside the ${png.width}x${png.height} image`);
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) << 2;
      rSum += png.data[idx];
      gSum += png.data[idx + 1];
      bSum += png.data[idx + 2];
      count++;
    }
  }

  return { r: rSum / count, g: gSum / count, b: bSum / count };
}

export function loadPng(filePath: string): PNG {
  return PNG.sync.read(fs.readFileSync(filePath));
}

/** Reads a region straight from a PNG file and returns its averaged colour as a hex string. */
export function sampleRegionHex(filePath: string, region: RenderRegion, borderPx = 3): string {
  const png = loadPng(filePath);
  const { r, g, b } = averageRegionColour(png, region, borderPx);
  return rgbToHex(r, g, b);
}
