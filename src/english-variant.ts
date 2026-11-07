/**
 * Detects whether a brand's own extracted copy (description/page excerpt)
 * spells English the British or American way, so generated briefs can
 * match the brand's own spelling rather than defaulting to one variant
 * regardless of the brand. Deliberately a plain word-list match, not a
 * guess: counts real, unambiguous spelling pairs (colour/color,
 * organise/organize, …) actually present in the text. Returns "unknown"
 * when nothing decisive was found, rather than fabricating a detection.
 */

const UK_SPELLINGS = [
  "colour", "colours", "coloured", "colouring",
  "favourite", "favourites",
  "organise", "organised", "organising", "organisation", "organisations",
  "optimise", "optimised", "optimising", "optimisation",
  "centre", "centres",
  "programme", "programmes",
  "analyse", "analysed", "analysing",
  "grey",
  "specialise", "specialised", "specialising",
  "customise", "customised", "customising",
  "recognise", "recognised", "recognising",
  "catalogue", "catalogues",
  "travelling", "traveller", "travellers",
  "modelling",
  "labelled",
  "cancelled", "cancelling",
  "licence", "licences",
  "defence",
  "behaviour", "behaviours",
  "humour",
  "honour", "honours",
  "neighbour", "neighbours",
  "theatre", "theatres",
  "realise", "realised", "realising",
  "fulfil", "fulfilment",
];

const US_SPELLINGS = [
  "color", "colors", "colored", "coloring",
  "favorite", "favorites",
  "organize", "organized", "organizing", "organization", "organizations",
  "optimize", "optimized", "optimizing", "optimization",
  "center", "centers",
  "program", "programs",
  "analyze", "analyzed", "analyzing",
  "gray",
  "specialize", "specialized", "specializing",
  "customize", "customized", "customizing",
  "recognize", "recognized", "recognizing",
  "catalog", "catalogs",
  "traveling", "traveler", "travelers",
  "modeling",
  "labeled",
  "canceled", "canceling",
  "license", "licenses",
  "defense",
  "behavior", "behaviors",
  "humor",
  "honor", "honors",
  "neighbor", "neighbors",
  "theater", "theaters",
  "realize", "realized", "realizing",
  "fulfill", "fulfillment",
];

export type EnglishVariant = "uk" | "us" | "unknown";

function countMatches(lowerText: string, words: string[]): number {
  let count = 0;
  for (const word of words) {
    if (new RegExp(`\\b${word}\\b`).test(lowerText)) count++;
  }
  return count;
}

/** Counts real UK/US spelling pairs present in `text`. A tie or no matches at all is "unknown" — never a guess dressed up as a detection. */
export function detectEnglishVariant(text: string): EnglishVariant {
  const lower = text.toLowerCase();
  const uk = countMatches(lower, UK_SPELLINGS);
  const us = countMatches(lower, US_SPELLINGS);
  if (uk === 0 && us === 0) return "unknown";
  if (uk > us) return "uk";
  if (us > uk) return "us";
  return "unknown";
}

/** A short, factual instruction line for the brief-generation prompt — never invents confidence the detection doesn't have. */
export function englishVariantInstruction(variant: EnglishVariant): string {
  switch (variant) {
    case "uk":
      return "This brand's own site spells English the British way (e.g. \"colour\", \"organise\"). Match that spelling in every brief.";
    case "us":
      return "This brand's own site spells English the American way (e.g. \"color\", \"organize\"). Match that spelling in every brief.";
    case "unknown":
      return "No clear British/American spelling signal was found in this brand's own copy. Default to British English spelling.";
  }
}
