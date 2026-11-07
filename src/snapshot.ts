/**
 * The free-tool "brand snapshot" — a human- and agent-readable brand.md a
 * visitor downloads and keeps. It only ever states what was actually
 * extracted or approved; it never invents a fact, colour, or font that
 * wasn't in the approved context (same rule llm.ts enforces for briefs).
 */

import type { BrandContext } from "./import/types";
import type { ApprovedBrandContext } from "./llm";

export interface SnapshotInput {
  sourceUrl: string;
  rawContext: BrandContext;
  approvedContext: ApprovedBrandContext;
}

function roleLabel(index: number, kind: "colour" | "font"): string {
  const colourRoles = ["background", "primary", "text", "accent"];
  const fontRoles = ["heading", "body"];
  const roles = kind === "colour" ? colourRoles : fontRoles;
  return roles[index] ?? `extra ${kind} ${index + 1}`;
}

/** Produces a Claude-ready brand.md: plain Markdown, no HTML, safe to paste into any agent's context. */
export function buildBrandMarkdown(input: SnapshotInput): string {
  const { sourceUrl, rawContext, approvedContext } = input;
  const title = rawContext.title?.trim() || new URL(sourceUrl).hostname;

  const lines: string[] = [];
  lines.push(`# ${title} — brand snapshot`);
  lines.push("");
  lines.push(`Source: ${sourceUrl}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(
    "This file states only what was approved or directly extracted from the site above — nothing here is invented. Paste it into Claude, ChatGPT or any agent as brand context."
  );
  lines.push("");

  lines.push("## Palette");
  lines.push("");
  if (approvedContext.colours.length === 0) {
    lines.push("No colours were approved yet.");
  } else {
    lines.push("| Role | Hex |");
    lines.push("| --- | --- |");
    approvedContext.colours.forEach((hex, i) => {
      lines.push(`| ${roleLabel(i, "colour")} | \`${hex}\` |`);
    });
  }
  lines.push("");

  lines.push("## Fonts");
  lines.push("");
  if (approvedContext.fonts.length === 0) {
    lines.push("No fonts were approved yet.");
  } else {
    lines.push("| Role | Family |");
    lines.push("| --- | --- |");
    approvedContext.fonts.forEach((family, i) => {
      lines.push(`| ${roleLabel(i, "font")} | ${family} |`);
    });
  }
  lines.push("");

  lines.push("## Voice");
  lines.push("");
  lines.push(approvedContext.voiceNotes || "No voice guidance was given — write in a plain, confident tone and avoid exclamation points unless told otherwise.");
  lines.push("");

  lines.push("## What this brand actually says about itself");
  lines.push("");
  lines.push(
    rawContext.description?.trim() || "No description was extracted — do not invent a summary of what this company does."
  );
  if (rawContext.textExcerpt.trim()) {
    lines.push("");
    lines.push("Readable copy excerpt from the live site (for sourcing real facts, not for copying verbatim):");
    lines.push("");
    lines.push("> " + rawContext.textExcerpt.trim().replace(/\n+/g, "\n> "));
  }
  lines.push("");

  lines.push("## Using this with an AI agent");
  lines.push("");
  lines.push(
    "Tell your agent: \"Use the palette, fonts and voice in this file for anything you design or write for us. Never use a colour or font that isn't listed here, and never invent a fact about us that isn't in the excerpt above.\""
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Generated free with Goodspeed's Brand OS. Want this wired directly into your team's tools (Canva, Gamma, Google Slides, Figma)? [Talk to Goodspeed](https://goodspeed.studio/contact)."
  );
  lines.push("");

  return lines.join("\n");
}
