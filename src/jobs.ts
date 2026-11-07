import type Database from "better-sqlite3";
import { newId } from "./ids";
import { config } from "./config";

export type JobPhase = "import" | "brief" | "generate" | "review";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  brand_id: string | null;
  run_id: string | null;
  phase: JobPhase;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  progress?: string | null;
}

export function enqueueJob(
  db: Database.Database,
  fields: { brandId?: string; runId?: string; phase: JobPhase }
): JobRow {
  const id = newId("job");
  db.prepare("INSERT INTO jobs (id, brand_id, run_id, phase, status) VALUES (?, ?, ?, ?, 'queued')").run(
    id,
    fields.brandId ?? null,
    fields.runId ?? null,
    fields.phase
  );
  return getJob(db, id)!;
}

export function getJob(db: Database.Database, id: string): JobRow | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}

export function setJobProgress(db: Database.Database, id: string, progress: string): void {
  db.prepare(
    "UPDATE jobs SET progress = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(progress, id);
}

function runningCount(db: Database.Database): number {
  const row = db.prepare("SELECT count(*) as n FROM jobs WHERE status = 'running'").get() as {
    n: number;
  };
  return row.n;
}

/**
 * Atomically claims the oldest queued job, honouring MAX_CONCURRENT_JOBS.
 * Returns null if nothing is queued or the concurrency cap is already met.
 */
export function claimNextJob(db: Database.Database): JobRow | null {
  const claim = db.transaction((): JobRow | null => {
    if (runningCount(db) >= config.MAX_CONCURRENT_JOBS) return null;
    const next = db
      .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
      .get() as JobRow | undefined;
    if (!next) return null;
    db.prepare(
      `UPDATE jobs
       SET status = 'running', attempts = attempts + 1,
           heartbeat_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    ).run(next.id);
    return getJob(db, next.id)!;
  });
  return claim();
}

export function completeJob(db: Database.Database, id: string): void {
  db.prepare(
    "UPDATE jobs SET status = 'succeeded', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(id);
}

export function failJob(db: Database.Database, id: string, message: string): void {
  db.prepare(
    "UPDATE jobs SET status = 'failed', last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(message.slice(0, 2000), id);
}

/** Only a still-queued job can be cancelled safely; a running fetch is not interrupted mid-flight (documented limitation). */
export function cancelQueuedJob(db: Database.Database, id: string): "cancelled" | "not_queued" | "not_found" {
  const job = getJob(db, id);
  if (!job) return "not_found";
  if (job.status !== "queued") return "not_queued";
  db.prepare(
    "UPDATE jobs SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(id);
  return "cancelled";
}

export type JobHandler = (db: Database.Database, job: JobRow) => Promise<void>;

/**
 * A single bounded-concurrency worker loop. One `setInterval` tick tries to
 * claim and run one job per MAX_CONCURRENT_JOBS slot; `claimNextJob` is what
 * actually enforces the cap, so overlapping ticks are safe.
 */
export function startWorker(
  db: Database.Database,
  handlers: Partial<Record<JobPhase, JobHandler>>,
  intervalMs = 500
): { stop: () => void } {
  let stopped = false;
  let ticking = false;

  const tick = async (): Promise<void> => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      for (let i = 0; i < config.MAX_CONCURRENT_JOBS; i++) {
        const job = claimNextJob(db);
        if (!job) break;
        const handler = handlers[job.phase];
        if (!handler) {
          failJob(db, job.id, `No handler registered for phase "${job.phase}"`);
          continue;
        }
        // Intentionally not awaited serially across slots; each job's own
        // handler awaits its own async work, and claimNextJob already
        // serialises claims so we never exceed the concurrency cap.
        handler(db, job)
          .then(() => completeJob(db, job.id))
          .catch((err: unknown) => failJob(db, job.id, err instanceof Error ? err.message : String(err)));
      }
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
