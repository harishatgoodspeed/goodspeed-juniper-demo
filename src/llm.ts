import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config";
import type { BrandContext } from "./import/types";
import type { Brief, BriefSet, OutputType } from "./pipeline-types";

/**
 * The shape PATCH /api/brands/:id currently persists as approved_context_json
 * (see src/server.ts and public/app.js's approve button). There is no
 * separate "approved images" list yet — only a single approved logo. Until
 * that exists, imageAssetIds is validated as an empty array (see
 * validateReferences below) rather than trusted against nothing.
 */
export interface ApprovedBrandContext {
  logoAssetId: string | null;
  colours: string[];
  fonts: string[];
  /** Freeform voice guidance the owner approved (e.g. "confident, no exclamation points, short sentences"). Empty string if none was given — never invented. */
  voiceNotes: string;
}

export interface GenerateBriefsInput {
  context: ApprovedBrandContext;
  rawContext: BrandContext;
  task: string;
  preset?: string;
}

export interface AnthropicMessagesClient {
  messages: {
    parse: (params: unknown) => Promise<{
      parsed_output: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export class BriefValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefValidationError";
  }
}

/**
 * Thrown when the model referenced a palette hex, font, or asset ID that
 * isn't actually in the brand's approved context. This is the one check that
 * matters most in this file: the model is never trusted to police its own
 * references, because a convincing-looking hex or font name that wasn't
 * actually approved is exactly the kind of fabricated-but-plausible output
 * this whole project is built to avoid. Every reference field is checked
 * here, independently of the Zod shape validation above it.
 */
export class BriefReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefReferenceError";
  }
}

const OUTPUT_TYPES: OutputType[] = ["linkedin_image", "one_pager_pdf", "slide", "post_copy"];

const BriefShape = z.object({
  outputType: z.enum(["linkedin_image", "one_pager_pdf", "slide", "post_copy"]),
  purpose: z.string().min(1),
  audience: z.string().min(1),
  sourcedFactualCopy: z.array(z.string()),
  layoutDirection: z.string().min(1),
  paletteTokenHexes: z.array(z.string()),
  fontFamilies: z.array(z.string()),
  logoAssetId: z.string().nullable(),
  imageAssetIds: z.array(z.string()),
  voiceGuidance: z.string(),
  unknowns: z.array(z.string()),
  postCopyText: z.string().optional(),
});

const BriefsToolInput = z.object({
  briefs: z.array(BriefShape).length(4),
});

function systemPrompt(): string {
  return [
    "You are drafting creative briefs for a brand's marketing assets.",
    "You must produce exactly one brief for each of these output types: " + OUTPUT_TYPES.join(", ") + ".",
    "",
    "Hard rules:",
    "- paletteTokenHexes must only contain hex values copied exactly from the approved palette you are given. Never invent, lighten, darken, or guess at a hex not in that list. Order matters: the renderer reads paletteTokenHexes as [background, primary/brand, body text, accent/CTA] in that position order, so list the approved hexes in that role order (repeat one if you don't have 4 distinct roles to fill, rather than leaving a later slot blank).",
    "- fontFamilies must only contain family names copied exactly from the approved fonts you are given. Never invent a font. Order matters: the renderer reads fontFamilies as [heading, body] in that position order.",
    "- logoAssetId must be exactly the approved logo asset ID you are given, or null if none was given. Never invent an asset ID.",
    "- imageAssetIds must always be an empty array. No image assets are approved for use yet.",
    "- sourcedFactualCopy and postCopyText (for the post_copy brief only) must contain only facts that are explicitly present in the brand description or page excerpt you are given. If a commercial fact (a price, a date, a metric, a partner name, a quote) is not explicitly given to you, do not invent a plausible-sounding one — put a note about the missing fact in that brief's unknowns array instead.",
    "- Never invent testimonials, review scores, or results.",
    "- Voice: write without exclamation points, matching any voice guidance you are given.",
  ].join("\n");
}

function userPrompt(input: GenerateBriefsInput): string {
  const lines = [
    `Task: ${input.task}`,
    input.preset ? `Preset: ${input.preset}` : null,
    "",
    "Approved palette (hex values you may use, verbatim):",
    ...input.context.colours.map((c) => `- ${c}`),
    "",
    "Approved fonts (family names you may use, verbatim):",
    ...input.context.fonts.map((f) => `- ${f}`),
    "",
    `Approved logo asset ID: ${input.context.logoAssetId ?? "none approved"}`,
    "",
    "Approved voice guidance (follow this exactly; if empty, infer a plain, confident voice from the page excerpt only):",
    input.context.voiceNotes || "(none given)",
    "",
    "Brand description (source of facts for sourcedFactualCopy/postCopyText):",
    input.rawContext.description ?? "(none extracted)",
    "",
    "Brand page excerpt (further source of facts):",
    input.rawContext.textExcerpt || "(none extracted)",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

function validateReferences(brief: Brief, context: ApprovedBrandContext): void {
  const approvedColours = new Set(context.colours.map((c) => c.toLowerCase()));
  for (const hex of brief.paletteTokenHexes) {
    if (!approvedColours.has(hex.toLowerCase())) {
      throw new BriefReferenceError(
        `Brief for "${brief.outputType}" referenced an unapproved palette hex: ${hex}`
      );
    }
  }

  const approvedFonts = new Set(context.fonts.map((f) => f.toLowerCase()));
  for (const font of brief.fontFamilies) {
    if (!approvedFonts.has(font.toLowerCase())) {
      throw new BriefReferenceError(`Brief for "${brief.outputType}" referenced an unapproved font: ${font}`);
    }
  }

  if (brief.logoAssetId !== null && brief.logoAssetId !== context.logoAssetId) {
    throw new BriefReferenceError(
      `Brief for "${brief.outputType}" referenced a logo asset that wasn't approved: ${brief.logoAssetId}`
    );
  }

  if (brief.imageAssetIds.length > 0) {
    throw new BriefReferenceError(
      `Brief for "${brief.outputType}" referenced image asset IDs (${brief.imageAssetIds.join(", ")}), but no image assets are approved yet — this field must be empty until the approval flow supports it.`
    );
  }
}

export async function generateBriefs(
  input: GenerateBriefsInput,
  deps: { client?: AnthropicMessagesClient } = {}
): Promise<BriefSet> {
  const client = deps.client ?? requireRealClient();

  const start = process.hrtime.bigint();
  const response = await client.messages.parse({
    model: config.ANTHROPIC_MODEL,
    max_tokens: config.MAX_RUN_TOKENS,
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(input) }],
    output_config: { format: zodOutputFormat(BriefsToolInput) },
  });
  const elapsedMs = Number((process.hrtime.bigint() - start) / 1_000_000n);

  if (!response.parsed_output) {
    throw new BriefValidationError("Model response did not include parsed structured output");
  }

  // The SDK's own output_config.format validation runs against the real API only —
  // re-validate here too so a mocked/misbehaving client can't skip it (same
  // "never trust the model's own claims" rule validateReferences enforces below).
  const parsed = BriefsToolInput.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new BriefValidationError(`Model output failed schema validation: ${parsed.error.message}`);
  }

  const briefs = parsed.data.briefs as Brief[];
  for (const brief of briefs) {
    validateReferences(brief, input.context);
    if (brief.outputType === "post_copy" && !brief.postCopyText) {
      throw new BriefValidationError('The "post_copy" brief is missing postCopyText');
    }
  }

  const gotTypes = new Set(briefs.map((b) => b.outputType));
  for (const t of OUTPUT_TYPES) {
    if (!gotTypes.has(t)) {
      throw new BriefValidationError(`Missing a brief for output type "${t}"`);
    }
  }

  return {
    briefs,
    model: config.ANTHROPIC_MODEL,
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    elapsedMs,
  };
}

function requireRealClient(): AnthropicMessagesClient {
  if (!config.hasAnthropicKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured — set it in .env to generate real briefs.");
  }
  return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) as unknown as AnthropicMessagesClient;
}
