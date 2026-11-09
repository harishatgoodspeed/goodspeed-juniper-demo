/**
 * Finds public channel links on a site, and reads what a fetched channel
 * page actually shows. A login wall is reported as blocked. Nothing here
 * is filled in when the page did not contain it.
 */

import * as cheerio from "cheerio";
import { safeFetch } from "../security/url";
import type { AuditChannelKind, AuditEvidenceSide, DiscoveredChannel } from "./types";

const MAX_CHANNELS = 6;
const MAX_IMAGE_BYTES = 60_000;

const SHARE_HOSTS = /(?:share|sharer|intent|shareArticle|sharing)/i;

export function discoverChannels(html: string, pageUrl: string): DiscoveredChannel[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const $ = cheerio.load(html);
  const found: Array<DiscoveredChannel & { rank: number }> = [];
  const seen = new Set<string>();
  const tokens = base.hostname.replace(/^www\./, "").split(".")[0].split(/[^a-z0-9]+/i).filter((part) => part.length > 2);

  const push = (kind: AuditChannelKind, raw: string, rank: number) => {
    const url = normaliseChannelUrl(kind, raw, base);
    if (!url) return;
    const haystack = url.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (rank > 1 && !tokens.some((token) => haystack.includes(token.toLowerCase()))) return;
    const key = kind + " " + url;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, url, name: channelName(kind, url), rank });
  };

  $("script[type='application/ld+json']").each((_, el) => {
    for (const same of sameAsValues($(el).text())) {
      const kind = kindForUrl(same);
      if (kind) push(kind, same, 0);
    }
  });

  $("header a[href], footer a[href], nav a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const kind = kindForUrl(href);
    if (kind) push(kind, href, 1);
  });

  $("a[href], link[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const kind = kindForUrl(href);
    if (kind) push(kind, href, 2);
  });

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = $(el).text().replace(/\s+/g, " ").trim();
    if (!/^blog$/i.test(label) && !/\/blog\/?$/i.test(href)) return;
    push("blog", href, 1);
  });

  return preferCompany(found).slice(0, MAX_CHANNELS);
}

export interface PublicChannelPage {
  kind: AuditChannelKind;
  url: string;
  fetchedUrl: string;
  blocked: boolean;
  reason: string | null;
  name: string | null;
  tagline: string | null;
  textExcerpt: string;
  colours: string[];
  imageUrl: string | null;
  imageDataUrl: string | null;
}

export function readPublicChannel(html: string, fetchedUrl: string, kind: AuditChannelKind): PublicChannelPage {
  const $ = cheerio.load(html);
  const title = clean($("title").first().text());
  const ogTitle = meta($, "og:title");
  const description = meta($, "og:description") || meta($, "description");
  const text = visibleText($);
  const blocked = isLoginWall(kind, fetchedUrl, title, text, html);
  const imageUrl = abs(meta($, "og:image") || $("link[rel='apple-touch-icon']").attr("href") || "", fetchedUrl);
  return {
    kind,
    url: fetchedUrl,
    fetchedUrl,
    blocked,
    reason: blocked ? blockReason(kind) : null,
    name: blocked ? null : ogTitle || title || null,
    tagline: blocked ? null : description || null,
    textExcerpt: blocked ? "" : text.slice(0, 600),
    colours: [],
    imageUrl: blocked ? null : imageUrl,
    imageDataUrl: null,
  };
}

export function isLoginWall(kind: AuditChannelKind, url: string, title: string, text: string, html: string): boolean {
  const blob = `${url} ${title} ${html.slice(0, 4000)}`.toLowerCase();
  if (/\/(login|uas\/login|authwall|checkpoint|signup|i\/flow\/login)\b/.test(blob)) return true;
  if (kind === "linkedin" && /authwall|join linkedin|sign in/.test(blob) && text.length < 500) return true;
  if ((kind === "x" || kind === "instagram") && /log in|sign up/.test(title.toLowerCase()) && text.length < 400) return true;
  return false;
}

export function blockReason(kind: AuditChannelKind): string {
  if (kind === "linkedin") {
    return "LinkedIn did not show the public company page. It asked for a login, so nothing on that page was read. Paste the text if you want this channel checked.";
  }
  const label = channelLabel(kind);
  return `${label} did not show a public page. Nothing from it was read.`;
}

export async function embedImage(url: string | null): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const result = await safeFetch(url, { timeoutMs: 8000, maxBytes: MAX_IMAGE_BYTES });
    if (result.statusCode >= 400) return null;
    const type = String(result.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(type)) return null;
    if (result.body.length === 0 || result.body.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${result.body.toString("base64")}`;
  } catch {
    return null;
  }
}

export function channelLabel(kind: AuditChannelKind): string {
  if (kind === "linkedin") return "LinkedIn";
  if (kind === "x") return "X";
  if (kind === "instagram") return "Instagram";
  if (kind === "youtube") return "YouTube";
  return "Blog";
}

export function side(caption: string, fields: { text?: string | null; imageUrl?: string | null; swatches?: string[] }): AuditEvidenceSide {
  const out: AuditEvidenceSide = { caption };
  if (fields.text) out.text = fields.text.slice(0, 280);
  if (fields.imageUrl) out.imageUrl = fields.imageUrl;
  if (fields.swatches && fields.swatches.length) out.swatches = fields.swatches.slice(0, 6);
  return out;
}

function kindForUrl(raw: string): AuditChannelKind | null {
  const value = raw.trim();
  if (!value || SHARE_HOSTS.test(value)) return null;
  let host = "";
  let path = value;
  try {
    const url = new URL(value, "https://example.test");
    host = url.hostname.replace(/^www\./, "").toLowerCase();
    path = url.pathname;
  } catch {
    return null;
  }
  if (host.endsWith("linkedin.com") && /\/(company|school|showcase)\//i.test(path)) return "linkedin";
  if ((host === "twitter.com" || host === "x.com" || host === "mobile.twitter.com") && profilePath(path)) return "x";
  if (host === "instagram.com" && profilePath(path) && !path.startsWith("/p/") && !path.startsWith("/reel/")) return "instagram";
  if ((host === "youtube.com" || host === "m.youtube.com") && /^\/(@|channel\/|c\/|user\/)/.test(path)) return "youtube";
  if (/\/blog\/?$/i.test(path) || /\/journal\/?$/i.test(path)) return "blog";
  return null;
}

function profilePath(path: string): boolean {
  const name = path.split("/").filter(Boolean)[0] || "";
  if (!name || name.length < 2) return false;
  return !/^(share|intent|home|explore|search|hashtag|i)$/i.test(name);
}

function normaliseChannelUrl(kind: AuditChannelKind, raw: string, base: URL): string | null {
  if (kind !== kindForUrl(raw) && !(kind === "blog" && /blog/i.test(raw))) return null;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    if (kind === "blog" && url.hostname !== base.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function channelName(kind: AuditChannelKind, url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (kind === "linkedin") return parts[1] || parsed.hostname;
    if (kind === "youtube" && parts[0]?.startsWith("@")) return parts[0];
    if (kind === "blog") return parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/$/, "");
    return parts[0] || parsed.hostname;
  } catch {
    return url;
  }
}

function preferCompany(channels: Array<DiscoveredChannel & { rank: number }>): DiscoveredChannel[] {
  const byKind = new Map<AuditChannelKind, DiscoveredChannel & { rank: number }>();
  for (const channel of channels) {
    const current = byKind.get(channel.kind);
    if (!current || channel.rank < current.rank) {
      byKind.set(channel.kind, channel);
      continue;
    }
    if (channel.rank === current.rank && channel.kind === "linkedin" && /\/company\//.test(channel.url) && !/\/company\//.test(current.url)) {
      byKind.set(channel.kind, channel);
    }
  }
  return [...byKind.values()].map(({ kind, url, name }) => ({ kind, url, name }));
}

function sameAsValues(text: string): string[] {
  const urls: string[] = [];
  const pattern = /"sameAs"\s*:\s*(\[[^\]]*\]|"[^"]+")/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const body = match[1];
    const found = body.match(/https?:\/\/[^"\s]+/g) || [];
    urls.push(...found);
  }
  return urls;
}

function meta($: cheerio.CheerioAPI, name: string): string | null {
  const node = $(`meta[property='${name}'], meta[name='${name}']`).attr("content");
  return clean(node || "") || null;
}

function visibleText($: cheerio.CheerioAPI): string {
  $("script, style, noscript").remove();
  return $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function abs(value: string, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
