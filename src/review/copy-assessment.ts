/**
 * The real AI voice/fact assessment the copy check was a stub for (see
 * README's former "Known limitations"). Judges one piece of generated copy
 * against only the facts it was allowed to use and the voice guidance it was
 * given — never against the model's own sense of what sounds plausible.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config";

export interface CopyAssessmentInput {
  sourcedFactualCopy: string[];
  voiceGuidance: string;
  text: string;
}

export interface CopyAssessmentClient {
  messages: {
    parse: (params: unknown) => Promise<{ parsed_output: unknown }>;
  };
}

const CopyAssessmentSchema = z.object({
  factsAreAllSourced: z.boolean(),
  inventedOrUnsupportedClaims: z.array(z.string()),
  matchesVoiceGuidance: z.boolean(),
  voiceMismatchExplanation: z.string(),
});

export interface CopyAssessmentResult {
  status: "pass" | "fail" | "not_verified";
  explanation: string;
}

export async function assessCopy(
  input: CopyAssessmentInput,
  deps: { client?: CopyAssessmentClient } = {}
): Promise<CopyAssessmentResult> {
  const text = input.text.trim();
  if (!text) {
    return { status: "not_verified", explanation: "No copy text to assess." };
  }

  let client = deps.client;
  if (!client) {
    if (!config.hasAnthropicKey) {
      return {
        status: "not_verified",
        explanation: "ANTHROPIC_API_KEY is not configured — cannot run a real copy assessment.",
      };
    }
    client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) as unknown as CopyAssessmentClient;
  }

  const response = await client.messages.parse({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: [
      "You are a strict brand-copy auditor. You check one piece of marketing copy against only the facts it was allowed to use and the voice guidance it was given.",
      "Be exact: a fact counts as sourced only if it is stated in, or is a direct, non-exaggerating paraphrase of, one of the sourced facts given to you. A number, date, price, name, or claim that is not in that list is invented, even if it sounds plausible or generic.",
      "Voice guidance is about tone and style (e.g. formality, sentence length, use of exclamation points) — judge the copy's actual voice against it, not its facts.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          "Sourced facts this copy was allowed to use (nothing else counts as sourced):",
          ...(input.sourcedFactualCopy.length > 0 ? input.sourcedFactualCopy.map((f) => `- ${f}`) : ["(none given)"]),
          "",
          `Voice guidance this copy was supposed to follow: ${input.voiceGuidance || "(none given)"}`,
          "",
          "Copy to assess:",
          text,
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(CopyAssessmentSchema) },
  });

  if (!response.parsed_output) {
    return { status: "not_verified", explanation: "The copy assessment model did not return a parseable result." };
  }
  const parsed = CopyAssessmentSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    return {
      status: "not_verified",
      explanation: `The copy assessment model's output failed schema validation: ${parsed.error.message}`,
    };
  }
  const result = parsed.data;

  if (!result.factsAreAllSourced) {
    return {
      status: "fail",
      explanation: `Contains claims not present in the sourced facts: ${
        result.inventedOrUnsupportedClaims.join("; ") || "(the model flagged this without naming a specific claim)"
      }.`,
    };
  }
  if (!result.matchesVoiceGuidance) {
    return {
      status: "fail",
      explanation: `Does not match the approved voice guidance: ${result.voiceMismatchExplanation}`,
    };
  }
  return { status: "pass", explanation: "Every claim is sourced and the copy matches the approved voice guidance." };
}
