import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrandMarkdown } from "../src/snapshot";
import type { BrandContext } from "../src/import/types";
import type { ApprovedBrandContext } from "../src/llm";

function rawContext(overrides: Partial<BrandContext> = {}): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: new Date().toISOString(),
    extractionMethod: "static-html-css",
    title: "Example Co",
    siteName: null,
    description: "Example Co sells artisanal walking boots, made in Vermont.",
    logoCandidates: [],
    colours: [],
    cssCustomProperties: [],
    fonts: [],
    googleFontsLinks: [],
    images: [],
    textExcerpt: "Example Co has been making boots since 1998.",
    textTruncated: false,
    stylesheetsFetched: 0,
    stylesheetsSkipped: 0,
    unknowns: [],
    ...overrides,
  };
}

function approved(overrides: Partial<ApprovedBrandContext> = {}): ApprovedBrandContext {
  return {
    logoAssetId: "asset_logo_1",
    colours: ["#C6DD66", "#1F3A2E"],
    fonts: ["Inter"],
    voiceNotes: "Confident, no exclamation points.",
    ...overrides,
  };
}

test("includes only approved colours and fonts, labelled by role", () => {
  const md = buildBrandMarkdown({ sourceUrl: "https://example.com", rawContext: rawContext(), approvedContext: approved() });
  assert.match(md, /background.*#C6DD66/s);
  assert.match(md, /primary.*#1F3A2E/s);
  assert.match(md, /heading.*Inter/s);
  assert.ok(!md.includes("#FF00FF"), "must never include an unapproved colour");
});

test("never invents a description or excerpt when none was extracted", () => {
  const md = buildBrandMarkdown({
    sourceUrl: "https://example.com",
    rawContext: rawContext({ description: null, textExcerpt: "" }),
    approvedContext: approved(),
  });
  assert.match(md, /No description was extracted — do not invent/);
  assert.ok(!md.includes("Readable copy excerpt"), "must not print an excerpt section when there is no excerpt");
});

test("states plainly when no colours or fonts have been approved yet, rather than fabricating any", () => {
  const md = buildBrandMarkdown({
    sourceUrl: "https://example.com",
    rawContext: rawContext(),
    approvedContext: approved({ colours: [], fonts: [] }),
  });
  assert.match(md, /No colours were approved yet/);
  assert.match(md, /No fonts were approved yet/);
});

test("falls back to a plain default voice instruction when no voice notes were given, without inventing a specific voice", () => {
  const md = buildBrandMarkdown({
    sourceUrl: "https://example.com",
    rawContext: rawContext(),
    approvedContext: approved({ voiceNotes: "" }),
  });
  assert.match(md, /No voice guidance was given/);
});

test("carries the real voice notes verbatim when they were given", () => {
  const md = buildBrandMarkdown({
    sourceUrl: "https://example.com",
    rawContext: rawContext(),
    approvedContext: approved({ voiceNotes: "Playful, short sentences, one joke per post." }),
  });
  assert.match(md, /Playful, short sentences, one joke per post\./);
});

test("includes the Goodspeed CTA so the free tool actually upsells", () => {
  const md = buildBrandMarkdown({ sourceUrl: "https://example.com", rawContext: rawContext(), approvedContext: approved() });
  assert.match(md, /goodspeed\.studio\/contact/);
});

test("falls back to the hostname when no title was extracted", () => {
  const md = buildBrandMarkdown({
    sourceUrl: "https://example.com",
    rawContext: rawContext({ title: null }),
    approvedContext: approved(),
  });
  assert.match(md, /^# example\.com — brand snapshot/);
});
