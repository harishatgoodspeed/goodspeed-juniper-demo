import dotenv from "dotenv";
import { z } from "zod";

const isTest = process.env.NODE_ENV === "test";

// In test mode, the environment comes entirely from `node --env-file=.env.test`
// (see package.json's "test" script) so test runs are reproducible and never
// depend on whatever happens to be in a developer's real local .env. Loading
// dotenv here too would silently fill in anything --env-file left unset
// (dotenv only sets variables that aren't already present) straight from the
// real .env file — exactly the bug this guard prevents.
if (!isTest) {
  dotenv.config();
}

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_PATH: z.string().default("./data/app.db"),
  ASSET_DIR: z.string().default("./data/assets"),

  // No login step — every visitor gets an anonymous, isolated workspace (see
  // src/security/session.ts). SESSION_SECRET still signs those session
  // cookies, so it stays required in production; a dev fallback keeps local
  // setup frictionless without ever allowing that relaxed default in prod.
  SESSION_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),

  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  DAILY_RUN_LIMIT: z.coerce.number().int().positive().default(20),
  MAX_RUN_TOKENS: z.coerce.number().int().positive().default(20000),
  COLOUR_DELTA_E_THRESHOLD: z.coerce.number().positive().default(4),
  // How closely a rendered logo must match a fresh reference render of the
  // same approved file (src/generate/logo-fidelity.ts) to pass, 0-1. Same
  // file/engine/box should render at ~1.0; this just leaves headroom for
  // anti-aliasing, never for a genuinely different asset.
  LOGO_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  // How close (CIEDE2000) a pixel in a free-tool "check this against our
  // brand" upload must be to an approved colour to count as a match.
  // Deliberately more lenient than COLOUR_DELTA_E_THRESHOLD — an upload may
  // be a photo, screenshot, or re-compressed export we don't control.
  UPLOAD_COLOUR_MATCH_THRESHOLD: z.coerce.number().positive().default(12),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // PLACEHOLDER values — tune once real free-tool traffic/cost data exists.
  // Estimated from Claude Sonnet 5.5 list pricing ($2/$10 per MTok); see
  // estimateUsdCost() below. These are safety caps on a placeholder estimate,
  // not a provider billing cap and not a confirmed price.
  PER_VISITOR_DAILY_SPEND_USD: z.coerce.number().positive().default(2.0),
  GLOBAL_DAILY_SPEND_USD: z.coerce.number().positive().default(50.0),
  // PLACEHOLDER reservation taken before a run, edit, or regeneration is queued.
  RUN_RESERVATION_USD: z.coerce.number().positive().default(0.35),
  EDIT_RESERVATION_USD: z.coerce.number().positive().default(0.05),
  REGENERATE_RESERVATION_USD: z.coerce.number().positive().default(0.12),
  MAX_POSTS_PER_RUN: z.coerce.number().int().min(3).max(5).default(3),

  // PLACEHOLDER — optional. When set, a notification is posted here on every
  // new email-capture submission (see src/leads.ts). No-op when unset.
  SLACK_WEBHOOK_URL: z.string().url().optional(),

  IMAGE_PROVIDER: z.string().optional(),
  IMAGE_PROVIDER_API_KEY: z.string().optional(),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === "production" && !parsed.SESSION_SECRET) {
  throw new Error("Missing required production configuration: SESSION_SECRET. See .env.example.");
}

// Dev/test fallback so the app still boots locally, clearly marked as insecure.
const sessionSecret =
  parsed.SESSION_SECRET ??
  (isTest ? "test-session-secret-0000000000000000" : "dev-only-session-secret-change-me");

// Sonnet 5.5 list pricing, USD per million tokens — see claude-api skill /
// platform.claude.com/docs/pricing. Used only to estimate spend against the
// caps above; it is an estimate, not a billing reconciliation.
const SONNET_5_5_INPUT_USD_PER_MTOK = 2.0;
const SONNET_5_5_OUTPUT_USD_PER_MTOK = 10.0;

export function estimateUsdCost(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * SONNET_5_5_INPUT_USD_PER_MTOK +
    (completionTokens / 1_000_000) * SONNET_5_5_OUTPUT_USD_PER_MTOK
  );
}

export const config = {
  ...parsed,
  SESSION_SECRET: sessionSecret,
  hasAnthropicKey: Boolean(parsed.ANTHROPIC_API_KEY),
  isDevFallbackAuth: !parsed.SESSION_SECRET,
};

export type Config = typeof config;
