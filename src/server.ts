import path from "node:path";
import fs from "node:fs";
import express from "express";
import { config } from "./config";
import { openDb } from "./db";
import { cookieMiddleware } from "./security/cookies";
import { attachSession, loginHandler, logoutHandler, requireAuth } from "./security/auth-middleware";
import { requireCsrf } from "./security/csrf";
import { SlidingWindowLimiter } from "./security/rate-limit";
import { serveStaticFile } from "./static-files";
import { validateUrlSyntax } from "./security/url";
import {
  createBrand,
  getBrand,
  listBrandsForOwner,
  listSourceAssets,
  getSourceAsset,
  setApprovedContext,
} from "./brands";
import { enqueueJob, getJob, startWorker } from "./jobs";
import { runImportJob } from "./import/run-import-job";
import { runBriefJob } from "./jobs/run-brief-job";
import { runGenerateJob } from "./jobs/run-generate-job";
import { createRun, getRun } from "./runs";
import { getOutput, listOutputsForRun, listReviewsForOutput } from "./outputs";

export function createApp() {
  const db = openDb();
  const app = express();

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieMiddleware);
  app.use(attachSession(db));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // --- Auth ---
  app.post("/api/login", loginHandler(db));
  app.post("/api/logout", requireAuth, requireCsrf, logoutHandler(db));
  app.get("/api/session", (req, res) => {
    res.json({ authenticated: Boolean(req.auth) });
  });

  // --- Brand import ---
  const importLimiterByOwner = new SlidingWindowLimiter(5, 60 * 60 * 1000);
  const importLimiterByIp = new SlidingWindowLimiter(5, 60 * 60 * 1000);

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
    res.json({
      id: brand.id,
      sourceUrl: brand.source_url,
      status: brand.status,
      error: brand.error,
      context: brand.context_json ? JSON.parse(brand.context_json) : null,
      approvedContext: brand.approved_context_json ? JSON.parse(brand.approved_context_json) : null,
      approvedContextVersion: brand.approved_context_version,
      assets,
      createdAt: brand.created_at,
      updatedAt: brand.updated_at,
    });
  });

  app.get("/api/assets/:id", requireAuth, (req, res) => {
    const asset = getSourceAsset(db, req.params.id);
    if (!asset || !asset.local_path) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const brand = getBrand(db, asset.brand_id);
    if (!brand || brand.owner_id !== req.auth!.ownerId) {
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

  // --- Runs (briefs -> generate -> review/repair) ---
  const runLimiterByOwner = new SlidingWindowLimiter(3, 60 * 60 * 1000);
  const runLimiterByIp = new SlidingWindowLimiter(3, 60 * 60 * 1000);

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
    if (ownerHasActiveRun(ownerId)) {
      res.status(409).json({
        error: "run_in_progress",
        message: "Only one active run per owner is allowed — wait for the current run to finish.",
      });
      return;
    }

    const run = createRun(db, brand.id, task, preset, brand.approved_context_version);
    const job = enqueueJob(db, { runId: run.id, phase: "brief" });
    res.status(202).json({ run, jobId: job.id });
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
    const { run } = found;
    const outputs = listOutputsForRun(db, run.id).map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      version: o.version,
      brief: o.template_inputs_json ? JSON.parse(o.template_inputs_json) : null,
      reviews: listReviewsForOutput(db, o.id).map((r) => ({
        id: r.id,
        outputVersion: r.output_version,
        findings: JSON.parse(r.findings_json),
        fixes: r.fixes_json ? JSON.parse(r.fixes_json) : [],
        createdAt: r.created_at,
      })),
    }));

    res.json({
      id: run.id,
      brandId: run.brand_id,
      task: run.task,
      preset: run.preset,
      status: run.status,
      model: run.model,
      promptTokens: run.prompt_tokens,
      completionTokens: run.completion_tokens,
      elapsedMs: run.elapsed_ms,
      unknowns: run.unknowns_json ? JSON.parse(run.unknowns_json) : [],
      createdAt: run.created_at,
      outputs,
    });
  });

  app.get("/api/outputs/:id/file", requireAuth, (req, res) => {
    const output = getOutput(db, req.params.id);
    if (!output || !output.file_id) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const run = getRun(db, output.run_id);
    const brand = run ? getBrand(db, run.brand_id) : undefined;
    if (!run || !brand || brand.owner_id !== req.auth!.ownerId) {
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

  // --- Own frontend (public/) ---
  const publicDir = path.join(__dirname, "..", "public");
  app.get("/", (req, res) => serveStaticFile(publicDir, "index.html", req, res));
  app.get(/^\/(app\.js|styles\.css)$/, (req, res) =>
    serveStaticFile(publicDir, req.path.slice(1), req, res)
  );

  // Fallback 404 for anything else under /api, and a plain 404 for other paths
  // (never the SPA shell — see static-files.ts).
  app.use((req, res) => {
    res.status(404).json({ error: "not_found", path: req.path });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return { app, db };
}

if (require.main === module) {
  fs.mkdirSync(config.ASSET_DIR, { recursive: true });
  const { app, db } = createApp();
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
