import type { BrandRow } from "./brands";
import type { RunRow } from "./runs";
import type { OutputRow, ReviewRow } from "./outputs";
import type { BrandContext } from "./import/types";
import { computeOverallPass } from "./review/review";

export interface ShareOutputView {
  output: OutputRow;
  reviews: ReviewRow[];
}

export interface SharePageData {
  brand: BrandRow;
  logoAssetId: string | null;
  run: RunRow | null;
  outputs: ShareOutputView[];
  /** Present only for a non-owner (shared-link) view, so asset/output URLs can carry it. Omitted for the owner's own session view, where the session cookie already grants access. */
  viewToken: string | null;
}

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withToken(url: string, token: string | null): string {
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Queued",
    briefing: "Drafting briefs",
    generating: "Rendering",
    reviewing: "Reviewing",
    completed: "Completed",
    partial: "Partially completed",
    failed: "Failed",
    ready: "Ready",
    pending: "Pending",
  };
  return labels[status] ?? status;
}

function outputTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    linkedin_image: "LinkedIn image",
    x_image: "X image",
    instagram_image: "Instagram image",
    one_pager_pdf: "One page PDF",
    slide: "Slide",
    post_copy: "Post copy",
  };
  return labels[type] ?? type;
}

function checkKindLabel(kind: string): string {
  const labels: Record<string, string> = { colour: "Colour", typography: "Typography", logo: "Logo", copy: "Copy" };
  return labels[kind] ?? kind;
}

function renderBrandSection(brand: BrandRow, context: BrandContext | null, logoAssetId: string | null, token: string | null): string {
  const logo = logoAssetId
    ? `<img class="logo" src="${esc(withToken(`/api/assets/${logoAssetId}`, token))}" alt="Approved logo for ${esc(context?.title ?? brand.source_url)}" width="160" height="60">`
    : `<p class="muted">No logo was approved for this brand.</p>`;

  return `
    <section aria-labelledby="brand-heading">
      <h2 id="brand-heading">The brand</h2>
      <p class="muted">Imported from <a href="${esc(brand.source_url)}">${esc(brand.source_url)}</a>.</p>
      ${logo}
    </section>`;
}

function renderBriefsSection(outputs: ShareOutputView[]): string {
  if (outputs.length === 0) {
    return `<section aria-labelledby="briefs-heading"><h2 id="briefs-heading">The briefs</h2><p class="muted">No briefs have been drafted yet.</p></section>`;
  }
  const items = outputs
    .map(({ output }) => {
      type BriefLike = {
        purpose?: string;
        audience?: string;
        layoutDirection?: string;
        sourcedFactualCopy?: string[];
        unknowns?: string[];
      };
      const brief: BriefLike = output.template_inputs_json ? JSON.parse(output.template_inputs_json) : {};
      const facts = (brief.sourcedFactualCopy ?? []).map((f) => `<li>${esc(f)}</li>`).join("");
      const unknowns = (brief.unknowns ?? []).map((u) => `<li>${esc(u)}</li>`).join("");
      return `
        <article class="brief-card">
          <h3>${esc(outputTypeLabel(output.type))}</h3>
          <p>${esc(brief.purpose ?? "")}</p>
          <p class="muted">Written for ${esc(brief.audience ?? "an unspecified audience")}.</p>
          ${facts ? `<p class="label">Facts used</p><ul>${facts}</ul>` : ""}
          ${unknowns ? `<p class="label">Open questions</p><ul>${unknowns}</ul>` : ""}
        </article>`;
    })
    .join("");
  return `<section aria-labelledby="briefs-heading"><h2 id="briefs-heading">The briefs</h2><div class="card-grid">${items}</div></section>`;
}

function renderOutputPreview(output: OutputRow, token: string | null): string {
  if (output.type === "post_copy") {
    let text = "";
    try {
      const brief = output.template_inputs_json ? JSON.parse(output.template_inputs_json) : {};
      text = brief.postCopyText ?? "";
    } catch {
      /* leave blank */
    }
    return text ? `<p class="post-copy">${esc(text)}</p>` : `<p class="muted">No text was produced.</p>`;
  }

  if (output.status !== "ready" || !output.file_id) {
    return `<p class="muted">This output is not ready.</p>`;
  }

  const fileUrl = withToken(`/api/outputs/${output.id}/file`, token);
  if (output.type === "one_pager_pdf") {
    return `<a class="download" href="${esc(fileUrl)}">Open the one page PDF</a>`;
  }
  return `<img class="output-image" src="${esc(fileUrl)}" alt="Rendered ${esc(outputTypeLabel(output.type))}" loading="lazy">
          <a class="download" href="${esc(fileUrl)}">Download this image</a>`;
}

function renderChecks(reviews: ReviewRow[]): string {
  const latest = reviews[reviews.length - 1];
  if (!latest) return `<p class="muted">This output has not been reviewed yet.</p>`;

  type Check = { kind: string; status: string; observed: string; approved: string; explanation: string; deltaE?: number };
  const checks = JSON.parse(latest.findings_json) as Check[];
  const rows = checks
    .map(
      (c) => `
      <tr>
        <th scope="row">${esc(checkKindLabel(c.kind))}</th>
        <td><span class="status-chip status-${esc(c.status)}">${esc(statusLabel(c.status))}</span></td>
        <td>${esc(c.observed)}</td>
        <td>${esc(c.approved)}</td>
        <td>${esc(c.explanation)}${c.deltaE !== undefined ? ` (delta E ${esc(c.deltaE.toFixed(2))})` : ""}</td>
      </tr>`
    )
    .join("");

  const fixesRaw = latest.fixes_json ? (JSON.parse(latest.fixes_json) as unknown[]) : [];
  const repairNote =
    fixesRaw.length > 0
      ? `<p class="muted">This output needed ${fixesRaw.length} repair attempt${fixesRaw.length === 1 ? "" : "s"} before this result.</p>`
      : "";

  return `
    ${repairNote}
    <div class="table-wrap">
      <table>
        <caption class="sr-only">Review findings</caption>
        <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Observed</th><th scope="col">Approved</th><th scope="col">Explanation</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * No opaque score: one honest label per output. "Brand approved" only when
 * every check in the latest review genuinely passed (or was not applicable)
 * — never when the brand's approved context has moved on since this output
 * was built, even if its own review once passed.
 */
function outputApprovalLabel(reviews: ReviewRow[], needsReview: boolean): { text: string; chipClass: string } {
  if (needsReview) return { text: "Needs review", chipClass: "status-partial" };
  const latest = reviews[reviews.length - 1];
  if (!latest) return { text: "Draft", chipClass: "status-partial" };
  type Check = { kind: string; status: string };
  const checks = JSON.parse(latest.findings_json) as Check[];
  const overallPass = computeOverallPass(checks as Parameters<typeof computeOverallPass>[0]);
  return overallPass ? { text: "Brand approved", chipClass: "status-pass" } : { text: "Draft", chipClass: "status-partial" };
}

function renderOutputsSection(outputs: ShareOutputView[], token: string | null, needsReview: boolean): string {
  if (outputs.length === 0) {
    return `<section aria-labelledby="outputs-heading"><h2 id="outputs-heading">The outputs</h2><p class="muted">Nothing has been generated for this brand yet.</p></section>`;
  }
  const items = outputs
    .map(({ output, reviews }) => {
      const approval = outputApprovalLabel(reviews, needsReview);
      return `
      <details class="output-card">
        <summary>
          <span>${esc(outputTypeLabel(output.type))}</span>
          <span class="status-chip ${esc(approval.chipClass)}" role="status">${esc(approval.text)}</span>
        </summary>
        <div class="output-body">
          ${needsReview ? `<p class="muted">The approved brand has changed since this was generated. It needs a fresh run to carry the current colours, fonts and voice.</p>` : ""}
          ${renderOutputPreview(output, token)}
          <h4>Review</h4>
          ${renderChecks(reviews)}
        </div>
      </details>`;
    })
    .join("");
  return `<section aria-labelledby="outputs-heading"><h2 id="outputs-heading">The outputs</h2><div class="output-list">${items}</div></section>`;
}

export function renderSharePage(data: SharePageData): string {
  const { brand, run, outputs, viewToken, logoAssetId } = data;
  const context: BrandContext | null = brand.context_json ? JSON.parse(brand.context_json) : null;
  const title = context?.title ?? brand.source_url;
  const needsReview = run ? run.context_version !== brand.approved_context_version : false;

  const promptSection = run
    ? `
      <section aria-labelledby="prompt-heading">
        <h2 id="prompt-heading">The brief that started this</h2>
        <p class="status-line"><span class="status-chip status-${esc(run.status)}" role="status">${esc(statusLabel(run.status))}</span></p>
        <blockquote class="prompt">${esc(run.task)}</blockquote>
        ${run.unknowns_json && JSON.parse(run.unknowns_json).length > 0 ? `<p class="label">Open questions from the briefs</p><ul>${(JSON.parse(run.unknowns_json) as string[]).map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
      </section>`
    : `<section aria-labelledby="prompt-heading"><h2 id="prompt-heading">The brief that started this</h2><p class="muted">No run has started for this brand yet.</p></section>`;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}: Goodspeed Brand OS</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F9F2ED; color: #242F28;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.55;
  }
  @media (prefers-reduced-motion: no-preference) {
    a, .download { transition: opacity 120ms ease; }
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  h2 { font-size: 20px; margin: 0 0 14px; }
  h3 { font-size: 16px; margin: 0 0 6px; }
  h4 { font-size: 14px; margin: 16px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #5B6B5F; }
  p { margin: 0 0 10px; }
  .muted { color: #5B6B5F; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #5B6B5F; margin: 10px 0 4px; }
  a { color: #36493C; }
  header.page-head { margin-bottom: 36px; }
  section { margin: 36px 0; padding-top: 28px; border-top: 1px solid rgba(36,47,40,0.12); }
  section:first-of-type { border-top: none; padding-top: 0; }
  .logo { max-width: 100%; height: auto; object-fit: contain; }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  .brief-card, .output-card { background: #fff; border: 1px solid rgba(36,47,40,0.14); border-radius: 12px; padding: 16px; }
  .output-list { display: flex; flex-direction: column; gap: 12px; }
  .output-card summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; font-weight: 600; list-style: none; }
  .output-card summary::-webkit-details-marker { display: none; }
  .output-card summary:focus-visible, a:focus-visible, .download:focus-visible { outline: 3px solid #1F51F2; outline-offset: 2px; }
  .output-body { margin-top: 14px; }
  .output-image { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(36,47,40,0.12); }
  .download { display: inline-block; margin-top: 8px; font-weight: 600; }
  .post-copy { white-space: pre-wrap; background: #fff; border: 1px solid rgba(36,47,40,0.14); border-radius: 8px; padding: 12px; }
  .status-chip { display: inline-block; font-size: 12px; padding: 3px 10px; border-radius: 999px; background: #EFEBE1; }
  .status-completed, .status-ready, .status-pass { background: #DDE9B3; }
  .status-failed, .status-fail { background: #F6D2C4; }
  .status-partial, .status-not_verified { background: #F6E7C4; }
  .status-line { margin-bottom: 10px; }
  blockquote.prompt { margin: 0; padding: 14px 16px; background: #fff; border: 1px solid rgba(36,47,40,0.14); border-left: 4px solid #36493C; border-radius: 0 8px 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(36,47,40,0.1); vertical-align: top; }
  .table-wrap { overflow-x: auto; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
  .cta { margin-top: 48px; padding: 28px; background: #36493C; color: #F9F2ED; border-radius: 16px; text-align: center; }
  .cta a { color: #C6DD66; font-weight: 700; text-decoration: none; }
  .cta a:hover, .cta a:focus-visible { text-decoration: underline; }
  @media (max-width: 480px) {
    .wrap { padding: 20px 16px 60px; }
  }
</style>
</head>
<body>
  <main class="wrap">
    <header class="page-head">
      <p class="label">Goodspeed Brand OS</p>
      <h1>${esc(title)}</h1>
    </header>

    ${promptSection}
    ${renderBrandSection(brand, context, logoAssetId, viewToken)}
    ${renderBriefsSection(outputs)}
    ${renderOutputsSection(outputs, viewToken, needsReview)}

    <div class="cta">
      <p>Want your own brand working this way?</p>
      <a href="https://goodspeed.studio/contact">Talk to Goodspeed</a>
    </div>
  </main>
</body>
</html>`;
}
