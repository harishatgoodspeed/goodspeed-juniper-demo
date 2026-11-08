-- LinkedIn-only free run: a text hook post, and one regenerate per post.
-- format_family gains 'hook' and still accepts 'proof' so rows already on
-- Railway keep reading. x_caption and post_assets.kind 'x_png' stay in the
-- schema and are simply not written by new runs.
-- SQLite cannot ALTER a CHECK in place. Child tables reference posts, and
-- foreign_keys stays on inside the migration transaction, so this rebuilds
-- the children first, then the parent.

CREATE TABLE posts_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  format_family TEXT NOT NULL CHECK (format_family IN ('carousel','explainer','proof','hook')),
  composition_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'linkedin' CHECK (channel IN ('linkedin','x')),
  english_variant TEXT NOT NULL CHECK (english_variant IN ('uk','us')),
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  hook_alternatives_json TEXT NOT NULL,
  caption TEXT NOT NULL,
  x_caption TEXT,
  alt_text TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  format_note TEXT NOT NULL DEFAULT '',
  source_refs_json TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  pages_json TEXT NOT NULL,
  palette_json TEXT NOT NULL,
  fonts_json TEXT NOT NULL,
  logo_asset_id TEXT,
  image_asset_ids_json TEXT NOT NULL,
  cta TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  revision INTEGER NOT NULL DEFAULT 1,
  brand_version INTEGER NOT NULL,
  review_json TEXT,
  review_revision INTEGER,
  review_brand_version INTEGER,
  review_passed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  regenerate_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO posts_new (
  id, run_id, position, format_family, composition_id, channel, english_variant,
  title, hook, hook_alternatives_json, caption, x_caption, alt_text, rationale, format_note,
  source_refs_json, claims_json, pages_json, palette_json, fonts_json, logo_asset_id, image_asset_ids_json,
  cta, status, revision, brand_version, review_json, review_revision, review_brand_version, review_passed,
  error, regenerate_count, created_at, updated_at
)
SELECT
  id, run_id, position, format_family, composition_id, channel, english_variant,
  title, hook, hook_alternatives_json, caption, x_caption, alt_text, rationale, format_note,
  source_refs_json, claims_json, pages_json, palette_json, fonts_json, logo_asset_id, image_asset_ids_json,
  cta, status, revision, brand_version, review_json, review_revision, review_brand_version, review_passed,
  error, 0, created_at, updated_at
FROM posts;

CREATE TABLE post_assets_new (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts_new(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','png','page_png','x_png')),
  page_index INTEGER,
  file_path TEXT,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO post_assets_new (id, post_id, kind, page_index, file_path, width, height, mime_type, byte_size, created_at)
SELECT id, post_id, kind, page_index, file_path, width, height, mime_type, byte_size, created_at FROM post_assets;

CREATE TABLE post_revisions_new (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts_new(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO post_revisions_new (id, post_id, revision, snapshot_json, created_at)
SELECT id, post_id, revision, snapshot_json, created_at FROM post_revisions;

DROP TABLE post_assets;
DROP TABLE post_revisions;
DROP TABLE posts;

ALTER TABLE posts_new RENAME TO posts;
ALTER TABLE post_assets_new RENAME TO post_assets;
ALTER TABLE post_revisions_new RENAME TO post_revisions;

CREATE INDEX idx_posts_run ON posts(run_id);
CREATE INDEX idx_post_assets_post ON post_assets(post_id);
CREATE INDEX idx_post_revisions_post ON post_revisions(post_id);
