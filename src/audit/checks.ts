/**
 * Six explainable checks. Each score maps to a status:
 * 80-100 ok, 50-79 warn, 0-49 break.
 *
 * A check whose every finding starts with "Not assessed" was not compared.
 * Those checks stay on the scorecard so a missing channel is not a pass,
 * and they are left out of overallScore and topBreaks.
 */

import { compareHex, rgbToHex } from "../review/colour";
import type { LogoCandidate } from "../import/types";
import type { AuditCheck, AuditCheckId, AuditFinding, AuditStatus, AuditSurface, AuditTopBreak } from "./types";

/** Same lenience as an uploaded image colour check. A measured distance, not a business metric. */
export const PALETTE_MATCH_DELTA_E = 12;

const CHECK_LABEL: Record<AuditCheckId, string> = {
  palette: "Colour palette",
  logo: "Logo",
  type: "Typography",
  voice: "Voice and tone",
  message: "Core message",
  formats: "Formats and templates",
};

const WHY: Record<AuditCheckId, string> = {
  palette: "Colour is the first thing a prospect sees. When it shifts by channel, the brand stops looking like one company.",
  logo: "The mark is how people recognise you at a glance. A missing or unclear logo makes the brand look unmanaged.",
  type: "Type is a system. When every channel picks its own fonts, every new deck starts again.",
  voice: "Tone is part of the promise. If the site and the other channels do not sound like the same firm, trust drops.",
  message: "People should meet the same offer on every channel. When the story shifts, buyers get confused and the work is redone.",
  formats: "Without a shared template, every asset is a one off and design becomes the bottleneck.",
};

const COST: Record<AuditCheckId, string> = {
  palette: "Lost trust",
  logo: "The brand looks unmanaged",
  type: "Rework on every deck",
  voice: "Sales and marketing sound like different firms",
  message: "Rework and confused buyers",
  formats: "Design becomes the bottleneck",
};

const STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "because",
  "been",
  "being",
  "but",
  "can",
  "for",
  "from",
  "had",
  "has",
  "have",
  "into",
  "its",
  "just",
  "more",
  "not",
  "our",
  "that",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
  "yours",
]);

export function statusForScore(score: number): AuditStatus {
  if (score >= 80) return "ok";
  if (score >= 50) return "warn";
  return "break";
}

export function makeCheck(id: AuditCheckId, score: number, findings: AuditFinding[]): AuditCheck {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id,
    label: CHECK_LABEL[id],
    score: clamped,
    status: statusForScore(clamped),
    findings,
  };
}

export function isAssessed(check: AuditCheck): boolean {
  return check.findings.some((finding) => !finding.detail.startsWith("Not assessed"));
}

export function overallFromChecks(checks: AuditCheck[]): number {
  const assessed = checks.filter(isAssessed);
  if (assessed.length === 0) return 0;
  const total = assessed.reduce((sum, check) => sum + check.score, 0);
  return Math.round(total / assessed.length);
}

export function rankBreaks(checks: AuditCheck[]): AuditTopBreak[] {
  const ranked = checks
    .filter(isAssessed)
    .filter((check) => check.status === "break" || check.status === "warn")
    .sort((a, b) => {
      const severity = (check: AuditCheck) => (check.status === "break" ? 0 : 1);
      return severity(a) - severity(b) || a.score - b.score;
    })
    .slice(0, 5);

  return ranked.map((check, index) => ({
    rank: index + 1,
    title: check.label,
    surface: primarySurface(check),
    whyItMatters: WHY[check.id],
    cost: COST[check.id],
  }));
}

function primarySurface(check: AuditCheck): AuditSurface {
  const elsewhere = check.findings.find((finding) => finding.surface !== "site");
  return (elsewhere ?? check.findings[0])?.surface ?? "site";
}

export function canonicalHex(value: string): string | null {
  const raw = value.trim().toLowerCase();
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9a-f]{3}$/.test(withHash)) {
    const hex = withHash.slice(1);
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(withHash)) return withHash;
  return null;
}

export function isNeutralHex(value: string): boolean {
  const hex = canonicalHex(value);
  if (!hex) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 18) return true;
  if (min >= 242) return true;
  if (max <= 22) return true;
  return false;
}

export function chromaticHexes(colours: string[], limit = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const colour of colours) {
    const hex = canonicalHex(colour);
    if (!hex || seen.has(hex) || isNeutralHex(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= limit) break;
  }
  return out;
}

function nearestDelta(colour: string, baseline: string[]): { delta: number; hex: string } | null {
  let best: { delta: number; hex: string } | null = null;
  for (const base of baseline) {
    const delta = compareHex(colour, base);
    if (!best || delta < best.delta) best = { delta, hex: base };
  }
  return best;
}

export function scorePalette(input: {
  siteColours: string[];
  blogColours: string[] | null;
  deckColours: string[] | null;
}): AuditCheck {
  const site = chromaticHexes(input.siteColours);
  const findings: AuditFinding[] = [];

  if (site.length === 0 && input.siteColours.length === 0) {
    return makeCheck("palette", 32, [
      {
        surface: "site",
        detail: "No colours could be read from the site CSS, so there is no palette to compare.",
      },
    ]);
  }

  const baseline = site.length > 0 ? site : chromaticHexes(input.siteColours, 8);
  const usableBaseline = baseline.length > 0 ? baseline : input.siteColours.map((c) => canonicalHex(c)).filter((c): c is string => Boolean(c)).slice(0, 8);

  const comparisons: Array<{ surface: AuditSurface; colours: string[] }> = [];
  if (input.blogColours) comparisons.push({ surface: "blog", colours: chromaticHexes(input.blogColours, 8) });
  if (input.deckColours) comparisons.push({ surface: "deck", colours: chromaticHexes(input.deckColours, 8) });

  if (comparisons.length === 0) {
    if (site.length >= 10) {
      return makeCheck("palette", 36, [
        {
          surface: "site",
          detail: `The site CSS names ${site.length} chromatic colours and no blog or deck was available to compare. That is a scattered palette on the page people land on.`,
        },
      ]);
    }
    return makeCheck("palette", 60, [
      {
        surface: "site",
        detail: `Not assessed across channels. Only the site was available, so blog and deck colours were not compared. The site itself names ${site.length} chromatic colour${site.length === 1 ? "" : "s"}.`,
      },
    ]);
  }

  let worst = 1;
  let compared = false;
  for (const comparison of comparisons) {
    if (comparison.colours.length === 0) {
      findings.push({
        surface: comparison.surface,
        detail: `Not assessed on the ${comparison.surface}. No chromatic colours could be read there.`,
      });
      continue;
    }
    compared = true;
    const far: string[] = [];
    let matched = 0;
    for (const colour of comparison.colours) {
      const nearest = nearestDelta(colour, usableBaseline);
      if (!nearest || nearest.delta > PALETTE_MATCH_DELTA_E) {
        far.push(colour);
      } else {
        matched += 1;
      }
    }
    const ratio = matched / comparison.colours.length;
    worst = Math.min(worst, ratio);
    if (far.length === 0) {
      findings.push({
        surface: comparison.surface,
        detail: `Every chromatic colour read from the ${comparison.surface} sits within ΔE ${PALETTE_MATCH_DELTA_E} of the site palette.`,
      });
    } else {
      const example = far[0];
      const nearest = nearestDelta(example, usableBaseline);
      const delta = nearest ? Math.round(nearest.delta) : 0;
      findings.push({
        surface: comparison.surface,
        detail: `${far.length} of ${comparison.colours.length} chromatic colours on the ${comparison.surface} sit outside the site palette. ${example} is about ΔE ${delta} from the closest site colour ${nearest?.hex ?? ""}, past the ΔE ${PALETTE_MATCH_DELTA_E} match line.`,
      });
    }
  }

  if (!compared) {
    return makeCheck("palette", 60, [
      {
        surface: "site",
        detail: "Not assessed across channels. A blog or deck was provided, but no chromatic colours could be read from it. This is not a pass.",
      },
      ...findings,
    ]);
  }

  const score = worst >= 0.75 ? 90 : worst >= 0.45 ? 64 : 34;
  return makeCheck("palette", score, findings);
}

export function scoreLogo(candidates: LogoCandidate[]): AuditCheck {
  const header = candidates.find(
    (candidate) => (candidate.kind === "header_img" || candidate.kind === "header_svg") && candidate.confidence >= 0.45
  );
  if (header) {
    return makeCheck("logo", 88, [
      {
        surface: "site",
        detail:
          header.kind === "header_svg"
            ? "An inline header logo was found on the site. It is not a separate file, so it was not compared with a deck."
            : "A header logo image was found on the site.",
        ...(header.kind === "header_img" ? { evidenceUrl: header.url } : {}),
      },
    ]);
  }
  const weak = candidates.find((candidate) => candidate.kind === "favicon" || candidate.kind === "og_image");
  if (weak) {
    return makeCheck("logo", 62, [
      {
        surface: "site",
        detail: "Only a favicon or social image was found. That does not confirm the logo is used as the brand mark. Deck logo fidelity was not checked.",
        evidenceUrl: weak.url,
      },
    ]);
  }
  return makeCheck("logo", 28, [
    {
      surface: "site",
      detail: "No favicon, social image, or header logo was found on the site.",
    },
  ]);
}

export function uniqueFontNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const cleaned = name.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (cleaned.startsWith("+") || cleaned.startsWith("var(")) continue;
    if (/placeholder$/i.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    if (GENERIC_FONTS.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "inherit",
  "initial",
]);

export function googleFontFamilies(href: string): string[] {
  const names: string[] = [];
  const re = /(?:^|[?&])family=([^&]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(href))) {
    const decoded = decodeURIComponent(match[1].replace(/\+/g, " "));
    const name = decoded.split(":")[0]?.trim();
    if (name) names.push(name);
  }
  return names;
}

export function scoreType(input: {
  siteFonts: string[];
  blogFonts: string[] | null;
  deckFonts: string[] | null;
  googleFonts: boolean;
}): AuditCheck {
  const site = uniqueFontNames(input.siteFonts);
  const findings: AuditFinding[] = [];
  let score = site.length === 0 ? 30 : site.length <= 2 ? 90 : site.length <= 4 ? 64 : 36;
  const listed = site.length === 0 ? "none" : site.join(", ");
  const google = input.googleFonts ? " A Google Fonts link was found." : "";
  findings.push({
    surface: "site",
    detail:
      site.length === 0
        ? "No named typeface was found in the site CSS or in a Google Fonts link."
        : `The site names ${site.length} typeface${site.length === 1 ? "" : "s"}: ${listed}.${google}`,
  });

  const extras: Array<{ surface: AuditSurface; fonts: string[] | null }> = [
    { surface: "blog", fonts: input.blogFonts },
    { surface: "deck", fonts: input.deckFonts },
  ];
  for (const extra of extras) {
    if (!extra.fonts) continue;
    const names = uniqueFontNames(extra.fonts);
    if (names.length === 0) {
      findings.push({
        surface: extra.surface,
        detail: `Not assessed for type on the ${extra.surface}. No named typeface could be read there. Screenshots are not used to guess fonts.`,
      });
      continue;
    }
    const siteKeys = new Set(site.map((name) => name.toLowerCase()));
    const missing = names.filter((name) => !siteKeys.has(name.toLowerCase()));
    if (missing.length === 0) {
      findings.push({
        surface: extra.surface,
        detail: `Typefaces on the ${extra.surface} (${names.join(", ")}) already appear on the site.`,
      });
    } else if (missing.length === 1) {
      score = Math.min(score, 66);
      findings.push({
        surface: extra.surface,
        detail: `The ${extra.surface} names ${missing[0]}, which is not in the site type list (${listed}).`,
      });
    } else {
      score = Math.min(score, 38);
      findings.push({
        surface: extra.surface,
        detail: `The ${extra.surface} names ${missing.join(", ")}, which are not in the site type list (${listed}).`,
      });
    }
  }

  return makeCheck("type", score, findings);
}

export interface VoiceProfile {
  wordsPerSentence: number;
  exclamationRate: number;
  youPer100: number;
  wePer100: number;
  sentences: number;
  exclamations: number;
}

export function voiceProfile(text: string): VoiceProfile | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 12) return null;
  const sentences = cleaned.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const sentenceCount = Math.max(1, sentences.length);
  const exclamations = (cleaned.match(/!/g) ?? []).length;
  const you = words.filter((word) => /^you(r|rs|'re|'ve)?$/i.test(word.replace(/[^a-z']/gi, ""))).length;
  const we = words.filter((word) => /^(we|our|ours|we're|we've)$/i.test(word.replace(/[^a-z']/gi, ""))).length;
  return {
    wordsPerSentence: words.length / sentenceCount,
    exclamationRate: exclamations / sentenceCount,
    youPer100: (you / words.length) * 100,
    wePer100: (we / words.length) * 100,
    sentences: sentenceCount,
    exclamations,
  };
}

export function summariseVoice(text: string): string {
  const profile = voiceProfile(text);
  if (!profile) return "Not enough site copy to summarise the voice.";
  const length =
    profile.wordsPerSentence < 12 ? "Short sentences" : profile.wordsPerSentence > 22 ? "Long sentences" : "Medium length sentences";
  const person =
    profile.youPer100 > profile.wePer100 + 0.8
      ? "addresses you"
      : profile.wePer100 > profile.youPer100 + 0.8
        ? "speaks as we"
        : "does not lean on you or we";
  const bang = profile.exclamationRate >= 0.25 ? "uses exclamations" : "rarely uses exclamations";
  return `${length}, ${person}, ${bang}.`;
}

function voicePoints(site: VoiceProfile, other: VoiceProfile): string[] {
  const reasons: string[] = [];
  if (Math.abs(site.wordsPerSentence - other.wordsPerSentence) >= 10) {
    reasons.push(
      `sentence length differs (site about ${Math.round(site.wordsPerSentence)} words, this text about ${Math.round(other.wordsPerSentence)})`
    );
  }
  const siteBangs = site.exclamationRate >= 0.25;
  const otherBangs = other.exclamationRate >= 0.25;
  if (siteBangs !== otherBangs) {
    reasons.push(
      otherBangs
        ? `this text uses exclamations (${other.exclamations} in ${other.sentences} sentences) and the site does not`
        : "the site uses exclamations and this text does not"
    );
  }
  const siteYou = site.youPer100 > site.wePer100 + 1;
  const siteWe = site.wePer100 > site.youPer100 + 1;
  const otherYou = other.youPer100 > other.wePer100 + 1;
  const otherWe = other.wePer100 > other.youPer100 + 1;
  if ((siteYou && otherWe) || (siteWe && otherYou)) {
    reasons.push(siteWe ? "the site speaks as we and this text addresses you" : "the site addresses you and this text speaks as we");
  }
  return reasons;
}

export function scoreVoice(parts: Array<{ surface: AuditSurface; text: string }>): AuditCheck {
  const site = parts.find((part) => part.surface === "site");
  const siteProfile = site ? voiceProfile(site.text) : null;
  const others = parts.filter((part) => part.surface !== "site" && part.text.trim());
  if (!siteProfile || others.length === 0) {
    return makeCheck("voice", 60, [
      {
        surface: "site",
        detail: siteProfile
          ? "Not assessed across channels. Voice was read on the site only. Paste LinkedIn text or add a blog to compare tone. This is not a pass."
          : "Not assessed. The site did not have enough readable copy to describe a voice.",
      },
    ]);
  }

  let worst = 0;
  const findings: AuditFinding[] = [
    {
      surface: "site",
      detail: `Site voice: ${summariseVoice(site!.text)}`,
    },
  ];
  for (const other of others) {
    const profile = voiceProfile(other.text);
    if (!profile) {
      findings.push({
        surface: other.surface,
        detail: `Not assessed. The ${other.surface} text is too short to compare tone (need at least 12 words).`,
      });
      continue;
    }
    const reasons = voicePoints(siteProfile, profile);
    worst = Math.max(worst, reasons.length);
    findings.push({
      surface: other.surface,
      detail:
        reasons.length === 0
          ? `The ${other.surface} text matches the site on sentence length, exclamations, and you versus we.`
          : `The ${other.surface} text drifts from the site: ${reasons.join("; ")}.`,
    });
  }

  const comparable = findings.some((finding) => finding.surface !== "site" && !finding.detail.startsWith("Not assessed"));
  if (!comparable) {
    return makeCheck("voice", 60, [
      {
        surface: "site",
        detail: "Not assessed across channels. The other texts were too short to compare tone. This is not a pass.",
      },
    ]);
  }
  const score = worst === 0 ? 90 : worst === 1 ? 68 : 36;
  return makeCheck("voice", score, findings);
}

export function offerTokens(text: string): string[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  for (const word of words) {
    if (word.length <= 3 || STOPWORDS.has(word)) continue;
    const token = word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
    if (token.length <= 3 || STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([token]) => token);
}

export function scoreMessage(siteOffer: string, parts: Array<{ surface: AuditSurface; text: string }>): AuditCheck {
  const tokens = offerTokens(siteOffer);
  const others = parts.filter((part) => part.surface !== "site" && part.text.trim());
  if (tokens.length < 3 || others.length === 0) {
    return makeCheck("message", 60, [
      {
        surface: "site",
        detail:
          tokens.length < 3
            ? "Not assessed. The site did not yield enough of an offer to compare with other channels."
            : "Not assessed across channels. Core message was read on the site only. This is not a pass.",
      },
    ]);
  }

  let worst = 1;
  const findings: AuditFinding[] = [];
  let compared = false;
  for (const other of others) {
    if (other.text.trim().split(/\s+/).length < 8) {
      findings.push({
        surface: other.surface,
        detail: `Not assessed. The ${other.surface} text is too short to compare with the site offer.`,
      });
      continue;
    }
    compared = true;
    const haystack = new Set(offerTokens(`${other.text} ${other.text}`));
    const raw = other.text.toLowerCase();
    const hit = tokens.filter((token) => haystack.has(token) || raw.includes(token));
    const ratio = hit.length / tokens.length;
    worst = Math.min(worst, ratio);
    const shown = hit.slice(0, 6).join(", ") || "none";
    findings.push({
      surface: other.surface,
      detail: `${hit.length} of ${tokens.length} offer words from the site show up in the ${other.surface} text (${shown}). Offer words: ${tokens.join(", ")}.`,
    });
  }

  if (!compared) {
    return makeCheck("message", 60, [
      {
        surface: "site",
        detail: "Not assessed across channels. The other texts were too short to compare with the site offer. This is not a pass.",
      },
    ]);
  }
  const score = worst >= 0.34 ? 88 : worst >= 0.15 ? 66 : 36;
  return makeCheck("message", score, findings);
}

export interface DeckFormatSignal {
  slideCount: number;
  colours: string[];
  slideSizes: string[];
  textLength: number;
}

export function scoreFormats(deck: DeckFormatSignal | null): AuditCheck {
  if (!deck) {
    return makeCheck("formats", 60, [
      {
        surface: "deck",
        detail: "Not assessed. No deck was uploaded, so template consistency was not checked. This is not a pass.",
      },
    ]);
  }
  const colours = chromaticHexes(deck.colours, 20);
  if (deck.textLength === 0 && colours.length === 0 && deck.slideSizes.length === 0 && deck.slideCount === 0) {
    return makeCheck("formats", 60, [
      {
        surface: "deck",
        detail: "Not assessed. The file was uploaded but no text, colours, or slide size could be read.",
      },
    ]);
  }

  const sizes = Array.from(new Set(deck.slideSizes));
  const manyColours = colours.length > 12;
  const mixedSizes = sizes.length > 1;
  let score = 86;
  if (manyColours || mixedSizes) score = 36;
  else if (colours.length > 8 || (colours.length === 0 && sizes.length === 0)) score = 64;

  const sizeNote =
    sizes.length === 0
      ? "Page size could not be read."
      : sizes.length === 1
        ? `One slide size was read (${sizes[0]}). That shows a shared size, not that every layout matches.`
        : `${sizes.length} different slide sizes were read (${sizes.join(", ")}), so the pages are not one template.`;
  const colourNote =
    colours.length === 0
      ? "No chromatic colours could be read from the file."
      : `${colours.length} chromatic colours were read from the file.`;
  const textNote = deck.textLength > 0 ? "Text was extracted from the file." : "No text could be extracted.";

  return makeCheck("formats", score, [
    {
      surface: "deck",
      detail: `${textNote} ${colourNote} ${sizeNote}`,
    },
  ]);
}

export function hexFromUnitRgb(r: number, g: number, b: number): string {
  return rgbToHex(r * 255, g * 255, b * 255);
}
