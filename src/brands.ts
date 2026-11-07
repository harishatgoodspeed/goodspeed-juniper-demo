import type Database from "better-sqlite3";
import { newId } from "./ids";
import type { BrandContext } from "./import/types";

export interface BrandRow {
  id: string;
  owner_id: string;
  source_url: string;
  status: "queued" | "importing" | "ready" | "failed";
  context_json: string | null;
  approved_context_json: string | null;
  approved_context_version: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function createBrand(db: Database.Database, ownerId: string, sourceUrl: string): BrandRow {
  const id = newId("brand");
  db.prepare(
    "INSERT INTO brands (id, owner_id, source_url, status) VALUES (?, ?, ?, 'queued')"
  ).run(id, ownerId, sourceUrl);
  return getBrand(db, id)!;
}

export function getBrand(db: Database.Database, id: string): BrandRow | undefined {
  return db.prepare("SELECT * FROM brands WHERE id = ?").get(id) as BrandRow | undefined;
}

export function listBrandsForOwner(db: Database.Database, ownerId: string): BrandRow[] {
  return db
    .prepare("SELECT * FROM brands WHERE owner_id = ? ORDER BY created_at DESC")
    .all(ownerId) as BrandRow[];
}

export function setBrandStatus(
  db: Database.Database,
  id: string,
  status: BrandRow["status"],
  error: string | null = null
): void {
  db.prepare(
    "UPDATE brands SET status = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(status, error, id);
}

export function setBrandContext(db: Database.Database, id: string, context: BrandContext): void {
  db.prepare(
    "UPDATE brands SET context_json = ?, status = 'ready', error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(JSON.stringify(context), id);
}

export function setApprovedContext(db: Database.Database, id: string, approved: unknown): void {
  db.prepare(
    `UPDATE brands
     SET approved_context_json = ?,
         approved_context_version = approved_context_version + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(JSON.stringify(approved), id);
}

export interface SourceAssetRow {
  id: string;
  brand_id: string;
  origin_url: string;
  kind: string;
  mime_type: string | null;
  local_path: string | null;
  byte_size: number | null;
  sha256: string | null;
  confidence: number | null;
  extraction_method: string | null;
  fetched_at: string;
}

export function addSourceAsset(
  db: Database.Database,
  brandId: string,
  fields: Omit<SourceAssetRow, "id" | "brand_id" | "fetched_at">
): SourceAssetRow {
  const id = newId("asset");
  db.prepare(
    `INSERT INTO source_assets
      (id, brand_id, origin_url, kind, mime_type, local_path, byte_size, sha256, confidence, extraction_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    brandId,
    fields.origin_url,
    fields.kind,
    fields.mime_type,
    fields.local_path,
    fields.byte_size,
    fields.sha256,
    fields.confidence,
    fields.extraction_method
  );
  return db.prepare("SELECT * FROM source_assets WHERE id = ?").get(id) as SourceAssetRow;
}

export function getSourceAsset(db: Database.Database, id: string): SourceAssetRow | undefined {
  return db.prepare("SELECT * FROM source_assets WHERE id = ?").get(id) as SourceAssetRow | undefined;
}

export function listSourceAssets(db: Database.Database, brandId: string): SourceAssetRow[] {
  return db
    .prepare("SELECT * FROM source_assets WHERE brand_id = ? ORDER BY fetched_at ASC")
    .all(brandId) as SourceAssetRow[];
}
