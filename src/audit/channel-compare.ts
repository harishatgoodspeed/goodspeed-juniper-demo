/**
 * Fetches each kept public channel and records only what the page showed,
 * next to the same thing from the site.
 */

import { extractBrandContext } from "../import/extract";
import { fetchBrandSource, ImportBlockedError } from "../import/fetch";
import type { BrandContext } from "../import/types";
import { compareHex } from "../review/colour";
import { SsrfError } from "../security/url";
import {
  blockReason,
  channelLabel,
  embedImage,
  readPublicChannel,
  side,
} from "./channels";
import { chromaticHexes } from "./checks";
import type { AuditChannelRef, AuditFinding, AuditSurface } from "./types";

export interface ChannelNotes {
  voiceTexts: Array<{ surface: AuditSurface; text: string }>;
  paletteFindings: AuditFinding[];
  logoFindings: AuditFinding[];
  messageFindings: AuditFinding[];
  skipped: Array<{ surface: string; reason: string }>;
  /** When colours clearly disagree, the palette score should not stay high. */
  paletteCap: number | null;
  logoCap: number | null;
  messageCap: number | null;
}

export async function compareChannels(
  channels: AuditChannelRef[],
  site: BrandContext,
  siteHtmlColours: string[]
): Promise<ChannelNotes> {
  const notes: ChannelNotes = {
    voiceTexts: [],
    paletteFindings: [],
    logoFindings: [],
    messageFindings: [],
    skipped: [],
    paletteCap: null,
    logoCap: null,
    messageCap: null,
  };
  const siteColours = chromaticHexes(siteHtmlColours, 6);
  const siteHeadline = (site.description || site.title || "").trim();
  const siteLogo = site.logoCandidates[0]?.url || null;
  const siteLogoData = await embedImage(siteLogo);

  for (const channel of channels.slice(0, 6)) {
    const label = channelLabel(channel.kind);
    let html = "";
    let fetchedUrl = channel.url;
    try {
      const source = await fetchBrandSource(channel.url);
      html = source.html;
      fetchedUrl = channel.url;
      const page = readPublicChannel(html, fetchedUrl, channel.kind);
      if (page.blocked) {
        notes.skipped.push({ surface: channel.kind, reason: page.reason || blockReason(channel.kind) });
        continue;
      }
      const context = extractBrandContext({
        sourceUrl: fetchedUrl,
        html,
        stylesheets: source.stylesheets,
        stylesheetsSkipped: source.stylesheetsSkipped,
        fetchedAt: new Date().toISOString(),
      });
      page.colours = context.colours.map((colour) => colour.hex);
      if (!page.tagline && context.description) page.tagline = context.description;
      if (!page.name && (context.siteName || context.title)) page.name = context.siteName || context.title;
      page.imageDataUrl = await embedImage(page.imageUrl);
      addPalette(notes, channel.kind, label, channel.url, siteColours, page.colours);
      addLogo(notes, channel.kind, label, channel.url, siteLogo, siteLogoData, page.imageUrl, page.imageDataUrl);
      addMessage(notes, channel.kind, label, channel.url, siteHeadline, page.tagline, site.siteName || site.title, page.name);
      if (page.textExcerpt.trim().split(/\s+/).length >= 12) {
        notes.voiceTexts.push({ surface: channel.kind, text: page.textExcerpt });
      }
    } catch (err) {
      const raw =
        err instanceof ImportBlockedError || err instanceof SsrfError
          ? err.message
          : `${label} could not be read. Nothing from it was used.`;
      const reason = /robots/i.test(raw)
        ? channel.kind === "linkedin"
          ? "LinkedIn did not let us read the public company page. Their robots.txt refuses this fetch, so nothing on that page was read. Paste the text if you want LinkedIn checked."
          : `${label} did not let us read the public page. Their robots.txt refuses this fetch, so nothing on it was read.`
        : raw;
      notes.skipped.push({ surface: channel.kind, reason });
    }
  }
  return notes;
}

function addPalette(
  notes: ChannelNotes,
  kind: AuditChannelRef["kind"],
  label: string,
  url: string,
  siteColours: string[],
  raw: string[]
): void {
  if (isPlatformHost(url)) {
    notes.paletteFindings.push({
      surface: kind,
      detail: `Not assessed on ${label}. The public page is ${label}'s own layout, so its interface colours are not the brand banner.`,
      evidenceUrl: url,
    });
    return;
  }
  const theirs = chromaticHexes(raw, 6);
  if (theirs.length === 0 || siteColours.length === 0) {
    notes.paletteFindings.push({
      surface: kind,
      detail: `Not assessed on ${label}. No colours could be read from the public page to set beside the site palette.`,
      evidenceUrl: url,
    });
    return;
  }
  let furthest = 0;
  for (const hex of theirs) {
    const best = Math.min(...siteColours.map((siteHex) => compareHex(hex, siteHex)));
    if (best > furthest) furthest = best;
  }
  const mismatch = furthest > 12;
  if (mismatch) notes.paletteCap = Math.min(notes.paletteCap ?? 48, 48);
  notes.paletteFindings.push({
    surface: kind,
    detail: mismatch
      ? `The colours read from the public ${label} page are not the site colours.`
      : `The colours read from the public ${label} page sit close to the site palette.`,
    evidenceUrl: url,
    whyItMatters: mismatch
      ? "Colour is the first thing a prospect sees. When it shifts by channel, the brand stops looking like one company."
      : undefined,
    comparison: {
      site: side("Site palette", { swatches: siteColours }),
      other: side(`${label} page`, { swatches: theirs }),
    },
  });
}

function addLogo(
  notes: ChannelNotes,
  kind: AuditChannelRef["kind"],
  label: string,
  url: string,
  siteLogo: string | null,
  siteLogoData: string | null,
  otherLogo: string | null,
  otherLogoData: string | null
): void {
  if (!siteLogo && !otherLogo) return;
  if (!otherLogo) {
    notes.logoFindings.push({
      surface: kind,
      detail: `Not assessed on ${label}. The public page did not publish a logo or cover image we could read.`,
      evidenceUrl: url,
    });
    return;
  }
  notes.logoFindings.push({
    surface: kind,
    detail: siteLogo
      ? `These are the marks each page publishes. This audit does not guess whether the drawings match.`
      : `The ${label} page publishes a mark. No logo was read from the site to set beside it.`,
    evidenceUrl: url,
    whyItMatters: "The mark is how people recognise you at a glance.",
    comparison: {
      site: side("Site logo", { imageUrl: siteLogoData || undefined }),
      other: side(`${label} logo`, { imageUrl: otherLogoData || undefined }),
    },
  });
  if (!siteLogo) notes.logoCap = Math.min(notes.logoCap ?? 62, 62);
}

function addMessage(
  notes: ChannelNotes,
  kind: AuditChannelRef["kind"],
  label: string,
  url: string,
  siteHeadline: string,
  tagline: string | null,
  siteName: string | null,
  pageName: string | null
): void {
  if (!tagline) {
    notes.messageFindings.push({
      surface: kind,
      detail: `Not assessed on ${label}. The public page did not include a tagline or description.`,
      evidenceUrl: url,
    });
    return;
  }
  const shared = overlap(siteHeadline, tagline);
  const token = (siteName || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const haystack = `${pageName || ""} ${tagline}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameMissing = token.length > 3 && !haystack.includes(token);
  const mismatch = shared < 2 || nameMissing;
  if (mismatch) notes.messageCap = Math.min(notes.messageCap ?? 42, 42);
  const detail = nameMissing
    ? `The ${label} page name does not use the site name, and the tagline was read beside the site headline.`
    : mismatch
      ? `The ${label} tagline does not use the same words as the site headline.`
      : `The ${label} tagline shares wording with the site headline.`;
  notes.messageFindings.push({
    surface: kind,
    detail,
    evidenceUrl: url,
    whyItMatters: mismatch
      ? "People should meet the same offer on every channel. When the story shifts, buyers get confused and the work is redone."
      : undefined,
    comparison: {
      site: side("Site headline", { text: siteHeadline || siteName }),
      other: side(`${label} tagline`, { text: tagline }),
    },
  });
}

function isPlatformHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /(^|\.)((youtube|instagram|linkedin)\.com|x\.com|twitter\.com|youtu\.be)$/i.test(host);
  } catch {
    return false;
  }
}

function overlap(left: string, right: string): number {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "our", "into"]);
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !stop.has(word))
    );
  const a = words(left);
  let count = 0;
  for (const word of words(right)) if (a.has(word)) count += 1;
  return count;
}
