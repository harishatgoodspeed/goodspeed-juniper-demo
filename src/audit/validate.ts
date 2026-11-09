import { z } from "zod";
import type { AuditCheckId, AuditResult } from "./types";

const CHECK_IDS = ["palette", "logo", "type", "voice", "message", "formats"] as const satisfies readonly AuditCheckId[];

const score = z.number().int().min(0).max(100);

const SURFACES = ["site", "blog", "linkedin", "deck", "x", "instagram", "youtube"] as const;

const EvidenceSideSchema = z
  .object({
    caption: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(400).optional(),
    imageUrl: z.string().trim().min(1).max(90_000).optional(),
    swatches: z.array(z.string().trim().min(4).max(20)).max(8).optional(),
  })
  .strict();

const FindingSchema = z
  .object({
    surface: z.enum(SURFACES),
    detail: z.string().trim().min(1).max(2000),
    evidenceUrl: z.string().trim().min(1).max(2000).optional(),
    whyItMatters: z.string().trim().min(1).max(400).optional(),
    comparison: z
      .object({
        site: EvidenceSideSchema,
        other: EvidenceSideSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const CheckSchema = z
  .object({
    id: z.enum(CHECK_IDS),
    label: z.string().trim().min(1).max(80),
    score,
    status: z.enum(["ok", "warn", "break"]),
    findings: z.array(FindingSchema).max(16),
  })
  .strict();

const BreakSchema = z
  .object({
    rank: z.number().int().min(1).max(5),
    title: z.string().trim().min(1).max(140),
    surface: z.enum(SURFACES),
    whyItMatters: z.string().trim().min(1).max(500),
    cost: z.string().trim().min(1).max(300),
  })
  .strict();

export const AuditResultSchema = z
  .object({
    brand: z
      .object({
        name: z.string().trim().min(1).max(160),
        siteUrl: z.string().trim().min(1).max(500),
        logoUrl: z.string().max(60_000).optional(),
        palette: z.array(z.string().max(40)).max(12),
        fonts: z.array(z.string().trim().min(1).max(80)).max(8),
        voiceSummary: z.string().max(500),
      })
      .strict(),
    overallScore: score,
    checks: z.array(CheckSchema).length(6),
    topBreaks: z.array(BreakSchema).max(5),
    toolsAndFormats: z
      .object({
        detected: z.array(z.string().trim().min(1).max(80)).max(16),
        /** Tools first, then formats, in one list. */
        requested: z.array(z.string().trim().min(1).max(80)).max(16),
      })
      .strict(),
    skippedSurfaces: z
      .array(
        z
          .object({
            surface: z.string().trim().min(1).max(40),
            reason: z.string().trim().min(1).max(500),
          })
          .strict()
      )
      .max(12),
    generatedAt: z.string().trim().min(1).max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.checks.forEach((check, index) => {
      if (check.id !== CHECK_IDS[index]) {
        ctx.addIssue({ code: "custom", message: "Checks are in the wrong order.", path: ["checks", index, "id"] });
      }
    });
  });

export function parseAuditResult(input: unknown): { ok: true; value: AuditResult } | { ok: false; message: string } {
  const parsed = AuditResultSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "The audit result is not in the expected shape." };
  }
  return { ok: true, value: parsed.data };
}
