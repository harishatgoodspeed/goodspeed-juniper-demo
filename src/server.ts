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
  const worker = startWorker(db, { import: runImportJob });

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
