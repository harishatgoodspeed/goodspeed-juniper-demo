import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { config } from "../config";

export const SESSION_COOKIE = "gs_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function sign(value: string, secret = config.SESSION_SECRET): string {
  const mac = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${mac}`;
}

export function verifySigned(signed: string, secret = config.SESSION_SECRET): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac("sha256", secret).update(value).digest("hex");
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(macBuf, expectedBuf)) return null;
  return value;
}

export interface SessionRow {
  id: string;
  owner_id: string;
  created_at: string;
  expires_at: string;
}

/**
 * Public free-tool access: no signup, no access code. Every visitor with no
 * valid session cookie gets a brand-new, isolated owner row the first time
 * they hit the app (see attachSession in auth-middleware.ts) — this is the
 * only thing that creates an owner. Two visitors never share one.
 */
export function createAnonymousOwner(db: Database.Database): string {
  const id = `owner_${crypto.randomBytes(12).toString("hex")}`;
  db.prepare("INSERT INTO owners (id) VALUES (?)").run(id);
  return id;
}

export function createSession(db: Database.Database, ownerId: string): SessionRow {
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, owner_id, expires_at) VALUES (?, ?, ?)").run(
    id,
    ownerId,
    expiresAt
  );
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow;
}

export function getValidSession(db: Database.Database, sessionId: string): SessionRow | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
    | SessionRow
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return undefined;
  }
  return row;
}

export function destroySession(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}
