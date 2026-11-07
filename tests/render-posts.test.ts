import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPostPackage } from "../src/generate/render-post";
import { countPdfPages } from "../src/pdf-pages";
import type { PostDraft } from "../src/posts/types";

function carousel(): PostDraft {
  return {
    formatFamily: "carousel",
    compositionId: "carousel-steps",
    title: "Six ways to look after a boot",
    hook: "Start with the sole.",
    hookAlternatives: ["Start with the sole.", "Look at the heel next."],
    caption: "A short carousel about looking after boots.",
    xCaption: "Look after the sole before the upper.",
    altText: "Six pages about boot care.",
    pages: Array.from({ length: 6 }, (_, index) => ({
      heading: `Step ${index + 1}`,
      body: "Check the stitching and the sole before you walk further.",
    })),
    claims: [],
    imageAssetIds: [],
    rationale: "A practical sequence.",
    cta: "Bring them in when the sole looks thin.",
    paletteTokenHexes: ["#F4F1EA", "#1F3A2E", "#1C1C1C", "#C97B4A"],
    fontFamilies: ["Georgia"],
    logoAssetId: null,
  };
}

test("a carousel exports a multipage PDF and ordered PNG pages", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-"));
  const rendered = await renderPostPackage(carousel(), { imagePaths: [] }, outDir, "linkedin");
  assert.equal(rendered.pages.length, 6);
  assert.ok(rendered.pdfPath);
  const pages = countPdfPages(fs.readFileSync(rendered.pdfPath!));
  assert.equal(pages, 6);
  const names = rendered.pages.map((page) => path.basename(page.filePath));
  assert.deepEqual(names, ["page-01.png", "page-02.png", "page-03.png", "page-04.png", "page-05.png", "page-06.png"]);
  assert.equal(rendered.layout.overflow, false);
  fs.rmSync(outDir, { recursive: true, force: true });
});
