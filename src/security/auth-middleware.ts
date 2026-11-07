import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createAnonymousOwner,
  createSession,
  destroySession,
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

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function provisionAnonymousSession(db: Database.Database, res: Response): { ownerId: string; sessionId: string } {
  const ownerId = createAnonymousOwner(db);
  const session = createSession(db, ownerId);
  setCookie(res, SESSION_COOKIE, sign(session.id), {
    httpOnly: true,
    maxAgeMs: SESSION_TTL_MS,
  });
  setCookie(res, CSRF_COOKIE, newCsrfToken(), {
    httpOnly: false, // the client script must read this to send it back as a header
    maxAgeMs: SESSION_TTL_MS,
  });
  return { ownerId, sessionId: session.id };
}

/**
 * No login step: every visitor gets an isolated, anonymous workspace. A
 * valid existing session cookie is reused; otherwise one is silently
 * provisioned right here, on the very first request. requireAuth below is
 * kept as a defensive check, not a real gate — attachSession should always
 * leave req.auth set except when a new-workspace rate limit is hit.
 */
export function attachSession(db: Database.Database) {
  // Scoped to this attachSession call (i.e. one per createApp() instance —
  // the same pattern every other limiter in server.ts already follows), not
  // module-level: a module-level singleton would leak state across every app
  // instance sharing this process, including every test file in one `node
  // --test` run.
  //
  // Defence in depth against identity-cycling to dodge the per-visitor spend
  // cap (clearing cookies and re-requesting to get a fresh owner): caps how
  // many brand-new anonymous workspaces one IP can provision per hour. The
  // global daily spend cap (see config.GLOBAL_DAILY_SPEND_USD) is the real
  // backstop regardless of how many identities one visitor cycles through.
  const newWorkspaceLimiter = new SlidingWindowLimiter(20, 60 * 60 * 1000);

  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (raw) {
      const sessionId = verifySigned(raw);
      if (sessionId) {
        const row = getValidSession(db, sessionId);
        if (row) {
          req.auth = { ownerId: row.owner_id, sessionId: row.id };
          next();
          return;
        }
      }
    }

    if (!newWorkspaceLimiter.check(clientIp(req))) {
      res.status(429).json({
        error: "too_many_new_workspaces",
        message: "Too many new sessions from this address. Try again in a while.",
      });
      return;
    }
    req.auth = provisionAnonymousSession(db, res);
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "unauthenticated", message: "Could not start a session." });
    return;
  }
  next();
}

/** Abandons the current anonymous workspace. The next request provisions a brand-new one via attachSession — this is "start over", not a real sign-out. */
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
