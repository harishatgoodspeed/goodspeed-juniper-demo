/**
 * Anonymous workspace retention. Share pages and downloads never include
 * contact details. When a brand is purged, its files and share tokens go with it.
 */

import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "./config";

export function purgeExpiredBrands(db: Database.Database, now = new Date(), assetDir = config.ASSET_DIR): string[] {
  const cutoff = new Date(now.getTime() - config.RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`SELECT id FROM brands WHERE created_at < ?`).all(cutoff) as { id: string }[];
  const removed: string[] = [];
  for (const row of rows) {
    const dir = path.join(assetDir, "brands", row.id);
    db.prepare(`DELETE FROM brands WHERE id = ?`).run(row.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    removed.push(row.id);
  }
  const staleBefore = now.getTime() - 2 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM rate_limit_hits WHERE hit_at < ?`).run(staleBefore);
  return removed;
}
