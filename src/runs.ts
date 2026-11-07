import type Database from "better-sqlite3";
import { newId } from "./ids";

export interface RunRow {
  id: string;
  brand_id: string;
  task: string;
  preset: string | null;
  context_version: number;
  briefs_json: string | null;
  unknowns_json: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  elapsed_ms: number | null;
  status: "queued" | "briefing" | "generating" | "reviewing" | "completed" | "partial" | "failed";
  created_at: string;
}

export function createRun(
  db: Database.Database,
  brandId: string,
  task: string,
  preset: string | null,
  contextVersion: number
): RunRow {
  const id = newId("run");
  db.prepare(
    "INSERT INTO runs (id, brand_id, task, preset, context_version, status) VALUES (?, ?, ?, ?, ?, 'queued')"
  ).run(id, brandId, task, preset, contextVersion);
  return getRun(db, id)!;
}

export function getRun(db: Database.Database, id: string): RunRow | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
}

export function setRunStatus(db: Database.Database, id: string, status: RunRow["status"]): void {
  db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, id);
}

export function setRunBriefs(
  db: Database.Database,
  id: string,
  fields: {
    briefsJson: string;
    unknownsJson: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    elapsedMs: number;
  }
): void {
  db.prepare(
    `UPDATE runs
     SET briefs_json = ?, unknowns_json = ?, model = ?, prompt_tokens = ?, completion_tokens = ?, elapsed_ms = ?, status = 'generating'
     WHERE id = ?`
  ).run(
    fields.briefsJson,
    fields.unknownsJson,
    fields.model,
    fields.promptTokens,
    fields.completionTokens,
    fields.elapsedMs,
    id
  );
}
