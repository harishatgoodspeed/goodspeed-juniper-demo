import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves a single file under `root`, rejecting any resolved path that
 * escapes it (defence against `..` traversal from a crafted request path),
 * with correct MIME type, GET/HEAD support, and a plain 404 — never the
 * app's own index page — for anything missing. Use for directories the app
 * explicitly intends to publish (its own frontend); never for user-fetched
 * or generated content, which is served only through authorised routes.
 */
export function serveStaticFile(root: string, requestedPath: string, req: Request, res: Response): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).set("Allow", "GET, HEAD").json({ error: "method_not_allowed" });
    return;
  }

  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, `.${path.posix.normalize(`/${requestedPath}`)}`);

  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.status(404).json({ error: "not_found", path: requestedPath });
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.status(200);
    res.set("Content-Type", contentType);
    res.set("Content-Length", String(stat.size));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });
}
