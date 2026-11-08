import type Database from "better-sqlite3";
import { newId } from "../ids";
import type { EnglishChoice, FormatFamily, PostChannel, PostDraft, PostPageCopy, SourceClaim } from "./types";

export interface PostRow {
  id: string;
  run_id: string;
  position: number;
  format_family: FormatFamily;
  composition_id: string;
  channel: PostChannel;
  english_variant: EnglishChoice;
  title: string;
  hook: string;
  hook_alternatives_json: string;
  caption: string;
  x_caption: string | null;
  alt_text: string;
  rationale: string;
  format_note: string;
  source_refs_json: string;
  claims_json: string;
  pages_json: string;
  palette_json: string;
  fonts_json: string;
  logo_asset_id: string | null;
  image_asset_ids_json: string;
  cta: string;
  status: "pending" | "ready" | "failed";
  revision: number;
  brand_version: number;
  review_json: string | null;
  review_revision: number | null;
  review_brand_version: number | null;
  review_passed: number;
  error: string | null;
  regenerate_count: number;
  created_at: string;
  updated_at: string;
}

export interface PostAssetRow {
  id: string;
  post_id: string;
  kind: "pdf" | "png" | "page_png" | "x_png";
  page_index: number | null;
  file_path: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  byte_size: number | null;
  created_at: string;
}

export function draftFromRow(row: PostRow): PostDraft {
  return {
    formatFamily: row.format_family,
    compositionId: row.composition_id,
    title: row.title,
    hook: row.hook,
    hookAlternatives: JSON.parse(row.hook_alternatives_json) as string[],
    caption: row.caption,
    altText: row.alt_text,
    pages: JSON.parse(row.pages_json) as PostPageCopy[],
    claims: JSON.parse(row.claims_json) as SourceClaim[],
    imageAssetIds: JSON.parse(row.image_asset_ids_json) as string[],
    rationale: row.rationale,
    cta: row.cta,
    paletteTokenHexes: JSON.parse(row.palette_json) as string[],
    fontFamilies: JSON.parse(row.fonts_json) as string[],
    logoAssetId: row.logo_asset_id,
  };
}

export function insertPost(
  db: Database.Database,
  fields: {
    runId: string;
    position: number;
    draft: PostDraft;
    channel: PostChannel;
    englishVariant: EnglishChoice;
    brandVersion: number;
    formatNote: string;
    sourceRefs: unknown;
  }
): PostRow {
  const id = newId("post");
  db.prepare(
    `INSERT INTO posts (
      id, run_id, position, format_family, composition_id, channel, english_variant,
      title, hook, hook_alternatives_json, caption, x_caption, alt_text, rationale, format_note,
      source_refs_json, claims_json, pages_json, palette_json, fonts_json, logo_asset_id, image_asset_ids_json,
      cta, status, revision, brand_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)`
  ).run(
    id,
    fields.runId,
    fields.position,
    fields.draft.formatFamily,
    fields.draft.compositionId,
    fields.channel,
    fields.englishVariant,
    fields.draft.title,
    fields.draft.hook,
    JSON.stringify(fields.draft.hookAlternatives),
    fields.draft.caption,
    "",
    fields.draft.altText,
    fields.draft.rationale,
    fields.formatNote,
    JSON.stringify(fields.sourceRefs),
    JSON.stringify(fields.draft.claims),
    JSON.stringify(fields.draft.pages),
    JSON.stringify(fields.draft.paletteTokenHexes),
    JSON.stringify(fields.draft.fontFamilies),
    fields.draft.logoAssetId,
    JSON.stringify(fields.draft.imageAssetIds),
    fields.draft.cta,
    fields.brandVersion
  );
  return getPost(db, id)!;
}

export function getPost(db: Database.Database, id: string): PostRow | undefined {
  return db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as PostRow | undefined;
}

export function listPostsForRun(db: Database.Database, runId: string): PostRow[] {
  return db.prepare(`SELECT * FROM posts WHERE run_id = ? ORDER BY position ASC`).all(runId) as PostRow[];
}

export function snapshotPost(db: Database.Database, row: PostRow): void {
  db.prepare(`INSERT INTO post_revisions (id, post_id, revision, snapshot_json) VALUES (?, ?, ?, ?)`).run(
    newId("rev"),
    row.id,
    row.revision,
    JSON.stringify(row)
  );
}

export function updatePostFields(
  db: Database.Database,
  id: string,
  fields: Partial<{
    title: string;
    hook: string;
    hook_alternatives_json: string;
    caption: string;
    x_caption: string;
    alt_text: string;
    composition_id: string;
    pages_json: string;
    claims_json: string;
    rationale: string;
    status: PostRow["status"];
    error: string | null;
    review_json: string | null;
    review_revision: number | null;
    review_brand_version: number | null;
    review_passed: number;
    regenerate_count: number;
  }>,
  bumpRevision: boolean
): void {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    assignments.push(`${key} = ?`);
    values.push(value);
  }
  if (bumpRevision) assignments.push(`revision = revision + 1`);
  assignments.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  values.push(id);
  db.prepare(`UPDATE posts SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
}

export function replacePostAssets(
  db: Database.Database,
  postId: string,
  assets: Array<Omit<PostAssetRow, "id" | "post_id" | "created_at">>
): PostAssetRow[] {
  db.prepare(`DELETE FROM post_assets WHERE post_id = ?`).run(postId);
  const insert = db.prepare(
    `INSERT INTO post_assets (id, post_id, kind, page_index, file_path, width, height, mime_type, byte_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const asset of assets) {
    insert.run(
      newId("passet"),
      postId,
      asset.kind,
      asset.page_index,
      asset.file_path,
      asset.width,
      asset.height,
      asset.mime_type,
      asset.byte_size
    );
  }
  return listPostAssets(db, postId);
}

export function listPostAssets(db: Database.Database, postId: string): PostAssetRow[] {
  return db
    .prepare(`SELECT * FROM post_assets WHERE post_id = ? ORDER BY COALESCE(page_index, -1) ASC, kind ASC`)
    .all(postId) as PostAssetRow[];
}

export function latestRevision(db: Database.Database, postId: string): { snapshot_json: string; revision: number } | undefined {
  return db
    .prepare(`SELECT snapshot_json, revision FROM post_revisions WHERE post_id = ? ORDER BY revision DESC LIMIT 1`)
    .get(postId) as { snapshot_json: string; revision: number } | undefined;
}

export function postLabel(row: PostRow, currentBrandVersion: number): "Checks passed" | "Draft" | "Needs review" {
  if (row.status !== "ready" || !row.review_json) return "Draft";
  if (row.review_revision !== row.revision || row.review_brand_version !== currentBrandVersion) return "Needs review";
  return row.review_passed === 1 ? "Checks passed" : "Draft";
}
