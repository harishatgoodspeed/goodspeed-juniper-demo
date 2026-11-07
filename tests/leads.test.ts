import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDb } from "../src/db";
import { createAnonymousOwner } from "../src/security/session";
import { createBrand } from "../src/brands";
import { createLead } from "../src/leads";
import { notifySlack } from "../src/slack";

test("createLead stores email/preferredTool/notes/consent and defaults consent to the given boolean", () => {
  const db = openTestDb();
  const ownerId = createAnonymousOwner(db);
  const brand = createBrand(db, ownerId, "https://example.com");

  const lead = createLead(db, brand.id, {
    email: "person@example.com",
    preferredTool: "Canva",
    notes: "Mostly Instagram carousels.",
    consent: true,
  });

  assert.equal(lead.brand_id, brand.id);
  assert.equal(lead.email, "person@example.com");
  assert.equal(lead.preferred_tool, "Canva");
  assert.equal(lead.notes, "Mostly Instagram carousels.");
  assert.equal(lead.consent, 1);
});

test("notifySlack is a no-op (never throws) when SLACK_WEBHOOK_URL is not configured", async () => {
  let called = false;
  await notifySlack("test message", {
    fetch: (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(called, false, "with no webhook configured, fetch must never be called");
});

test("notifySlack never throws even when the webhook request itself fails", async () => {
  await assert.doesNotReject(() =>
    notifySlack("test message", {
      fetch: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    })
  );
});
