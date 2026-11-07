/**
 * Source ledger built from fetched page text. The model may cite these IDs.
 * It may not invent its own fact whitelist. Excerpts are untrusted data.
 */

export interface LedgerEntry {
  id: string;
  sourceUrl: string;
  excerpt: string;
  retrievedAt: string;
}

export interface LedgerSource {
  sourceUrl: string;
  title?: string | null;
  description?: string | null;
  textExcerpt?: string | null;
  retrievedAt: string;
}

const MIN_EXCERPT = 24;

export function buildSourceLedger(source: LedgerSource): LedgerEntry[] {
  const chunks: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
    if (trimmed.length < MIN_EXCERPT) return;
    if (chunks.some((c) => c === trimmed)) return;
    chunks.push(trimmed.slice(0, 600));
  };

  push(source.title ? `${source.title}` : null);
  push(source.description);

  const excerpt = source.textExcerpt ?? "";
  const parts = excerpt
    .split(/\n+/)
    .flatMap((block) => block.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) push(excerpt);
  else for (const part of parts) push(part);

  return chunks.slice(0, 40).map((excerptText, index) => ({
    id: `L${index + 1}`,
    sourceUrl: source.sourceUrl,
    excerpt: excerptText,
    retrievedAt: source.retrievedAt,
  }));
}

/** Numbers, percentages, money, and years that have to appear in a source excerpt. Bare step indexes are not claims. */
export function extractNumericTokens(text: string): string[] {
  const re =
    /(?:[$£€]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\b(?:19|20)\d{2}\b|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)/g;
  return text.match(re) ?? [];
}

function normaliseToken(token: string): string {
  return token.replace(/\s+/g, "").toLowerCase();
}

export function unsupportedNumericTokens(text: string, ledgerText: string): string[] {
  const blob = ledgerText.replace(/\s+/g, "").toLowerCase();
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const token of extractNumericTokens(text)) {
    const key = normaliseToken(token);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!blob.includes(key)) missing.push(token);
  }
  return missing;
}

export interface CitedClaim {
  text: string;
  ledgerIds: string[];
  kind: "fact" | "draft_opinion";
}

/**
 * A fact is supported only when every cited ledger id exists and the cited
 * excerpts contain its numbers and at least half of its longer words.
 * The model's own sourcedFactualCopy list is not an input here.
 */
export function verifyCitedClaims(
  claims: CitedClaim[],
  ledger: LedgerEntry[]
): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(ledger.map((entry) => [entry.id, entry]));
  for (const claim of claims) {
    if (claim.kind === "draft_opinion") {
      const numbers = extractNumericTokens(claim.text);
      if (numbers.length > 0) {
        return { ok: false, reason: `A draft opinion still contains a figure (${numbers.join(", ")}). Figures need a source excerpt.` };
      }
      continue;
    }
    if (claim.ledgerIds.length === 0) {
      return { ok: false, reason: `Factual claim has no source id: ${claim.text}` };
    }
    const excerpts: string[] = [];
    for (const id of claim.ledgerIds) {
      const entry = byId.get(id);
      if (!entry) return { ok: false, reason: `Claim cites ${id}, which is not in the source ledger.` };
      excerpts.push(entry.excerpt);
    }
    const blob = excerpts.join(" ");
    const missing = unsupportedNumericTokens(claim.text, blob);
    if (missing.length > 0) {
      return { ok: false, reason: `Claim uses ${missing.join(", ")} but the cited source excerpt does not.` };
    }
    const words = claim.text.toLowerCase().match(/[a-z]{5,}/g) ?? [];
    if (words.length > 0) {
      const hay = blob.toLowerCase();
      const hits = words.filter((word) => hay.includes(word)).length;
      if (hits / words.length < 0.5) {
        return { ok: false, reason: `Claim is not supported by its cited source excerpt: ${claim.text}` };
      }
    }
  }
  return { ok: true };
}
