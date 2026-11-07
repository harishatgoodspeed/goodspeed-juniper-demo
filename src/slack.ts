import { config } from "./config";

export interface SlackDeps {
  /** Injectable for tests. Defaults to the real global fetch. */
  fetch?: typeof fetch;
}

/**
 * Posts a plain-text message to config.SLACK_WEBHOOK_URL, if configured.
 * SLACK_WEBHOOK_URL is an operator-set value (PLACEHOLDER in config.ts), not
 * user input, so this doesn't go through the SSRF-guarded safeFetch that
 * untrusted URLs (brand import, logo/image fetches) use — it's the same
 * trust level as ANTHROPIC_API_KEY. Never throws: a lead is already stored
 * in the database by the time this is called (see POST
 * /api/brands/:id/leads), so a Slack outage must not turn into a failed
 * request or a lost lead — it only logs.
 */
export async function notifySlack(text: string, deps: SlackDeps = {}): Promise<void> {
  if (!config.SLACK_WEBHOOK_URL) return;
  const fetchFn = deps.fetch ?? fetch;
  try {
    const res = await fetchFn(config.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`Slack webhook responded ${res.status}`);
    }
  } catch (err) {
    console.error("Slack webhook notification failed:", err instanceof Error ? err.message : err);
  }
}
