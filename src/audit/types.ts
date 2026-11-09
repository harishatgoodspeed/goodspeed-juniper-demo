/**
 * Shared contract for the free brand audit.
 * POST /api/audit returns AuditResult.
 * GET /api/audit/sample returns the Bent Pixels sample AuditResult.
 *
 * deckFile is a base64 JSON upload: { filename?, mimeType, base64 }.
 * LinkedIn is pasted text only. This API does not fetch LinkedIn pages.
 */

export type AuditCheckId = "palette" | "logo" | "type" | "voice" | "message" | "formats";

export type AuditStatus = "ok" | "warn" | "break";

export type AuditSurface = "site" | "blog" | "linkedin" | "deck";

export interface AuditFinding {
  surface: AuditSurface;
  detail: string;
  evidenceUrl?: string;
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
  deckFile?: AuditDeckFile;
  tools: string[];
  formats: string[];
}
