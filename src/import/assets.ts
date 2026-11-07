import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeFetch } from "../security/url";
import { sanitizeSvg } from "./svg-sanitize";
import { config } from "../config";

const ALLOWED_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
};

const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB per asset

export interface DownloadedAsset {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  sha256: string;
  sanitized: boolean;
}

export class AssetRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetRejectedError";
  }
}

/** Downloads one candidate asset under SSRF protection, validates its MIME type and size, and sanitises SVGs. */
export async function downloadAndValidateAsset(url: string): Promise<DownloadedAsset> {
  const res = await safeFetch(url, { maxBytes: MAX_ASSET_BYTES });
  if (res.statusCode >= 400) {
    throw new AssetRejectedError(`HTTP ${res.statusCode} fetching ${url}`);
  }
  if (res.body.length > MAX_ASSET_BYTES) {
    throw new AssetRejectedError(`Asset exceeds ${MAX_ASSET_BYTES} bytes`);
  }

  const declared = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const mimeType = declared && ALLOWED_MIME_EXT[declared] ? declared : sniffMime(res.body, url);
  if (!mimeType || !ALLOWED_MIME_EXT[mimeType]) {
    throw new AssetRejectedError(`Unsupported or unrecognised asset type (declared "${declared || "none"}")`);
  }

  let buffer = res.body;
  let sanitized = false;
  if (mimeType === "image/svg+xml") {
    buffer = Buffer.from(sanitizeSvg(buffer.toString("utf8")), "utf8");
    sanitized = true;
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return { buffer, mimeType, extension: ALLOWED_MIME_EXT[mimeType], sha256, sanitized };
}

/** Falls back to magic-byte sniffing for the handful of types we accept, when a host omits/misreports Content-Type. */
function sniffMime(buf: Buffer, url: string): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "image/x-icon";
  const head = buf.subarray(0, 256).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  if (/\.svg($|\?)/i.test(url)) return "image/svg+xml";
  return null;
}

export function assetDir(brandId: string): string {
  const dir = path.join(config.ASSET_DIR, "brands", brandId, "source");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveAssetFile(brandId: string, assetId: string, asset: DownloadedAsset): string {
  const dir = assetDir(brandId);
  const filePath = path.join(dir, `${assetId}.${asset.extension}`);
  fs.writeFileSync(filePath, asset.buffer);
  return filePath;
}

export function saveTextFile(brandId: string, filename: string, text: string): string {
  const dir = path.join(config.ASSET_DIR, "brands", brandId, "source");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, text, "utf8");
  return filePath;
}
