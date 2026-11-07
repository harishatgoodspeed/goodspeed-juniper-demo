/**
 * The free tool's "check this against our brand" upload review.
 *
 * Deliberately narrow and honest: it checks colour only. Identifying a
 * typeface or logo from an arbitrary rasterised upload (a screenshot, an
 * exported design, a photo of a printed piece) isn't something this project
 * can do reliably — claiming to would be exactly the kind of fabricated
 * capability this codebase otherwise refuses to ship (see review.ts's
 * not_applicable/not_verified states). Colour, by contrast, is something we
 * can measure for real: decode the upload, sample its actual pixels, and
 * compute a genuine CIEDE2000 distance (src/review/colour.ts) from each
 * approved palette colour to the nearest pixel that's actually in the
 * image. The UI must say "colour only" — never imply font/logo coverage.
 */

import { chromium } from "playwright";
import { compareHex, rgbToHex } from "./colour";

export interface ColourMatch {
  approvedHex: string;
  /** Smallest CIEDE2000 distance from this approved colour to any sampled pixel in the upload. */
  minDeltaE: number;
  /** The upload's own pixel (as a hex) that produced minDeltaE, for display. */
  closestObservedHex: string;
  found: boolean;
}

export interface UploadColourCheckResult {
  width: number;
  height: number;
  matches: ColourMatch[];
  /** How many of the approved colours were found in the upload within threshold — never a single opaque score. */
  foundCount: number;
  totalApproved: number;
}

export class UploadDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadDecodeError";
  }
}

interface SampleResult {
  width: number;
  height: number;
  samples: { r: number; g: number; b: number }[];
}

/**
 * Decodes an uploaded image (any format a real browser can decode: PNG,
 * JPEG, WebP, GIF) via a real Chromium canvas — the same "actually render
 * it, don't guess" approach the rest of this project uses — and returns a
 * downsampled grid of its real pixel colours. A data: URI has no file://
 * origin restriction (unlike src/generate/render.ts's templates), so this
 * needs no temp file.
 */
async function samplePixels(buffer: Buffer, mimeType: string, gridSize = 48): Promise<SampleResult | null> {
  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(
      async ({ src, grid }) => {
        const img = new Image();
        const loaded = await new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = src;
        });
        if (!loaded || img.naturalWidth === 0 || img.naturalHeight === 0) return null;

        const canvas = document.createElement("canvas");
        canvas.width = grid;
        canvas.height = grid;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, grid, grid);

        const data = ctx.getImageData(0, 0, grid, grid).data;
        const samples: { r: number; g: number; b: number }[] = [];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 16) continue; // skip near-fully-transparent pixels
          samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
        }
        return { width: img.naturalWidth, height: img.naturalHeight, samples };
      },
      { src: dataUri, grid: gridSize }
    );
  } finally {
    await browser.close();
  }
}

/**
 * For each approved colour, finds the closest pixel actually present in the
 * upload and reports a real CIEDE2000 distance — never a fabricated score.
 * `thresholdDeltaE` is deliberately more lenient than the render-review
 * threshold (config.COLOUR_DELTA_E_THRESHOLD): an upload may be a photo,
 * screenshot, or re-compressed export, none of which this project produced
 * or controls the exactness of.
 */
export function checkSamplesAgainstPalette(
  samples: { r: number; g: number; b: number }[],
  approvedHexes: string[],
  thresholdDeltaE: number
): ColourMatch[] {
  return approvedHexes.map((approvedHex) => {
    let best: { deltaE: number; hex: string } | null = null;
    for (const s of samples) {
      const observedHex = rgbToHex(s.r, s.g, s.b);
      const deltaE = compareHex(observedHex, approvedHex);
      if (!best || deltaE < best.deltaE) best = { deltaE, hex: observedHex };
    }
    return {
      approvedHex,
      minDeltaE: best?.deltaE ?? Infinity,
      closestObservedHex: best?.hex ?? "n/a",
      found: (best?.deltaE ?? Infinity) <= thresholdDeltaE,
    };
  });
}

export interface UploadCheckDeps {
  /** Injectable for tests, so this never needs a real Chromium render to exercise offline. */
  samplePixels?: typeof samplePixels;
}

/**
 * Full upload-vs-brand colour check: decode the real image, sample its real
 * pixels, and compare against the approved palette. Throws UploadDecodeError
 * (never silently returns a fabricated result) if the upload can't actually
 * be decoded as an image at all.
 */
export async function checkUploadAgainstBrand(
  buffer: Buffer,
  mimeType: string,
  approvedHexes: string[],
  thresholdDeltaE: number,
  deps: UploadCheckDeps = {}
): Promise<UploadColourCheckResult> {
  const sample = deps.samplePixels ?? samplePixels;
  const decoded = await sample(buffer, mimeType);
  if (!decoded) {
    throw new UploadDecodeError("Could not decode the uploaded file as an image.");
  }
  if (decoded.samples.length === 0) {
    throw new UploadDecodeError("The uploaded image has no non-transparent pixels to sample.");
  }

  const matches = checkSamplesAgainstPalette(decoded.samples, approvedHexes, thresholdDeltaE);
  return {
    width: decoded.width,
    height: decoded.height,
    matches,
    foundCount: matches.filter((m) => m.found).length,
    totalApproved: approvedHexes.length,
  };
}
