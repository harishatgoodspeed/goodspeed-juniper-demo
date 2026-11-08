-- Let posts.format_family store the text-only hook post.
-- Existing proof rows stay valid so a database that already has them still opens.
-- x_caption is left in place and is no longer written by new drafts.

PRAGMA foreign_keys=OFF;

CREATE TABLE posts_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  format_family TEXT NOT NULL CHECK (format_family IN ('carousel','explainer','hook','proof')),
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO posts_new (
  id, run_id, position, format_family, composition_id, channel, english_variant,
  title, hook, hook_alternatives_json, caption, x_caption, alt_text, rationale, format_note,
  source_refs_json, claims_json, pages_json, palette_json, fonts_json, logo_asset_id, image_asset_ids_json,
  cta, status, revision, brand_version, review_json, review_revision, review_brand_version, review_passed,
  error, created_at, updated_at
)
SELECT
  id, run_id, position, format_family, composition_id, channel, english_variant,
  title, hook, hook_alternatives_json, caption, x_caption, alt_text, rationale, format_note,
  source_refs_json, claims_json, pages_json, palette_json, fonts_json, logo_asset_id, image_asset_ids_json,
  cta, status, revision, brand_version, review_json, review_revision, review_brand_version, review_passed,
  error, created_at, updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX idx_posts_run ON posts(run_id);

PRAGMA foreign_keys=ON;
