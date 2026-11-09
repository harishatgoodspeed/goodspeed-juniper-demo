/**
 * Runs one free brand audit. Fetches the site (and one optional blog page)
 * through the existing SSRF-safe importer, then scores the six checks.
 * LinkedIn is pasted text only. A deck is parsed locally when the upload can be read.
 */

import { extractBrandContext } from "../import/extract";
import { fetchBrandSource, ImportBlockedError, type BrandSource } from "../import/fetch";
import type { BrandContext, FontCandidate } from "../import/types";
import { SsrfError, validateUrlSyntax } from "../security/url";
import {
  chromaticHexes,
  googleFontFamilies,
  makeCheck,
  overallFromChecks,
  rankBreaks,
  scoreFormats,
  scoreLogo,
  scoreMessage,
  scorePalette,
  scoreType,
  scoreVoice,
  summariseVoice,
  uniqueFontNames,
  type DeckFormatSignal,
} from "./checks";
import { compareChannels } from "./channel-compare";
import { bestLogoUrl } from "./channels";
import { detectTools } from "./detect-tools";
import { parseDeck } from "./deck";
import type { AuditCheck, AuditFinding, AuditRequest, AuditResult, AuditSurface } from "./types";

const MAX_LIST = 20;
const MAX_ITEM = 80;
const MAX_LINKEDIN = 12_000;
const MAX_DECK_BYTES = 6 * 1024 * 1024;

export class AuditRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuditRequestError";
    this.status = status;
    this.code = code;
  }
}

export interface AuditDeps {
  fetchSource?: (rawUrl: string) => Promise<BrandSource>;
  now?: () => Date;
}

export async function runAudit(body: unknown, deps: AuditDeps = {}): Promise<AuditResult> {
  const request = parseAuditBody(body);
  const fetchSource = deps.fetchSource ?? fetchBrandSource;
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();

  let site: BrandSource;
  try {
    site = await fetchSource(request.siteUrl);
  } catch (err) {
    throw new AuditRequestError(422, "site_unreadable", surfaceFailure("site", err));
  }

  const siteContext = extractBrandContext({
    sourceUrl: request.siteUrl,
    html: site.html,
    stylesheets: site.stylesheets,
    stylesheetsSkipped: site.stylesheetsSkipped,
    fetchedAt: generatedAt,
  });

  const skipped: Array<{ surface: string; reason: string }> = [];

  let blogContext: BrandContext | null = null;
  if (!request.blogUrl) {
    skipped.push({ surface: "blog", reason: "No blog URL was provided." });
  } else {
    try {
      const blog = await fetchSource(request.blogUrl);
      blogContext = extractBrandContext({
        sourceUrl: request.blogUrl,
        html: blog.html,
        stylesheets: blog.stylesheets,
        stylesheetsSkipped: blog.stylesheetsSkipped,
        fetchedAt: generatedAt,
      });
    } catch (err) {
      skipped.push({ surface: "blog", reason: surfaceFailure("blog", err) });
    }
  }

  let linkedinText: string | null = null;
  const pasted = request.linkedinText?.trim() ?? "";
  const keptLinkedIn = (request.channels || []).some((channel) => channel.kind === "linkedin");
  if (!pasted && !keptLinkedIn) {
    skipped.push({
      surface: "linkedin",
      reason: "No LinkedIn page was kept, and no post text was pasted.",
    });
  } else if (isBareUrl(pasted)) {
    skipped.push({
      surface: "linkedin",
      reason: "A link was pasted. LinkedIn pages are not fetched. Paste the post text.",
    });
  } else {
    linkedinText = pasted.slice(0, MAX_LINKEDIN);
  }

  let deckSignal: DeckFormatSignal | null = null;
  let deckText: string | null = null;
  let deckColours: string[] | null = null;
  let deckFonts: string[] | null = null;
  if (!request.deckFile) {
    skipped.push({ surface: "deck", reason: "No deck was uploaded." });
  } else {
    const buffer = decodeDeck(request.deckFile.base64);
    const parsed = parseDeck(buffer, request.deckFile.mimeType, request.deckFile.filename ?? "");
    if (!parsed.ok) {
      skipped.push({ surface: "deck", reason: parsed.reason });
    } else {
      deckText = parsed.deck.text;
      deckColours = parsed.deck.colours;
      deckFonts = parsed.deck.fonts;
      deckSignal = {
        slideCount: parsed.deck.slideCount,
        colours: parsed.deck.colours,
        slideSizes: parsed.deck.slideSizes,
        textLength: parsed.deck.text.trim().length,
      };
    }
  }

  const siteFonts = fontNames(siteContext);
  const blogFonts = blogContext ? fontNames(blogContext) : null;
  const siteCopy = [siteContext.description, siteContext.textExcerpt].filter(Boolean).join(" ");
  const blogCopy = blogContext ? [blogContext.description, blogContext.textExcerpt].filter(Boolean).join(" ") : "";

  const channelNotes = await compareChannels(
    request.channels || [],
    siteContext,
    siteContext.colours.map((colour) => colour.hex),
    request.screenshots || [],
    site.html
  );
  skipped.push(...channelNotes.skipped);

  const voiceParts: Array<{ surface: AuditSurface; text: string }> = [{ surface: "site", text: siteCopy }];
  if (blogCopy) voiceParts.push({ surface: "blog", text: blogCopy });
  if (linkedinText) voiceParts.push({ surface: "linkedin", text: linkedinText });
  if (deckText) voiceParts.push({ surface: "deck", text: deckText });
  for (const part of channelNotes.voiceTexts) {
    if (part.surface === "blog" && blogCopy) continue;
    if (!voiceParts.some((existing) => existing.surface === part.surface && existing.text === part.text)) {
      voiceParts.push(part);
    }
  }

  const messageParts = voiceParts.filter((part) => part.surface !== "site");

  const checks: AuditCheck[] = [
    scorePalette({
      siteColours: siteContext.colours.map((colour) => colour.hex),
      blogColours: blogContext ? blogContext.colours.map((colour) => colour.hex) : null,
      deckColours,
    }),
    scoreLogo(siteContext.logoCandidates),
    scoreType({
      siteFonts,
      blogFonts,
      deckFonts,
      googleFonts: siteContext.googleFontsLinks.length > 0,
    }),
    scoreVoice(voiceParts),
    scoreMessage(siteCopy, messageParts),
    scoreFormats(deckSignal),
  ];
  checks[0] = withChannelFindings(checks[0], channelNotes.paletteFindings, channelNotes.paletteCap);
  checks[1] = withChannelFindings(checks[1], channelNotes.logoFindings, channelNotes.logoCap);
  checks[4] =
    channelNotes.storyRows.length > 1
      ? makeCheck("message", channelNotes.messageCap ?? 88, channelNotes.messageFindings.slice(0, 12))
      : withChannelFindings(checks[4], channelNotes.messageFindings, channelNotes.messageCap);

  const logo = bestLogoUrl(siteContext.logoCandidates);

  const palette = chromaticHexes(
    siteContext.colours.map((colour) => colour.hex),
    8
  );
  const fallbackPalette = siteContext.colours.map((colour) => colour.hex).slice(0, 6);

  return {
    brand: {
      name: brandName(siteContext, request.siteUrl),
      siteUrl: request.siteUrl,
      ...(channelNotes.siteLogoData ? { logoUrl: channelNotes.siteLogoData } : logo ? { logoUrl: logo } : {}),
      palette: palette.length > 0 ? palette : fallbackPalette,
      fonts: siteFonts.slice(0, 8),
      voiceSummary: summariseVoice(siteCopy),
    },
    overallScore: overallFromChecks(checks),
    checks,
    topBreaks: rankBreaks(checks),
    toolsAndFormats: {
      detected: detectTools(site.html),
      requested: dedupe([...request.tools, ...request.formats]),
    },
    skippedSurfaces: skipped,
    ...(channelNotes.storyRows.length > 1
      ? {
          storyChanges: channelNotes.storyRows,
          ...(channelNotes.storyVerdict ? { storyVerdict: channelNotes.storyVerdict } : {}),
        }
      : {}),
    generatedAt,
  };
}

function fontNames(context: BrandContext): string[] {
  const declared = context.fonts.map((font: FontCandidate) => font.family);
  const linked = context.googleFontsLinks.flatMap(googleFontFamilies);
  return uniqueFontNames([...declared, ...linked]);
}

function brandName(context: BrandContext, siteUrl: string): string {
  if (context.siteName) return context.siteName.slice(0, 120);
  if (context.title) {
    const head = context.title.split(/\s+[|\-]\s+/)[0]?.trim();
    if (head) return head.slice(0, 120);
  }
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Untitled brand";
  }
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function withChannelFindings(check: AuditCheck, findings: AuditFinding[], cap: number | null): AuditCheck {
  if (findings.length === 0 && cap == null) return check;
  const score = cap == null ? check.score : Math.min(check.score, cap);
  return makeCheck(check.id, score, [...check.findings, ...findings].slice(0, 12));
}

function parseChannels(value: unknown): AuditRequest["channels"] {
  if (!Array.isArray(value)) return undefined;
  const kinds = new Set(["linkedin", "x", "instagram", "youtube", "blog"]);
  const channels: NonNullable<AuditRequest["channels"]> = [];
  for (const item of value.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!kinds.has(kind) || !url) continue;
    try {
      validateUrlSyntax(url);
    } catch (err) {
      throw new AuditRequestError(400, "invalid_url", err instanceof Error ? err.message : "Invalid channel URL");
    }
    channels.push({ kind: kind as NonNullable<AuditRequest["channels"]>[number]["kind"], url });
  }
  return channels.length ? channels : undefined;
}

function parseScreenshots(value: unknown): AuditRequest["screenshots"] {
  if (!Array.isArray(value)) return undefined;
  const kinds = new Set(["linkedin", "x", "instagram"]);
  const shots: NonNullable<AuditRequest["screenshots"]> = [];
  for (const item of value.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    const base64 = typeof record.base64 === "string" ? record.base64.trim() : "";
    if (!kinds.has(kind) || !/^image\/(png|jpeg|webp|gif)$/.test(mimeType) || !base64) continue;
    if (base64.length > 6_000_000) {
      throw new AuditRequestError(400, "invalid_body", "That screenshot is too large. Use an image under 4 MB.");
    }
    shots.push({
      kind: kind as "linkedin" | "x" | "instagram",
      mimeType,
      base64,
      ...(typeof record.filename === "string" ? { filename: record.filename.slice(0, 120) } : {}),
    });
  }
  return shots.length ? shots : undefined;
}

function isBareUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function surfaceFailure(surface: string, err: unknown): string {
  if (err instanceof ImportBlockedError || err instanceof SsrfError) return err.message;
  if (err instanceof AuditRequestError) return err.message;
  return surface === "site"
    ? "The site could not be read. Check the URL and try again."
    : "The blog could not be read. The rest of the audit continued without it.";
}

function decodeDeck(base64: string): Buffer {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0 || buffer.length > MAX_DECK_BYTES) {
    throw new AuditRequestError(400, "invalid_body", "The deck is empty or larger than 6 MB.");
  }
  return buffer;
}

export function parseAuditBody(body: unknown): AuditRequest {
  if (!body || typeof body !== "object") {
    throw new AuditRequestError(400, "invalid_body", "Send a site URL, at least one tool, and at least one format.");
  }
  const record = body as Record<string, unknown>;
  const siteUrl = typeof record.siteUrl === "string" ? record.siteUrl.trim() : "";
  if (!siteUrl) {
    throw new AuditRequestError(400, "invalid_body", "A site URL is required.");
  }
  try {
    validateUrlSyntax(siteUrl);
  } catch (err) {
    throw new AuditRequestError(400, "invalid_url", err instanceof Error ? err.message : "Invalid URL");
  }

  let blogUrl: string | undefined;
  if (typeof record.blogUrl === "string" && record.blogUrl.trim()) {
    blogUrl = record.blogUrl.trim();
    try {
      validateUrlSyntax(blogUrl);
    } catch (err) {
      throw new AuditRequestError(400, "invalid_url", err instanceof Error ? err.message : "Invalid blog URL");
    }
  }

  let linkedinText: string | undefined;
  if (typeof record.linkedinText === "string" && record.linkedinText.trim()) {
    if (record.linkedinText.length > 20_000) {
      throw new AuditRequestError(400, "invalid_body", "Paste a shorter LinkedIn excerpt.");
    }
    linkedinText = record.linkedinText;
  }

  const tools = stringList(record.tools, "tool");
  const formats = stringList(record.formats, "format");
  if (tools.length === 0 || formats.length === 0) {
    throw new AuditRequestError(400, "invalid_body", "Choose at least one tool and one format.");
  }

  let deckFile: AuditRequest["deckFile"];
  if (record.deckFile != null) {
    if (typeof record.deckFile !== "object") {
      throw new AuditRequestError(400, "invalid_body", "The deck upload must include a mime type and base64 data.");
    }
    const deck = record.deckFile as Record<string, unknown>;
    const mimeType = typeof deck.mimeType === "string" ? deck.mimeType.trim() : "";
    const base64 = typeof deck.base64 === "string" ? deck.base64.trim() : "";
    const filename = typeof deck.filename === "string" ? deck.filename.trim().slice(0, 200) : undefined;
    if (!mimeType || !base64) {
      throw new AuditRequestError(400, "invalid_body", "The deck upload must include a mime type and base64 data.");
    }
    const allowed =
      mimeType === "application/pdf" ||
      mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      mimeType === "application/vnd.ms-powerpoint" ||
      (mimeType === "application/octet-stream" && /\.(pdf|pptx|ppt)$/i.test(filename ?? ""));
    if (!allowed) {
      throw new AuditRequestError(400, "invalid_body", "Upload a PDF or a PPTX. Other deck files are not read.");
    }
    deckFile = { mimeType, base64, ...(filename ? { filename } : {}) };
  }

  const channels = parseChannels(record.channels);
  const screenshots = parseScreenshots(record.screenshots);

  return {
    siteUrl,
    ...(blogUrl ? { blogUrl } : {}),
    ...(linkedinText ? { linkedinText } : {}),
    ...(channels ? { channels } : {}),
    ...(screenshots ? { screenshots } : {}),
    ...(deckFile ? { deckFile } : {}),
    tools,
    formats,
  };
}

function stringList(value: unknown, label: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new AuditRequestError(400, "invalid_body", `The ${label} list must be an array of short names.`);
  }
  if (value.length > MAX_LIST) {
    throw new AuditRequestError(400, "invalid_body", `Send at most ${MAX_LIST} ${label}s.`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > MAX_ITEM) {
      throw new AuditRequestError(400, "invalid_body", `Each ${label} must be a short name.`);
    }
    return item.trim();
  });
}
