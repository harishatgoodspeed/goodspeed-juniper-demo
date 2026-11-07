import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "playwright";
import { pixelSimilarity, renderLogoReference } from "../src/generate/logo-fidelity";
import { writeSolidPng } from "./helpers/png";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "juniper");
const LOGO_PATH = path.join(FIXTURE_DIR, "logo-temp.svg");
const BOX = { x: 0, y: 0, width: 140, height: 140 };

test("pixelSimilarity returns null for differently-sized buffers rather than a misleading score", () => {
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  assert.equal(pixelSimilarity(png1x1, Buffer.from("not a png")), null);
});

test("renderLogoReference, called twice for the same file/box/background, is near pixel-identical to itself (sanity: the renderer is deterministic)", async () => {
  const browser = await chromium.launch();
  try {
    const [a, b] = await Promise.all([
      renderLogoReference(browser, LOGO_PATH, BOX, "#F2ECDF"),
      renderLogoReference(browser, LOGO_PATH, BOX, "#F2ECDF"),
    ]);
    assert.ok(a && b);
    const similarity = pixelSimilarity(a as Buffer, b as Buffer);
    assert.ok(similarity !== null && similarity > 0.99, `expected near-identical renders, got ${similarity}`);
  } finally {
    await browser.close();
  }
});

test("a reference render of a genuinely different asset is visually dissimilar — proves this check can actually catch a wrong/substituted logo, not just presence", async () => {
  const browser = await chromium.launch();
  const differentImagePath = writeSolidPng(140, 140, "#102A5C"); // a flat, saturated navy — nothing like the logo's cream/green lockup
  try {
    const [logoRender, differentRender] = await Promise.all([
      renderLogoReference(browser, LOGO_PATH, BOX, "#F2ECDF"),
      renderLogoReference(browser, differentImagePath, BOX, "#F2ECDF"),
    ]);
    assert.ok(logoRender && differentRender);
    const similarity = pixelSimilarity(logoRender as Buffer, differentRender as Buffer);
    assert.ok(similarity !== null);
    assert.ok(
      (similarity as number) < 0.9,
      `expected a visibly different image to score well under the 0.9 pass threshold, got ${similarity}`
    );
  } finally {
    await browser.close();
  }
});

test("renderLogoReference returns null for a non-local (remote) path, never silently fetching it", async () => {
  const browser = await chromium.launch();
  try {
    const result = await renderLogoReference(browser, "https://example.invalid/logo.png", BOX, "#ffffff");
    assert.equal(result, null);
  } finally {
    await browser.close();
  }
});
