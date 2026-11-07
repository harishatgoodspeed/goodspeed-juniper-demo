import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { config } from "../config";

export const SESSION_COOKIE = "gs_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const DEFAULT_OWNER_ID = "owner_default";

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

/** Constant-time comparison for the shared access code. */
export function accessCodeMatches(candidate: string): boolean {
  const expected = Buffer.from(config.APP_ACCESS_CODE);
  const given = Buffer.from(candidate ?? "");
  if (expected.length !== given.length) {
    // Still do a comparison of equal length to avoid a length side-channel
    // being the only timing signal; this call's result is discarded.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, given);
}

export interface SessionRow {
  id: string;
  owner_id: string;
  created_at: string;
  expires_at: string;
}

/**
 * This is a single-operator private prototype gated by one shared access
 * code (see APP_ACCESS_CODE), not a multi-tenant signup system. Every valid
 * login resolves to the same default owner so the one operator always sees
 * the same workspace across sessions and devices. The schema still models
 * owner_id on every table so a real multi-user mode is additive later.
 */
export function getOrCreateDefaultOwner(db: Database.Database): string {
  const existing = db.prepare("SELECT id FROM owners WHERE id = ?").get(DEFAULT_OWNER_ID);
  if (!existing) {
    db.prepare("INSERT INTO owners (id) VALUES (?)").run(DEFAULT_OWNER_ID);
  }
  return DEFAULT_OWNER_ID;
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
