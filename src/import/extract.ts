import * as cheerio from "cheerio";
import * as csstree from "css-tree";
import type { BrandContext, ColourCandidate, ContentImage, FontCandidate, LogoCandidate } from "./types";

const TEXT_EXCERPT_LIMIT = 4000;
const GENERIC_FONT_KEYWORDS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
]);

export interface FetchedStylesheet {
  url: string;
  text: string;
}

export interface ExtractInput {
  sourceUrl: string;
  html: string;
  stylesheets: FetchedStylesheet[];
  stylesheetsSkipped: number;
  fetchedAt?: string;
}

export function extractBrandContext(input: ExtractInput): BrandContext {
  const $ = cheerio.load(input.html);
  const unknowns: string[] = [];

  const title = $("head > title").first().text().trim() || null;
  const siteName = metaContent($, 'meta[property="og:site_name"]') ?? null;
  const description =
    metaContent($, 'meta[name="description"]') ?? metaContent($, 'meta[property="og:description"]') ?? null;
  if (!description) unknowns.push("No meta description or og:description found.");

  const logoCandidates = extractLogoCandidates($, input.sourceUrl);
  if (logoCandidates.length === 0) unknowns.push("No favicon, og:image, or header logo image/SVG found.");

  const inlineCss = $("style")
    .map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");
  const allCss = [inlineCss, ...input.stylesheets.map((s) => s.text)].join("\n");

  const { colours, customProperties } = extractColoursAndCustomProperties(allCss);
  if (colours.length === 0) unknowns.push("No colour declarations found in reachable CSS.");

  const fonts = extractFontDeclarations(allCss);
  const googleFontsLinks = extractGoogleFontsLinks($);
  if (fonts.length === 0 && googleFontsLinks.length === 0) {
    unknowns.push("No font-family, @font-face, or Google Fonts link found.");
  }

  const images = extractContentImages($, input.sourceUrl);

  const { text, truncated } = extractReadableText($);
  if (!text) unknowns.push("No readable body copy could be extracted.");

  if (input.stylesheetsSkipped > 0) {
    unknowns.push(
      `${input.stylesheetsSkipped} stylesheet(s) were not fetched (limit reached) and were not analysed.`
    );
  }

  return {
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    extractionMethod: "static-html-css",
    title,
    siteName,
    description,
    logoCandidates,
    colours,
    cssCustomProperties: customProperties,
    fonts,
    googleFontsLinks,
    images,
    textExcerpt: text,
    textTruncated: truncated,
    stylesheetsFetched: input.stylesheets.length,
    stylesheetsSkipped: input.stylesheetsSkipped,
    unknowns,
  };
}

function metaContent($: cheerio.CheerioAPI, selector: string): string | undefined {
  const val = $(selector).attr("content");
  return val ? val.trim() : undefined;
}

function toAbsolute(url: string, base: string): string | null {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function extractLogoCandidates($: cheerio.CheerioAPI, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];

  $('link[rel~="icon"], link[rel="shortcut icon"]').each((_, el) => {
    const href = $(el).attr("href");
    const abs = href && toAbsolute(href, baseUrl);
    if (abs) out.push({ url: abs, kind: "favicon", confidence: 0.3, method: "<link rel=icon>" });
  });

  const ogImage = metaContent($, 'meta[property="og:image"]');
  if (ogImage) {
    const abs = toAbsolute(ogImage, baseUrl);
    if (abs) out.push({ url: abs, kind: "og_image", confidence: 0.4, method: 'meta[property="og:image"]' });
  }

  $("header img, .header img, #header img, nav img").each((_, el) => {
    const alt = ($(el).attr("alt") ?? "").toLowerCase();
    const cls = ($(el).attr("class") ?? "").toLowerCase();
    const id = ($(el).attr("id") ?? "").toLowerCase();
    const src = $(el).attr("src");
    if (!src) return;
    const looksLikeLogo = /logo|brand|wordmark/.test(`${alt} ${cls} ${id}`);
    const abs = toAbsolute(src, baseUrl);
    if (abs) {
      out.push({
        url: abs,
        kind: "header_img",
        confidence: looksLikeLogo ? 0.7 : 0.45,
        method: looksLikeLogo ? "header <img> with logo-like alt/class" : "header <img> (first found)",
      });
    }
  });

  $("header svg, .header svg, #header svg, nav svg").each((_, el) => {
    const cls = ($(el).attr("class") ?? "").toLowerCase();
    const id = ($(el).attr("id") ?? "").toLowerCase();
    if (/logo|brand|wordmark/.test(`${cls} ${id}`)) {
      out.push({
        url: baseUrl,
        kind: "header_svg",
        confidence: 0.8,
        method: "inline <svg> in header with logo-like class/id (not separately downloadable — flagged for manual review)",
      });
    }
  });

  // The selectors above overlap (e.g. a <link rel="shortcut icon"> matches
  // both the rel~="icon" and rel="shortcut icon" halves of the first
  // selector; the same <img> can sit in both "header img" and "nav img"),
  // so the same URL+kind can be pushed more than once. Dedupe, keeping the
  // highest-confidence entry for each.
  const byKey = new Map<string, LogoCandidate>();
  for (const candidate of out) {
    const key = `${candidate.kind}:${candidate.url}`;
    const existing = byKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, candidate);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.confidence - a.confidence);
}

const COLOUR_PATTERN = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g;

export function normaliseToHex(value: string): string | null {
  const v = value.trim();
  if (v.startsWith("#")) {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 8) hex = hex.slice(0, 6); // drop alpha for grouping
    if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return `#${hex.toLowerCase()}`;
  }
  const rgbMatch = v.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((p) => parseFloat(p.trim()));
    const [r, g, b] = parts;
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return `#${[r, g, b].map((n) => clamp255(n).toString(16).padStart(2, "0")).join("").toLowerCase()}`;
  }
  // hsl/hsla are intentionally not converted (would need a colour-space
  // conversion we haven't pulled in for Phase 1); left for Phase 4's colour
  // library. Declarations using hsl() are skipped here, not invented.
  return null;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function extractColoursAndCustomProperties(css: string): {
  colours: ColourCandidate[];
  customProperties: { name: string; value: string }[];
} {
  const counts = new Map<string, { count: number; properties: Set<string> }>();
  const customProps = new Map<string, string>();

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { onParseError: () => undefined });
  } catch {
    return { colours: [], customProperties: [] };
  }

  csstree.walk(ast, (node) => {
    if (node.type === "Declaration") {
      const property = node.property;
      const value = csstree.generate(node.value);

      if (property.startsWith("--")) {
        customProps.set(property, value.trim());
      }

      const matches = value.match(COLOUR_PATTERN);
      if (matches) {
        for (const m of matches) {
          const hex = normaliseToHex(m);
          if (!hex) continue;
          const entry = counts.get(hex) ?? { count: 0, properties: new Set<string>() };
          entry.count += 1;
          entry.properties.add(property);
          counts.set(hex, entry);
        }
      }
    }
  });

  const colours: ColourCandidate[] = Array.from(counts.entries())
    .map(([hex, { count, properties }]) => ({
      hex,
      declarationCount: count,
      properties: Array.from(properties).slice(0, 8),
    }))
    .sort((a, b) => b.declarationCount - a.declarationCount);

  const customProperties = Array.from(customProps.entries()).map(([name, value]) => ({ name, value }));

  return { colours, customProperties };
}

/**
 * Reads literal font names from a CSS value's own structure instead of its
 * generated text. This matters because `font-family: var(--x, "Inter", sans-serif)`
 * has commas *inside* the var() function — splitting the generated text on
 * every comma (the naive approach) shreds that fallback chain into garbage
 * fragments. Walking only the Value node's direct children keeps a Function
 * child (var(...), and anything else we can't statically resolve) as a single
 * opaque unit that we skip, rather than guessing at its contents.
 */
function familyNamesFromValue(valueNode: csstree.CssNode): string[] {
  if (valueNode.type !== "Value") return [];
  const families: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) families.push(current.join(" "));
    current = [];
  };
  valueNode.children.forEach((child) => {
    if (child.type === "Operator" && child.value === ",") {
      flush();
    } else if (child.type === "Identifier") {
      current.push(child.name);
    } else if (child.type === "String") {
      current.push(stripQuotes(child.value));
    }
    // Function nodes (var(...), etc.) and anything else are left opaque: we
    // don't attempt to resolve custom-property fallback chains here.
  });
  flush();
  return families;
}

function extractFontDeclarations(css: string): FontCandidate[] {
  const families = new Map<string, FontCandidate>();

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { onParseError: () => undefined });
  } catch {
    return [];
  }

  csstree.walk(ast, (node) => {
    if (node.type === "Atrule" && node.name === "font-face") {
      let family: string | undefined;
      let url: string | undefined;
      let weight: string | undefined;
      if (node.block) {
        csstree.walk(node.block, (inner) => {
          if (inner.type === "Declaration") {
            const value = csstree.generate(inner.value);
            if (inner.property === "font-family") family = familyNamesFromValue(inner.value)[0];
            if (inner.property === "src") {
              const urlMatch = value.match(/url\(([^)]+)\)/i);
              if (urlMatch) url = stripQuotes(urlMatch[1]);
            }
            if (inner.property === "font-weight") weight = value.trim();
          }
        });
      }
      if (family) {
        families.set(`face:${family}`, { family, source: "@font-face", url, weight });
      }
      return;
    }
    if (node.type === "Declaration" && node.property === "font-family") {
      for (const name of familyNamesFromValue(node.value)) {
        if (!name || GENERIC_FONT_KEYWORDS.has(name.toLowerCase())) continue;
        const key = `decl:${name}`;
        if (!families.has(key)) {
          families.set(key, { family: name, source: "font-family" });
        }
      }
    }
  });

  return Array.from(families.values());
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

function extractGoogleFontsLinks($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/fonts\.googleapis\.com/i.test(href)) out.push(href);
  });
  return out;
}

function extractContentImages($: cheerio.CheerioAPI, baseUrl: string): ContentImage[] {
  const out: ContentImage[] = [];
  const seen = new Set<string>();
  $("main img, article img, body img").each((_, el) => {
    if (out.length >= 20) return; // bounded, per the import limits
    const src = $(el).attr("src");
    if (!src) return;
    const abs = toAbsolute(src, baseUrl);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, alt: ($(el).attr("alt") ?? "").trim() });
  });
  return out;
}

function extractReadableText($: cheerio.CheerioAPI): { text: string; truncated: boolean } {
  const clone = $.root().clone();
  clone.find("script, style, nav, footer, noscript, svg, header").remove();
  const container = clone.find("main").length ? clone.find("main") : clone.find("article").length ? clone.find("article") : clone.find("body");
  const text = container
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > TEXT_EXCERPT_LIMIT) {
    return { text: text.slice(0, TEXT_EXCERPT_LIMIT), truncated: true };
  }
  return { text, truncated: false };
}
