/**
 * Compares what each channel is actually selling.
 * Brand names, stopwords, and the word "creator" do not count as the same story.
 * The overlap itself uses the fixed offer-word rubric in checks.ts.
 */

import { offerTokens } from "./checks";

export interface Positioning {
  /** Short phrase taken from the text, such as "YouTube channel growth". */
  sells: string;
  tokens: Set<string>;
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => safeChar(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Drops the LinkedIn "| 2,295 followers on LinkedIn" prefix. */
export function cleanChannelText(value: string): { text: string; followers: string | null } {
  const decoded = decodeHtml(value).replace(/\s+/g, " ").trim();
  const followers = decoded.match(/([\d][\d,.]*)\s+followers on LinkedIn/i)?.[1] ?? null;
  const text = decoded
    .replace(/^[^.|]{0,90}\|\s*[\d,.]+\s+followers on LinkedIn\.?\s*/i, "")
    .replace(/[\d,.]+\s+followers on LinkedIn\.?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, followers };
}

export function readPositioning(raw: string, brandName: string): Positioning {
  const { text } = cleanChannelText(raw);
  const brand = brandTokens(brandName);
  const tokens = new Set(
    offerTokens(text, 40).filter((token) => !brand.has(token) && token !== "creator" && token !== "drive" && token !== "level")
  );
  return { sells: sellsLine(text, brand), tokens };
}

export function storiesDiffer(left: Set<string>, right: Set<string>): boolean {
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared < 2;
}

export function storyVerdict(siteSells: string, rows: Array<{ label: string; sells: string }>): string {
  const parts = [`Site sells ${siteSells}`, ...rows.map((row) => `${row.label} sells ${row.sells}`)];
  return parts.join("; ") + ".";
}

function sellsLine(text: string, brand: Set<string>): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (/revenue accelerator/i.test(clean)) return "a revenue accelerator";
  if (/creator tv|creator-led advertising|advertising that drives/i.test(clean)) return "a Creator TV ad platform";
  if (/youtube/i.test(clean) && /channel|media|subscriber|results/i.test(clean)) return "YouTube channel growth";
  if (/redesign/i.test(clean) && /website/i.test(clean)) return "website redesign";
  if (/low[\s-]code/i.test(clean) || /ai agency/i.test(clean)) return "a low code and AI agency";
  const clause = (clean.split(/(?<=[.!?])\s+/)[0] || clean).replace(/[|].*$/, "");
  let phrase = clause;
  for (const word of [...brand].sort((a, b) => b.length - a.length)) {
    phrase = phrase.replace(new RegExp(`\\b${word}\\b`, "ig"), " ");
  }
  const words = phrase.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 8);
  return words.join(" ").replace(/^[,.\s]+|[,.\s]+$/g, "") || "the same line as the site";
}

function brandTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const word of name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (word.length <= 2) continue;
    out.add(word);
    if (word.length > 4 && word.endsWith("s")) out.add(word.slice(0, -1));
  }
  return out;
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}
