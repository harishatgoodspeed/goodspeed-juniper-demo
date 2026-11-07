/**
 * Server owned format library. These are observed structures, not proof of
 * virality and not fresh live discovery. Permitted use is the structure only.
 * Observed dates are the research dates from 7 November 2026, Europe/London.
 */

export interface FormatReference {
  id: string;
  family: "carousel" | "explainer" | "proof";
  platform: "linkedin" | "x";
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
    structure: "A sequence people can save and follow, with one action or date idea per page.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "saveable-framework",
    family: "explainer",
    platform: "x",
    name: "Saveable checklist or framework",
    exampleUrl: "https://x.com/Akankshaku46881/status/2118921437910274452",
    observedDate: "2026-11-07",
    structure: "One image that still makes sense without the caption. Hierarchy, a short list or a comparison. No fake button.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "proof-walkthrough",
    family: "proof",
    platform: "x",
    name: "Proof led walkthrough",
    exampleUrl: "https://x.com/i/status/2118725601528062135",
    observedDate: "2026-11-06",
    structure: "A real screenshot or detail with one insight. If the image is missing, use a text led point instead of a fake picture.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "proof-with-resources",
    family: "proof",
    platform: "x",
    name: "Demonstration with resources",
    exampleUrl: "https://x.com/i/status/2117998992126591399",
    observedDate: "2026-11-04",
    structure: "Show the thing, then a short list of what the reader can do next. No invented result.",
    permittedUse: "structure_only",
    live: false,
  },
  {
    id: "proof-tool-demo",
    family: "proof",
    platform: "x",
    name: "Tool demonstration",
    exampleUrl: "https://x.com/i/status/2116847879071404490",
    observedDate: "2026-11-01",
    structure: "A practical demonstration of a tool or method. Do not copy the artwork or claim the creator's results.",
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
