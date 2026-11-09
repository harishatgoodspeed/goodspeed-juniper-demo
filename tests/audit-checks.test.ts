import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { buildZip } from "../src/zip-safe";
import { parseDeck } from "../src/audit/deck";
import {
  isAssessed,
  overallFromChecks,
  rankBreaks,
  scoreFormats,
  scoreLogo,
  scoreMessage,
  scorePalette,
  scoreType,
  scoreVoice,
} from "../src/audit/checks";
import type { LogoCandidate } from "../src/import/types";
import type { AuditCheck } from "../src/audit/types";

const headerLogo: LogoCandidate = {
  url: "https://example.com/logo.svg",
  kind: "header_img",
  confidence: 0.7,
  method: "header img",
};

test("palette matches a close blog colour and breaks on a far one", () => {
  const close = scorePalette({ siteColours: ["#1f3a2e", "#f4f1ea"], blogColours: ["#1f3a2e"], deckColours: null });
  assert.equal(close.status, "ok");
  assert.match(close.findings[0].detail, /blog/);
  assert.match(close.findings[0].detail, /ΔE 12/);

  const far = scorePalette({ siteColours: ["#1f3a2e"], blogColours: ["#ff00aa"], deckColours: null });
  assert.equal(far.status, "break");
  assert.match(far.findings.map((finding) => finding.detail).join(" "), /#ff00aa/);
  assert.equal(far.findings.find((finding) => finding.detail.includes("#ff00aa"))?.surface, "blog");
});

test("palette with only the site is not treated as a cross channel pass", () => {
  const check = scorePalette({ siteColours: ["#1f3a2e"], blogColours: null, deckColours: null });
  assert.equal(check.status, "warn");
  assert.match(check.findings[0].detail, /^Not assessed/);
  assert.equal(isAssessed(check), false);
});

test("logo, type, voice, and message follow the rubric", () => {
  const logo = scoreLogo([headerLogo]);
  assert.equal(logo.status, "ok");
  assert.equal(logo.findings[0].evidenceUrl, headerLogo.url);

  const favicon = scoreLogo([
    { url: "https://example.com/favicon.png", kind: "favicon", confidence: 0.3, method: "icon" },
  ]);
  assert.equal(favicon.status, "warn");
  assert.equal(scoreLogo([]).status, "break");

  assert.equal(scoreType({ siteFonts: ["Georgia", "Inter"], blogFonts: null, deckFonts: null, googleFonts: false }).status, "ok");
  const mixed = scoreType({
    siteFonts: ["Georgia"],
    blogFonts: ["Papyrus", "Comic Sans MS"],
    deckFonts: null,
    googleFonts: true,
  });
  assert.equal(mixed.status, "break");
  assert.match(mixed.findings.map((finding) => finding.detail).join(" "), /Papyrus/);
  assert.match(mixed.findings[0].detail, /Google Fonts/);

  const site = "We design brand systems for founders and we keep every page calm and specific for the people who hire us.";
  const linkedin = "You will love this offer!!! Buy it now!!! You should click today!!! You need this deal right now!!!";
  const voice = scoreVoice([
    { surface: "site", text: site },
    { surface: "linkedin", text: linkedin },
  ]);
  assert.equal(voice.status, "break");
  assert.match(voice.findings.find((finding) => finding.surface === "linkedin")!.detail, /exclamations|addresses you/);

  const aligned = scoreMessage(site, [{ surface: "linkedin", text: site }]);
  assert.equal(aligned.status, "ok");
  const drifted = scoreMessage(site, [{ surface: "linkedin", text: linkedin }]);
  assert.equal(drifted.status, "break");
  assert.match(drifted.findings[0].detail, /0 of /);

  const siteOnly = scoreVoice([{ surface: "site", text: site }]);
  assert.match(siteOnly.findings[0].detail, /^Not assessed/);
  assert.equal(isAssessed(siteOnly), false);
});

test("unassessed checks stay off the score and the ranked breaks, and costs invent no money", () => {
  const checks: AuditCheck[] = [
    scorePalette({ siteColours: ["#1f3a2e"], blogColours: null, deckColours: null }),
    scoreLogo([]),
    scoreType({ siteFonts: ["Georgia", "Inter"], blogFonts: null, deckFonts: null, googleFonts: false }),
    scoreVoice([{ surface: "site", text: "We design brand systems for founders and we keep the work calm." }]),
    scoreMessage("We design brand systems for founders and keep the work calm.", []),
    scoreFormats(null),
  ];
  assert.equal(checks.filter(isAssessed).every((check) => check.id === "logo" || check.id === "type"), true);
  const score = overallFromChecks(checks);
  assert.equal(score, Math.round((28 + 90) / 2));
  const breaks = rankBreaks(checks);
  assert.ok(breaks.length <= 5);
  assert.equal(breaks[0].title, "Logo");
  assert.equal(breaks[0].cost, "The brand looks unmanaged");
  for (const item of breaks) {
    assert.doesNotMatch(`${item.cost} ${item.whyItMatters}`, /[£$€]|pound|dollar/i);
    assert.equal(item.rank > 0, true);
  }
});

test("a stored and a deflated PPTX yield text and colour, and a PDF yields text", () => {
  const slide = `<?xml version="1.0"?><p:sld><a:t>We build communities for creators</a:t><a:srgbClr val="C6DD66"/><a:latin typeface="Georgia"/></p:sld>`;
  const presentation = `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`;
  const stored = parseDeck(
    buildZip([
      { name: "ppt/slides/slide1.xml", data: slide },
      { name: "ppt/presentation.xml", data: presentation },
    ]),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "deck.pptx"
  );
  assert.equal(stored.ok, true);
  if (stored.ok) {
    assert.match(stored.deck.text, /communities for creators/);
    assert.ok(stored.deck.colours.includes("#c6dd66"));
    assert.deepEqual(stored.deck.fonts, ["Georgia"]);
    assert.deepEqual(stored.deck.slideSizes, ["12192000x6858000"]);
    const formats = scoreFormats({
      slideCount: stored.deck.slideCount,
      colours: stored.deck.colours,
      slideSizes: stored.deck.slideSizes,
      textLength: stored.deck.text.length,
    });
    assert.equal(formats.status, "ok");
  }

  const deflated = parseDeck(
    zipDeflated("ppt/slides/slide1.xml", slide),
    "application/octet-stream",
    "notes.pptx"
  );
  assert.equal(deflated.ok, true);
  if (deflated.ok) assert.match(deflated.deck.text, /communities/);

  const pdf = parseDeck(
    Buffer.from(
      "%PDF-1.1\n1 0 obj\n<< /Length 80 >>\nstream\nBT (We build communities for creators) Tj ET\n0.1 0.4 0.9 rg\nendstream\nendobj\n%%EOF\n"
    ),
    "application/pdf",
    "deck.pdf"
  );
  assert.equal(pdf.ok, true);
  if (pdf.ok) {
    assert.match(pdf.deck.text, /communities for creators/);
    assert.equal(pdf.deck.colours.length, 1);
  }

  const scanned = parseDeck(Buffer.from("%PDF-1.1\n%%EOF"), "application/pdf", "scan.pdf");
  assert.equal(scanned.ok, false);
});

function zipDeflated(name: string, data: string): Buffer {
  const nameBuf = Buffer.from(name);
  const raw = Buffer.from(data);
  const compressed = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(raw), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([local, nameBuf, compressed]);
}
