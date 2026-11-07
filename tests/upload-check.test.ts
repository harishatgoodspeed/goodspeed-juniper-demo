import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkSamplesAgainstPalette, checkUploadAgainstBrand, UploadDecodeError } from "../src/review/upload-check";
import { writeSolidPng } from "./helpers/png";

const THRESHOLD = 12;

test("checkSamplesAgainstPalette: an approved colour genuinely present in the samples is found with deltaE 0", () => {
  const samples = [
    { r: 0x10, g: 0x2a, b: 0x5c }, // #102A5C
    { r: 255, g: 255, b: 255 },
  ];
  const matches = checkSamplesAgainstPalette(samples, ["#102A5C"], THRESHOLD);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].found, true);
  assert.equal(matches[0].minDeltaE, 0);
  assert.equal(matches[0].closestObservedHex, "#102a5c");
});

test("checkSamplesAgainstPalette: an approved colour with nothing close in the samples is not found, with a real (large) deltaE", () => {
  const samples = [{ r: 255, g: 255, b: 255 }]; // pure white only
  const matches = checkSamplesAgainstPalette(samples, ["#102A5C"], THRESHOLD); // saturated navy
  assert.equal(matches[0].found, false);
  assert.ok(matches[0].minDeltaE > THRESHOLD, `expected a large deltaE, got ${matches[0].minDeltaE}`);
});

test("checkUploadAgainstBrand: a real solid-colour PNG matching the approved palette is found end to end (real Chromium decode)", async () => {
  const pngPath = writeSolidPng(64, 64, "#C6DD66");
  const buffer = fs.readFileSync(pngPath);

  const result = await checkUploadAgainstBrand(buffer, "image/png", ["#C6DD66", "#36493C"], THRESHOLD);

  assert.equal(result.width, 64);
  assert.equal(result.height, 64);
  assert.equal(result.totalApproved, 2);
  assert.equal(result.foundCount, 1, "only the colour actually present in the upload should be found");
  const greenMatch = result.matches.find((m) => m.approvedHex === "#C6DD66");
  const darkMatch = result.matches.find((m) => m.approvedHex === "#36493C");
  assert.equal(greenMatch?.found, true);
  assert.ok((greenMatch?.minDeltaE ?? 99) < 2, `expected a near-zero deltaE for an exact solid-colour match, got ${greenMatch?.minDeltaE}`);
  assert.equal(darkMatch?.found, false);
});

test("checkUploadAgainstBrand throws UploadDecodeError for bytes that aren't a real image, never a fabricated result", async () => {
  const garbage = Buffer.from("this is not an image");
  await assert.rejects(() => checkUploadAgainstBrand(garbage, "image/png", ["#C6DD66"], THRESHOLD), UploadDecodeError);
});

test("checkUploadAgainstBrand reports an honest per-colour breakdown, never a single opaque score", async () => {
  const pngPath = writeSolidPng(32, 32, "#FFFFFF");
  const buffer = fs.readFileSync(pngPath);
  const result = await checkUploadAgainstBrand(buffer, "image/png", ["#111111", "#222222", "#FFFFFF"], THRESHOLD);
  assert.equal(result.matches.length, 3, "every approved colour gets its own reported match, not a rolled-up score");
  assert.equal(result.foundCount, 1);
});
