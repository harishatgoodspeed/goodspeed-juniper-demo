/**
 * One logged-out read of a public LinkedIn company page.
 * A normal browser user agent, no cookies, no proxy, no login.
 * The parsed result is cached by URL so an audit does not fetch it twice.
 */

import * as cheerio from "cheerio";
import { chromium } from "playwright";

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface LinkedInGuest {
  ok: boolean;
  status: number;
  /** Starts with "Couldn't read" when ok is false. */
  reason: string | null;
  name: string | null;
  tagline: string | null;
  about: string | null;
  imageUrl: string | null;
}

const cache = new Map<string, LinkedInGuest>();

export function parseLinkedInGuest(html: string, status: number, finalUrl: string): LinkedInGuest {
  if (status === 999 || status === 403 || status === 401 || (status >= 400 && status !== 0)) {
    return fail(`Couldn't read. LinkedIn returned ${status}, so nothing on that page was used.`);
  }
  const blob = `${finalUrl} ${html.slice(0, 6000)}`.toLowerCase();
  if (/authwall|\/login|\/uas\/login|join linkedin/.test(blob) && !/property="og:description"/i.test(html)) {
    return fail("Couldn't read. LinkedIn showed a login wall, so nothing on that page was used.");
  }
  const $ = cheerio.load(html);
  const name = meta($, "og:title");
  const tagline = meta($, "og:description") || meta($, "description");
  const imageUrl = abs(meta($, "og:image") || "", finalUrl);
  const about = aboutText($);
  if (!name && !tagline && !about && !imageUrl) {
    return fail("Couldn't read. The public page had no title, tagline, or logo, so nothing was used.");
  }
  return { ok: true, status, reason: null, name, tagline, about, imageUrl };
}

export async function fetchLinkedInGuest(url: string): Promise<LinkedInGuest> {
  const key = url.split("?")[0];
  const cached = cache.get(key);
  if (cached) return cached;
  let result: LinkedInGuest;
  try {
    result = await loadOnce(url);
  } catch {
    result = fail("Couldn't read. The public LinkedIn page did not load, so nothing was used.");
  }
  cache.set(key, result);
  return result;
}

async function loadOnce(url: string): Promise<LinkedInGuest> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: CHROME_UA, locale: "en-GB" });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const status = response?.status() ?? 0;
    const html = await page.content();
    return parseLinkedInGuest(html, status, page.url());
  } finally {
    await browser.close();
  }
}

function fail(reason: string): LinkedInGuest {
  return { ok: false, status: 0, reason, name: null, tagline: null, about: null, imageUrl: null };
}

function meta($: cheerio.CheerioAPI, name: string): string | null {
  const value = $(`meta[property='${name}'], meta[name='${name}']`).attr("content") || "";
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function aboutText($: cheerio.CheerioAPI): string | null {
  let about: string | null = null;
  $("h1, h2, h3").each((_, el) => {
    if (about) return;
    if (!/^about\b/i.test($(el).text().replace(/\s+/g, " ").trim())) return;
    const next = $(el).next().text().replace(/\s+/g, " ").trim();
    if (next.length >= 40) about = next.slice(0, 500);
  });
  return about;
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
