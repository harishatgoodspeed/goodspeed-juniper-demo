import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import { requireAuth } from "../security/auth-middleware";
import { requireCsrf } from "../security/csrf";
import { PersistentSlidingWindowLimiter } from "../security/persistent-rate-limit";
import { parseAuditResult } from "./validate";
import { renderAuditPdf } from "./render-pdf";

const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 8;

function pdfFilename(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${ascii.length > 0 ? ascii : "brand"}-brand-audit.pdf`;
}

/**
 * POST /api/audit/pdf
 * Body: an AuditResult. Response: a branded PDF.
 * Same anonymous session and CSRF check as POST /api/audit.
 * No email is collected.
 */
export function registerAuditPdfRoutes(app: Express, db: Database.Database): void {
  const byOwner = new PersistentSlidingWindowLimiter(db, LIMIT, WINDOW_MS, "audit-pdf-owner");
  const byIp = new PersistentSlidingWindowLimiter(db, LIMIT, WINDOW_MS, "audit-pdf-ip");

  app.post("/api/audit/pdf", requireAuth, requireCsrf, async (req: Request, res: Response) => {
    const parsed = parseAuditResult(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_audit", message: parsed.message });
      return;
    }

    const ownerId = req.auth!.ownerId;
    const ip = req.ip ?? "unknown";
    if (!byOwner.check(ownerId) || !byIp.check(ip)) {
      res.status(429).json({
        error: "rate_limited",
        message: "Report limit reached. Try again in a little while.",
      });
      return;
    }

    try {
      const rendered = await renderAuditPdf(parsed.value);
      const filename = pdfFilename(parsed.value.brand.name);
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="${filename}"`);
      res.set("Cache-Control", "no-store");
      res.set("X-Content-Type-Options", "nosniff");
      res.send(rendered.pdf);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.status(500).json({ error: "render_failed", message: "The report could not be rendered." });
    }
  });
}
