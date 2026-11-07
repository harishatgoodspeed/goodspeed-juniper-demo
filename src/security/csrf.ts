import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const CSRF_COOKIE = "gs_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Double-submit cookie check: the header must match the cookie, both set by us. */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (
    typeof cookieToken === "string" &&
    typeof headerToken === "string" &&
    cookieToken.length > 0 &&
    cookieToken === headerToken
  ) {
    next();
    return;
  }
  res.status(403).json({ error: "csrf_check_failed", message: "Missing or mismatched CSRF token." });
}
