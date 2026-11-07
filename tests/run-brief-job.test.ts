import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../src/db";
import { createBrand, setBrandContext, setApprovedContext } from "../src/brands";
import { getOrCreateDefaultOwner } from "../src/security/session";
import { createRun, getRun } from "../src/runs";
import { enqueueJob } from "../src/jobs";
import { runBriefJob } from "../src/jobs/run-brief-job";
import type { BrandContext } from "../src/import/types";
import type { BriefSet } from "../src/pipeline-types";

function minimalContext(): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: new Date().toISOString(),
    extractionMethod: "static-html-css",
    title: "Example",
    siteName: null,
    description: "Example Co sells artisanal walking boots.",
    logoCandidates: [],
    colours: [],
    cssCustomProperties: [],
    fonts: [],
    googleFontsLinks: [],
    images: [],
    textExcerpt: "Example Co has been making boots since 1998.",
    textTruncated: false,
    stylesheetsFetched: 0,
    stylesheetsSkipped: 0,
    unknowns: [],
  };
}

function fakeBriefSet(): BriefSet {
  const common = {
    purpose: "Promote the launch",
    audience: "Existing customers",
    sourcedFactualCopy: ["Example Co has been making boots since 1998."],
    layoutDirection: "Bold product shot.",
    paletteTokenHexes: ["#C6DD66"],
    fontFamilies: ["Inter"],
    logoAssetId: null,
    imageAssetIds: [],
    voiceGuidance: "Confident.",
    unknowns: ["price not supplied"],
  };
  return {
    briefs: [
      { ...common, outputType: "linkedin_image" },
      { ...common, outputType: "one_pager_pdf" },
      { ...common, outputType: "slide" },
      { ...common, outputType: "post_copy", postCopyText: "Example Co has been making boots since 1998." },
    ],
    model: "fake-model",
    promptTokens: 42,
    completionTokens: 99,
    elapsedMs: 7,
  };
}

function setUp() {
  const db = openTestDb();
  const ownerId = getOrCreateDefaultOwner(db);
  const brand = createBrand(db, ownerId, "https://example.com");
  setBrandContext(db, brand.id, minimalContext());
  setApprovedContext(db, brand.id, { logoAssetId: null, colours: ["#C6DD66"], fonts: ["Inter"] });
  const run = createRun(db, brand.id, "Launch a new boot colourway", null, 1);
  const job = enqueueJob(db, { runId: run.id, phase: "brief" });
  return { db, brand, run, job };
}

test("runBriefJob persists a successful brief generation onto the run row", async () => {
  const { db, run, job } = setUp();
  const briefSet = fakeBriefSet();

  await runBriefJob(db, job, { generateBriefs: async () => briefSet });

  const updated = getRun(db, run.id)!;
  assert.equal(updated.status, "generating");
  assert.equal(updated.model, "fake-model");
  assert.equal(updated.prompt_tokens, 42);
  assert.equal(updated.completion_tokens, 99);
  assert.equal(updated.elapsed_ms, 7);
  const briefs = JSON.parse(updated.briefs_json!);
  assert.equal(briefs.length, 4);
  const unknowns = JSON.parse(updated.unknowns_json!);
  assert.ok(unknowns.includes("price not supplied"));
});

test("runBriefJob marks the run failed and rethrows when brief generation throws", async () => {
  const { db, run, job } = setUp();

  await assert.rejects(
    () =>
      runBriefJob(db, job, {
        generateBriefs: async () => {
          throw new Error("boom");
        },
      }),
    /boom/
  );

  const updated = getRun(db, run.id)!;
  assert.equal(updated.status, "failed");
});

test("runBriefJob throws clearly if the brand has no approved context yet", async () => {
  const db = openTestDb();
  const ownerId = getOrCreateDefaultOwner(db);
  const brand = createBrand(db, ownerId, "https://example.com");
  setBrandContext(db, brand.id, minimalContext());
  // no setApprovedContext call
  const run = createRun(db, brand.id, "Launch", null, 0);
  const job = enqueueJob(db, { runId: run.id, phase: "brief" });

  await assert.rejects(() => runBriefJob(db, job, { generateBriefs: async () => fakeBriefSet() }), /approved context/);
});
