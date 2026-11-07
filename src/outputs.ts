import type Database from "better-sqlite3";
import { newId } from "./ids";
import type { OutputType } from "./pipeline-types";

export interface OutputRow {
  id: string;
  run_id: string;
  type: OutputType;
  brief_id: string | null;
  template_inputs_json: string | null;
  file_id: string | null;
  version: number;
  status: "pending" | "ready" | "failed";
  created_at: string;
}

export function createOutput(
  db: Database.Database,
  runId: string,
  type: OutputType,
  briefJson: string
): OutputRow {
  const id = newId("output");
  db.prepare(
    "INSERT INTO outputs (id, run_id, type, brief_id, template_inputs_json, version, status) VALUES (?, ?, ?, ?, ?, 1, 'pending')"
  ).run(id, runId, type, type, briefJson);
  return getOutput(db, id)!;
}

export function getOutput(db: Database.Database, id: string): OutputRow | undefined {
  return db.prepare("SELECT * FROM outputs WHERE id = ?").get(id) as OutputRow | undefined;
}

export function listOutputsForRun(db: Database.Database, runId: string): OutputRow[] {
  return db.prepare("SELECT * FROM outputs WHERE run_id = ? ORDER BY created_at ASC").all(runId) as OutputRow[];
}

/**
 * `file_id` stores the absolute local file path directly rather than a
 * foreign key into a dedicated files table — the Phase 1 schema doesn't
 * define one, and adding one is a bigger structural change than this
 * integration pass should make unasked. Documented in README as a known
 * simplification. Controlled access still goes through an ownership-checked
 * route (GET /api/outputs/:id/file), never a static path.
 */
export function setOutputReady(db: Database.Database, id: string, fileId: string | null): void {
  db.prepare("UPDATE outputs SET status = 'ready', file_id = ? WHERE id = ?").run(fileId, id);
}

export function setOutputFailed(db: Database.Database, id: string): void {
  db.prepare("UPDATE outputs SET status = 'failed' WHERE id = ?").run(id);
}

export interface ReviewRow {
  id: string;
  output_id: string;
  output_version: number;
  findings_json: string;
  fixes_json: string | null;
  created_at: string;
}

export function createReview(
  db: Database.Database,
  outputId: string,
  outputVersion: number,
  findingsJson: string,
  fixesJson: string | null
): ReviewRow {
  const id = newId("review");
  db.prepare(
    "INSERT INTO reviews (id, output_id, output_version, findings_json, fixes_json) VALUES (?, ?, ?, ?, ?)"
  ).run(id, outputId, outputVersion, findingsJson, fixesJson);
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as ReviewRow;
}

export function listReviewsForOutput(db: Database.Database, outputId: string): ReviewRow[] {
  return db
    .prepare("SELECT * FROM reviews WHERE output_id = ? ORDER BY created_at ASC")
    .all(outputId) as ReviewRow[];
}
