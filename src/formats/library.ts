/**
 * Server owned format library. These are structures the free tool is allowed
 * to borrow, not proof of virality and not a live trend feed.
 * Carousel dates are the research dates from 7 November 2026, Europe/London.
 * The hook post is a format we publish, not a copied example.
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
    structure:
      "Portrait pages, 1080 by 1350. A cover promise, one useful point on each following page, a short close and a soft ask. Six to eight pages.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "planning-calendar-carousel",
    family: "carousel",
    platform: "linkedin",
    name: "Checklist carousel",
    exampleUrl: "https://www.linkedin.com/posts/thecreativeconnect-uk_ukbusiness-contentstrategy-digitalmarketing-activity-7523092845348646913--_7I",
    observedDate: "2026-11-07",
    structure:
      "A sequence people can save and tick off, with one action per page. Cover, then one checklist item per page, then a short close.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "saveable-framework",
    family: "explainer",
    platform: "linkedin",
    name: "Saveable checklist",
    exampleUrl: "",
    observedDate: "2026-11-07",
    structure:
      "One portrait image that still makes sense without the caption. A title and four to six short checklist rows. No comparison columns and no fake button.",
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
    structure:
      "No image and no pages. One opening line, two or three alternative openings, and a LinkedIn caption that begins with the chosen opening and stands on its own.",
    permittedUse: "structure_only",
    live: false,
  },
];

export function formatReferenceFor(family: FormatReference["family"]): FormatReference {
  const found = FORMAT_LIBRARY.find((item) => item.family === family);
  if (!found) throw new Error(`No format reference for ${family}`);
  return found;
}

export function formatReferenceById(id: string): FormatReference | undefined {
  return FORMAT_LIBRARY.find((item) => item.id === id);
}

export function evergreenLabel(): string {
  return "Evergreen format";
}
