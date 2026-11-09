/**
 * Stand-in for the audit contract until POST /api/audit, GET /api/audit/sample,
 * and POST /api/audit/pdf exist. The page calls those routes first and uses
 * this only when they are missing or refuse the body.
 */
(function (root) {
  var CHECKS = [
    { id: "palette", label: "Colour palette" },
    { id: "logo", label: "Logo" },
    { id: "type", label: "Typography" },
    { id: "voice", label: "Voice and tone" },
    { id: "message", label: "Core message" },
    { id: "formats", label: "Formats and templates" },
  ];

  var COSTS = {
    palette: "Lost trust",
    logo: "The brand looks unmanaged",
    type: "Rework on every deck",
    voice: "Sales and marketing sound like different firms",
    message: "Rework and confused buyers",
    formats: "Design becomes the bottleneck",
  };

  var WHY = {
    palette: "Colour is the first thing a prospect sees. When it shifts by channel, the brand stops looking like one company.",
    logo: "The mark is how people recognise you at a glance. A missing or unclear logo makes the brand look unmanaged.",
    type: "Type is a system. When every channel picks its own fonts, every new deck starts again.",
    voice: "Tone is part of the promise. If the site and the other channels do not sound like the same firm, trust drops.",
    message: "People should meet the same offer on every channel. When the story shifts, buyers get confused and the work is redone.",
    formats: "Without a shared template, every asset is a one off and design becomes the bottleneck.",
  };

  function words(text) {
    var stop = {
      the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, your: 1, you: 1,
      are: 1, was: 1, were: 1, have: 1, has: 1, not: 1, but: 1, its: 1, into: 1,
      about: 1, they: 1, their: 1, our: 1, who: 1, what: 1, when: 1, where: 1,
      will: 1, can: 1, off: 1, than: 1, then: 1, them: 1, been: 1, also: 1,
    };
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function (word) { return word.length > 3 && !stop[word]; });
  }

  function overlap(left, right) {
    var set = {};
    right.forEach(function (word) { set[word] = 1; });
    var count = 0;
    left.forEach(function (word) { if (set[word]) count += 1; });
    return count;
  }

  function clamp(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function finding(surface, detail, evidenceUrl) {
    var row = { surface: surface, detail: detail };
    if (evidenceUrl && /^https?:\/\//i.test(evidenceUrl)) row.evidenceUrl = evidenceUrl;
    return row;
  }

  function bentPixelsSample() {
    var checks = [
      check("palette", 86, [
        finding("site", "Homepage CSS chromatic colours sit in one blue family: #0099ff, #007bff, #228dff, #72b6ff, #004084, beside neutral ink #12141f. No blog or deck was part of this example, so other channels were not compared.", "https://www.bentpixels.com/"),
      ]),
      check("logo", 62, [
        finding("site", "Only a favicon or social image was found in the static homepage. That does not confirm the logo is used as the brand mark.", "https://www.bentpixels.com/"),
      ]),
      check("type", 64, [
        finding("site", "The homepage names 3 typefaces: Inter, Geist, Poppins. Three families on one page is a mixed type signal.", "https://www.bentpixels.com/"),
      ]),
      check("voice", 60, [
        finding("site", "Not assessed across channels. The homepage speaks as we, in short sentences, and rarely uses exclamations. No LinkedIn caption was pasted in this example. This is not a pass."),
      ]),
      check("message", 36, [
        finding("site", "The homepage lead is 'The Original Creator TV Platform' and 'We don't buy impressions, We build communities.' The brands page lead is 'Where Scale, Safety, and Storytelling Meet,' aimed at advertisers. The offer shifts between creators and brand buyers on the same site.", "https://www.bentpixels.com/brands"),
      ]),
      check("formats", 60, [
        finding("deck", "Not assessed. No deck was uploaded, so template consistency was not checked. This is not a pass."),
      ]),
    ];
    return {
      brand: {
        name: "Bent Pixels",
        siteUrl: "https://www.bentpixels.com/",
        logoUrl: "https://framerusercontent.com/images/KaXMLJ6vLdCCb4PDh9PhlpTjdEs.png",
        palette: ["#0099ff", "#007bff", "#228dff", "#72b6ff", "#004084", "#12141f"],
        fonts: ["Inter", "Geist", "Poppins"],
        voiceSummary: "Short sentences, speaks as we, rarely uses exclamations.",
      },
      overallScore: overallFromChecks(checks),
      checks: checks,
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
  }

  function assessed(check) {
    return (check.findings || []).some(function (item) {
      return String(item.detail || "").indexOf("Not assessed") !== 0;
    });
  }

  function overallFromChecks(checks) {
    var comparable = checks.filter(assessed);
    if (!comparable.length) return 0;
    var total = 0;
    comparable.forEach(function (item) { total += item.score; });
    return clamp(total / comparable.length);
  }

  function rankBreaks(checks) {
    return checks
      .filter(assessed)
      .filter(function (item) { return item.status === "break" || item.status === "warn"; })
      .sort(function (a, b) {
        var weight = { break: 0, warn: 1, ok: 2 };
        if (weight[a.status] !== weight[b.status]) return weight[a.status] - weight[b.status];
        return a.score - b.score;
      })
      .slice(0, 5)
      .map(function (item, index) {
        return {
          rank: index + 1,
          title: item.label,
          surface: primarySurface(item),
          whyItMatters: WHY[item.id],
          cost: COSTS[item.id],
        };
      });
  }

  function primarySurface(check) {
    var elsewhere = (check.findings || []).filter(function (item) { return item.surface !== "site"; })[0];
    return (elsewhere || (check.findings || [])[0] || {}).surface || "site";
  }

  function previewFromRequest(body, brand, detected) {
    var request = body || {};
    var siteUrl = String(request.siteUrl || (brand && brand.siteUrl) || "");
    var blogUrl = String(request.blogUrl || "").trim();
    var linkedin = String(request.linkedinText || "").trim();
    var deck = hasDeck(request.deckFile);
    var voice = String((brand && brand.voiceSummary) || "").trim();
    var palette = (brand && brand.palette) || [];
    var fonts = (brand && brand.fonts) || [];
    var logoUrl = brand && brand.logoUrl;
    var linkedinWords = words(linkedin);
    var shared = overlap(linkedinWords, words(voice));
    var linkOnly = /^https?:\/\/\S+$/i.test(linkedin) || (/linkedin\.com/i.test(linkedin) && linkedin.split(/\s+/).length < 8);
    var linkedinReady = Boolean(linkedin) && !linkOnly && wordCount(linkedin) >= 12;

    var paletteFindings = [];
    if (palette.length) paletteFindings.push(finding("site", "Confirmed colours: " + palette.join(", ") + ".", siteUrl));
    else paletteFindings.push(finding("site", "No colours were confirmed.", siteUrl));
    if (blogUrl) paletteFindings.push(finding("blog", "Not assessed on the blog. This preview does not fetch the page, so its colours were not compared.", blogUrl));
    if (deck) paletteFindings.push(finding("deck", "Not assessed on the deck. This preview does not sample colours from the file."));

    var logoFindings = logoUrl
      ? [finding("site", "A logo from the site is on the confirmed brand.", siteUrl)]
      : [finding("site", "Logo: unknown. Nothing on the site was confirmed as the mark.", siteUrl)];

    var typeFindings = [];
    if (!fonts.length) typeFindings.push(finding("site", "No font was confirmed.", siteUrl));
    else if (fonts.length === 1) typeFindings.push(finding("site", "One family was confirmed: " + fonts[0] + ".", siteUrl));
    else typeFindings.push(finding("site", "More than one family was confirmed: " + fonts.join(", ") + ".", siteUrl));
    if (deck) typeFindings.push(finding("deck", "Not assessed for type on the deck. No named typeface could be read there. Screenshots are not used to guess fonts."));

    var voiceCheck;
    var messageCheck;
    if (!linkedinReady && !blogUrl) {
      voiceCheck = check("voice", 60, [
        finding("site", "Not assessed across channels. Voice was read on the site only. Paste LinkedIn text or add a blog to compare tone. This is not a pass."),
      ]);
      messageCheck = check("message", 60, [
        finding("site", voice
          ? "Not assessed across channels. Core message was read on the site only. This is not a pass."
          : "Not assessed. The site did not yield enough of an offer to compare with other channels."),
      ]);
    } else if (!linkedinReady) {
      voiceCheck = check("voice", 60, [
        finding("linkedin", linkOnly
          ? "Not assessed. The LinkedIn field looks like a link. A link is not enough, because we cannot open LinkedIn pages."
          : "Not assessed. The LinkedIn text is too short to compare tone (need at least 12 words)."),
      ]);
      messageCheck = check("message", 60, [
        finding("linkedin", "Not assessed. The LinkedIn text is too short to compare with the site offer."),
      ]);
    } else if (shared < 2) {
      voiceCheck = check("voice", 46, [
        finding("site", voice ? "Confirmed voice: " + clip(voice) : "No voice notes were confirmed.", siteUrl),
        finding("linkedin", "Pasted LinkedIn text (" + linkedinWords.length + " words) does not share the confirmed wording. Opening: " + clip(linkedin)),
      ]);
      messageCheck = check("message", 42, [
        finding("site", voice ? "Site wording used as the offer: " + clip(voice) : "No offer text was confirmed.", siteUrl),
        finding("linkedin", "Pasted LinkedIn text leads somewhere else: " + clip(linkedin)),
      ]);
    } else {
      voiceCheck = check("voice", 72, [
        finding("site", voice ? "Confirmed voice: " + clip(voice) : "No voice notes were confirmed.", siteUrl),
        finding("linkedin", "Pasted LinkedIn text shares some wording with the confirmed voice. A model has not scored it in this preview."),
      ]);
      messageCheck = check("message", 74, [
        finding("site", voice ? "Site wording used as the offer: " + clip(voice) : "No offer text was confirmed.", siteUrl),
        finding("linkedin", "Pasted LinkedIn text overlaps the site wording. This preview does not judge the offer beyond that overlap."),
      ]);
    }

    var built = [
      check("palette", palette.length ? 84 : 32, paletteFindings),
      check("logo", logoUrl ? 90 : 48, logoFindings),
      check("type", !fonts.length ? 34 : fonts.length > 1 ? 64 : 86, typeFindings),
      voiceCheck,
      messageCheck,
      deck
        ? check("formats", 55, [finding("deck", "A deck was attached. Layout consistency is not judged in this preview.")])
        : check("formats", 60, [finding("deck", "Not assessed. No deck was uploaded, so template consistency was not checked. This is not a pass.")]),
    ];

    var skipped = [];
    if (!blogUrl) skipped.push({ surface: "blog", reason: "No blog address was given." });
    if (!linkedin) skipped.push({ surface: "linkedin", reason: "No LinkedIn text was pasted. We cannot read LinkedIn pages automatically." });
    if (!deck) skipped.push({ surface: "deck", reason: "No deck was uploaded." });

    return {
      brand: {
        name: (brand && brand.name) || hostOf(siteUrl) || "Your brand",
        siteUrl: siteUrl,
        logoUrl: logoUrl || undefined,
        palette: palette.slice(),
        fonts: fonts.slice(),
        voiceSummary: voice || "No voice notes were confirmed.",
      },
      overallScore: overallFromChecks(built),
      checks: built,
      topBreaks: rankBreaks(built),
      toolsAndFormats: {
        detected: (detected || []).slice(),
        requested: requestedList(request.tools, request.formats),
      },
      skippedSurfaces: skipped,
      generatedAt: new Date().toISOString(),
    };
  }

  function hasDeck(deckFile) {
    if (!deckFile) return false;
    if (typeof deckFile === "string") return deckFile.trim().length > 0;
    return Boolean(deckFile.base64);
  }

  function requestedList(tools, formats) {
    var seen = {};
    var out = [];
    (tools || []).concat(formats || []).forEach(function (item) {
      var name = String(item || "").trim();
      if (!name || seen[name]) return;
      seen[name] = 1;
      out.push(name);
    });
    return out;
  }

  function wordCount(text) {
    var trimmed = String(text || "").trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function statusForScore(score) {
    if (score >= 80) return "ok";
    if (score >= 50) return "warn";
    return "break";
  }

  function check(id, score, findings) {
    var meta = CHECKS.filter(function (item) { return item.id === id; })[0];
    var clamped = clamp(score);
    return { id: id, label: meta.label, score: clamped, status: statusForScore(clamped), findings: findings };
  }

  function clip(text) {
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= 140) return clean;
    return clean.slice(0, 137) + "...";
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (err) { return ""; }
  }

  function isAuditResult(value) {
    if (!value || typeof value !== "object") return false;
    if (!value.brand || typeof value.brand.name !== "string" || typeof value.brand.siteUrl !== "string") return false;
    if (typeof value.overallScore !== "number") return false;
    if (!Array.isArray(value.checks) || !Array.isArray(value.topBreaks)) return false;
    if (!value.toolsAndFormats || !Array.isArray(value.skippedSurfaces)) return false;
    if (typeof value.generatedAt !== "string") return false;
    return true;
  }

  function pdfEscape(text) {
    return String(text)
      .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function wrap(text, width) {
    var wordsInLine = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var line = "";
    wordsInLine.forEach(function (word) {
      var next = line ? line + " " + word : word;
      if (next.length > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    if (!lines.length) lines.push("");
    return lines;
  }

  function reportLines(result, preview) {
    var lines = [];
    if (preview) lines.push("Preview copy. The PDF service is not connected on this build yet.");
    lines.push("Where your brand is breaking");
    lines.push(result.brand.name + " (" + result.brand.siteUrl + ")");
    lines.push("Overall " + result.overallScore + " out of 100");
    lines.push("Generated " + String(result.generatedAt).slice(0, 10));
    lines.push("");
    lines.push("Where it breaks most");
    (result.topBreaks || []).forEach(function (item) {
      lines.push(item.rank + ". " + item.title + " (" + item.surface + ")");
      lines.push("Why it matters: " + item.whyItMatters);
      lines.push("The cost: " + item.cost);
      lines.push("");
    });
    lines.push("Scorecard");
    (result.checks || []).forEach(function (item) {
      var state = assessed(item) ? item.status : "Not assessed";
      lines.push(item.label + ": " + item.score + " (" + state + ")");
      (item.findings || []).forEach(function (row) {
        lines.push(row.surface + ": " + row.detail);
      });
      lines.push("");
    });
    var requested = result.toolsAndFormats && result.toolsAndFormats.requested;
    var asked = Array.isArray(requested)
      ? requested
      : ((requested && requested.tools) || []).concat((requested && requested.formats) || []);
    lines.push("Noticed: " + ((result.toolsAndFormats && result.toolsAndFormats.detected) || []).join(", "));
    lines.push("You asked for: " + asked.join(", "));
    lines.push("");
    lines.push("Not checked");
    (result.skippedSurfaces || []).forEach(function (item) {
      lines.push(item.surface + ": " + item.reason);
    });
    lines.push("");
    lines.push("Talk to Goodspeed: https://goodspeed.studio/contact");
    lines.push("A starter begins from the designs you already approved. No price is listed here.");
    var wrapped = [];
    lines.forEach(function (line) {
      wrap(line, 88).forEach(function (part) { wrapped.push(part); });
    });
    return wrapped;
  }

  function buildPreviewPdfBytes(result, preview) {
    var lines = reportLines(result, preview);
    var pageSize = 42;
    var pages = [];
    for (var i = 0; i < lines.length; i += pageSize) pages.push(lines.slice(i, i + pageSize));
    if (!pages.length) pages.push(["Empty report"]);

    var next = 1;
    var catalogId = next++;
    var pagesId = next++;
    var fontId = next++;
    var pageIds = pages.map(function () { return next++; });
    var contentIds = pages.map(function () { return next++; });
    var objs = [];

    function streamFor(pageLines) {
      var commands = ["BT", "/F1 11 Tf", "48 800 Td", "16 TL"];
      pageLines.forEach(function (line, index) {
        var text = pdfEscape(line);
        commands.push(index === 0 ? "(" + text + ") Tj" : "T* (" + text + ") Tj");
      });
      commands.push("ET");
      return commands.join("\n");
    }

    pages.forEach(function (pageLines, index) {
      var stream = streamFor(pageLines);
      objs[contentIds[index]] = "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream";
      objs[pageIds[index]] = "<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 595 842] /Contents " + contentIds[index] + " 0 R /Resources << /Font << /F1 " + fontId + " 0 R >> >> >>";
    });
    objs[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objs[pagesId] = "<< /Type /Pages /Count " + pages.length + " /Kids [" + pageIds.map(function (id) { return id + " 0 R"; }).join(" ") + "] >>";
    objs[catalogId] = "<< /Type /Catalog /Pages " + pagesId + " 0 R >>";

    var body = "%PDF-1.4\n";
    var offsets = [0];
    for (var id = 1; id < next; id++) {
      offsets[id] = body.length;
      body += id + " 0 obj\n" + objs[id] + "\nendobj\n";
    }
    var xref = body.length;
    var table = "xref\n0 " + next + "\n0000000000 65535 f \n";
    for (var ref = 1; ref < next; ref++) {
      table += String(offsets[ref]).padStart(10, "0") + " 00000 n \n";
    }
    body += table;
    body += "trailer\n<< /Size " + next + " /Root " + catalogId + " 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    return new TextEncoder().encode(body);
  }

  root.BrandAuditMock = {
    sample: bentPixelsSample,
    previewFromRequest: previewFromRequest,
    buildPreviewPdfBytes: buildPreviewPdfBytes,
    isAuditResult: isAuditResult,
    costs: COSTS,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
