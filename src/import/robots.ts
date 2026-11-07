/**
 * Minimal robots.txt check. Good enough to respect an explicit Disallow for
 * our user-agent or "*" on the exact path we're about to fetch — not a full
 * RFC 9309 implementation (no wildcard/$ matching, no crawl-delay, no sitemap
 * parsing). Documented as a known limitation.
 */
export interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
}

export function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let current: RobotsRule | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      current = { userAgent: value.toLowerCase(), disallow: [], allow: [] };
      rules.push(current);
    } else if (key === "disallow" && current) {
      if (value) current.disallow.push(value);
    } else if (key === "allow" && current) {
      if (value) current.allow.push(value);
    }
  }
  return rules;
}

export function isPathAllowed(rules: RobotsRule[], userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase();
  const applicable = rules.filter((r) => r.userAgent === ua);
  const group = applicable.length > 0 ? applicable : rules.filter((r) => r.userAgent === "*");

  let bestMatch: { length: number; allowed: boolean } | null = null;
  for (const rule of group) {
    for (const d of rule.disallow) {
      if (d === "") continue; // empty Disallow means allow everything
      if (path.startsWith(d) && (!bestMatch || d.length > bestMatch.length)) {
        bestMatch = { length: d.length, allowed: false };
      }
    }
    for (const a of rule.allow) {
      if (path.startsWith(a) && (!bestMatch || a.length > bestMatch.length)) {
        bestMatch = { length: a.length, allowed: true };
      }
    }
  }
  return bestMatch ? bestMatch.allowed : true;
}
