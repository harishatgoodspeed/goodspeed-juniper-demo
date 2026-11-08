/**
 * Server owned format library. These are observed structures, not proof of
 * virality and not fresh live discovery. Permitted use is the structure only.
 * Observed dates are the research dates from 7 November 2026, Europe/London.
 * The free tool drafts three LinkedIn posts: a carousel, a checklist image,
 * and a text hook. There is no gallery and no X export.
 */

export interface FormatReference {
  id: string;
  family: "carousel" | "explainer" | "hook";
  platform: "linkedin";
  name: string;
  exampleUrl: string;
  observedDate: string;
  structure: string;
  permittedUse: "structure_only";
  live: false;
}

export const FORMAT_LIBRARY: FormatReference[] = [
  {
    id: "practical-document-carousel",
    family: "carousel",
    platform: "linkedin",
    name: "Practical document carousel",
    exampleUrl: "https://www.linkedin.com/posts/socialinsider_how-to-get-more-engagement-on-linkedin-activity-7455210970722791424-xVI7",
    observedDate: "2026-11-07",
    structure: "Portrait pages. A cover promise, one useful point on each following page, a short close and a soft ask.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "planning-calendar-carousel",
    family: "carousel",
    platform: "linkedin",
    name: "Useful planning carousel",
    exampleUrl: "https://www.linkedin.com/posts/thecreativeconnect-uk_ukbusiness-contentstrategy-digitalmarketing-activity-7523092845348646913--_7I",
    observedDate: "2026-11-07",
    structure: "A sequence people can save and follow, with one action or date idea per page. This is the checklist-carousel recipe.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "saveable-checklist",
    family: "explainer",
    platform: "linkedin",
    name: "Saveable checklist",
    exampleUrl: "",
    observedDate: "2026-11-07",
    structure: "One portrait image that still makes sense without the caption. A short checklist with clear hierarchy. No comparison table and no fake button.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "text-hook-post",
    family: "hook",
    platform: "linkedin",
    name: "Text hook post",
    exampleUrl: "",
    observedDate: "2026-11-08",
    structure: "A short hook, two or three alternative hooks, and a LinkedIn caption. No image and no pages to render.",
    permittedUse: "structure_only",
    live: false,
  },
];

export function formatReferenceFor(family: FormatReference["family"]): FormatReference {
  const found = FORMAT_LIBRARY.find((item) => item.family === family);
  if (!found) throw new Error(`No format reference for ${family}`);
  return found;
}

export function evergreenLabel(): string {
  return "Evergreen format";
}
