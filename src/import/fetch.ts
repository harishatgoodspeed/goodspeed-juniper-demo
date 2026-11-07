import * as cheerio from "cheerio";
import { safeFetch, SsrfError, validateUrlSyntax } from "../security/url";
import { isPathAllowed, parseRobots } from "./robots";
import type { FetchedStylesheet } from "./extract";

export class ImportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportBlockedError";
  }
}

const USER_AGENT = "GoodspeedBrandOS/1.0 (+https://goodspeed.studio)";
const MAX_STYLESHEETS = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_TOTAL_MS = 30_000; // 30 s

export interface BrandSource {
  html: string;
  stylesheets: FetchedStylesheet[];
  stylesheetsSkipped: number;
  bytesUsed: number;
}

/**
 * Fetches exactly one HTML page and up to MAX_STYLESHEETS stylesheets it
 * references, under a shared 25 MB / 30 s budget. Does not crawl other pages.
 * Throws ImportBlockedError for robots.txt disallow or SsrfError for anything
 * the SSRF guard refuses.
 */
export async function fetchBrandSource(rawUrl: string): Promise<BrandSource> {
  const url = validateUrlSyntax(rawUrl);
  const deadline = Date.now() + MAX_TOTAL_MS;
  let bytesUsed = 0;

  await checkRobots(url, deadline);

  const pageResult = await safeFetch(url.toString(), {
    timeoutMs: remaining(deadline),
    maxBytes: MAX_TOTAL_BYTES,
  });
  if (pageResult.statusCode >= 400) {
    throw new ImportBlockedError(`Site returned HTTP ${pageResult.statusCode} for ${url}`);
  }
  bytesUsed += pageResult.body.length;
  const html = pageResult.body.toString("utf8");

  const $ = cheerio.load(html);
  const stylesheetUrls: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      stylesheetUrls.push(new URL(href, pageResult.finalUrl).toString());
    } catch {
      /* ignore unparsable href */
    }
  });

  const toFetch = stylesheetUrls.slice(0, MAX_STYLESHEETS);
  const stylesheetsSkipped = Math.max(0, stylesheetUrls.length - toFetch.length);

  const stylesheets: FetchedStylesheet[] = [];
  let fetchFailures = 0;
  for (const cssUrl of toFetch) {
    if (bytesUsed >= MAX_TOTAL_BYTES || remaining(deadline) <= 0) {
      fetchFailures += toFetch.length - stylesheets.length - fetchFailures;
      break;
    }
    try {
      const res = await safeFetch(cssUrl, {
        timeoutMs: remaining(deadline),
        maxBytes: MAX_TOTAL_BYTES - bytesUsed,
      });
      if (res.statusCode < 400) {
        bytesUsed += res.body.length;
        stylesheets.push({ url: cssUrl, text: res.body.toString("utf8") });
      } else {
        fetchFailures += 1;
      }
    } catch (err) {
      // A single blocked/failed subresource (e.g. its own SSRF check fails,
      // or it times out) does not fail the whole import — it's recorded as
      // skipped, same as hitting the stylesheet count cap.
      fetchFailures += 1;
    }
  }

  return {
    html,
    stylesheets,
    stylesheetsSkipped: stylesheetsSkipped + fetchFailures,
    bytesUsed,
  };
}

async function checkRobots(url: URL, deadline: number): Promise<void> {
  const robotsUrl = new URL("/robots.txt", url).toString();
  try {
    const res = await safeFetch(robotsUrl, {
      timeoutMs: Math.min(5000, remaining(deadline)),
      maxBytes: 512 * 1024,
    });
    if (res.statusCode >= 400) return; // no robots.txt → allowed
    const rules = parseRobots(res.body.toString("utf8"));
    if (!isPathAllowed(rules, USER_AGENT, url.pathname || "/")) {
      throw new ImportBlockedError(`robots.txt disallows fetching ${url.pathname} for our user agent.`);
    }
  } catch (err) {
    if (err instanceof ImportBlockedError) throw err;
    if (err instanceof SsrfError) throw err;
    // robots.txt fetch failing for any other reason (timeout, network) does
    // not block the import — absence of a readable robots.txt means allowed.
  }
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}
