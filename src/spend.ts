/**
 * Placeholder spend accounting. Prices and caps are configuration, not a
 * provider bill. Reservations are taken before work is queued so two
 * concurrent requests cannot both pass a budget that only covers one of them.
 * Settled rows record real token usage from generation and review, including
 * calls that failed after the API returned usage. Released rows are the
 * unused part of a reservation and do not count.
 */

import type Database from "better-sqlite3";
import { config, estimateUsdCost } from "./config";
import { newId } from "./ids";

export type UsageStatus = "reserved" | "settled" | "released" | "failed";

export interface UsageRow {
  id: string;
  owner_id: string | null;
  run_id: string | null;
  post_id: string | null;
  kind: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_usd: number;
  status: UsageStatus;
  created_at: string;
}

const DAY = `datetime('now', '-1 day')`;

function legacyRunSpend(db: Database.Database, ownerId?: string): number {
  const covered = new Set(
    (db.prepare(`SELECT DISTINCT run_id AS id FROM api_usage WHERE run_id IS NOT NULL`).all() as { id: string }[]).map(
      (row) => row.id
    )
  );
  const rows = (
    ownerId
      ? db
          .prepare(
            `SELECT r.id as id, r.prompt_tokens as prompt_tokens, r.completion_tokens as completion_tokens
             FROM runs r JOIN brands b ON b.id = r.brand_id
             WHERE b.owner_id = ? AND r.created_at > ${DAY} AND r.prompt_tokens IS NOT NULL`
          )
          .all(ownerId)
      : db
          .prepare(
            `SELECT id, prompt_tokens, completion_tokens FROM runs
             WHERE created_at > ${DAY} AND prompt_tokens IS NOT NULL`
          )
          .all()
  ) as Array<{ id: string; prompt_tokens: number; completion_tokens: number | null }>;
  return rows.reduce((sum, row) => {
    if (covered.has(row.id)) return sum;
    return sum + estimateUsdCost(row.prompt_tokens, row.completion_tokens ?? 0);
  }, 0);
}

function usageSpend(db: Database.Database, ownerId?: string): number {
  const row = (
    ownerId
      ? db
          .prepare(
            `SELECT COALESCE(SUM(estimated_usd), 0) AS usd FROM api_usage
             WHERE owner_id = ? AND status IN ('reserved','settled') AND created_at > ${DAY}`
          )
          .get(ownerId)
      : db
          .prepare(
            `SELECT COALESCE(SUM(estimated_usd), 0) AS usd FROM api_usage
             WHERE status IN ('reserved','settled') AND created_at > ${DAY}`
          )
          .get()
  ) as { usd: number };
  return row.usd;
}

export function spendUsd(db: Database.Database, ownerId?: string): number {
  return legacyRunSpend(db, ownerId) + usageSpend(db, ownerId);
}

export interface ReservationResult {
  ok: true;
  id: string;
  pricing: "placeholder_estimate";
}

export interface ReservationDenied {
  ok: false;
  scope: "visitor" | "global";
  pricing: "placeholder_estimate";
}

export function tryReserve(
  db: Database.Database,
  fields: { ownerId: string; runId?: string | null; postId?: string | null; kind: string; usd: number }
): ReservationResult | ReservationDenied {
  if (!(fields.usd > 0)) {
    throw new Error("Reservation amount must be a positive placeholder estimate.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const visitor = spendUsd(db, fields.ownerId);
    if (visitor + fields.usd > config.PER_VISITOR_DAILY_SPEND_USD) {
      db.exec("ROLLBACK");
      return { ok: false, scope: "visitor", pricing: "placeholder_estimate" };
    }
    const global = spendUsd(db);
    if (global + fields.usd > config.GLOBAL_DAILY_SPEND_USD) {
      db.exec("ROLLBACK");
      return { ok: false, scope: "global", pricing: "placeholder_estimate" };
    }
    const id = newId("spend");
    db.prepare(
      `INSERT INTO api_usage (id, owner_id, run_id, post_id, kind, model, prompt_tokens, completion_tokens, estimated_usd, status)
       VALUES (?, ?, ?, ?, ?, NULL, 0, 0, ?, 'reserved')`
    ).run(id, fields.ownerId, fields.runId ?? null, fields.postId ?? null, fields.kind, fields.usd);
    db.exec("COMMIT");
    return { ok: true, id, pricing: "placeholder_estimate" };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

export function releaseReservation(db: Database.Database, id: string | null | undefined): void {
  if (!id) return;
  db.prepare(`UPDATE api_usage SET status = 'released', estimated_usd = 0 WHERE id = ? AND status = 'reserved'`).run(id);
}

export function settleUsage(
  db: Database.Database,
  fields: {
    ownerId: string | null;
    runId?: string | null;
    postId?: string | null;
    kind: string;
    model?: string | null;
    promptTokens: number;
    completionTokens: number;
    failed?: boolean;
  }
): void {
  const usd = estimateUsdCost(fields.promptTokens, fields.completionTokens);
  db.prepare(
    `INSERT INTO api_usage (id, owner_id, run_id, post_id, kind, model, prompt_tokens, completion_tokens, estimated_usd, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("spend"),
    fields.ownerId,
    fields.runId ?? null,
    fields.postId ?? null,
    fields.kind,
    fields.model ?? config.ANTHROPIC_MODEL,
    fields.promptTokens,
    fields.completionTokens,
    usd,
    fields.failed ? "failed" : "settled"
  );
}

export function attachReservationToRun(db: Database.Database, reservationId: string, runId: string): void {
  db.prepare(`UPDATE api_usage SET run_id = ? WHERE id = ?`).run(runId, reservationId);
}
