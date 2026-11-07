import type Database from "better-sqlite3";
import { newId } from "./ids";

export interface LeadRow {
  id: string;
  brand_id: string;
  email: string;
  preferred_tool: string | null;
  notes: string | null;
  consent: 0 | 1;
  created_at: string;
}

export interface NewLead {
  email: string;
  preferredTool: string | null;
  notes: string | null;
  consent: boolean;
}

export function createLead(db: Database.Database, brandId: string, lead: NewLead): LeadRow {
  const id = newId("lead");
  db.prepare(
    "INSERT INTO leads (id, brand_id, email, preferred_tool, notes, consent) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, brandId, lead.email, lead.preferredTool, lead.notes, lead.consent ? 1 : 0);
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as LeadRow;
}
