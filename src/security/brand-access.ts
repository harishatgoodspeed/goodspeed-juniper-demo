import type { Request } from "express";
import type Database from "better-sqlite3";
import { isValidShareToken } from "../shares";
import type { BrandRow } from "../brands";

/**
 * A brand's data is private by default — the owner's session, or a valid
 * share token for that exact brand, and nothing else. Never widen this to
 * "any authenticated user": the whole point of sharing being opt-in is that
 * an owner's other brands stay invisible to a visitor holding one share link.
 */
export function canAccessBrand(req: Request, db: Database.Database, brand: BrandRow): boolean {
  if (req.auth && req.auth.ownerId === brand.owner_id) return true;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  return isValidShareToken(db, brand.id, token);
}

export function isOwner(req: Request, brand: BrandRow): boolean {
  return Boolean(req.auth && req.auth.ownerId === brand.owner_id);
}
