import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { JobRow } from "../jobs";
import { getBrand, getSourceAsset } from "../brands";
import { getRun, setRunStatus } from "../runs";
import { createOutput, createReview, setOutputFailed, setOutputReady } from "../outputs";
import { renderOutput as realRenderOutput, type RenderAssets } from "../generate/render";
import { resolveFontFaces as realResolveFontFaces, type ResolvedFontFace } from "../generate/font-assets";
import { reviewWithRepair } from "../review/repair";
import { config } from "../config";
import type { Brief, RenderEvidence } from "../pipeline-types";
import type { BrandContext } from "../import/types";
import type { ApprovedBrandContext } from "../llm";
import { approvedImagePaths } from "../imagery";

export interface RunGenerateJobDeps {
  /** Injectable for tests, so this never needs a real Chromium install to be exercised offline. */
  render?: (brief: Brief, assets: RenderAssets, outDir: string) => Promise<RenderEvidence>;
  /** Injectable for tests, so this never needs real network access to Google Fonts / the brand's own site. */
  resolveFontFaces?: (families: string[], rawContext: BrandContext) => Promise<Map<string, ResolvedFontFace>>;
}

/**
 * Renders every brief and reviews+repairs it immediately, in one job phase.
 * A separate "review" phase (the jobs table's CHECK constraint already
 * allows one) would need RenderEvidence serialised into the DB so a later
 * job could pick it back up — the Phase 1 schema has no column for that, and
 * adding one is a bigger structural change than this integration pass
 * should make unasked. Keeping render+review together avoids inventing that
 * storage while still producing real, reviewed outputs. Noted in README as a
 * follow-up for whoever wants render and review on separate, independently
 * retryable job phases.
 */
export async function runGenerateJob(db: Database.Database, job: JobRow, deps: RunGenerateJobDeps = {}): Promise<void> {
  const render = deps.render ?? realRenderOutput;
  const resolveFontFaces = deps.resolveFontFaces ?? realResolveFontFaces;

  if (!job.run_id) throw new Error("Generate job has no run_id");
  const run = getRun(db, job.run_id);
  if (!run) throw new Error(`Run ${job.run_id} not found`);
  if (!run.briefs_json) throw new Error(`Run ${run.id} has no briefs yet`);

  const brand = getBrand(db, run.brand_id);
  if (!brand || !brand.approved_context_json) throw new Error(`Brand ${run.brand_id} has no approved context`);

  setRunStatus(db, run.id, "generating");

  const approved = JSON.parse(brand.approved_context_json) as ApprovedBrandContext;
  const logoAsset = approved.logoAssetId ? getSourceAsset(db, approved.logoAssetId) : undefined;

  // Real font files for whichever approved families we can actually fetch —
  // resolved once per run (not per-brief/per-repair-attempt) since every
  // brief in a run shares the same approved fonts.
  const fontFaces = brand.context_json
    ? await resolveFontFaces(approved.fonts, JSON.parse(brand.context_json) as BrandContext)
    : new Map<string, ResolvedFontFace>();

  const imagePaths = approvedImagePaths(db, brand.id, approved.approvedImageAssetIds);
  const assets: RenderAssets = { logoPath: logoAsset?.local_path ?? undefined, imagePaths, fontFaces };

  const outDir = path.join(config.ASSET_DIR, "brands", brand.id, "outputs", run.id);
  fs.mkdirSync(outDir, { recursive: true });

  const briefs = JSON.parse(run.briefs_json) as Brief[];
  let anyUnresolved = false;

  setRunStatus(db, run.id, "reviewing");

  for (const brief of briefs) {
    const output = createOutput(db, run.id, brief.outputType, JSON.stringify(brief));
    try {
      const evidence = await render(brief, assets, outDir);
      const rerender = (b: Brief) => render(b, assets, outDir);
      const result = await reviewWithRepair(evidence, brief, rerender, 2);

      setOutputReady(db, output.id, evidence.filePath);
      createReview(
        db,
        output.id,
        output.version,
        JSON.stringify(result.finalReview.checks),
        result.repairs.length > 0 ? JSON.stringify(result.repairs) : null
      );

      if (result.unresolved) anyUnresolved = true;
    } catch (err) {
      setOutputFailed(db, output.id);
      anyUnresolved = true;
      createReview(
        db,
        output.id,
        output.version,
        JSON.stringify([
          {
            kind: "colour",
            status: "not_verified",
            observed: "render failed",
            approved: "n/a",
            explanation: `Rendering threw before any check could run: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]),
        null
      );
    }
  }

  setRunStatus(db, run.id, anyUnresolved ? "partial" : "completed");
}
