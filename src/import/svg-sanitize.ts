import * as cheerio from "cheerio";

/**
 * Conservative SVG sanitiser for untrusted remote SVGs. Strips script
 * execution surfaces and external references; does not attempt to be a full
 * XSS-proof sanitiser for every edge case (that would warrant a maintained
 * library such as DOMPurify) — documented as a known limitation suitable for
 * a private prototype, flagged for hardening before wider use.
 */
export function sanitizeSvg(raw: string): string {
  const $ = cheerio.load(raw, { xmlMode: true });

  $("script, foreignObject, iframe, embed, object").remove();

  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    const attribs = { ...el.attribs };
    for (const name of Object.keys(attribs)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on")) {
        $(el).removeAttr(name);
        continue;
      }
      if (lower === "href" || lower === "xlink:href") {
        const value = attribs[name];
        if (!value.startsWith("#") && !value.startsWith("data:image/")) {
          $(el).removeAttr(name);
        }
      }
    }
  });

  return $.xml();
}
