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
  bestLogoUrl,
  blockReason,
  channelLabel,
  embedImage,
  readPublicChannel,
  side,
} from "./channels";
import { chromaticHexes } from "./checks";
import { fetchLinkedInGuest } from "./linkedin-guest";
import { searchMetaAds } from "./meta-ads";
import { readChannelScreenshot } from "./screenshot-read";
import type { AuditChannelRef, AuditFinding, AuditScreenshot, AuditSurface } from "./types";

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
  siteLogoData: string | null;
}

export async function compareChannels(
  channels: AuditChannelRef[],
  site: BrandContext,
  siteHtmlColours: string[],
  screenshots: AuditScreenshot[] = [],
  siteHtml = ""
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
    siteLogoData: null,
  };
  const siteColours = chromaticHexes(siteHtmlColours, 6);
  const siteHeadline = (site.description || site.title || "").trim();
  const siteLogo = bestLogoUrl(site.logoCandidates);
  const siteLogoData = await embedImage(siteLogo);
  notes.siteLogoData = siteLogoData;

  for (const channel of channels.slice(0, 6)) {
    const label = channelLabel(channel.kind);
    const shot = screenshots.find((item) => item.kind === channel.kind);
    if (channel.kind === "linkedin") {
      await readLinkedIn(notes, channel, label, siteColours, siteHeadline, site.siteName || site.title, siteLogo, siteLogoData, shot);
      continue;
    }
    let html = "";
    let fetchedUrl = channel.url;
    try {
      const source = await fetchBrandSource(channel.url);
      html = source.html;
      fetchedUrl = channel.url;
      const page = readPublicChannel(html, fetchedUrl, channel.kind);
      if (page.blocked) {
        if (shot && (channel.kind === "x" || channel.kind === "instagram")) {
          await addScreenshot(notes, channel.kind, label, shot, siteColours, siteHeadline, siteLogo, siteLogoData);
        } else {
          const reason = page.reason || blockReason(channel.kind);
          notes.skipped.push({
            surface: channel.kind,
            reason: reason.startsWith("Couldn't read") ? reason : `Couldn't read. ${reason}`,
          });
        }
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
      const blocked = /robots/i.test(raw)
        ? `Couldn't read. ${label} did not let us read the public page. Their robots.txt refuses this fetch, so nothing on it was read.`
        : raw.startsWith("Couldn't read")
          ? raw
          : `Couldn't read. ${raw}`;
      if (shot && (channel.kind === "x" || channel.kind === "instagram")) {
        await addScreenshot(notes, channel.kind, label, shot, siteColours, siteHeadline, siteLogo, siteLogoData);
      } else {
        notes.skipped.push({ surface: channel.kind, reason: blocked });
      }
    }
  }

  const meta = await searchMetaAds(site.siteName || site.title || "the brand", siteHtml);
  if (!meta.assessed) {
    notes.skipped.push({ surface: "meta", reason: meta.reason });
  } else if (meta.ads.length === 0) {
    notes.messageFindings.push({
      surface: "meta",
      detail: "Not assessed. The Meta Ad Library returned no ads for this name in the EU countries that were queried.",
    });
  } else {
    const ad = meta.ads[0];
    const copy = [ad.title, ad.body].filter(Boolean).join(" ");
    notes.messageFindings.push({
      surface: "meta",
      detail: copy
        ? "This ad copy was returned by the Meta Ad Library for ads shown in the EU."
        : "Not assessed. The Meta Ad Library row had no copy to set beside the site headline.",
      evidenceUrl: ad.snapshotUrl || undefined,
      whyItMatters: copy
        ? "People should meet the same offer on the site and in the ads. When the story shifts, buyers get confused."
        : undefined,
      comparison: copy
        ? {
            site: side("Site headline", { text: siteHeadline, swatches: siteColours }),
            other: side("Meta ad", { text: copy }),
          }
        : undefined,
    });
  }
  return notes;
}

async function readLinkedIn(
  notes: ChannelNotes,
  channel: AuditChannelRef,
  label: string,
  siteColours: string[],
  siteHeadline: string,
  siteName: string | null,
  siteLogo: string | null,
  siteLogoData: string | null,
  shot: AuditScreenshot | undefined
): Promise<void> {
  const guest = await fetchLinkedInGuest(channel.url);
  if (!guest.ok) {
    if (shot) {
      await addScreenshot(notes, "linkedin", label, shot, siteColours, siteHeadline, siteLogo, siteLogoData);
      return;
    }
    notes.skipped.push({
      surface: "linkedin",
      reason: guest.reason || "Couldn't read. LinkedIn did not return a public page.",
    });
    return;
  }
  const logoData = await embedImage(guest.imageUrl);
  if (guest.imageUrl || siteLogoData) {
    notes.logoFindings.push({
      surface: "linkedin",
      detail: "These are the marks the site and the public LinkedIn page publish.",
      evidenceUrl: channel.url,
      whyItMatters: "The mark is how people recognise you at a glance.",
      comparison: {
        site: side("Site logo", { imageUrl: siteLogoData || undefined }),
        other: side("LinkedIn logo", { imageUrl: logoData || undefined }),
      },
    });
  }
  const tagline = guest.tagline;
  if (tagline) {
    addMessage(notes, "linkedin", label, channel.url, siteHeadline, tagline, siteName, guest.name);
  } else {
    notes.messageFindings.push({
      surface: "linkedin",
      detail: "Not assessed. The public LinkedIn page had no tagline.",
      evidenceUrl: channel.url,
    });
  }
  const about = guest.about;
  if (about && about.split(/\s+/).length >= 12) {
    notes.voiceTexts.push({ surface: "linkedin", text: about });
  }
}

async function addScreenshot(
  notes: ChannelNotes,
  kind: AuditScreenshot["kind"],
  label: string,
  shot: AuditScreenshot,
  siteColours: string[],
  siteHeadline: string,
  siteLogo: string | null,
  siteLogoData: string | null
): Promise<void> {
  const read = await readChannelScreenshot(shot.base64, shot.mimeType);
  const text = [read.name, read.tagline].filter(Boolean).join(". ");
  notes.logoFindings.push({
    surface: kind,
    detail: text
      ? `From your screenshot. ${text}`
      : "From your screenshot. The palette was read from the image. No name or tagline text could be read.",
    whyItMatters: "This is the page you supplied, because the public page could not be read.",
    comparison: {
      site: side("Site logo", { imageUrl: siteLogoData || undefined, text: siteHeadline, swatches: siteColours }),
      other: side("From your screenshot", {
        imageUrl: read.previewDataUrl,
        text: text || null,
        swatches: read.colours,
      }),
    },
  });
  if (read.colours.length && siteColours.length) {
    let furthest = 0;
    for (const hex of read.colours) {
      const best = Math.min(...siteColours.map((siteHex) => compareHex(hex, siteHex)));
      if (best > furthest) furthest = best;
    }
    if (furthest > 18) notes.paletteCap = Math.min(notes.paletteCap ?? 55, 55);
    notes.paletteFindings.push({
      surface: kind,
      detail: "From your screenshot. These are colours sampled from the image, beside the site palette.",
      comparison: {
        site: side("Site palette", { swatches: siteColours }),
        other: side("From your screenshot", { swatches: read.colours }),
      },
    });
  }
  void siteLogo;
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
  const token = ((siteName || "").toLowerCase().match(/[a-z0-9]{4,}/) || [""])[0];
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
