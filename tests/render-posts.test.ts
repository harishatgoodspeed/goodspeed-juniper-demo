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

test("a checklist image is one PNG and a hook post writes no image and no x.png", async () => {
  const checklist = carousel();
  checklist.formatFamily = "explainer";
  checklist.compositionId = "explainer-framework";
  checklist.pages = checklist.pages.slice(0, 4);
  const checklistDir = fs.mkdtempSync(path.join(os.tmpdir(), "checklist-"));
  const checklistRendered = await renderPostPackage(checklist, { imagePaths: [] }, checklistDir, "linkedin");
  assert.equal(checklistRendered.pages.length, 1);
  assert.equal(checklistRendered.pdfPath, null);
  const png = fs.readFileSync(checklistRendered.pages[0].filePath);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(fs.readdirSync(checklistDir).some((name) => name === "x.png"), false);

  const hook = carousel();
  hook.formatFamily = "hook";
  hook.compositionId = "hook-text";
  hook.pages = [];
  const hookDir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const hookRendered = await renderPostPackage(hook, { imagePaths: [] }, hookDir, "linkedin");
  assert.equal(hookRendered.pages.length, 0);
  assert.equal(hookRendered.pdfPath, null);
  assert.equal(fs.readdirSync(hookDir).some((name) => name.endsWith(".png") || name.endsWith(".pdf")), false);

  const xDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-skip-"));
  const xRendered = await renderPostPackage(carousel(), { imagePaths: [] }, xDir, "x");
  assert.equal(xRendered.pages.length, 0);
  assert.equal(fs.readdirSync(xDir).some((name) => name.endsWith(".png")), false);

  fs.rmSync(checklistDir, { recursive: true, force: true });
  fs.rmSync(hookDir, { recursive: true, force: true });
  fs.rmSync(xDir, { recursive: true, force: true });
});
