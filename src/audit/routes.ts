import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";
import { requireAuth } from "../security/auth-middleware";
import { requireCsrf } from "../security/csrf";
import { PersistentSlidingWindowLimiter } from "../security/persistent-rate-limit";
import { AuditRequestError, runAudit, type AuditDeps } from "./run-audit";
import { sampleAuditResult } from "./sample";
import type { AuditResult } from "./types";

const CHECK_IDS = ["palette", "logo", "type", "voice", "message", "formats"] as const;

/** Throws if a result would break the shared contract. Costs stay plain language. */
export function assertAuditResultShape(result: AuditResult): void {
  if (!result.brand?.name || !result.brand.siteUrl) {
    throw new Error("Audit result is missing the brand.");
  }
  if (!Number.isInteger(result.overallScore) || result.overallScore < 0 || result.overallScore > 100) {
    throw new Error("overallScore must be an integer from 0 to 100.");
  }
  if (result.checks.length !== CHECK_IDS.length) {
    throw new Error("Audit result must include the six checks.");
  }
  result.checks.forEach((check, index) => {
    if (check.id !== CHECK_IDS[index]) throw new Error("Checks are in the wrong order.");
    if (!Number.isInteger(check.score) || check.score < 0 || check.score > 100) {
      throw new Error("Each check score must be an integer from 0 to 100.");
    }
    if (check.status !== "ok" && check.status !== "warn" && check.status !== "break") {
      throw new Error("Each check status must be ok, warn, or break.");
    }
  });
  if (result.topBreaks.length > 5) throw new Error("topBreaks is capped at 5.");
  for (const item of result.topBreaks) {
    if (/[£$€]|\b(?:pounds|dollars|usd|gbp)\b/i.test(`${item.cost} ${item.whyItMatters}`)) {
      throw new Error("A break cost must not invent money.");
    }
  }
  if (!Array.isArray(result.toolsAndFormats?.detected) || !Array.isArray(result.toolsAndFormats?.requested)) {
    throw new Error("toolsAndFormats is missing.");
  }
  if (!Array.isArray(result.skippedSurfaces) || typeof result.generatedAt !== "string") {
    throw new Error("Audit result is missing skipped surfaces or a timestamp.");
  }
}

export function mountAuditRoutes(app: Express, db: Database.Database, deps: AuditDeps = {}): void {
  const byOwner = new PersistentSlidingWindowLimiter(db, 6, 60 * 60 * 1000, "audit-owner");
  const byIp = new PersistentSlidingWindowLimiter(db, 6, 60 * 60 * 1000, "audit-ip");

  app.get("/api/audit/sample", (_req, res) => {
    const sample = sampleAuditResult();
    assertAuditResultShape(sample);
    res.json(sample);
  });

  app.post("/api/audit", requireAuth, requireCsrf, async (req: Request, res: Response) => {
    const ownerId = req.auth!.ownerId;
    const ip = req.ip ?? "unknown";
    if (!byOwner.check(ownerId) || !byIp.check(ip)) {
      res.status(429).json({ error: "rate_limited", message: "Audit limit reached. Try again in an hour." });
      return;
    }
    try {
      const result = await runAudit(req.body, deps);
      assertAuditResultShape(result);
      res.json(result);
    } catch (err) {
      if (err instanceof AuditRequestError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      // eslint-disable-next-line no-console
      console.error(err);
      res.status(500).json({ error: "internal_error", message: "The audit could not be completed." });
    }
  });
}
