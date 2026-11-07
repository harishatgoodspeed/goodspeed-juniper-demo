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

  // Required in production; a dev fallback keeps local setup frictionless without
  // ever allowing the same relaxed default in production.
  APP_ACCESS_CODE: z.string().optional(),
  SESSION_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),

  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(2),
  DAILY_RUN_LIMIT: z.coerce.number().int().positive().default(20),
  MAX_RUN_TOKENS: z.coerce.number().int().positive().default(20000),
  COLOUR_DELTA_E_THRESHOLD: z.coerce.number().positive().default(4),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  IMAGE_PROVIDER: z.string().optional(),
  IMAGE_PROVIDER_API_KEY: z.string().optional(),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === "production") {
  const missing: string[] = [];
  if (!parsed.APP_ACCESS_CODE) missing.push("APP_ACCESS_CODE");
  if (!parsed.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (missing.length) {
    throw new Error(
      `Missing required production configuration: ${missing.join(", ")}. See .env.example.`
    );
  }
}

// Dev/test fallbacks so the app still boots locally, clearly marked as insecure.
const accessCode =
  parsed.APP_ACCESS_CODE ?? (isTest ? "test-access-code" : "dev-only-change-me");
const sessionSecret =
  parsed.SESSION_SECRET ??
  (isTest ? "test-session-secret-0000000000000000" : "dev-only-session-secret-change-me");

export const config = {
  ...parsed,
  APP_ACCESS_CODE: accessCode,
  SESSION_SECRET: sessionSecret,
  hasAnthropicKey: Boolean(parsed.ANTHROPIC_API_KEY),
  isDevFallbackAuth: !parsed.APP_ACCESS_CODE || !parsed.SESSION_SECRET,
};

export type Config = typeof config;
