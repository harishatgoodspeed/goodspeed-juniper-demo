import type { NextFunction, Request, Response } from "express";
import { config } from "../config";

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cookies: Record<string, string>;
    }
  }
}

export function cookieMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.cookies = parseCookieHeader(req.headers.cookie);
  next();
}

export interface CookieOptions {
  httpOnly?: boolean;
  maxAgeMs?: number;
  sameSite?: "Strict" | "Lax" | "None";
}

export function setCookie(res: Response, name: string, value: string, opts: CookieOptions = {}): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  if (config.NODE_ENV === "production") parts.push("Secure");
  if (opts.maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`);
  appendSetCookie(res, parts.join("; "));
}

export function clearCookie(res: Response, name: string): void {
  appendSetCookie(res, `${name}=; Path=/; Max-Age=0`);
}

function appendSetCookie(res: Response, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", [String(existing), cookie]);
  }
}
