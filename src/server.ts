import path from "node:path";
import fs from "node:fs";
import express from "express";
import { config } from "./config";
import { openDb } from "./db";
import { cookieMiddleware } from "./security/cookies";
import { attachSession, logoutHandler, requireAuth } from "./security/auth-middleware";
import { requireCsrf } from "./security/csrf";
import { PersistentSlidingWindowLimiter } from "./security/persistent-rate-limit";
import { tryReserve, attachReservationToRun, spendUsd } from "./spend";
import { assertRasterWithinLimits, ImageLimitError } from "./image-limits";
import { detectSiteLanguage } from "./language";
import { detectEnglishVariant } from "./english-variant";
import { listOwnedUploads } from "./imagery";
import { mountAuditRoutes } from "./audit/routes";
import type { AuditDeps } from "./audit/run-audit";
import { newId } from "./ids";
import { purgeExpiredBrands } from "./retention";
import { serveStaticFile } from "./static-files";
import { validateUrlSyntax } from "./security/url";
import {
  createBrand,
  getBrand,
  listBrandsForOwner,
  listSourceAssets,
  getSourceAsset,
  setApprovedContext,
  setBrandContext,
} from "./brands";
import { enqueueJob, getJob, startWorker } from "./jobs";
import { runImportJob } from "./import/run-import-job";
import { runBriefJob } from "./jobs/run-brief-job";
import { runGenerateJob } from "./jobs/run-generate-job";
import { createRun, getLatestRunForBrand, getRun } from "./runs";
import { getOutput, listOutputsForRun, listReviewsForOutput } from "./outputs";
import { computeOverallPass } from "./review/review";
import { createShare, getShare, listActiveSharesForBrand, revokeShare } from "./shares";
import { canAccessBrand, isOwner } from "./security/brand-access";
import { renderSharePage } from "./share-page";
import { buildBrandMarkdown } from "./snapshot";
import { registerAuditPdfRoutes } from "./audit/pdf-route";
import { checkUploadAgainstBrand, UploadDecodeError } from "./review/upload-check";
import { createLead } from "./leads";
import { notifySlack } from "./slack";
import type { ApprovedBrandContext } from "./llm";
import type { BrandContext } from "./import/types";

function notFoundPage(): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Page not found</title>
  <style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#F9F2ED;color:#242F28;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}</style>
  </head><body><div><h1>Page not found</h1><p>This page does not exist, or you do not have a link that can open it.</p></div></body></html>`;
}

export function createApp(options?: { auditDeps?: AuditDeps }) {
  const db = openDb();
  const app = express();

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  // Before attachSession: a health check must never provision a workspace.
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // The tight parser used to wrap every route, including uploads. A later
  // route parser cannot raise that limit: Express already rejected the body.
  // Upload routes get a larger limit here. Everything else stays at 100kb.
  const tightJson = express.json({ limit: "100kb" });
  const uploadJson = express.json({ limit: "8mb" });
  const auditJson = express.json({ limit: "12mb" });
  app.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/api/audit") {
      return auditJson(req, res, next);
    }
    if (req.method === "POST" && /\/(check-upload|owned-images)$/.test(req.path)) {
      return uploadJson(req, res, next);
    }
    return tightJson(req, res, next);
  });
  app.use(cookieMiddleware);
  app.use(attachSession(db));

  // --- Auth ---
  // No login step: attachSession above silently provisions an isolated,
  // anonymous workspace on first visit. /api/logout abandons it ("start
  // over"), not a real sign-out — the next request gets a brand-new one.
  app.post("/api/logout", requireAuth, requireCsrf, logoutHandler(db));
  app.get("/api/session", (req, res) => {
    res.json({ authenticated: Boolean(req.auth), ownerId: req.auth?.ownerId ?? null });
  });

  mountAuditRoutes(app, db, options?.auditDeps);

  // --- Brand import ---
  const importLimiterByOwner = new PersistentSlidingWindowLimiter(db, 5, 60 * 60 * 1000, "import-owner");
  const importLimiterByIp = new PersistentSlidingWindowLimiter(db, 5, 60 * 60 * 1000, "import-ip");

  app.post("/api/brands", requireAuth, requireCsrf, (req, res) => {
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    try {
      validateUrlSyntax(rawUrl);
    } catch (err) {
      res.status(400).json({ error: "invalid_url", message: err instanceof Error ? err.message : "Invalid URL" });
      return;
    }

    const ownerId = req.auth!.ownerId;
    const ip = req.ip ?? "unknown";
    if (!importLimiterByOwner.check(ownerId) || !importLimiterByIp.check(ip)) {
      res.status(429).json({ error: "rate_limited", message: "Import limit reached: 5 per hour." });
      return;
    }

    const brand = createBrand(db, ownerId, rawUrl);
    const job = enqueueJob(db, { brandId: brand.id, phase: "import" });
    res.status(202).json({ brand, jobId: job.id });
  });

  app.get("/api/brands", requireAuth, (req, res) => {
    const brands = listBrandsForOwner(db, req.auth!.ownerId).map((b) => ({
      id: b.id,
      sourceUrl: b.source_url,
      status: b.status,
      createdAt: b.created_at,
    }));
    res.json({ brands });
  });

  app.get("/api/brands/:id", requireAuth, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const assets = listSourceAssets(db, brand.id).map((a) => ({
      id: a.id,
      kind: a.kind,
      origin_url: a.origin_url,
      mime_type: a.mime_type,
      byte_size: a.byte_size,
      confidence: a.confidence,
      extraction_method: a.extraction_method,
      // local_path intentionally omitted: filesystem layout is not client-facing.
    }));
    const parsedContext = brand.context_json ? JSON.parse(brand.context_json) : null;
    const sampleText = `${parsedContext?.description ?? ""} ${parsedContext?.textExcerpt ?? ""}`;
    const detected = detectEnglishVariant(sampleText);
    res.json({
      id: brand.id,
      sourceUrl: brand.source_url,
      status: brand.status,
      error: brand.error,
      context: parsedContext,
      englishSuggestion: detected === "us" ? "us" : "uk",
      englishSuggestionSource: detected === "unknown" ? "default_british" : "site_spelling",
      siteLanguage: detectSiteLanguage(sampleText),
      approvedContext: brand.approved_context_json ? JSON.parse(brand.approved_context_json) : null,
      approvedContextVersion: brand.approved_context_version,
      assets,
      createdAt: brand.created_at,
      updatedAt: brand.updated_at,
      latestRun: (() => {
        const latest = getLatestRunForBrand(db, brand.id);
        return latest ? { id: latest.id, status: latest.status } : null;
      })(),
    });
  });

  app.get("/api/assets/:id", (req, res) => {
    const asset = getSourceAsset(db, req.params.id);
    if (!asset || !asset.local_path) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const brand = getBrand(db, asset.brand_id);
    // Accessible to the owning session, or to anyone holding a valid share
    // token for this brand (see /b/:id) — never to any other authenticated
    // user just because they're logged in.
    if (!brand || !canAccessBrand(req, db, brand)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!fs.existsSync(asset.local_path)) {
      res.status(404).json({ error: "not_found", message: "Asset record exists but the file is missing on disk." });
      return;
    }
    res.set("Content-Type", asset.mime_type ?? "application/octet-stream");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(asset.local_path).pipe(res);
  });

  // Free-tool brand snapshot: a Claude-ready brand.md download with the
  // approved palette/fonts/voice, zero contact required. Shared with the
  // same access rule as other brand assets (owner, or a valid share token).
  app.get("/api/brands/:id/snapshot.md", requireAuth, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || !canAccessBrand(req, db, brand)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!brand.context_json || !brand.approved_context_json) {
      res.status(409).json({ error: "not_ready", message: "Approve a brand selection before downloading a snapshot." });
      return;
    }
    const rawContext = JSON.parse(brand.context_json) as BrandContext;
    const approvedRaw = JSON.parse(brand.approved_context_json) as Partial<ApprovedBrandContext>;
    const approvedContext: ApprovedBrandContext = {
      logoAssetId: approvedRaw.logoAssetId ?? null,
      colours: Array.isArray(approvedRaw.colours) ? approvedRaw.colours : [],
      fonts: Array.isArray(approvedRaw.fonts) ? approvedRaw.fonts : [],
      voiceNotes: typeof approvedRaw.voiceNotes === "string" ? approvedRaw.voiceNotes : "",
    };
    const markdown = buildBrandMarkdown({ sourceUrl: brand.source_url, rawContext, approvedContext });
    res.set("Content-Type", "text/markdown; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="brand-snapshot.md"');
    res.send(markdown);
  });

  // Free-tool "check this against our brand" upload review — colour only,
  // deliberately (see upload-check.ts's module doc for why). A separate,
  // larger JSON body limit applies only to this route; every other route
  // keeps the tight 100kb default above.
  const UPLOAD_CHECK_MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED_UPLOAD_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const uploadCheckLimiterByOwner = new PersistentSlidingWindowLimiter(db, 10, 60 * 60 * 1000, "upload-owner");

  app.post(
    "/api/brands/:id/check-upload",
    requireAuth,
    requireCsrf,
    async (req, res) => {
      const brand = getBrand(db, req.params.id);
      if (!brand || !canAccessBrand(req, db, brand)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (!uploadCheckLimiterByOwner.check(req.auth!.ownerId)) {
        res.status(429).json({ error: "rate_limited", message: "Upload-check limit reached: 10 per hour." });
        return;
      }

      const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "";
      const imageBase64 = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : "";
      if (!ALLOWED_UPLOAD_MIME.has(mimeType) || !imageBase64) {
        res.status(400).json({
          error: "invalid_body",
          message: "mimeType (image/png, image/jpeg, image/webp, or image/gif) and imageBase64 are required.",
        });
        return;
      }

      const buffer = Buffer.from(imageBase64, "base64");
      if (buffer.length === 0 || buffer.length > UPLOAD_CHECK_MAX_BYTES) {
        res.status(400).json({
          error: "invalid_body",
          message: `Image must be non-empty and under ${UPLOAD_CHECK_MAX_BYTES} bytes.`,
        });
        return;
      }
      try {
        assertRasterWithinLimits(buffer);
      } catch (err) {
        if (err instanceof ImageLimitError) {
          res.status(400).json({ error: "image_too_large", message: err.message });
          return;
        }
        throw err;
      }

      const approved = brand.approved_context_json
        ? (JSON.parse(brand.approved_context_json) as Partial<ApprovedBrandContext>)
        : null;
      const approvedColours = approved && Array.isArray(approved.colours) ? approved.colours : [];
      if (approvedColours.length === 0) {
        res.status(409).json({
          error: "no_palette",
          message: "No colours were approved for this brand yet — approve a selection first.",
        });
        return;
      }

      try {
        const result = await checkUploadAgainstBrand(buffer, mimeType, approvedColours, config.UPLOAD_COLOUR_MATCH_THRESHOLD);
        res.json(result);
      } catch (err) {
        if (err instanceof UploadDecodeError) {
          res.status(400).json({ error: "undecodable_image", message: err.message });
          return;
        }
        res.status(500).json({ error: "check_failed", message: "Could not analyse the uploaded image." });
      }
    }
  );

  // Optional, post-delivery email capture. Never required to use any part
  // of the free tool — see src/leads.ts and the free-journey UI, which only
  // shows this after a run has actually delivered something.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const leadLimiterByOwner = new PersistentSlidingWindowLimiter(db, 5, 60 * 60 * 1000, "lead-owner");

  app.post("/api/brands/:id/leads", requireAuth, requireCsrf, async (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!leadLimiterByOwner.check(req.auth!.ownerId)) {
      res.status(429).json({ error: "rate_limited", message: "Please try again later." });
      return;
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const preferredTool = typeof req.body?.preferredTool === "string" ? req.body.preferredTool.trim().slice(0, 200) : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 2000) : null;
    const consent = req.body?.consent === true;

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "invalid_body", message: "A valid email address is required." });
      return;
    }
    if (!consent) {
      res.status(400).json({ error: "consent_required", message: "Consent is required to save your details." });
      return;
    }

    const lead = createLead(db, brand.id, { email, preferredTool, notes: notes || null, consent: true });
    void notifySlack(
      [
        "New Brand OS free-tool lead",
        `Brand: ${brand.source_url}`,
        `Email: ${email}`,
        preferredTool ? `Preferred tool: ${preferredTool}` : null,
        notes ? `Notes: ${notes}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join("\n")
    );

    res.status(201).json({ ok: true, id: lead.id });
  });

  app.patch("/api/brands/:id", requireAuth, requireCsrf, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (typeof req.body?.approvedContext !== "object" || req.body.approvedContext === null) {
      res.status(400).json({ error: "invalid_body", message: "approvedContext object is required." });
      return;
    }
    setApprovedContext(db, brand.id, req.body.approvedContext);
    res.json({ ok: true, brand: getBrand(db, brand.id) });
  });

  app.delete("/api/brands/:id", requireAuth, requireCsrf, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "confirmation_required", message: "Pass { confirm: true } to delete." });
      return;
    }
    for (const asset of listSourceAssets(db, brand.id)) {
      if (asset.local_path && fs.existsSync(asset.local_path)) {
        try {
          fs.unlinkSync(asset.local_path);
        } catch {
          /* best-effort file cleanup; DB row removal below is authoritative */
        }
      }
    }
    db.prepare("DELETE FROM brands WHERE id = ?").run(brand.id); // cascades via FK
    res.json({ ok: true });
  });

  // --- Sharing ---
  // A brand's results are private by default (see canAccessBrand / GET /b/:id).
  // This section is how an owner opts in, and how they revoke that opt-in.
  app.post("/api/brands/:id/share", requireAuth, requireCsrf, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const { share, token } = createShare(db, brand.id);
    res.status(201).json({
      id: share.id,
      token,
      url: `${config.APP_BASE_URL}/b/${brand.id}?token=${token}`,
      createdAt: share.created_at,
      warning:
        "Anyone with this link can view this page and download its outputs. It is shown once here and cannot be retrieved again — revoke it if it leaks.",
    });
  });

  app.get("/api/brands/:id/shares", requireAuth, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const shares = listActiveSharesForBrand(db, brand.id).map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      // token/token_hash are never returned once creation has responded.
    }));
    res.json({ shares });
  });

  app.delete("/api/brands/:id/share/:shareId", requireAuth, requireCsrf, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const share = getShare(db, req.params.shareId);
    if (!share || share.brand_id !== brand.id) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    revokeShare(db, share.id);
    res.json({ ok: true });
  });

  // --- Shareable result page ---
  // Deliberately NOT behind requireAuth: canAccessBrand allows either the
  // owner's session or a valid share token, and a visitor with neither gets
  // the same 404 a nonexistent brand would — existence is never confirmed to
  // someone without access.
  app.get("/b/:id", (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || !canAccessBrand(req, db, brand)) {
      res.status(404).set("Content-Type", "text/html; charset=utf-8").send(notFoundPage());
      return;
    }

    const owner = isOwner(req, brand);
    const viewToken = owner ? null : typeof req.query.token === "string" ? req.query.token : null;

    const run = getLatestRunForBrand(db, brand.id) ?? null;
    const outputs = run
      ? listOutputsForRun(db, run.id).map((output) => ({ output, reviews: listReviewsForOutput(db, output.id) }))
      : [];

    const approved: { logoAssetId: string | null } | null = brand.approved_context_json
      ? JSON.parse(brand.approved_context_json)
      : null;

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.send(
      renderSharePage({
        brand,
        logoAssetId: approved?.logoAssetId ?? null,
        run,
        outputs,
        viewToken,
      })
    );
  });

  // --- Runs (briefs -> generate -> review/repair) ---
  const runLimiterByOwner = new PersistentSlidingWindowLimiter(db, 3, 60 * 60 * 1000, "run-owner");
  const runLimiterByIp = new PersistentSlidingWindowLimiter(db, 3, 60 * 60 * 1000, "run-ip");

  function dailyRunCount(): number {
    const row = db
      .prepare("SELECT count(*) as n FROM runs WHERE created_at > datetime('now', '-1 day')")
      .get() as { n: number };
    return row.n;
  }

  function ownerHasActiveRun(ownerId: string): boolean {
    const row = db
      .prepare(
        `SELECT 1 FROM runs r JOIN brands b ON b.id = r.brand_id
         WHERE b.owner_id = ? AND r.status NOT IN ('completed','partial','failed') LIMIT 1`
      )
      .get(ownerId);
    return Boolean(row);
  }

  app.post("/api/brands/:id/runs", requireAuth, requireCsrf, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (brand.status !== "ready" || !brand.approved_context_json) {
      res.status(400).json({
        error: "brand_not_ready",
        message: "This brand's import must be complete and its context approved before starting a run.",
      });
      return;
    }

    const task = typeof req.body?.task === "string" ? req.body.task.trim() : "";
    if (!task) {
      res.status(400).json({ error: "invalid_body", message: "task is required." });
      return;
    }
    const preset = typeof req.body?.preset === "string" ? req.body.preset : null;

    const ownerId = req.auth!.ownerId;
    const ip = req.ip ?? "unknown";
    if (!runLimiterByOwner.check(ownerId) || !runLimiterByIp.check(ip)) {
      res.status(429).json({ error: "rate_limited", message: "Run limit reached: 3 per hour." });
      return;
    }
    if (dailyRunCount() >= config.DAILY_RUN_LIMIT) {
      res.status(429).json({ error: "rate_limited", message: "The daily run limit has been reached." });
      return;
    }
    const approvedForRun = JSON.parse(brand.approved_context_json) as Partial<ApprovedBrandContext>;
    const rawForRun = brand.context_json ? (JSON.parse(brand.context_json) as BrandContext) : null;
    const siteLanguage = detectSiteLanguage(`${rawForRun?.description ?? ""} ${rawForRun?.textExcerpt ?? ""}`);
    if (siteLanguage === "other" && req.body?.confirmEnglish !== true) {
      res.status(400).json({
        error: "confirm_language",
        message: "This site does not look like English. Confirm before we write in English. We will not translate it on our own.",
      });
      return;
    }
    const requestedVariant = req.body?.englishVariant;
    const savedVariant = approvedForRun.englishVariant;
    const englishVariant = requestedVariant === "us" || requestedVariant === "uk"
      ? requestedVariant
      : savedVariant === "us" || savedVariant === "uk"
        ? savedVariant
        : "uk";

    if (spendUsd(db) >= config.GLOBAL_DAILY_SPEND_USD || spendUsd(db, ownerId) >= config.PER_VISITOR_DAILY_SPEND_USD) {
      res.status(429).json({
        error: "spend_cap_reached",
        pricing: "placeholder_estimate",
        message: "This free tool has reached its spend limit for today. Please try again tomorrow. The limit uses a placeholder estimate, not a provider bill.",
      });
      return;
    }
    if (ownerHasActiveRun(ownerId)) {
      res.status(409).json({
        error: "run_in_progress",
        message: "Only one active run per owner is allowed — wait for the current run to finish.",
      });
      return;
    }

    const reservation = tryReserve(db, { ownerId, kind: "run", usd: config.RUN_RESERVATION_USD });
    if (!reservation.ok) {
      res.status(429).json({
        error: "spend_cap_reached",
        pricing: reservation.pricing,
        message:
          reservation.scope === "global"
            ? "This free tool has reached its spend limit for today. Please try again tomorrow. The limit uses a placeholder estimate, not a provider bill."
            : "You've reached today's free limit for this workspace. Please try again tomorrow. The limit uses a placeholder estimate, not a provider bill.",
      });
      return;
    }
    const run = createRun(db, brand.id, task, preset, brand.approved_context_version, {
      mode: "legacy",
      englishVariant,
      reservationId: reservation.id,
    });
    attachReservationToRun(db, reservation.id, run.id);
    const job = enqueueJob(db, { runId: run.id, phase: "brief" });
    res.status(202).json({
      run,
      jobId: job.id,
      englishVariant,
      englishVariantSource: requestedVariant === "uk" || requestedVariant === "us" ? "request" : savedVariant ? "brand" : "default_british",
      pricing: "placeholder_estimate",
    });
  });

  function loadRunWithOwnerCheck(runId: string, ownerId: string) {
    const run = getRun(db, runId);
    if (!run) return null;
    const brand = getBrand(db, run.brand_id);
    if (!brand || brand.owner_id !== ownerId) return null;
    return { run, brand };
  }

  app.get("/api/runs/:id", requireAuth, (req, res) => {
    const found = loadRunWithOwnerCheck(req.params.id, req.auth!.ownerId);
    if (!found) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const { run, brand } = found;
    // Brand versioning: a run is stamped with the approved-context version it
    // was generated against (brand.approved_context_version at the time —
    // see POST .../runs above). If the brand's approved context has moved on
    // since, every output from this run is honestly "needs review" — never
    // silently still shown as current.
    const needsReview = run.context_version !== brand.approved_context_version;
    const outputs = listOutputsForRun(db, run.id).map((o) => {
      const reviews = listReviewsForOutput(db, o.id).map((r) => ({
        id: r.id,
        outputVersion: r.output_version,
        findings: JSON.parse(r.findings_json),
        fixes: r.fixes_json ? JSON.parse(r.fixes_json) : [],
        createdAt: r.created_at,
      }));
      const latestReview = reviews[reviews.length - 1];
      const overallPass = latestReview ? computeOverallPass(latestReview.findings) : false;
      // No opaque score: just the one honest label a visitor needs — never
      // "Brand approved" unless every check genuinely passed, and never once
      // the brand itself has moved on from the version this was built against.
      const label = needsReview ? "Needs review" : overallPass ? "Brand approved" : "Draft";
      return {
        id: o.id,
        type: o.type,
        status: o.status,
        version: o.version,
        brief: o.template_inputs_json ? JSON.parse(o.template_inputs_json) : null,
        reviews,
        needsReview,
        label,
      };
    });

    res.json({
      id: run.id,
      brandId: run.brand_id,
      task: run.task,
      preset: run.preset,
      mode: run.mode ?? "legacy",
      englishVariant: run.english_variant,
      channel: run.channel,
      status: run.status,
      model: run.model,
      promptTokens: run.prompt_tokens,
      completionTokens: run.completion_tokens,
      elapsedMs: run.elapsed_ms,
      unknowns: run.unknowns_json ? JSON.parse(run.unknowns_json) : [],
      createdAt: run.created_at,
      outputs,
      pricing: "placeholder_estimate",
    });
  });

  app.get("/api/outputs/:id/file", (req, res) => {
    const output = getOutput(db, req.params.id);
    if (!output || !output.file_id) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const run = getRun(db, output.run_id);
    const brand = run ? getBrand(db, run.brand_id) : undefined;
    if (!run || !brand || !canAccessBrand(req, db, brand)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!fs.existsSync(output.file_id)) {
      res.status(404).json({ error: "not_found", message: "Output record exists but the file is missing on disk." });
      return;
    }
    const ext = path.extname(output.file_id).toLowerCase();
    const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "application/octet-stream";
    res.set("Content-Type", mime);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(output.file_id).pipe(res);
  });

  app.get("/api/jobs/:id", requireAuth, (req, res) => {
    const job = getJob(db, req.params.id);
    if (!job) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (job.brand_id) {
      const brand = getBrand(db, job.brand_id);
      if (!brand || brand.owner_id !== req.auth!.ownerId) {
        res.status(404).json({ error: "not_found" });
        return;
      }
    } else if (job.run_id) {
      // Brief/generate jobs carry run_id instead of brand_id — ownership
      // traces through the run's brand. Without this branch any
      // authenticated user could poll any other owner's run jobs.
      const found = loadRunWithOwnerCheck(job.run_id, req.auth!.ownerId);
      if (!found) {
        res.status(404).json({ error: "not_found" });
        return;
      }
    }
    res.json(job);
  });

  app.post("/api/brands/manual", requireAuth, requireCsrf, (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    const offer = typeof req.body?.offer === "string" ? req.body.offer.trim().slice(0, 600) : "";
    const audience = typeof req.body?.audience === "string" ? req.body.audience.trim().slice(0, 300) : "";
    const rawUrl = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!name || !offer) {
      res.status(400).json({ error: "invalid_body", message: "Add a business name and what you offer, then try again." });
      return;
    }
    let sourceUrl = `manual:${name}`;
    if (rawUrl) {
      try {
        validateUrlSyntax(rawUrl);
        sourceUrl = rawUrl;
      } catch (err) {
        res.status(400).json({ error: "invalid_url", message: err instanceof Error ? err.message : "Invalid URL" });
        return;
      }
    }
    const brand = createBrand(db, req.auth!.ownerId, sourceUrl);
    setBrandContext(db, brand.id, {
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      extractionMethod: "static-html-css",
      title: name,
      siteName: name,
      description: offer,
      logoCandidates: [],
      colours: [],
      cssCustomProperties: [],
      fonts: [],
      googleFontsLinks: [],
      images: [],
      textExcerpt: [offer, audience].filter(Boolean).join(" "),
      textTruncated: false,
      stylesheetsFetched: 0,
      stylesheetsSkipped: 0,
      unknowns: ["Entered by hand because the site could not be read.", audience ? "" : "Audience was not given."].filter(Boolean),
    });
    res.status(201).json({ brand: getBrand(db, brand.id) });
  });

  app.post("/api/brands/:id/owned-images", requireAuth, requireCsrf, async (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (req.body?.ownershipConfirmed !== true) {
      res.status(400).json({
        error: "ownership_required",
        message: "Confirm you own this image before it can be used. We will not take pictures from the website on our own.",
      });
      return;
    }
    const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "";
    const imageBase64 = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : "";
    if (!ALLOWED_UPLOAD_MIME.has(mimeType) || !imageBase64) {
      res.status(400).json({ error: "invalid_body", message: "Choose a PNG, JPEG, WebP or GIF." });
      return;
    }
    const buffer = Buffer.from(imageBase64, "base64");
    if (buffer.length === 0 || buffer.length > UPLOAD_CHECK_MAX_BYTES) {
      res.status(400).json({ error: "invalid_body", message: "That image is empty or too large." });
      return;
    }
    let size: { width: number; height: number } | null = null;
    try {
      size = assertRasterWithinLimits(buffer);
    } catch (err) {
      if (err instanceof ImageLimitError) {
        res.status(400).json({ error: "image_too_large", message: err.message });
        return;
      }
      throw err;
    }
    const id = newId("upload");
    const ext = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "gif";
    const dir = path.join(config.ASSET_DIR, "brands", brand.id, "owned");
    fs.mkdirSync(dir, { recursive: true });
    const localPath = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(localPath, buffer);
    db.prepare(
      `INSERT INTO owned_uploads (id, brand_id, local_path, mime_type, byte_size, width, height, ownership_confirmed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(id, brand.id, localPath, mimeType, buffer.length, size?.width ?? null, size?.height ?? null);
    const approved = brand.approved_context_json ? (JSON.parse(brand.approved_context_json) as ApprovedBrandContext) : {
      logoAssetId: null,
      colours: [],
      fonts: [],
      voiceNotes: "",
    };
    const ids = new Set(approved.approvedImageAssetIds ?? []);
    ids.add(id);
    setApprovedContext(db, brand.id, { ...approved, approvedImageAssetIds: [...ids] });
    res.status(201).json({ id, width: size?.width ?? null, height: size?.height ?? null, ownershipConfirmed: true });
  });

  app.get("/api/brands/:id/owned-images", requireAuth, (req, res) => {
    const brand = getBrand(db, req.params.id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      images: listOwnedUploads(db, brand.id).map((image) => ({
        id: image.id,
        mimeType: image.mime_type,
        width: image.width,
        height: image.height,
      })),
    });
  });

  // Audit PDF. Scoring lives in the audit routes above.
  registerAuditPdfRoutes(app, db);

  // --- Own frontend (public/) ---
  const publicDir = path.join(__dirname, "..", "public");
  app.get("/", (req, res) => serveStaticFile(publicDir, "index.html", req, res));
  app.get(/^\/(app\.js|styles\.css|bent-pixels-wordmark\.png)$/, (req, res) =>
    serveStaticFile(publicDir, req.path.slice(1), req, res)
  );

  // Fallback 404 for anything else under /api, and a plain 404 for other paths
  // (never the SPA shell — see static-files.ts).
  app.use((req, res) => {
    res.status(404).json({ error: "not_found", path: req.path });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
    const type = typeof err === "object" && err && "type" in err ? String((err as { type?: string }).type) : "";
    if (status === 413 || type === "entity.too.large") {
      res.status(413).json({ error: "payload_too_large", message: "That upload is too large." });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return { app, db };
}

if (require.main === module) {
  fs.mkdirSync(config.ASSET_DIR, { recursive: true });
  const { app, db } = createApp();
  purgeExpiredBrands(db);
  const worker = startWorker(db, { import: runImportJob, brief: runBriefJob, generate: runGenerateJob });

  const server = app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Goodspeed Brand OS listening on :${config.PORT} (${config.NODE_ENV})`);
    if (config.isDevFallbackAuth) {
      // eslint-disable-next-line no-console
      console.warn(
        "APP_ACCESS_CODE/SESSION_SECRET not set — using insecure dev fallbacks. Do not run this in production."
      );
    }
    if (!config.hasAnthropicKey) {
      // eslint-disable-next-line no-console
      console.warn("ANTHROPIC_API_KEY not set — brief generation and voice review (Phase 2+) will be unavailable.");
    }
  });

  const shutdown = () => {
    worker.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
