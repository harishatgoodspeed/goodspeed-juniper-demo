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
import { detectTools } from "./detect-tools";
import { parseDeck } from "./deck";
import type { AuditCheck, AuditRequest, AuditResult, AuditSurface } from "./types";

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
  if (!pasted) {
    skipped.push({
      surface: "linkedin",
      reason: "No LinkedIn text was pasted. LinkedIn pages are not fetched.",
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

  const voiceParts: Array<{ surface: AuditSurface; text: string }> = [{ surface: "site", text: siteCopy }];
  if (blogCopy) voiceParts.push({ surface: "blog", text: blogCopy });
  if (linkedinText) voiceParts.push({ surface: "linkedin", text: linkedinText });
  if (deckText) voiceParts.push({ surface: "deck", text: deckText });

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

  const logo = siteContext.logoCandidates.find((candidate) => candidate.kind === "header_img") ??
    siteContext.logoCandidates.find((candidate) => candidate.kind === "favicon" || candidate.kind === "og_image");

  const palette = chromaticHexes(
    siteContext.colours.map((colour) => colour.hex),
    8
  );
  const fallbackPalette = siteContext.colours.map((colour) => colour.hex).slice(0, 6);

  return {
    brand: {
      name: brandName(siteContext, request.siteUrl),
      siteUrl: request.siteUrl,
      ...(logo ? { logoUrl: logo.url } : {}),
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

  return {
    siteUrl,
    ...(blogUrl ? { blogUrl } : {}),
    ...(linkedinText ? { linkedinText } : {}),
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
