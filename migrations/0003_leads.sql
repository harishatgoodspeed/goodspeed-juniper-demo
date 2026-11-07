-- Optional post-delivery email capture for the free tool (email, preferred
-- tool, brand notes, consent). Never required to use the free tool itself —
-- see src/leads.ts and POST /api/brands/:id/leads.

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  preferred_tool TEXT,
  notes TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_leads_brand ON leads(brand_id);
