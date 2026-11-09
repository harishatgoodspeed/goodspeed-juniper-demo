import type { AuditResult } from "./types";

/**
 * Bent Pixels example, matching the audit engine sample.
 * Palette, type, and the Framer detection were read from the public site.
 * Voice and formats are "Not assessed" (score 60, status warn) and are left
 * out of overallScore and topBreaks. The logo line is site presence only.
 * requested lists tools first, then formats, in one array.
 */
export const bentPixelsAuditResult: AuditResult = {
  brand: {
    name: "Bent Pixels",
    siteUrl: "https://www.bentpixels.com/",
    logoUrl: "https://framerusercontent.com/images/KaXMLJ6vLdCCb4PDh9PhlpTjdEs.png",
    palette: ["#0099ff", "#007bff", "#228dff", "#72b6ff", "#004084", "#12141f"],
    fonts: ["Inter", "Geist", "Poppins"],
    voiceSummary: "Short sentences, speaks as we, rarely uses exclamations.",
  },
  overallScore: 62,
  checks: [
    {
      id: "palette",
      label: "Colour palette",
      score: 86,
      status: "ok",
      findings: [
        {
          surface: "site",
          detail:
            "Homepage CSS chromatic colours sit in one blue family: #0099ff, #007bff, #228dff, #72b6ff, #004084, beside neutral ink #12141f. No blog or deck was part of this example, so other channels were not compared.",
          evidenceUrl: "https://www.bentpixels.com/",
        },
      ],
    },
    {
      id: "logo",
      label: "Logo",
      score: 62,
      status: "warn",
      findings: [
        {
          surface: "site",
          detail:
            "Only a favicon or social image was found in the static homepage. That does not confirm the logo is used as the brand mark.",
          evidenceUrl: "https://framerusercontent.com/images/KaXMLJ6vLdCCb4PDh9PhlpTjdEs.png",
        },
      ],
    },
    {
      id: "type",
      label: "Typography",
      score: 64,
      status: "warn",
      findings: [
        {
          surface: "site",
          detail: "The homepage names 3 typefaces: Inter, Geist, Poppins. Three families on one page is a mixed type signal.",
          evidenceUrl: "https://www.bentpixels.com/",
        },
      ],
    },
    {
      id: "voice",
      label: "Voice and tone",
      score: 60,
      status: "warn",
      findings: [
        {
          surface: "site",
          detail:
            "Not assessed across channels. The homepage speaks as we, in short sentences, and rarely uses exclamations. No LinkedIn caption was pasted in this example. This is not a pass.",
        },
      ],
    },
    {
      id: "message",
      label: "Core message",
      score: 36,
      status: "break",
      findings: [
        {
          surface: "site",
          detail:
            "The homepage lead is 'The Original Creator TV Platform' and 'We don't buy impressions, We build communities.' The brands page lead is 'Where Scale, Safety, and Storytelling Meet,' aimed at advertisers. The offer shifts between creators and brand buyers on the same site.",
          evidenceUrl: "https://www.bentpixels.com/brands",
        },
      ],
    },
    {
      id: "formats",
      label: "Formats and templates",
      score: 60,
      status: "warn",
      findings: [
        {
          surface: "deck",
          detail: "Not assessed. No deck was uploaded, so template consistency was not checked. This is not a pass.",
        },
      ],
    },
  ],
  topBreaks: [
    {
      rank: 1,
      title: "Core message",
      surface: "site",
      whyItMatters: "People should meet the same offer on every channel. When the story shifts, buyers get confused and the work is redone.",
      cost: "Rework and confused buyers",
    },
    {
      rank: 2,
      title: "Logo",
      surface: "site",
      whyItMatters: "The mark is how people recognise you at a glance. A missing or unclear logo makes the brand look unmanaged.",
      cost: "The brand looks unmanaged",
    },
    {
      rank: 3,
      title: "Typography",
      surface: "site",
      whyItMatters: "Type is a system. When every channel picks its own fonts, every new deck starts again.",
      cost: "Rework on every deck",
    },
  ],
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
