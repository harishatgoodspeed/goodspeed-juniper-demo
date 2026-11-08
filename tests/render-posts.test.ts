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

function exact(seed: string, length: number): string {
  let out = seed;
  while (out.length < length) out = `${out} ${seed}`;
  return out.slice(0, length);
}

test("a carousel exports a multipage PDF and ordered PNG pages", async () => {
  const draft = carousel();
  draft.cta = exact("Bring the pair in while the sole is still a sole.", 140);
  draft.pages = draft.pages.map(() => ({
    heading: exact("Check the welt and the heel before a long wet path", 72),
    body: exact("Look along the stitching and repair it before the next walk rather than after the split.", 180),
  }));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-"));
  const rendered = await renderPostPackage(draft, { imagePaths: [] }, outDir, "linkedin");
  assert.equal(rendered.pages.length, 6);
  assert.ok(rendered.pdfPath);
  const pages = countPdfPages(fs.readFileSync(rendered.pdfPath!));
  assert.equal(pages, 6);
  const names = rendered.pages.map((page) => path.basename(page.filePath));
  assert.deepEqual(names, ["page-01.png", "page-02.png", "page-03.png", "page-04.png", "page-05.png", "page-06.png"]);
  for (const page of rendered.pages) {
    assert.equal(page.width, 1080);
    assert.equal(page.height, 1350);
  }
  assert.equal(rendered.layout.overflow, false);
  assert.equal(rendered.layout.overlap, false);
  assert.ok(rendered.layout.contrastRatio >= 3);
  assert.ok(rendered.layout.minBodyPx >= 30);
  assert.deepEqual(rendered.layout.problems, []);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("a checklist image is one portrait PNG and a hook post renders nothing", async () => {
  const checklist: PostDraft = {
    ...carousel(),
    formatFamily: "explainer",
    compositionId: "explainer-framework",
    title: exact("Before you call a boot finished", 64),
    pages: Array.from({ length: 6 }, () => ({
      heading: exact("Sole still holds a print", 40),
      body: exact("If the tread is smooth it is already late to wait.", 90),
    })),
  };
  const checklistDir = fs.mkdtempSync(path.join(os.tmpdir(), "checklist-"));
  const image = await renderPostPackage(checklist, { imagePaths: [] }, checklistDir, "linkedin");
  assert.equal(image.pages.length, 1);
  assert.equal(image.pdfPath, null);
  assert.equal(path.basename(image.pages[0].filePath), "page-01.png");
  assert.equal(image.pages[0].width, 1080);
  assert.equal(image.pages[0].height, 1350);
  assert.equal(image.layout.overflow, false);
  assert.equal(image.layout.overlap, false);
  assert.ok(image.layout.contrastRatio >= 3);
  assert.ok(image.layout.minBodyPx >= 30);
  assert.deepEqual(image.layout.problems, []);
  const pngs = fs.readdirSync(checklistDir).filter((name) => name.endsWith(".png") || name.endsWith(".pdf"));
  assert.deepEqual(pngs, ["page-01.png"]);

  const hook: PostDraft = {
    ...carousel(),
    formatFamily: "hook",
    compositionId: "hook-text",
    pages: [],
    altText: "",
    xCaption: "",
  };
  const hookDir = path.join(os.tmpdir(), `hook-${Date.now()}`);
  const text = await renderPostPackage(hook, { imagePaths: [] }, hookDir, "x");
  assert.equal(text.pages.length, 0);
  assert.equal(text.pdfPath, null);
  assert.equal(text.compositionId, "hook-text");
  assert.match(text.text, /Start with the sole/);
  assert.equal(fs.existsSync(hookDir), false);
  fs.rmSync(checklistDir, { recursive: true, force: true });
});
