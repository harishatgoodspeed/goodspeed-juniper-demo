-- Widen outputs.type's CHECK constraint to allow the instagram_image and
-- x_image output types added by the free-tool-public-launch branch
-- (src/pipeline-types.ts's OutputType union). Without this, createOutput()
-- would fail its CHECK constraint the first time a real run tried to
-- persist either new type. SQLite can't ALTER a CHECK constraint in place,
-- so this follows SQLite's own documented rebuild pattern: new table, copy
-- rows, drop old table, rename.

PRAGMA foreign_keys=OFF;

CREATE TABLE outputs_new (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('linkedin_image','x_image','instagram_image','one_pager_pdf','slide','post_copy')),
  brief_id TEXT,
  template_inputs_json TEXT,
  file_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO outputs_new (id, run_id, type, brief_id, template_inputs_json, file_id, version, status, created_at)
  SELECT id, run_id, type, brief_id, template_inputs_json, file_id, version, status, created_at FROM outputs;

DROP TABLE outputs;
ALTER TABLE outputs_new RENAME TO outputs;

CREATE INDEX idx_outputs_run ON outputs(run_id);

PRAGMA foreign_keys=ON;
