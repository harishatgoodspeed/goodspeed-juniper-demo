import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBriefs, BriefValidationError, BriefReferenceError, type AnthropicMessagesClient } from "../src/llm";
import type { BrandContext } from "../src/import/types";

const APPROVED_COLOURS = ["#C6DD66", "#36493C"];
const APPROVED_FONTS = ["Inter", "Space Grotesk"];
const APPROVED_LOGO = "asset_logo_1";

function rawContext(overrides: Partial<BrandContext> = {}): BrandContext {
  return {
    sourceUrl: "https://example.com",
    fetchedAt: new Date().toISOString(),
    extractionMethod: "static-html-css",
    title: "Example",
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

function baseInput() {
  return {
    context: { logoAssetId: APPROVED_LOGO, colours: APPROVED_COLOURS, fonts: APPROVED_FONTS, voiceNotes: "Confident, no exclamation points." },
    rawContext: rawContext(),
    task: "Launch a new boot colourway",
  };
}

function validBrief(outputType: string, overrides: Record<string, unknown> = {}) {
  return {
    outputType,
    purpose: "Promote the launch",
    audience: "Existing customers",
    sourcedFactualCopy: ["Example Co has been making boots since 1998."],
    layoutDirection: "Bold product shot with the new colourway front and centre.",
    paletteTokenHexes: [APPROVED_COLOURS[0]],
    fontFamilies: [APPROVED_FONTS[0]],
    logoAssetId: APPROVED_LOGO,
    imageAssetIds: [],
    voiceGuidance: "Confident, no exclamation points.",
    unknowns: [],
    ...(outputType === "post_copy" ? { postCopyText: "Example Co has been making boots since 1998." } : {}),
    ...overrides,
  };
}

function mockClient(briefs: unknown[], usage = { input_tokens: 123, output_tokens: 456 }): AnthropicMessagesClient {
  return {
    messages: {
      parse: async () => ({
        parsed_output: { briefs },
        usage,
      }),
    },
  };
}

function sixValidBriefs(overrides: Record<string, Record<string, unknown>> = {}) {
  return [
    validBrief("linkedin_image", overrides.linkedin_image),
    validBrief("x_image", overrides.x_image),
    validBrief("instagram_image", overrides.instagram_image),
    validBrief("one_pager_pdf", overrides.one_pager_pdf),
    validBrief("slide", overrides.slide),
    validBrief("post_copy", overrides.post_copy),
  ];
}

test("a valid mock response round-trips into a correctly-shaped BriefSet with real usage/timing", async () => {
  const client = mockClient(sixValidBriefs());

  const result = await generateBriefs(baseInput(), { client });

  assert.equal(result.briefs.length, 6);
  assert.equal(result.promptTokens, 123);
  assert.equal(result.completionTokens, 456);
  assert.ok(result.elapsedMs >= 0);
  assert.ok(result.briefs.some((b) => b.outputType === "post_copy" && b.postCopyText));
});

test("rejects a brief that invents a palette hex not in the approved context", async () => {
  const client = mockClient(sixValidBriefs({ linkedin_image: { paletteTokenHexes: ["#FF00FF"] } })); // not approved

  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefReferenceError);
});

test("rejects a brief that invents a font not in the approved context", async () => {
  const client = mockClient(sixValidBriefs({ linkedin_image: { fontFamilies: ["Comic Sans MS"] } }));

  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefReferenceError);
});

test("rejects a brief that references a logo asset ID other than the approved one", async () => {
  const client = mockClient(sixValidBriefs({ linkedin_image: { logoAssetId: "asset_some_other_logo" } }));

  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefReferenceError);
});

test("rejects a brief with any imageAssetIds, since none are approved yet", async () => {
  const client = mockClient(sixValidBriefs({ linkedin_image: { imageAssetIds: ["asset_random_image"] } }));

  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefReferenceError);
});

test("accepts a brief with logoAssetId: null even when a logo was approved (model may choose not to use it)", async () => {
  const client = mockClient(sixValidBriefs({ linkedin_image: { logoAssetId: null } }));
  const result = await generateBriefs(baseInput(), { client });
  assert.equal(result.briefs[0].logoAssetId, null);
});

test("rejects a response that fails Zod shape validation instead of silently coercing it", async () => {
  const client = mockClient([
    { outputType: "linkedin_image", purpose: "x" }, // missing required fields
    ...sixValidBriefs().slice(1),
  ]);

  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefValidationError);
});

test("accepts three briefs and does not require the old set of six", async () => {
  const client = mockClient([
    validBrief("linkedin_image"),
    validBrief("x_image", { purpose: "A different post, not a resize" }),
    validBrief("post_copy"),
  ]);
  const result = await generateBriefs(baseInput(), { client });
  assert.equal(result.briefs.length, 3);
});

test("rejects a duplicate output type instead of treating a second file as a new post", async () => {
  const client = mockClient([
    ...sixValidBriefs().slice(0, 5),
    validBrief("slide", { purpose: "duplicate slide instead of post_copy" }),
  ]);

  await assert.rejects(() => generateBriefs(baseInput(), { client }), /duplicate output type/i);
});

test("rejects a post_copy brief missing postCopyText", async () => {
  const client = mockClient(sixValidBriefs({ post_copy: { postCopyText: undefined } }));

  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefValidationError);
});

test("rejects a model response with no parsed structured output", async () => {
  const client: AnthropicMessagesClient = {
    messages: {
      parse: async () => ({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } }),
    },
  };
  await assert.rejects(() => generateBriefs(baseInput(), { client }), BriefValidationError);
});

test("throws a clear error when no client is injected and no ANTHROPIC_API_KEY is configured", async () => {
  await assert.rejects(() => generateBriefs(baseInput()), /ANTHROPIC_API_KEY/);
});
