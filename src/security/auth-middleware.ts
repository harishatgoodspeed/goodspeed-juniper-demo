import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  accessCodeMatches,
  createSession,
  destroySession,
  getOrCreateDefaultOwner,
  getValidSession,
  sign,
  verifySigned,
} from "./session";
import { CSRF_COOKIE, newCsrfToken } from "./csrf";
import { setCookie, clearCookie } from "./cookies";
import { SlidingWindowLimiter } from "./rate-limit";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { ownerId: string; sessionId: string };
    }
  }
}

// 10 failed access-code attempts per 15 minutes per IP.
const loginLimiter = new SlidingWindowLimiter(10, 15 * 60 * 1000);

export function attachSession(db: Database.Database) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (raw) {
      const sessionId = verifySigned(raw);
      if (sessionId) {
        const row = getValidSession(db, sessionId);
        if (row) {
          req.auth = { ownerId: row.owner_id, sessionId: row.id };
        }
      }
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in with the access code first." });
    return;
  }
  next();
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function loginHandler(db: Database.Database) {
  return (req: Request, res: Response): void => {
    const ip = clientIp(req);
    if (!loginLimiter.check(ip)) {
      res.status(429).json({
        error: "too_many_attempts",
        message: "Too many attempts. Try again later.",
      });
      return;
    }

    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!accessCodeMatches(code)) {
      res.status(401).json({ error: "invalid_code", message: "Incorrect access code." });
      return;
    }

    const ownerId = getOrCreateDefaultOwner(db);
    const session = createSession(db, ownerId);
    setCookie(res, SESSION_COOKIE, sign(session.id), {
      httpOnly: true,
      maxAgeMs: SESSION_TTL_MS,
    });
    setCookie(res, CSRF_COOKIE, newCsrfToken(), {
      httpOnly: false, // the client script must read this to send it back as a header
      maxAgeMs: SESSION_TTL_MS,
    });
    res.json({ ok: true, ownerId });
  };
}

export function logoutHandler(db: Database.Database) {
  return (req: Request, res: Response): void => {
    if (req.auth) {
      destroySession(db, req.auth.sessionId);
    }
    clearCookie(res, SESSION_COOKIE);
    clearCookie(res, CSRF_COOKIE);
    res.json({ ok: true });
  };
}
