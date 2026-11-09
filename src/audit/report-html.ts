import type { AuditCheck, AuditCheckId, AuditEvidenceSide, AuditFinding, AuditResult, AuditStatus } from "./types";

/** A4 at 96 CSS pixels per inch. Same page box as the one pager renderer. */
export const AUDIT_PAGE = { width: 794, height: 1123 };

export const GOODSPEED_CONTACT_URL = "https://goodspeed.studio/contact";

/** Static report copy. British English. No dashes used as punctuation, and no hyphens. */
export const REPORT_COPY = {
  wordmark: "Goodspeed",
  kicker: "Free brand audit",
  title: "Where your brand is breaking",
  scoreLabel: "Overall score, out of 100",
  colours: "Approved colours",
  typefaces: "Approved typefaces",
  voice: "Approved voice",
  generated: "Generated free with Goodspeed Brand OS",
  noColours: "No colours were provided.",
  noTypefaces: "No typefaces were provided.",
  noVoice: "No voice summary was provided.",
  logoSkipped: "The logo address was not embedded. This report does not fetch remote files.",
  breaksLede: "Ranked as this audit returned them. Cost is in plain words. No money figures are added here.",
  noBreaks: "This audit did not rank any breaks.",
  why: "Why it matters",
  cost: "What it costs",
  scorecard: "Scorecard",
  scorecardLede: "Each score is the score this audit returned. A check missing from the result is left blank.",
  noFindings: "No findings were recorded for this check.",
  notIncluded: "Not included in this result.",
  holding: "Holding",
  watch: "Watch",
  breaking: "Breaking",
  notAssessed: "Not assessed",
  skippedTitle: "What we could not check",
  skippedLede: "Anything listed here was not assessed. A gap is not a pass.",
  nothingSkipped: "No surface was skipped.",
  toolsTitle: "Your tools and formats",
  toolsLede: "Detected is what the audit could see. You asked for lists tools first, then the formats you ship.",
  detected: "Detected",
  requested: "You asked for",
  nothingDetected: "Nothing was detected.",
  nothingRequested: "Nothing was requested.",
  installNote: "Any install starts from your own approved designs.",
  talk: "Talk to Goodspeed",
  closeLede: "Bring the breaks in this report. The work after this starts from designs you have already approved.",
  noEmail: "This report did not ask for your email.",
  prepared: "Prepared for",
} as const;

const CHECK_ORDER: readonly AuditCheckId[] = ["palette", "logo", "type", "voice", "message", "formats"];

const DEFAULT_LABEL: Record<AuditCheckId, string> = {
  palette: "Colour palette",
  logo: "Logo",
  type: "Typography",
  voice: "Voice and tone",
  message: "Core message",
  formats: "Formats and templates",
};

const STATUS_LABEL: Record<AuditStatus, string> = {
  ok: REPORT_COPY.holding,
  warn: REPORT_COPY.watch,
  break: REPORT_COPY.breaking,
};

const SURFACE_LABEL: Record<string, string> = {
  site: "Website",
  blog: "Blog",
  linkedin: "LinkedIn",
  deck: "Deck",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  meta: "Meta ads",
};

export function formatAuditDate(generatedAt: string): string | null {
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(parsed));
}

export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "";
  return String(score);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function surfaceLabel(surface: string): string {
  return SURFACE_LABEL[surface] ?? surface;
}

/** Only a small inline image may be embedded. Remote addresses are not fetched. */
export function safeLogoSrc(logoUrl: string | undefined): string | null {
  if (!logoUrl) return null;
  const compact = logoUrl.replace(/\s/g, "");
  if (compact.length > 200_000) return null;
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(compact)) return compact;
  return null;
}

/**
 * A check is assessed only when some finding is a real comparison.
 * The engine leaves an unassessed check at score 60 and status warn, with
 * every finding starting "Not assessed". That is not a warning.
 */
export function isAssessedCheck(check: AuditCheck): boolean {
  return check.findings.some((finding) => !finding.detail.startsWith("Not assessed"));
}

function checkSummary(checks: AuditCheck[]): string {
  const assessed = checks.filter(isAssessedCheck);
  const leftOut = checks.length - assessed.length;
  const leftNote =
    leftOut === 0 ? "" : leftOut === 1 ? " 1 check was not assessed." : ` ${leftOut} checks were not assessed.`;
  if (assessed.length === 0) return `No check was assessed.${leftNote}`.trim();
  const breaking = assessed.filter((check) => check.status === "break").length;
  const watch = assessed.filter((check) => check.status === "warn").length;
  let lead: string;
  if (breaking === 1) lead = `1 of ${assessed.length} checks is breaking.`;
  else if (breaking > 1) lead = `${breaking} of ${assessed.length} checks are breaking.`;
  else if (watch === 1) lead = `1 of ${assessed.length} checks needs a closer look.`;
  else if (watch > 1) lead = `${watch} of ${assessed.length} checks need a closer look.`;
  else if (assessed.length === 1) lead = "The check that was assessed is holding.";
  else lead = `All ${assessed.length} checks are holding.`;
  return `${lead}${leftNote}`;
}

function swatches(colours: string[], onDark: boolean): string {
  const safe = colours.filter((colour) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colour));
  if (safe.length === 0) {
    if (colours.length === 0) return `<p class="quiet">${REPORT_COPY.noColours}</p>`;
    return `<p class="quiet">${colours.map((colour) => escapeHtml(colour)).join(", ")}</p>`;
  }
  const klass = onDark ? "swatch swatch-dark" : "swatch";
  return `<div class="swatches">${safe
    .map((colour) => `<span class="${klass}" style="background:${colour}"></span>`)
    .join("")}</div>`;
}

function chips(items: string[], empty: string): string {
  if (items.length === 0) return `<p class="quiet">${empty}</p>`;
  return `<ul class="chips">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function runningFooter(dateLabel: string): string {
  return `<footer class="run-foot"><span>${REPORT_COPY.generated}</span><span>${escapeHtml(dateLabel)}</span><span class="pageno"></span></footer>`;
}

function pageBar(brandName: string): string {
  return `<header class="mast"><span class="wordmark">${REPORT_COPY.wordmark}</span><span>${escapeHtml(brandName)}</span></header>`;
}

function cover(result: AuditResult, dateLabel: string): string {
  const { brand } = result;
  const logo = safeLogoSrc(brand.logoUrl);
  const titleSize = brand.name.length > 32 ? 40 : brand.name.length > 18 ? 52 : 64;
  const logoBlock = logo
    ? `<img class="logo" src="${escapeHtml(logo)}" alt="" />`
    : brand.logoUrl
      ? `<p class="logo-note">${REPORT_COPY.logoSkipped}</p>`
      : "";
  const typeLine =
    brand.fonts.length > 0
      ? brand.fonts.map((font) => escapeHtml(font)).join(", ")
      : REPORT_COPY.noTypefaces;

  return `<article class="sheet cover">
    <header class="cover-top">
      <span class="wordmark">${REPORT_COPY.wordmark}</span>
      <span>${REPORT_COPY.kicker}</span>
    </header>
    <div class="cover-main">
      <div class="cover-identity">
        <p class="eyebrow">${REPORT_COPY.title}</p>
        <h1 style="font-size:${titleSize}px">${escapeHtml(brand.name)}</h1>
        <p class="url">${escapeHtml(brand.siteUrl)}</p>
        ${logoBlock}
      </div>
      <div class="cover-result">
      <div class="score-block">
        <p class="score">${escapeHtml(formatScore(result.overallScore))}</p>
        <p class="score-label">${REPORT_COPY.scoreLabel}</p>
        <p class="score-note">${escapeHtml(checkSummary(result.checks))}</p>
      </div>
      <div class="cover-specimens">
        <div>
          <p class="meta-label">${REPORT_COPY.colours}</p>
          ${swatches(brand.palette, true)}
        </div>
        <div>
          <p class="meta-label">${REPORT_COPY.typefaces}</p>
          <p class="type-line">${typeLine}</p>
        </div>
      </div>
      </div>
    </div>
    <footer class="cover-foot">
      <p>${escapeHtml(dateLabel)}</p>
      <p>${REPORT_COPY.generated}</p>
    </footer>
  </article>`;
}

function breaksPage(result: AuditResult, dateLabel: string): string {
  const ordered = [...result.topBreaks].sort((a, b) => a.rank - b.rank || 0);
  const body =
    ordered.length === 0
      ? `<p class="quiet">${REPORT_COPY.noBreaks}</p>`
      : ordered
          .map(
            (item) => `<section class="break">
              <p class="rank">${escapeHtml(String(item.rank))}</p>
              <div>
                <h3>${escapeHtml(item.title)}</h3>
                <p class="surface">${escapeHtml(surfaceLabel(item.surface))}</p>
                <h4>${REPORT_COPY.why}</h4>
                <p>${escapeHtml(item.whyItMatters)}</p>
                <h4>${REPORT_COPY.cost}</h4>
                <p>${escapeHtml(item.cost)}</p>
              </div>
            </section>`
          )
          .join("");

  return `<article class="sheet">
    ${pageBar(result.brand.name)}
    <div class="body">
      <h2>${REPORT_COPY.title}</h2>
      <p class="lede">${REPORT_COPY.breaksLede}</p>
      <div class="breaks">${body}</div>
    </div>
    ${runningFooter(dateLabel)}
  </article>`;
}

function scorecardPage(result: AuditResult, dateLabel: string): string {
  const byId = new Map(result.checks.map((check) => [check.id, check]));
  const rows = CHECK_ORDER.map((id) => {
    const check = byId.get(id);
    if (!check) {
      return `<section class="check missing">
        <h3>${DEFAULT_LABEL[id]}</h3>
        <p class="quiet">${REPORT_COPY.notIncluded}</p>
      </section>`;
    }
    const findings = findingList(check);
    if (!isAssessedCheck(check)) {
      return `<section class="check unassessed">
        <div class="check-top">
          <h3>${escapeHtml(check.label || DEFAULT_LABEL[id])}</h3>
          <p class="check-score"><span class="status status-unassessed">${REPORT_COPY.notAssessed}</span></p>
        </div>
        ${findings}
      </section>`;
    }
    const width = Number.isInteger(check.score) && check.score >= 0 && check.score <= 100 ? String(check.score) : null;
    return `<section class="check">
      <div class="check-top">
        <h3>${escapeHtml(check.label)}</h3>
        <p class="check-score"><span class="num">${escapeHtml(formatScore(check.score))}</span><span class="status status-${check.status}">${STATUS_LABEL[check.status]}</span></p>
      </div>
      ${width === null ? "" : `<div class="meter" aria-hidden="true"><span class="fill fill-${check.status}" style="width:${width}%"></span></div>`}
      ${findings}
    </section>`;
  }).join("");

  const voice = result.brand.voiceSummary.trim()
    ? escapeHtml(result.brand.voiceSummary.trim())
    : REPORT_COPY.noVoice;

  return `<article class="sheet">
    ${pageBar(result.brand.name)}
    <div class="body">
      <h2>${REPORT_COPY.scorecard}</h2>
      <p class="lede">${REPORT_COPY.scorecardLede}</p>
      <p class="baseline"><span class="meta-label">${REPORT_COPY.voice}</span> ${voice}</p>
      <div class="checks">${rows}</div>
    </div>
    ${runningFooter(dateLabel)}
  </article>`;
}

function findingList(check: AuditCheck): string {
  if (check.findings.length === 0) return `<p class="quiet">${REPORT_COPY.noFindings}</p>`;
  return `<ul class="findings">${check.findings
    .map((finding) => {
      const source = finding.evidenceUrl
        ? `<a class="evidence" href="${escapeHtml(finding.evidenceUrl)}">${escapeHtml(finding.evidenceUrl)}</a>`
        : "";
      const why = finding.whyItMatters ? `<p class="why">${escapeHtml(finding.whyItMatters)}</p>` : "";
      return `<li><span class="surf">${escapeHtml(surfaceLabel(finding.surface))}</span><span class="detail">${escapeHtml(finding.detail)}</span>${why}${source}</li>`;
    })
    .join("")}</ul>`;
}

function comparisonBlock(comparison: AuditFinding["comparison"]): string {
  if (!comparison) return "";
  return `<div class="compare">${sideHtml(comparison.site)}${sideHtml(comparison.other)}</div>`;
}

function sideHtml(side: AuditEvidenceSide): string {
  const img = side.imageUrl && side.imageUrl.startsWith("data:") ? `<img src="${side.imageUrl}" alt="">` : "";
  const swatches = (side.swatches || [])
    .map((hex) => `<span class="swatch" style="background:${escapeHtml(hex)}"></span>`)
    .join("");
  const text = side.text ? `<p>${escapeHtml(side.text)}</p>` : "";
  return `<figure><figcaption>${escapeHtml(side.caption)}</figcaption>${img}${swatches ? `<div class="swatch-row">${swatches}</div>` : ""}${text}</figure>`;
}

function evidencePage(result: AuditResult, dateLabel: string): string {
  const pairs = result.checks.flatMap((check) => check.findings.filter((finding) => finding.comparison));
  if (pairs.length === 0) return "";
  const blocks = pairs
    .map((finding) => {
      const link = finding.evidenceUrl
        ? `<a class="evidence" href="${escapeHtml(finding.evidenceUrl)}">${escapeHtml(finding.evidenceUrl)}</a>`
        : "";
      const why = finding.whyItMatters ? `<p class="why">${escapeHtml(finding.whyItMatters)}</p>` : "";
      return `<section class="pair"><p><span class="surf">${escapeHtml(surfaceLabel(finding.surface))}</span> ${escapeHtml(finding.detail)}</p>${why}${comparisonBlock(finding.comparison)}${link}</section>`;
    })
    .join("");
  return `<article class="sheet">
    ${pageBar(result.brand.name)}
    <div class="body">
      ${storyCard(result)}
      <h2>Side by side</h2>
      <p class="lede">Each pair is something the audit actually read. A missing picture means that file could not be embedded.</p>
      ${blocks}
    </div>
    ${runningFooter(dateLabel)}
  </article>`;
}

function storyCard(result: AuditResult): string {
  const rows = result.storyChanges || [];
  if (rows.length === 0) return "";
  const lines = rows
    .map(
      (row) =>
        `<li><span class="surf">${escapeHtml(row.label)}</span><span class="detail">${escapeHtml(row.sells)}</span></li>`
    )
    .join("");
  const verdict = result.storyVerdict ? `<p class="lede">${escapeHtml(result.storyVerdict)}</p>` : "";
  return `<section class="story"><h2>Where your story changes</h2>${verdict}<ul class="findings">${lines}</ul></section>`;
}

function gapsPage(result: AuditResult, dateLabel: string): string {
  const unassessed = result.checks.filter((check) => !isAssessedCheck(check));
  const skippedItems = [
    ...result.skippedSurfaces.map(
      (item) =>
        `<li><span class="surf">${escapeHtml(surfaceLabel(item.surface))}</span><span class="detail">${escapeHtml(item.reason)}</span></li>`
    ),
    ...unassessed.flatMap((check) =>
      check.findings.map(
        (finding) =>
          `<li><span class="surf">${escapeHtml(check.label || DEFAULT_LABEL[check.id])}</span><span class="detail">${escapeHtml(finding.detail)}</span></li>`
      )
    ),
  ];
  const skipped =
    skippedItems.length === 0
      ? `<p class="quiet">${REPORT_COPY.nothingSkipped}</p>`
      : `<ul class="skips">${skippedItems.join("")}</ul>`;

  return `<article class="sheet">
    ${pageBar(result.brand.name)}
    <div class="body gaps">
      <section>
        <h2>${REPORT_COPY.skippedTitle}</h2>
        <p class="lede">${REPORT_COPY.skippedLede}</p>
        ${skipped}
      </section>
      <section>
        <h2>${REPORT_COPY.toolsTitle}</h2>
        <p class="lede">${REPORT_COPY.toolsLede}</p>
        <div class="tool-cols">
          <div>
            <h3>${REPORT_COPY.detected}</h3>
            ${chips(result.toolsAndFormats.detected, REPORT_COPY.nothingDetected)}
          </div>
          <div>
            <h3>${REPORT_COPY.requested}</h3>
            ${chips(result.toolsAndFormats.requested, REPORT_COPY.nothingRequested)}
          </div>
        </div>
      </section>
      <aside class="note"><p>${REPORT_COPY.installNote}</p></aside>
    </div>
    ${runningFooter(dateLabel)}
  </article>`;
}

function closePage(result: AuditResult, dateLabel: string): string {
  return `<article class="sheet close">
    <header class="cover-top">
      <span class="wordmark">${REPORT_COPY.wordmark}</span>
      <span class="pageno"></span>
    </header>
    <div class="close-main">
      <p class="eyebrow">${REPORT_COPY.kicker}</p>
      <h2><a href="${GOODSPEED_CONTACT_URL}">${REPORT_COPY.talk}</a></h2>
      <p class="close-lede">${REPORT_COPY.closeLede}</p>
      <p class="close-url"><a href="${GOODSPEED_CONTACT_URL}">${GOODSPEED_CONTACT_URL}</a></p>
      <p class="close-note">${REPORT_COPY.noEmail}</p>
    </div>
    <footer class="cover-foot">
      <p>${REPORT_COPY.prepared} ${escapeHtml(result.brand.name)}</p>
      <p>${escapeHtml(dateLabel)}</p>
    </footer>
  </article>`;
}

export function buildAuditReportHtml(result: AuditResult): string {
  const formatted = formatAuditDate(result.generatedAt);
  const dateLabel = formatted ?? result.generatedAt;
  const { width, height } = AUDIT_PAGE;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(result.brand.name)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f4f2ec; }
  body {
    width: ${width}px;
    color: #1c1c1c;
    font-family: Inter, "Liberation Sans", "DejaVu Sans", sans-serif;
    font-size: 14px;
    line-height: 1.4;
    hyphens: none;
  }
  @page { size: ${width}px ${height}px; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    background: #f4f2ec;
    counter-increment: sheet;
  }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  h1, h2, h3, h4, p { margin: 0; }
  ul { margin: 0; padding: 0; list-style: none; }
  a { color: inherit; }
  .wordmark { font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; }
  .mast {
    height: 52px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 40px;
    background: #1f3a2e;
    color: #f4f2ec;
    font-size: 13px;
  }
  .mast span:last-child { text-align: right; overflow-wrap: anywhere; }
  .body { flex: 1; min-height: 0; padding: 32px 44px 12px; display: flex; flex-direction: column; }
  .run-foot {
    height: 36px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 44px;
    border-top: 1px solid #e3e0d8;
    color: #5c5a55;
    font-size: 11px;
  }
  .pageno::before { content: counter(sheet) " of 5"; }
  h2 {
    font-family: "Liberation Serif", "DejaVu Serif", Georgia, serif;
    font-size: 34px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: 0;
  }
  .lede { margin-top: 8px; max-width: 640px; color: #3c3a36; font-size: 14px; }
  .quiet { color: #5c5a55; }
  .meta-label {
    display: block;
    margin-bottom: 6px;
    color: inherit;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.72;
  }

  .cover, .close { background: #1f3a2e; color: #f4f2ec; }
  .cover-top {
    height: 64px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 48px;
    font-size: 13px;
  }
  .cover-main {
    flex: 1;
    padding: 56px 48px 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .eyebrow {
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.78;
  }
  .cover h1 {
    margin-top: 14px;
    max-width: 680px;
    font-family: "Liberation Serif", "DejaVu Serif", Georgia, serif;
    font-weight: 700;
    line-height: 1.02;
    letter-spacing: 0;
    overflow-wrap: anywhere;
  }
  .url { margin-top: 12px; font-size: 15px; opacity: 0.8; overflow-wrap: anywhere; }
  .logo { width: 72px; height: 72px; object-fit: contain; margin-top: 18px; background: #f4f2ec; border-radius: 10px; }
  .logo-note { margin-top: 16px; max-width: 420px; font-size: 13px; opacity: 0.8; }
  .score-block { margin-top: 0; }
  .cover-specimens { margin-top: 28px; display: flex; flex-direction: column; gap: 16px; }
  .score {
    font-family: "Liberation Serif", "DejaVu Serif", Georgia, serif;
    font-size: 128px;
    line-height: 0.85;
    font-weight: 700;
  }
  .score-label { margin-top: 10px; font-size: 16px; }
  .score-note { margin-top: 4px; font-size: 15px; opacity: 0.78; }
  .cover-foot {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 48px 36px;
  }
  .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(28, 28, 28, 0.18); }
  .swatch-dark { border-color: rgba(244, 242, 236, 0.55); }
  .type-line { font-size: 15px; overflow-wrap: anywhere; }
  .cover-generated { font-size: 13px; opacity: 0.78; }
  .cover-generated p + p { margin-top: 2px; }

  .breaks { margin-top: 8px; display: flex; flex-direction: column; }
  .break {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 10px;
    padding: 22px 0 24px;
    border-top: 1px solid #e3e0d8;
  }
  .rank {
    font-family: "Liberation Serif", "DejaVu Serif", Georgia, serif;
    font-size: 32px;
    line-height: 1;
    color: #1f3a2e;
  }
  .break h3 {
    font-family: "Liberation Serif", "DejaVu Serif", Georgia, serif;
    font-size: 24px;
    line-height: 1.2;
    font-weight: 700;
  }
  .surface { margin-top: 4px; color: #5c5a55; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
  .break h4 {
    margin-top: 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #5c5a55;
  }
  .break p { font-size: 16px; line-height: 1.4; }

  .baseline { margin-top: 12px; font-size: 13px; line-height: 1.4; }
  .baseline .meta-label { display: inline; margin: 0 6px 0 0; color: #5c5a55; }
  .checks { margin-top: 8px; }
  .check { padding: 7px 0 8px; border-top: 1px solid #e3e0d8; }
  .check-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .check h3 { font-size: 14px; font-weight: 600; }
  .check-score { display: flex; align-items: baseline; gap: 8px; flex: none; }
  .check-score .num {
    font-family: "Liberation Serif", "DejaVu Serif", Georgia, serif;
    font-size: 18px;
    font-weight: 700;
  }
  .status { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  .status-ok { color: #245c32; }
  .status-warn { color: #8a5a12; }
  .status-break { color: #8c3a24; }
  .status-unassessed { color: #5c5a55; }
  .meter { height: 3px; margin-top: 5px; background: #e3e0d8; border-radius: 99px; }
  .fill { display: block; height: 3px; border-radius: 99px; }
  .fill-ok { background: #245c32; }
  .fill-warn { background: #8a5a12; }
  .fill-break { background: #8c3a24; }
  .findings { margin-top: 4px; }
  .findings li, .skips li { display: grid; grid-template-columns: 92px 1fr; gap: 8px; padding: 2px 0; font-size: 12px; line-height: 1.35; }
  .surf { color: #5c5a55; font-weight: 600; }
  .evidence { grid-column: 2; color: #5c5a55; overflow-wrap: anywhere; font-size: 11px; }
  .why, .compare { grid-column: 1 / -1; }
  .why { margin: 2px 0 0; color: #3d4a40; }
  .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
  .compare figure { margin: 0; background: #fff; border: 1px solid #e3e0d8; border-radius: 8px; padding: 8px; }
  .compare figcaption { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #5c685e; margin-bottom: 4px; }
  .compare img { max-width: 100%; max-height: 56px; object-fit: contain; }
  .compare p { margin: 4px 0 0; font-size: 12px; }
  .swatch-row { display: flex; gap: 4px; flex-wrap: wrap; }
  .swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15); }

  .gaps { justify-content: flex-start; }
  .gaps section + section { margin-top: 48px; }
  .tool-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 16px; }
  .tool-cols h3 { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #5c5a55; margin-bottom: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chips li {
    padding: 7px 12px;
    background: #fffdf8;
    border: 1px solid #e3e0d8;
    border-radius: 999px;
    font-size: 14px;
  }
  .skips { margin-top: 18px; }
  .skips li { grid-template-columns: 168px 1fr; font-size: 16px; line-height: 1.4; padding: 12px 0; border-top: 1px solid #e3e0d8; }
  .note {
    margin-top: auto;
    padding: 16px 18px;
    background: #1f3a2e;
    color: #f4f2ec;
    border-radius: 12px;
    font-size: 16px;
    line-height: 1.4;
  }

  .close-main { flex: 1; padding: 48px 48px 12px; display: flex; flex-direction: column; justify-content: center; }
  .close h2 {
    margin-top: 12px;
    font-size: 64px;
    max-width: 640px;
    line-height: 0.98;
  }
  .close h2 a { text-decoration: none; }
  .close-lede { margin-top: 18px; max-width: 520px; font-size: 18px; line-height: 1.4; }
  .close-url { margin-top: 22px; font-size: 16px; }
  .close-url a { text-decoration: underline; text-underline-offset: 3px; }
  .close-note { margin-top: 10px; font-size: 14px; opacity: 0.75; }
  .close .cover-foot { font-size: 14px; opacity: 0.8; }
  .close .pageno { font-size: 13px; }
</style>
</head>
<body>
${cover(result, dateLabel)}
${breaksPage(result, dateLabel)}
${evidencePage(result, dateLabel)}
${scorecardPage(result, dateLabel)}
${gapsPage(result, dateLabel)}
${closePage(result, dateLabel)}
</body>
</html>`;
}
