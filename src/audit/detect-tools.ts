/** Tool hints read from the site HTML. A hint is a string that is actually in the page, not a guess about competitors. */

const SIGNALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Framer", pattern: /framer\.com|framerusercontent|data-framer/i },
  { name: "Webflow", pattern: /webflow\.com|data-wf-/i },
  { name: "WordPress", pattern: /wp-content|wp-includes/i },
  { name: "Shopify", pattern: /cdn\.shopify\.com|myshopify\.com/i },
  { name: "Squarespace", pattern: /squarespace\.com|squarespace-cdn/i },
  { name: "Wix", pattern: /wixstatic\.com|\bwix\.com/i },
  { name: "Google Fonts", pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i },
  { name: "Next.js", pattern: /__NEXT_DATA__|\/_next\/static/i },
];

export function detectTools(html: string): string[] {
  return SIGNALS.filter((signal) => signal.pattern.test(html)).map((signal) => signal.name);
}
