/**
 * Supporting photos are used only when the visitor confirmed they own them.
 * Scraped page images are never added silently.
 */

import fs from "node:fs";
import type Database from "better-sqlite3";

export interface OwnedUploadRow {
  id: string;
  brand_id: string;
  local_path: string;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  ownership_confirmed: number;
  created_at: string;
}

export function getOwnedUpload(db: Database.Database, id: string): OwnedUploadRow | undefined {
  return db.prepare(`SELECT * FROM owned_uploads WHERE id = ?`).get(id) as OwnedUploadRow | undefined;
}

export function listOwnedUploads(db: Database.Database, brandId: string): OwnedUploadRow[] {
  return db
    .prepare(`SELECT * FROM owned_uploads WHERE brand_id = ? AND ownership_confirmed = 1 ORDER BY created_at ASC`)
    .all(brandId) as OwnedUploadRow[];
}

export function approvedImagePaths(db: Database.Database, brandId: string, approvedIds: string[] | undefined): string[] {
  const allowed = new Set(approvedIds ?? []);
  const paths: string[] = [];
  for (const row of listOwnedUploads(db, brandId)) {
    if (!allowed.has(row.id)) continue;
    if (!row.ownership_confirmed) continue;
    if (!row.local_path || !fs.existsSync(row.local_path)) continue;
    paths.push(row.local_path);
  }
  return paths;
}
