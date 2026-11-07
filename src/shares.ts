import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { newId } from "./ids";

export interface ShareRow {
  id: string;
  brand_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a new capability share. The raw token is returned exactly once —
 * only its hash is stored, the same way a password or API key would be, so
 * it can't be recovered later even by the owner; losing it means generating
 * a new one (and, if wanted, revoking the old).
 */
export function createShare(db: Database.Database, brandId: string): { share: ShareRow; token: string } {
  const token = crypto.randomBytes(32).toString("hex"); // 256 bits of entropy
  const id = newId("share");
  db.prepare("INSERT INTO shares (id, brand_id, token_hash) VALUES (?, ?, ?)").run(id, brandId, hashToken(token));
  const share = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as ShareRow;
  return { share, token };
}

export function listActiveSharesForBrand(db: Database.Database, brandId: string): ShareRow[] {
  return db
    .prepare(
      `SELECT * FROM shares
       WHERE brand_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC`
    )
    .all(brandId) as ShareRow[];
}

export function getShare(db: Database.Database, id: string): ShareRow | undefined {
  return db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as ShareRow | undefined;
}

export function revokeShare(db: Database.Database, id: string): void {
  db.prepare("UPDATE shares SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id);
}

/** True if this raw token is an active (non-revoked, non-expired) share for this exact brand. */
export function isValidShareToken(db: Database.Database, brandId: string, token: string): boolean {
  if (!token) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM shares
       WHERE brand_id = ? AND token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .get(brandId, hashToken(token));
  return Boolean(row);
}
