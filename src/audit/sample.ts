/**
 * Static Bent Pixels example. Bent Pixels is the only example brand.
 * Signals below were read from the public homepage HTML on 9 Nov 2026
 * (Framer, Inter / Geist / Poppins, blue CSS colours, the homepage offer)
 * and from the public brands page lead. This object is not a live crawl.
 */

import { makeCheck, overallFromChecks, rankBreaks } from "./checks";
import type { AuditResult } from "./types";

const checks = [
  makeCheck("palette", 86, [
    {
      surface: "site",
      detail:
        "Homepage CSS chromatic colours sit in one blue family: #0099ff, #007bff, #228dff, #72b6ff, #004084, beside neutral ink #12141f. No blog or deck was part of this example, so other channels were not compared.",
      evidenceUrl: "https://www.bentpixels.com/",
    },
  ]),
  makeCheck("logo", 62, [
    {
      surface: "site",
      detail:
        "Only a favicon or social image was found in the static homepage. That does not confirm the logo is used as the brand mark.",
      evidenceUrl: "https://framerusercontent.com/images/KaXMLJ6vLdCCb4PDh9PhlpTjdEs.png",
    },
  ]),
  makeCheck("type", 64, [
    {
      surface: "site",
      detail: "The homepage names 3 typefaces: Inter, Geist, Poppins. Three families on one page is a mixed type signal.",
      evidenceUrl: "https://www.bentpixels.com/",
    },
  ]),
  makeCheck("voice", 60, [
    {
      surface: "site",
      detail:
        "Not assessed across channels. The homepage speaks as we, in short sentences, and rarely uses exclamations. No LinkedIn caption was pasted in this example. This is not a pass.",
    },
  ]),
  makeCheck("message", 36, [
    {
      surface: "site",
      detail:
        "The homepage lead is 'The Original Creator TV Platform' and 'We don't buy impressions, We build communities.' The brands page lead is 'Where Scale, Safety, and Storytelling Meet,' aimed at advertisers. The offer shifts between creators and brand buyers on the same site.",
      evidenceUrl: "https://www.bentpixels.com/brands",
    },
  ]),
  makeCheck("formats", 60, [
    {
      surface: "deck",
      detail: "Not assessed. No deck was uploaded, so template consistency was not checked. This is not a pass.",
    },
  ]),
];

export const BENT_PIXELS_SAMPLE: AuditResult = {
  brand: {
    name: "Bent Pixels",
    siteUrl: "https://www.bentpixels.com/",
    logoUrl: "https://framerusercontent.com/images/KaXMLJ6vLdCCb4PDh9PhlpTjdEs.png",
    palette: ["#0099ff", "#007bff", "#228dff", "#72b6ff", "#004084", "#12141f"],
    fonts: ["Inter", "Geist", "Poppins"],
    voiceSummary: "Short sentences, speaks as we, rarely uses exclamations.",
  },
  overallScore: overallFromChecks(checks),
  checks,
  topBreaks: rankBreaks(checks),
  toolsAndFormats: {
    detected: ["Framer"],
    requested: ["Claude", "Figma", "LinkedIn posts", "sales deck"],
  },
  skippedSurfaces: [
    { surface: "blog", reason: "This example does not include a blog URL." },
    { surface: "linkedin", reason: "LinkedIn pages are not fetched, and this example has no pasted caption." },
    { surface: "deck", reason: "No deck was uploaded." },
  ],
  generatedAt: "2026-11-09T12:00:00.000Z",
};

export function sampleAuditResult(): AuditResult {
  return BENT_PIXELS_SAMPLE;
}
