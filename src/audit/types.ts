/**
 * Shared contract for the free brand audit.
 * POST /api/audit returns AuditResult.
 * GET /api/audit/sample returns the Bent Pixels sample AuditResult.
 *
 * deckFile is a base64 JSON upload: { filename?, mimeType, base64 }.
 * channels are public pages discovered on the site and kept by the visitor.
 * LinkedIn is fetched as a public company page. A login wall is not treated as content.
 */

export type AuditCheckId = "palette" | "logo" | "type" | "voice" | "message" | "formats";

export type AuditStatus = "ok" | "warn" | "break";

export type AuditSurface = "site" | "blog" | "linkedin" | "deck" | "x" | "instagram" | "youtube" | "meta";

export type AuditChannelKind = "linkedin" | "x" | "instagram" | "youtube" | "blog";

export interface AuditScreenshot {
  kind: "linkedin" | "x" | "instagram";
  mimeType: string;
  base64: string;
  filename?: string;
}

export interface AuditChannelRef {
  kind: AuditChannelKind;
  url: string;
}

/** A public channel link read from the site. name is the handle or host, not a guess. */
export interface DiscoveredChannel {
  kind: AuditChannelKind;
  url: string;
  name: string;
}

/** One side of a side by side comparison. Only fields that were actually read. */
export interface AuditEvidenceSide {
  caption: string;
  text?: string;
  /** A normal URL, or a data URL when the image was already fetched. */
  imageUrl?: string;
  swatches?: string[];
}

export interface AuditFinding {
  surface: AuditSurface;
  detail: string;
  evidenceUrl?: string;
  whyItMatters?: string;
  comparison?: {
    site: AuditEvidenceSide;
    other: AuditEvidenceSide;
  };
}

export interface AuditCheck {
  id: AuditCheckId;
  label: string;
  /** Integer from 0 to 100. */
  score: number;
  status: AuditStatus;
  findings: AuditFinding[];
}

export interface AuditTopBreak {
  rank: number;
  title: string;
  surface: AuditSurface;
  whyItMatters: string;
  /** Plain language such as lost trust or rework. Never money or an invented figure. */
  cost: string;
}

export interface AuditBrand {
  name: string;
  siteUrl: string;
  logoUrl?: string;
  palette: string[];
  fonts: string[];
  voiceSummary: string;
}

export interface AuditResult {
  brand: AuditBrand;
  /** Integer from 0 to 100. */
  overallScore: number;
  checks: AuditCheck[];
  /** At most 5. */
  topBreaks: AuditTopBreak[];
  toolsAndFormats: {
    detected: string[];
    requested: string[];
  };
  skippedSurfaces: Array<{ surface: string; reason: string }>;
  generatedAt: string;
}

export interface AuditDeckFile {
  filename?: string;
  mimeType: string;
  base64: string;
}

export interface AuditRequest {
  siteUrl: string;
  blogUrl?: string;
  linkedinText?: string;
  /** Public channel pages the visitor kept. */
  channels?: AuditChannelRef[];
  /** Screenshots for channels whose public page could not be read. */
  screenshots?: AuditScreenshot[];
  deckFile?: AuditDeckFile;
  tools: string[];
  formats: string[];
}
