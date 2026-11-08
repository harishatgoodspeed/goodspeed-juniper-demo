/**
 * Free tool path: three post packages, not six unrelated files.
 * Legacy runs (mode !== "posts") stay on run-brief-job / run-generate-job.
 */

import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../config";
import { getBrand } from "../brands";
import type { JobRow } from "../jobs";
import { setJobProgress } from "../jobs";
import { getRun, setRunBriefs, setRunLedger, setRunStatus } from "../runs";
import { buildSourceLedger, type LedgerEntry } from "../ledger";
import { releaseReservation, settleUsage } from "../spend";
import { evergreenLabel, formatReferenceFor } from "../formats/library";
import { generatePostConcepts as realGeneratePostConcepts, type GeneratePostsInput } from "../posts/concepts";
import type { FormatFamily, PostDraft, PostPackageSet } from "../posts/types";
import { insertPost, listPostsForRun, replacePostAssets, updatePostFields, type PostRow } from "../posts/store";
import { renderPostPackage as realRenderPostPackage, type RenderedPostPackage } from "../generate/render-post";
import type { PostTemplateAssets } from "../generate/post-templates";
import { resolveFontFaces as realResolveFontFaces, type ResolvedFontFace } from "../generate/font-assets";
import { reviewOutput } from "../review/review";
import type { Brief, RenderEvidence } from "../pipeline-types";
import type { ApprovedBrandContext } from "../llm";
import type { BrandContext } from "../import/types";
import { draftFromRow } from "../posts/store";

export interface PostsJobDeps {
  generatePostConcepts?: typeof realGeneratePostConcepts;
  renderPostPackage?: typeof realRenderPostPackage;
  resolveFontFaces?: (families: string[], rawContext: BrandContext) => Promise<Map<string, ResolvedFontFace>>;
}

function ownerIdForBrand(db: Database.Database, brandId: string): string | null {
  const row = db.prepare(`SELECT owner_id FROM brands WHERE id = ?`).get(brandId) as { owner_id: string } | undefined;
  return row?.owner_id ?? null;
}

export async function runPostsBriefJob(db: Database.Database, job: JobRow, deps: PostsJobDeps = {}): Promise<void> {
  const generate = deps.generatePostConcepts ?? realGeneratePostConcepts;
  if (!job.run_id) throw new Error("Brief job has no run_id");
  const run = getRun(db, job.run_id);
  if (!run) throw new Error(`Run ${job.run_id} not found`);
  const brand = getBrand(db, run.brand_id);
  if (!brand?.context_json || !brand.approved_context_json) throw new Error("Brand is not ready");

  setJobProgress(db, job.id, "preparing_ideas");
  setRunStatus(db, run.id, "briefing");
  const raw = JSON.parse(brand.context_json) as BrandContext;
  const approved = JSON.parse(brand.approved_context_json) as ApprovedBrandContext;
  const ledger = buildSourceLedger({
    sourceUrl: raw.sourceUrl,
    title: raw.title,
    description: raw.description,
    textExcerpt: raw.textExcerpt,
    retrievedAt: raw.fetchedAt,
  });
  const replace = db.prepare(`DELETE FROM source_ledger_entries WHERE brand_id = ?`);
  const insert = db.prepare(
    `INSERT INTO source_ledger_entries (brand_id, ledger_id, source_url, excerpt, retrieved_at) VALUES (?, ?, ?, ?, ?)`
  );
  const saveLedger = db.transaction(() => {
    replace.run(brand.id);
    for (const entry of ledger) insert.run(brand.id, entry.id, entry.sourceUrl, entry.excerpt, entry.retrievedAt);
  });
  saveLedger();
  setRunLedger(db, run.id, JSON.stringify(ledger));

  const variant = run.english_variant === "us" ? "us" : "uk";
  const channel = "linkedin" as const;
  const input: GeneratePostsInput = {
    task: run.task,
    englishVariant: variant,
    voiceNotes: approved.voiceNotes ?? "",
    ledger,
    colours: approved.colours,
    fonts: approved.fonts,
    logoAssetId: approved.logoAssetId,
    businessSummary: raw.description ?? "",
    audienceHint: "",
  };

  try {
    const pack = await generate(input);
    settleUsage(db, {
      ownerId: ownerIdForBrand(db, brand.id),
      runId: run.id,
      kind: "post_concepts",
      model: pack.model,
      promptTokens: pack.promptTokens,
      completionTokens: pack.completionTokens,
    });
    setRunBriefs(db, run.id, {
      briefsJson: JSON.stringify(pack.posts),
      unknownsJson: JSON.stringify([]),
      model: pack.model,
      promptTokens: pack.promptTokens,
      completionTokens: pack.completionTokens,
      elapsedMs: pack.elapsedMs,
    });
    for (const [index, draft] of orderedFreePosts(pack.posts).entries()) {
      const reference = formatReferenceFor(draft.formatFamily as "carousel" | "explainer" | "hook");
      insertPost(db, {
        runId: run.id,
        position: index,
        draft,
        channel,
        englishVariant: variant,
        brandVersion: run.context_version,
        formatNote: `${evergreenLabel()}. ${reference.name}. Observed ${reference.observedDate}. Not a live trend.`,
        sourceRefs: ledger.map((entry) => ({ id: entry.id, sourceUrl: entry.sourceUrl })),
      });
    }
  } catch (err) {
    releaseReservation(db, run.reservation_id);
    setRunStatus(db, run.id, "failed");
    throw err;
  }
}

const FREE_ORDER: FormatFamily[] = ["carousel", "explainer", "hook"];

function orderedFreePosts(posts: PostDraft[]): PostDraft[] {
  if (posts.length !== 3) {
    throw new Error("A free run must draft exactly three posts: a carousel, a checklist and a text hook.");
  }
  const byFamily = new Map(posts.map((post) => [post.formatFamily, post]));
  const ordered = FREE_ORDER.map((family) => byFamily.get(family));
  if (ordered.some((post) => !post)) {
    throw new Error("A free run must draft exactly three posts: a carousel, a checklist and a text hook.");
  }
  return ordered as PostDraft[];
}

function evidenceFor(draft: PostDraft, rendered: RenderedPostPackage): RenderEvidence {
  const text = [draft.hook, draft.caption, rendered.text].filter(Boolean).join("\n");
  if (draft.formatFamily === "hook") {
    return {
      outputType: "post_copy",
      filePath: null,
      width: 0,
      height: 0,
      regions: [],
      fontChecks: [],
      logoCheck: null,
      overflow: false,
      text,
    };
  }
  return {
    outputType: "linkedin_image",
    filePath: rendered.pages[0]?.filePath ?? null,
    width: rendered.pages[0]?.width ?? 0,
    height: rendered.pages[0]?.height ?? 0,
    regions: [],
    fontChecks: [],
    logoCheck: null,
    overflow: rendered.layout.overflow,
    text,
    layout: rendered.layout,
  };
}

function briefFor(draft: PostDraft, voice: string): Brief {
  const textOnly = draft.formatFamily === "hook";
  return {
    outputType: textOnly ? "post_copy" : "linkedin_image",
    purpose: draft.rationale,
    audience: "",
    sourcedFactualCopy: [],
    layoutDirection: draft.compositionId,
    paletteTokenHexes: draft.paletteTokenHexes,
    fontFamilies: draft.fontFamilies,
    logoAssetId: textOnly ? null : draft.logoAssetId,
    imageAssetIds: [],
    voiceGuidance: voice,
    unknowns: [],
  };
}

export async function runPostsGenerateJob(db: Database.Database, job: JobRow, deps: PostsJobDeps = {}): Promise<void> {
  const render = deps.renderPostPackage ?? realRenderPostPackage;
  const resolveFonts = deps.resolveFontFaces ?? realResolveFontFaces;
  if (!job.run_id) throw new Error("Generate job has no run_id");
  const run = getRun(db, job.run_id);
  if (!run) throw new Error(`Run ${job.run_id} not found`);
  const brand = getBrand(db, run.brand_id);
  if (!brand?.approved_context_json) throw new Error("Brand has no approved context");
  setJobProgress(db, job.id, "preparing_ideas");
  setRunStatus(db, run.id, "generating");

  const approved = JSON.parse(brand.approved_context_json) as ApprovedBrandContext;
  const raw = brand.context_json ? (JSON.parse(brand.context_json) as BrandContext) : null;
  const fontFaces = raw ? await resolveFonts(approved.fonts, raw) : new Map<string, ResolvedFontFace>();
  const logoPath = approved.logoAssetId
    ? (db.prepare(`SELECT local_path FROM source_assets WHERE id = ?`).get(approved.logoAssetId) as { local_path: string | null } | undefined)
        ?.local_path ?? undefined
    : undefined;
  const assets: PostTemplateAssets = {
    logoPath: logoPath && fs.existsSync(logoPath) ? logoPath : undefined,
    imagePaths: [],
    fontFaces,
  };
  const ledger = (run.ledger_json ? JSON.parse(run.ledger_json) : []) as LedgerEntry[];
  const posts = listPostsForRun(db, run.id);
  let anyUnresolved = false;
  setRunStatus(db, run.id, "reviewing");

  try {
    for (const post of posts) {
      await renderOnePost(db, post, assets, ledger, approved.voiceNotes ?? "", render);
      const updated = listPostsForRun(db, run.id).find((row) => row.id === post.id);
      if (!updated || updated.status !== "ready" || updated.review_passed !== 1) anyUnresolved = true;
    }
    setRunStatus(db, run.id, posts.length === 0 || anyUnresolved ? "partial" : "completed");
  } finally {
    releaseReservation(db, run.reservation_id);
  }
}

async function renderOnePost(
  db: Database.Database,
  post: PostRow,
  assets: PostTemplateAssets,
  ledger: LedgerEntry[],
  voice: string,
  render: typeof realRenderPostPackage
): Promise<void> {
  const draft = draftFromRow(post);
  const outDir = path.join(config.ASSET_DIR, "brands", "posts", post.id, `r${post.revision}`);
  try {
    const rendered =
      draft.formatFamily === "hook"
        ? {
            pages: [],
            pdfPath: null,
            text: [draft.hook, draft.caption].filter(Boolean).join("\n"),
            compositionId: "hook-text",
            layout: { overflow: false, overlap: false, minBodyPx: 0, contrastRatio: 0, problems: [] },
          }
        : await render(draft, { ...assets, imagePaths: [] }, outDir, "linkedin");
    const usage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
    const review = await reviewOutput(evidenceFor(draft, rendered), briefFor(draft, voice), {
      ledger,
      claims: draft.claims,
      onUsage: (entry) => {
        usage.promptTokens += entry.promptTokens;
        usage.completionTokens += entry.completionTokens;
      },
    });
    if (usage.promptTokens || usage.completionTokens) {
      const brand = db.prepare(`SELECT b.owner_id as owner_id FROM posts p JOIN runs r ON r.id = p.run_id JOIN brands b ON b.id = r.brand_id WHERE p.id = ?`).get(post.id) as { owner_id: string };
      settleUsage(db, {
        ownerId: brand.owner_id,
        runId: post.run_id,
        postId: post.id,
        kind: "copy_review",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
    }
    const files: Array<{
      kind: "pdf" | "png" | "page_png";
      page_index: number | null;
      file_path: string;
      width: number | null;
      height: number | null;
      mime_type: string;
      byte_size: number;
    }> = rendered.pages.map((page) => ({
      kind: rendered.pages.length > 1 ? "page_png" : "png",
      page_index: page.index,
      file_path: page.filePath,
      width: page.width,
      height: page.height,
      mime_type: "image/png",
      byte_size: fs.statSync(page.filePath).size,
    }));
    if (rendered.pdfPath) {
      files.push({
        kind: "pdf",
        page_index: null,
        file_path: rendered.pdfPath,
        width: rendered.pages[0]?.width ?? null,
        height: rendered.pages[0]?.height ?? null,
        mime_type: "application/pdf",
        byte_size: fs.statSync(rendered.pdfPath).size,
      });
    }
    replacePostAssets(db, post.id, files);
    updatePostFields(
      db,
      post.id,
      {
        status: "ready",
        error: null,
        review_json: JSON.stringify(review.checks),
        review_revision: post.revision,
        review_brand_version: post.brand_version,
        review_passed: review.overallPass ? 1 : 0,
      },
      false
    );
  } catch (err) {
    updatePostFields(
      db,
      post.id,
      {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        review_passed: 0,
        review_json: JSON.stringify([
          {
            kind: "layout",
            status: "not_verified",
            observed: "render failed",
            approved: "n/a",
            explanation: err instanceof Error ? err.message : String(err),
          },
        ]),
        review_revision: post.revision,
        review_brand_version: post.brand_version,
      },
      false
    );
  }
}

export async function rerenderPost(db: Database.Database, postId: string, deps: PostsJobDeps = {}): Promise<void> {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(postId) as PostRow | undefined;
  if (!post) throw new Error("Post not found");
  const run = getRun(db, post.run_id);
  if (!run) throw new Error("Run not found");
  const brand = getBrand(db, run.brand_id);
  if (!brand?.approved_context_json) throw new Error("Brand missing");
  const approved = JSON.parse(brand.approved_context_json) as ApprovedBrandContext;
  const raw = brand.context_json ? (JSON.parse(brand.context_json) as BrandContext) : null;
  const resolveFonts = deps.resolveFontFaces ?? realResolveFontFaces;
  const fontFaces = raw ? await resolveFonts(approved.fonts, raw) : new Map();
  const logoPath = approved.logoAssetId
    ? (db.prepare(`SELECT local_path FROM source_assets WHERE id = ?`).get(approved.logoAssetId) as { local_path: string | null } | undefined)
        ?.local_path ?? undefined
    : undefined;
  const assets: PostTemplateAssets = {
    logoPath: logoPath && fs.existsSync(logoPath) ? logoPath : undefined,
    imagePaths: [],
    fontFaces,
  };
  const ledger = (run.ledger_json ? JSON.parse(run.ledger_json) : []) as LedgerEntry[];
  await renderOnePost(db, post, assets, ledger, approved.voiceNotes ?? "", deps.renderPostPackage ?? realRenderPostPackage);
}

export type { PostPackageSet };
