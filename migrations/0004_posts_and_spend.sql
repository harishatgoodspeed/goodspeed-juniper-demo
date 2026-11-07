-- Post packages, source ledger, spend reservations, owned images, and
-- persisted rate-limit hits. Existing runs stay readable: runs.mode defaults
-- to 'legacy' so rows created before this migration keep the six-file path.
-- New free-tool runs set mode to 'posts'.

ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE runs ADD COLUMN english_variant TEXT;
ALTER TABLE runs ADD COLUMN channel TEXT;
ALTER TABLE runs ADD COLUMN reservation_id TEXT;
ALTER TABLE runs ADD COLUMN ledger_json TEXT;

ALTER TABLE jobs ADD COLUMN progress TEXT;

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  format_family TEXT NOT NULL CHECK (format_family IN ('carousel','explainer','proof')),
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
CREATE INDEX idx_posts_run ON posts(run_id);

CREATE TABLE post_assets (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','png','page_png','x_png')),
  page_index INTEGER,
  file_path TEXT,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_post_assets_post ON post_assets(post_id);

CREATE TABLE post_revisions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_post_revisions_post ON post_revisions(post_id);

CREATE TABLE source_ledger_entries (
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  ledger_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (brand_id, ledger_id)
);

CREATE TABLE api_usage (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  run_id TEXT,
  post_id TEXT,
  kind TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','released','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_api_usage_owner ON api_usage(owner_id, created_at);
CREATE INDEX idx_api_usage_run ON api_usage(run_id);

CREATE TABLE owned_uploads (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  local_path TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  ownership_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_owned_uploads_brand ON owned_uploads(brand_id);

CREATE TABLE rate_limit_hits (
  bucket TEXT NOT NULL,
  hit_at INTEGER NOT NULL
);
CREATE INDEX idx_rate_hits ON rate_limit_hits(bucket, hit_at);
