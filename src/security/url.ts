import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import ipaddr from "ipaddr.js";

/**
 * SSRF-resistant URL fetching.
 *
 * The attack this defends against: a user supplies a URL whose hostname looks
 * public but resolves (now, or on a later lookup) to a loopback, private, or
 * link-local address — reaching internal services or cloud metadata endpoints
 * instead of the public internet. Checking the hostname string is not enough,
 * because DNS can answer differently between the check and the connection
 * (rebinding) and because redirects can point anywhere.
 *
 * The approach: resolve the hostname ourselves, reject unsafe resolved IPs,
 * then connect to that *validated IP literal* directly (never hostname again)
 * while still sending the correct Host header / TLS SNI. Every redirect hop
 * repeats this whole process from scratch — nothing is trusted from a
 * previous hop.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

export interface SafeFetchOptions {
  /** Total wall-clock budget across the whole redirect chain, in ms. */
  timeoutMs?: number;
  /** Maximum response body size in bytes; the connection is aborted past this. */
  maxBytes?: number;
  /** Maximum redirects to follow. */
  maxRedirects?: number;
  /** Extra request headers (Host/User-Agent are managed by this module). */
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
  redirectChain: string[];
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_REDIRECTS = 5;

/** Validate scheme and reject embedded credentials. Throws SsrfError on anything else. */
export function validateUrlSyntax(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with embedded credentials are not allowed");
  }
  if (!url.hostname) {
    throw new SsrfError("URL has no hostname");
  }
  return url;
}

/** True if this resolved IP must never be contacted on the user's behalf. */
export function isDisallowedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(ip); // normalises IPv4-mapped IPv6 (::ffff:10.0.0.1) to IPv4
  } catch {
    return true; // unparsable is untrusted
  }
  // ipaddr.js range() returns 'unicast' only for ordinary public addresses;
  // everything else (loopback, private, linkLocal/metadata, uniqueLocal,
  // reserved, multicast, carrierGradeNat, benchmarking, amt, as112, ...) is
  // denied by only allow-listing 'unicast'.
  const range = addr.range();
  return range !== "unicast";
}

interface ResolvedTarget {
  ip: string;
  family: 4 | 6;
}

/** Resolve a hostname and return the first address that passes the IP allow-check. */
export async function resolveSafeTarget(hostname: string): Promise<ResolvedTarget> {
  // A literal IP in the URL still goes through the same check.
  if (ipaddr.isValid(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new SsrfError(`Refusing to contact non-public address: ${hostname}`);
    }
    const family = hostname.includes(":") ? 6 : 4;
    return { ip: hostname, family };
  }

  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new SsrfError(`DNS lookup for ${hostname} returned no addresses`);
  }
  const safe = records.find((r) => !isDisallowedIp(r.address));
  if (!safe) {
    throw new SsrfError(
      `${hostname} resolves only to non-public addresses (${records.map((r) => r.address).join(", ")})`
    );
  }
  return { ip: safe.address, family: safe.family as 4 | 6 };
}

export function resolveRedirectLocation(location: string, base: URL): URL {
  const next = new URL(location, base);
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    throw new SsrfError(`Redirect used an unsupported scheme: ${next.protocol}`);
  }
  if (next.username || next.password) {
    throw new SsrfError("Redirect target has embedded credentials");
  }
  return next;
}

/**
 * Fetch a URL under full SSRF protection: hostname and every redirect target
 * are freshly resolved and IP-checked, and the connection is made to the
 * validated IP literal (never a hostname) to close the DNS-rebinding window.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const deadline = Date.now() + timeoutMs;
  let current = validateUrlSyntax(rawUrl);
  const redirectChain: string[] = [];

  for (let hop = 0; ; hop++) {
    if (hop > maxRedirects) {
      throw new SsrfError(`Too many redirects (> ${maxRedirects})`);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SsrfError("Fetch timed out");
    }

    const target = await resolveSafeTarget(current.hostname);
    const result = await requestOnce(current, target, {
      timeoutMs: remaining,
      maxBytes,
      headers: opts.headers,
    });

    if (
      result.statusCode >= 300 &&
      result.statusCode < 400 &&
      result.headers.location &&
      hop < maxRedirects
    ) {
      redirectChain.push(current.toString());
      current = resolveRedirectLocation(result.headers.location, current);
      continue;
    }

    return {
      statusCode: result.statusCode,
      headers: result.headers,
      body: result.body,
      finalUrl: current.toString(),
      redirectChain,
    };
  }
}

function requestOnce(
  url: URL,
  target: ResolvedTarget,
  opts: { timeoutMs: number; maxBytes: number; headers?: Record<string, string> }
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        host: target.ip, // connect to the validated IP literal, never the hostname again
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.protocol === "https:" ? url.hostname : undefined, // correct TLS SNI/cert check
        timeout: opts.timeoutMs,
        headers: {
          Host: url.hostname,
          "User-Agent": "GoodspeedBrandOS/1.0 (+https://goodspeed.studio)",
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBytes) {
            req.destroy(new SsrfError(`Response exceeded ${opts.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new SsrfError("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}
