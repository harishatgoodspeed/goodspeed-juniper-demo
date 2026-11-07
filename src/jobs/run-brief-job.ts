import type Database from "better-sqlite3";
import { enqueueJob, type JobRow } from "../jobs";
import { getBrand } from "../brands";
import { getRun, setRunBriefs, setRunStatus } from "../runs";
import { generateBriefs as realGenerateBriefs, type ApprovedBrandContext } from "../llm";
import type { BrandContext } from "../import/types";
import { runPostsBriefJob, type PostsJobDeps } from "./run-posts-job";

export interface RunBriefJobDeps extends PostsJobDeps {
  /** Injectable for tests, so this handler never needs a real ANTHROPIC_API_KEY to be exercised offline. */
  generateBriefs?: typeof realGenerateBriefs;
  /** Injectable for tests, so a successful brief job doesn't also need the generate job's dependencies. */
  enqueueNext?: typeof enqueueJob;
}

export async function runBriefJob(db: Database.Database, job: JobRow, deps: RunBriefJobDeps = {}): Promise<void> {
  const generateBriefs = deps.generateBriefs ?? realGenerateBriefs;
  const enqueueNext = deps.enqueueNext ?? enqueueJob;
  if (!job.run_id) throw new Error("Brief job has no run_id");
  const run = getRun(db, job.run_id);
  if (!run) throw new Error(`Run ${job.run_id} not found`);

  const brand = getBrand(db, run.brand_id);
  if (!brand) throw new Error(`Brand ${run.brand_id} not found`);
  if (!brand.context_json) throw new Error(`Brand ${brand.id} has no imported context yet`);
  if (!brand.approved_context_json) throw new Error(`Brand ${brand.id} has no approved context yet`);

  if ((run.mode ?? "legacy") === "posts") {
    try {
      await runPostsBriefJob(db, job, deps);
      enqueueNext(db, { runId: run.id, phase: "generate" });
    } catch (err) {
      setRunStatus(db, run.id, "failed");
      throw err;
    }
    return;
  }

  setRunStatus(db, run.id, "briefing");

  try {
    const rawContext = JSON.parse(brand.context_json) as BrandContext;
    const context = JSON.parse(brand.approved_context_json) as ApprovedBrandContext;

    const briefSet = await generateBriefs({ context, rawContext, task: run.task, preset: run.preset ?? undefined });

    setRunBriefs(db, run.id, {
      briefsJson: JSON.stringify(briefSet.briefs),
      unknownsJson: JSON.stringify(briefSet.briefs.flatMap((b) => b.unknowns)),
      model: briefSet.model,
      promptTokens: briefSet.promptTokens,
      completionTokens: briefSet.completionTokens,
      elapsedMs: briefSet.elapsedMs,
    });

    enqueueNext(db, { runId: run.id, phase: "generate" });
  } catch (err) {
    setRunStatus(db, run.id, "failed");
    throw err;
  }
}
