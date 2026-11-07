-- Phase 1 schema. Tables for later phases (runs, outputs, reviews, shares) are
-- created now so later phases are additive migrations, not destructive ones.

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_owner ON sessions(owner_id);

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','importing','ready','failed')),
  context_json TEXT,
  approved_context_json TEXT,
  approved_context_version INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_brands_owner ON brands(owner_id);

CREATE TABLE source_assets (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  origin_url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('logo','favicon','og_image','content_image','stylesheet','html')),
  mime_type TEXT,
  local_path TEXT,
  byte_size INTEGER,
  sha256 TEXT,
  confidence REAL,
  extraction_method TEXT,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_source_assets_brand ON source_assets(brand_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  run_id TEXT,
  phase TEXT NOT NULL CHECK (phase IN ('import','brief','generate','review')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_brand ON jobs(brand_id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  preset TEXT,
  context_version INTEGER NOT NULL,
  briefs_json TEXT,
  unknowns_json TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  elapsed_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','briefing','generating','reviewing','completed','partial','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_runs_brand ON runs(brand_id);

CREATE TABLE outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('linkedin_image','one_pager_pdf','slide','post_copy')),
  brief_id TEXT,
  template_inputs_json TEXT,
  file_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_outputs_run ON outputs(run_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  output_version INTEGER NOT NULL,
  findings_json TEXT NOT NULL,
  fixes_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_reviews_output ON reviews(output_id);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_shares_brand ON shares(brand_id);
