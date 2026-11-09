(function () {
  var TOOLS = ["Canva", "Figma", "Google Slides", "Gamma", "PowerPoint", "Notion", "Other"];
  var FORMATS = ["LinkedIn posts", "Decks", "One-pagers", "Blog images", "Ads", "Other"];
  var VIEWS = ["landingView", "progressView", "confirmView", "channelsView", "toolsView", "auditProgressView", "resultsView"];
  var STEP_FOR = {
    landingView: "site",
    progressView: "site",
    confirmView: "brand",
    channelsView: "channels",
    toolsView: "tools",
    auditProgressView: "report",
    resultsView: "report",
  };
  var STATUS_LABEL = { ok: "Sound", warn: "Weak", break: "Breaking" };
  var SURFACE_LABEL = { site: "Site", blog: "Blog", linkedin: "LinkedIn", deck: "Deck" };

  var brandId = null;
  var brandData = null;
  var confirmed = null;
  var detected = [];
  var deckPayload = null;
  var auditResult = null;
  var auditIsPreview = false;
  var auditTimer = null;

  function $(id) { return document.getElementById(id); }
  function show(id, options) {
    VIEWS.forEach(function (view) { $(view).hidden = view !== id; });
    document.querySelectorAll(".steps li").forEach(function (li) {
      li.setAttribute("aria-current", li.dataset.step === STEP_FOR[id] ? "step" : "false");
    });
    if (options && options.focus === false) return;
    var heading = $(id).querySelector("h1");
    if (heading) heading.focus();
  }
  function csrf() {
    var match = document.cookie.match(/(?:^|; )gs_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  async function api(path, options) {
    var opts = options || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (opts.body) headers["Content-Type"] = "application/json";
    if (opts.method && opts.method !== "GET") headers["X-CSRF-Token"] = csrf();
    var res = await fetch(path, Object.assign({}, opts, { headers: headers, credentials: "same-origin" }));
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    if (!res.ok) {
      var error = new Error((data && data.message) || "Something went wrong. Please try again.");
      error.status = res.status;
      error.code = data && data.error;
      error.data = data;
      throw error;
    }
    return data;
  }
  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.entries(props || {}).forEach(function (entry) {
      var key = entry[0];
      var value = entry[1];
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function normaliseHex(value) {
    var hex = String(value || "").trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split("").map(function (ch) { return ch + ch; }).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return "#" + hex.toLowerCase();
  }
  function moneyLike(text) {
    return /[£$€]|\bGBP\b|\bUSD\b|\bEUR\b/i.test(String(text || ""));
  }
  function safeCost(text) {
    if (!text || moneyLike(text)) return "The cost is trust, rework, or a design bottleneck. No figure is shown.";
    return text;
  }

  function renderSample(result) {
    var body = $("sampleBody");
    body.innerHTML = "";
    body.appendChild(scoreStrip(result, true));
    body.appendChild(el("h2", { text: "Example breaks" }));
    body.appendChild(breakList(result.topBreaks.slice(0, 3)));
    var pills = el("ul", { class: "pill-row" });
    result.checks.forEach(function (check) {
      pills.appendChild(el("li", {}, [
        badgeFor(check),
        document.createTextNode(" " + check.label),
      ]));
    });
    body.appendChild(pills);
  }

  function scoreStrip(result, compact) {
    var score = Math.round(Number(result.overallScore) || 0);
    var band = score >= 80 ? "Holding together" : score >= 50 ? "Mixed" : "Breaking";
    var wrap = el("div", { class: "score-strip" });
    wrap.appendChild(el("p", { class: "score-num", text: String(score) }));
    var meta = el("div", { class: "score-meta" });
    meta.appendChild(el("p", { class: "hint", text: "out of 100" }));
    meta.appendChild(el("p", { class: "band", text: band }));
    if (!compact) meta.appendChild(el("p", { class: "hint", text: result.brand.name }));
    wrap.appendChild(meta);
    return wrap;
  }

  function notAssessed(check) {
    var findings = (check && check.findings) || [];
    return findings.length > 0 && findings.every(function (item) {
      return String(item.detail || "").indexOf("Not assessed") === 0;
    });
  }

  function badgeFor(check) {
    if (notAssessed(check)) return el("span", { class: "badge na", text: "Not assessed" });
    var status = check && check.status;
    return el("span", { class: "badge " + (status || "warn"), text: STATUS_LABEL[status] || status || "Weak" });
  }

  function breakList(items) {
    var list = el("ol", { class: "break-list" });
    (items || []).forEach(function (item) {
      var card = el("li", { class: "break-card" });
      card.appendChild(el("p", { class: "rank", text: "Rank " + item.rank + ", " + (SURFACE_LABEL[item.surface] || item.surface || "Site") }));
      card.appendChild(el("h3", { text: item.title || "Break" }));
      card.appendChild(el("p", { text: "Why it matters: " + (item.whyItMatters || "") }));
      card.appendChild(el("p", { text: "The cost: " + safeCost(item.cost) }));
      list.appendChild(card);
    });
    return list;
  }

  function setStepState(listId, active) {
    var seen = false;
    Array.prototype.forEach.call($(listId).children, function (li) {
      if (li.dataset.step === active) {
        li.dataset.state = "active";
        seen = true;
      } else {
        li.dataset.state = seen ? "waiting" : "done";
      }
    });
  }

  $("importForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("importError").hidden = true;
    var url = $("siteUrl").value.trim();
    try {
      var started = await api("/api/brands", { method: "POST", body: JSON.stringify({ url: url }) });
      brandId = started.brand.id;
      show("progressView");
      $("blockedBox").hidden = true;
      $("progressHeading").textContent = "Reading your site";
      $("extractUrl").textContent = url;
      setStepState("extractSteps", "reading_website");
      $("progressText").textContent = "Reading your website";
      $("extractDetail").textContent = "Fetching the public page.";
      var job = await pollJob(started.jobId, function (current) {
        var finding = current.progress === "finding_brand";
        setStepState("extractSteps", finding ? "finding_brand" : "reading_website");
        $("progressText").textContent = finding ? "Finding your brand" : "Reading your website";
        $("extractDetail").textContent = finding ? "Looking for colours, type, and a logo." : "Fetching the public page.";
      });
      if (job.status === "failed") return showBlocked();
      await openBrand();
    } catch (err) {
      $("importError").hidden = false;
      $("importError").textContent = err.message;
      show("landingView");
    }
  });

  async function pollJob(jobId, onTick) {
    for (;;) {
      var job = await api("/api/jobs/" + jobId);
      onTick(job);
      if (job.status === "succeeded" || job.status === "failed") return job;
      await sleep(1200);
    }
  }

  async function showBlocked() {
    var data = await api("/api/brands/" + brandId);
    $("blockedBox").hidden = false;
    $("blockedText").textContent = data.error || "We could not read that address. Try again, use a different address, or enter a short description.";
    $("progressHeading").textContent = "The import stopped";
    $("progressText").textContent = "The import stopped";
    $("extractDetail").textContent = "";
  }

  $("retryImport").addEventListener("click", function () { $("importForm").requestSubmit(); });
  $("correctUrl").addEventListener("click", function () { show("landingView"); $("siteUrl").focus(); });

  $("manualForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("manualError").hidden = true;
    try {
      var created = await api("/api/brands/manual", {
        method: "POST",
        body: JSON.stringify({
          name: $("manualName").value.trim(),
          offer: $("manualOffer").value.trim(),
          audience: $("manualAudience").value.trim(),
          url: $("siteUrl").value.trim(),
        }),
      });
      brandId = created.brand.id;
      await openBrand();
    } catch (err) {
      $("manualError").hidden = false;
      $("manualError").textContent = err.message;
    }
  });

  async function openBrand() {
    brandData = await api("/api/brands/" + brandId);
    var context = brandData.context || {};
    var logoAsset = (brandData.assets || []).find(function (asset) { return asset.kind === "logo"; })
      || (brandData.assets || []).find(function (asset) { return asset.kind === "favicon"; })
      || null;
    $("brandName").value = shortName(context.siteName || context.title || "");
    $("confirmUrl").textContent = brandData.sourceUrl || "";
    $("siteSays").textContent = context.description || "Unknown.";
    $("excerpt").textContent = context.textExcerpt ? context.textExcerpt.slice(0, 700) : "No readable copy was found.";
    $("voiceNotes").value = "";
    renderLogo(logoAsset);
    renderColourEditor(uniqueHexes(context.colours || []).slice(0, 6));
    renderFontEditor(uniqueFonts(context.fonts || []));
    detected = noticedTools(context);
    show("confirmView");
  }

  function shortName(value) {
    var text = String(value || "").trim();
    var pipe = text.split(" | ")[0].trim();
    return pipe || text;
  }

  function uniqueHexes(colours) {
    var seen = {};
    var out = [];
    colours.forEach(function (colour) {
      var hex = normaliseHex(colour && colour.hex);
      if (!hex || seen[hex]) return;
      seen[hex] = 1;
      out.push(hex);
    });
    return out;
  }

  function uniqueFonts(fonts) {
    var seen = {};
    var out = [];
    fonts.forEach(function (font) {
      var family = String((font && font.family) || "").trim();
      if (!family || /placeholder/i.test(family)) return;
      var key = family.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(family);
    });
    return out.slice(0, 4);
  }

  function noticedTools(context) {
    var found = [];
    var fonts = (context && context.fonts) || [];
    var google = ((context && context.googleFontsLinks) || []).length > 0
      || fonts.some(function (font) { return /fonts\.(gstatic|googleapis)\.com/i.test(font.url || ""); });
    var framer = fonts.some(function (font) { return /framerusercontent\.com/i.test(font.url || ""); });
    if (framer) found.push("Framer");
    if (google) found.push("Google Fonts");
    return found;
  }

  function renderLogo(logoAsset) {
    var slot = $("logoSlot");
    slot.innerHTML = "";
    if (!logoAsset) {
      slot.appendChild(el("p", { class: "hint", text: "Logo: unknown" }));
      slot.dataset.assetId = "";
      return;
    }
    slot.dataset.assetId = logoAsset.id;
    slot.appendChild(el("img", { class: "logo-slot", src: "/api/assets/" + logoAsset.id, alt: "Logo from the site" }));
  }

  function renderColourEditor(colours) {
    var box = $("colourFields");
    box.innerHTML = "";
    var list = colours.length ? colours : [""];
    list.forEach(function (hex, index) {
      var row = el("div", { class: "colour-row" });
      var swatch = el("span", { class: "swatch", "aria-hidden": "true" });
      var input = el("input", { type: "text", value: hex, spellcheck: "false", "aria-label": "Colour " + (index + 1) });
      paint(swatch, input.value);
      input.addEventListener("input", function () { paint(swatch, input.value); });
      var remove = el("button", { class: "btn btn-ghost btn-small", type: "button", text: "Remove" });
      remove.addEventListener("click", function () {
        var next = readColourInputs().filter(function (_, item) { return item !== index; });
        renderColourEditor(next);
      });
      row.appendChild(swatch);
      row.appendChild(input);
      row.appendChild(remove);
      box.appendChild(row);
    });
  }

  function paint(swatch, value) {
    var hex = normaliseHex(value);
    swatch.style.background = hex || "transparent";
  }

  function readColourInputs() {
    return Array.prototype.map.call($("colourFields").querySelectorAll("input"), function (input) { return input.value; });
  }

  function renderFontEditor(fonts) {
    var box = $("fontFields");
    box.innerHTML = "";
    var list = fonts.length ? fonts : [""];
    list.forEach(function (family, index) {
      var row = el("div", { class: "font-row" });
      var input = el("input", { type: "text", value: family, "aria-label": "Font " + (index + 1) });
      var remove = el("button", { class: "btn btn-ghost btn-small", type: "button", text: "Remove" });
      remove.addEventListener("click", function () {
        var next = readFontInputs().filter(function (_, item) { return item !== index; });
        renderFontEditor(next);
      });
      row.appendChild(input);
      row.appendChild(remove);
      box.appendChild(row);
    });
  }

  function readFontInputs() {
    return Array.prototype.map.call($("fontFields").querySelectorAll("input"), function (input) { return input.value; });
  }

  $("addColour").addEventListener("click", function () {
    renderColourEditor(readColourInputs().concat([""]));
  });
  $("addFont").addEventListener("click", function () {
    renderFontEditor(readFontInputs().concat([""]));
  });
  $("backToUrl").addEventListener("click", function () { show("landingView"); });

  $("brandForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("approveError").hidden = true;
    var name = $("brandName").value.trim();
    if (!name) {
      $("approveError").hidden = false;
      $("approveError").textContent = "Add a business name before you continue.";
      return;
    }
    var colours = [];
    var colourError = "";
    readColourInputs().forEach(function (value) {
      if (!value.trim() || colourError) return;
      var hex = normaliseHex(value);
      if (!hex) colourError = "Use a hex colour such as #1c1f31, or leave the row blank.";
      else colours.push(hex);
    });
    if (colourError) {
      $("approveError").hidden = false;
      $("approveError").textContent = colourError;
      return;
    }
    var fonts = readFontInputs().map(function (value) { return value.trim(); }).filter(Boolean);
    var voice = $("voiceNotes").value.trim();
    var context = (brandData && brandData.context) || {};
    var logoId = $("logoSlot").dataset.assetId || null;
    try {
      await api("/api/brands/" + brandId, {
        method: "PATCH",
        body: JSON.stringify({
          approvedContext: {
            logoAssetId: logoId,
            colours: colours,
            fonts: fonts,
            voiceNotes: voice,
            approvedImageAssetIds: [],
            englishVariant: "uk",
          },
        }),
      });
      confirmed = {
        name: name,
        siteUrl: (brandData && brandData.sourceUrl) || $("siteUrl").value.trim(),
        logoUrl: logoId ? "/api/assets/" + logoId : undefined,
        palette: colours,
        fonts: fonts,
        voiceSummary: voice || context.description || context.textExcerpt || "",
      };
      $("snapshotLink").href = "/api/brands/" + brandId + "/snapshot.md";
      show("channelsView");
    } catch (err) {
      $("approveError").hidden = false;
      $("approveError").textContent = err.message;
    }
  });

  $("backToBrand").addEventListener("click", function () { show("confirmView"); });
  $("deckFile").addEventListener("change", function () {
    var file = $("deckFile").files && $("deckFile").files[0];
    $("deckName").textContent = file ? file.name : "";
  });

  $("channelsForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("channelsError").hidden = true;
    var blog = $("blogUrl").value.trim();
    if (blog) {
      try {
        var parsed = new URL(blog);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad");
      } catch (err) {
        $("channelsError").hidden = false;
        $("channelsError").textContent = "Enter a full blog address, starting with https://, or leave it blank.";
        return;
      }
    }
    var linkedin = $("linkedinText").value.trim();
    if (linkedin.length > 12000) {
      $("channelsError").hidden = false;
      $("channelsError").textContent = "Paste a shorter LinkedIn excerpt. Two to five posts is enough.";
      return;
    }
    deckPayload = null;
    var file = $("deckFile").files && $("deckFile").files[0];
    if (file) {
      var mime = deckMime(file);
      if (!mime) {
        $("channelsError").hidden = false;
        $("channelsError").textContent = "Upload a PDF or a PPTX. Other deck files are not read.";
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        $("channelsError").hidden = false;
        $("channelsError").textContent = "That deck is over 6 MB. Use a smaller PDF or PPTX, or continue without it.";
        return;
      }
      var base64 = await readBase64(file);
      if (!base64) {
        $("channelsError").hidden = false;
        $("channelsError").textContent = "That deck could not be read. Try a different PDF or PPTX.";
        return;
      }
      deckPayload = { filename: file.name, mimeType: mime, base64: base64 };
    }
    renderDetected();
    show("toolsView");
  });

  var PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  function deckMime(file) {
    var name = file.name || "";
    if (file.type === "application/pdf" || /\.pdf$/i.test(name)) return "application/pdf";
    if (file.type === PPTX_MIME || /\.pptx$/i.test(name)) return PPTX_MIME;
    return "";
  }

  function readBase64(file) {
    return readDataUrl(file).then(function (url) {
      var comma = String(url).indexOf(",");
      return comma === -1 ? "" : url.slice(comma + 1);
    });
  }

  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.readAsDataURL(file);
    });
  }

  function renderDetected() {
    var list = $("detectedChips");
    list.innerHTML = "";
    detected.forEach(function (name) { list.appendChild(el("li", { text: name })); });
    $("detectedBlock").hidden = detected.length === 0;
  }

  function choiceBox(containerId, names, group) {
    var box = $(containerId);
    box.innerHTML = "";
    names.forEach(function (name) {
      var id = group + "-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      var label = el("label", { class: "choice", for: id });
      var input = el("input", { type: "checkbox", id: id, value: name, name: group });
      input.addEventListener("change", function () {
        if (name !== "Other") return;
        var wrap = $(group === "tool" ? "toolOtherWrap" : "formatOtherWrap");
        wrap.hidden = !input.checked;
        if (input.checked) wrap.querySelector("input").focus();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(name));
      box.appendChild(label);
    });
  }
  choiceBox("toolChoices", TOOLS, "tool");
  choiceBox("formatChoices", FORMATS, "format");

  function selected(group) {
    return Array.prototype.filter.call(document.querySelectorAll('input[name="' + group + '"]:checked'), function (input) {
      return input.value !== "Other";
    }).map(function (input) { return input.value; });
  }

  $("backToChannels").addEventListener("click", function () { show("channelsView"); });

  $("toolsForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("toolsError").hidden = true;
    $("rateNote").hidden = true;
    var tools = selected("tool");
    var formats = selected("format");
    var toolOtherOn = document.getElementById("tool-other").checked;
    var formatOtherOn = document.getElementById("format-other").checked;
    var toolOther = $("toolOther").value.trim();
    var formatOther = $("formatOther").value.trim();
    if (toolOtherOn) {
      if (!toolOther) {
        $("toolsError").hidden = false;
        $("toolsError").textContent = "Name the other tool.";
        return;
      }
      tools.push(toolOther);
    }
    if (formatOtherOn) {
      if (!formatOther) {
        $("toolsError").hidden = false;
        $("toolsError").textContent = "Name the other format.";
        return;
      }
      formats.push(formatOther);
    }
    if (!tools.length || !formats.length) {
      $("toolsError").hidden = false;
      $("toolsError").textContent = "Pick at least one tool and one format.";
      return;
    }
    var body = {
      siteUrl: confirmed.siteUrl,
      tools: tools,
      formats: formats,
    };
    var blog = $("blogUrl").value.trim();
    var linkedin = $("linkedinText").value.trim();
    if (blog) body.blogUrl = blog;
    if (linkedin) body.linkedinText = linkedin;
    if (deckPayload) body.deckFile = deckPayload;
    $("runAudit").disabled = true;
    show("auditProgressView");
    setStepState("auditSteps", "site");
    $("auditProgressText").textContent = "Checking your site";
    var started = Date.now();
    if (auditTimer) clearInterval(auditTimer);
    auditTimer = setInterval(function () {
      var elapsed = Date.now() - started;
      var step = elapsed < 800 ? "site" : elapsed < 1600 ? "added" : "report";
      setStepState("auditSteps", step);
      $("auditProgressText").textContent = step === "site" ? "Checking your site" : step === "added" ? "Checking what you added" : "Writing your report";
    }, 400);
    try {
      var outcome = await postAudit(body);
      var wait = 2200 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      clearInterval(auditTimer);
      setStepState("auditSteps", "report");
      auditResult = outcome.result;
      auditIsPreview = outcome.preview;
      renderResults();
      show("resultsView");
    } catch (err) {
      clearInterval(auditTimer);
      show("toolsView");
      if (err.rateLimited) {
        $("rateNote").hidden = false;
      } else {
        $("toolsError").hidden = false;
        $("toolsError").textContent = err.message;
      }
    } finally {
      $("runAudit").disabled = false;
    }
  });

  async function postAudit(body) {
    await api("/api/session");
    var res;
    try {
      res = await fetch("/api/audit", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf(),
        },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { result: BrandAuditMock.previewFromRequest(body, confirmed, detected), preview: true };
    }
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    if (res.ok && BrandAuditMock.isAuditResult(data)) return { result: data, preview: false };
    if (res.status === 429) {
      var limited = new Error("You have reached the free limit of 6 audits an hour.");
      limited.rateLimited = true;
      throw limited;
    }
    if (res.status === 404 || (data && data.error === "not_found")) {
      return { result: BrandAuditMock.previewFromRequest(body, confirmed, detected), preview: true };
    }
    if (res.status === 413) {
      throw new Error("That deck is too large. PDF and PPTX files need to stay under 6 MB.");
    }
    throw new Error((data && data.message) || "The audit did not finish. Please try again.");
  }

  function renderResults() {
    var result = auditResult;
    $("resultsTitle").textContent = "Where " + result.brand.name + " is breaking";
    $("previewNote").hidden = !auditIsPreview;
    $("previewNote").textContent = auditIsPreview
      ? "This on-screen report is a preview. The audit service is not connected on this build yet, so these checks are not a live reading of your brand."
      : "";
    var score = $("scoreBlock");
    score.innerHTML = "";
    if (result.brand.logoUrl) score.appendChild(el("img", { class: "logo-slot", src: result.brand.logoUrl, alt: "" }));
    score.appendChild(scoreStrip(result, false));
    if (result.brand.palette.length) {
      var swatches = el("div", { class: "swatches" });
      result.brand.palette.forEach(function (hex) {
        swatches.appendChild(el("span", { class: "colour-pair" }, [
          el("span", { class: "swatch", style: "background:" + hex, title: hex }),
          el("span", { class: "hint", text: hex }),
        ]));
      });
      score.appendChild(swatches);
    }
    score.appendChild(el("p", { text: result.brand.voiceSummary }));

    var breaks = $("breaksBlock");
    breaks.innerHTML = "";
    var anyBreak = (result.checks || []).some(function (check) { return check.status === "break"; });
    breaks.appendChild(el("h2", { text: anyBreak ? "Where it breaks most" : "The weakest points" }));
    if (!(result.topBreaks || []).length) breaks.appendChild(el("p", { text: "Nothing in this report was marked as weak." }));
    else breaks.appendChild(breakList(result.topBreaks));

    var card = $("scorecardBlock");
    card.innerHTML = "";
    card.appendChild(el("h2", { text: "Scorecard" }));
    var table = el("table", { class: "scorecard" });
    var head = el("tr", {}, [
      el("th", { text: "Check" }),
      el("th", { text: "Score" }),
      el("th", { text: "Status" }),
      el("th", { text: "What we saw" }),
    ]);
    table.appendChild(el("thead", {}, [head]));
    var tbody = el("tbody");
    (result.checks || []).forEach(function (check) {
      var seen = el("td");
      (check.findings || []).forEach(function (item) {
        var line = el("p", { class: "finding" });
        line.appendChild(document.createTextNode((SURFACE_LABEL[item.surface] || item.surface) + ": " + item.detail + " "));
        if (item.evidenceUrl && /^https?:\/\//i.test(item.evidenceUrl)) {
          line.appendChild(el("a", { href: item.evidenceUrl, rel: "noopener", target: "_blank", text: "Source" }));
        }
        seen.appendChild(line);
      });
      tbody.appendChild(el("tr", {}, [
        el("td", { text: check.label }),
        el("td", { text: String(check.score) }),
        el("td", {}, [badgeFor(check)]),
        seen,
      ]));
    });
    table.appendChild(tbody);
    var wrap = el("div", { class: "scorecard-wrap" });
    wrap.appendChild(table);
    card.appendChild(wrap);

    var tools = $("toolsBlock");
    tools.innerHTML = "";
    tools.appendChild(el("h2", { text: "Tools and formats" }));
    var pack = result.toolsAndFormats || {};
    tools.appendChild(el("h3", { text: "Noticed" }));
    tools.appendChild(chipList(pack.detected && pack.detected.length ? pack.detected : ["Nothing extra was noticed on the site."]));
    var requested = pack.requested;
    if (Array.isArray(requested)) {
      tools.appendChild(el("h3", { text: "You asked for" }));
      tools.appendChild(chipList(requested));
    } else {
      tools.appendChild(el("h3", { text: "Tools you asked for" }));
      tools.appendChild(chipList((requested && requested.tools) || []));
      tools.appendChild(el("h3", { text: "Formats you asked for" }));
      tools.appendChild(chipList((requested && requested.formats) || []));
    }

    var skipped = $("skippedBlock");
    skipped.innerHTML = "";
    skipped.appendChild(el("h2", { text: "Not checked" }));
    if (!(result.skippedSurfaces || []).length) skipped.appendChild(el("p", { text: "Every surface you added was included." }));
    (result.skippedSurfaces || []).forEach(function (item) {
      skipped.appendChild(el("p", { text: (SURFACE_LABEL[item.surface] || item.surface) + ": " + item.reason }));
    });
    $("pdfStatus").textContent = "";
  }

  function chipList(items) {
    var list = el("ul", { class: "chips" });
    (items || []).forEach(function (item) { list.appendChild(el("li", { text: item })); });
    return list;
  }

  $("downloadPdf").addEventListener("click", async function () {
    if (!auditResult) return;
    $("pdfStatus").textContent = "Preparing the PDF.";
    try {
      var blob = await fetchPdf(auditResult);
      var url = URL.createObjectURL(blob);
      var link = el("a", { href: url, download: "brand-audit.pdf" });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      $("pdfStatus").textContent = auditIsPreview
        ? "Preview PDF downloaded. The report service is not connected on this build yet."
        : "PDF downloaded.";
    } catch (err) {
      $("pdfStatus").textContent = err.message || "The PDF could not be saved. Try again.";
    }
  });

  async function fetchPdf(result) {
    try {
      var res = await fetch("/api/audit/pdf", {
        method: "POST",
        headers: {
          Accept: "application/pdf",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf(),
        },
        credentials: "same-origin",
        body: JSON.stringify(result),
      });
      var type = res.headers.get("content-type") || "";
      if (res.ok && type.indexOf("pdf") !== -1) return await res.blob();
    } catch (err) { /* fall through to the preview */ }
    var bytes = BrandAuditMock.buildPreviewPdfBytes(result, true);
    return new Blob([bytes], { type: "application/pdf" });
  }

  $("logoutBtn").addEventListener("click", async function () {
    try { await api("/api/logout", { method: "POST", body: JSON.stringify({}) }); } catch (err) { /* reload anyway */ }
    window.location.reload();
  });

  async function loadRemoteSample() {
    try {
      var res = await fetch("/api/audit/sample", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!res.ok) return null;
      var data = await res.json();
      return BrandAuditMock.isAuditResult(data) ? data : null;
    } catch (err) {
      return null;
    }
  }

  async function boot() {
    renderSample(BrandAuditMock.sample());
    try {
      await api("/api/session");
      var remote = await loadRemoteSample();
      if (remote) renderSample(remote);
      var listed = await api("/api/brands");
      if (!listed.brands.length) {
        show("landingView", { focus: false });
        return;
      }
      brandId = listed.brands[0].id;
      var data = await api("/api/brands/" + brandId);
      if (data.status === "failed") {
        show("progressView");
        $("blockedBox").hidden = false;
        $("blockedText").textContent = data.error || "We could not read that address.";
        $("progressHeading").textContent = "The import stopped";
        return;
      }
      if (data.status !== "ready") {
        show("progressView");
        $("progressText").textContent = "Reading your website";
        $("extractUrl").textContent = data.sourceUrl || "";
        for (;;) {
          await sleep(1200);
          data = await api("/api/brands/" + brandId);
          if (data.status === "ready") break;
          if (data.status === "failed") return showBlocked();
        }
      }
      await openBrand();
    } catch (err) {
      show("landingView", { focus: false });
    }
  }

  boot();
})();
