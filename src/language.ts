/**
 * A small stopword check so we can ask before translating. It does not name
 * a language it cannot prove. Short or mixed text stays "unknown".
 */

const ENGLISH = ["the", "and", "for", "with", "your", "this", "that", "from", "are", "you", "our", "have", "will"];
const OTHER = ["les", "des", "une", "dans", "pour", "und", "der", "die", "das", "nicht", "los", "las", "para", "que", "con"];

export type SiteLanguage = "english" | "other" | "unknown";

function hits(text: string, words: string[]): number {
  const lower = ` ${text.toLowerCase()} `;
  return words.reduce((count, word) => count + (lower.includes(` ${word} `) ? 1 : 0), 0);
}

export function detectSiteLanguage(text: string): SiteLanguage {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 12) return "unknown";
  const english = hits(text, ENGLISH);
  const other = hits(text, OTHER);
  if (english === 0 && other === 0) return "unknown";
  if (other >= 3 && other > english) return "other";
  if (english >= 2 && english >= other) return "english";
  return "unknown";
}
