(function () {
  var TOOLS = ["Canva", "Figma", "Google Slides", "Gamma", "PowerPoint", "Notion", "Other"];
  var FORMATS = ["LinkedIn posts", "Decks", "One-pagers", "Blog images", "Ads", "Other"];
  var VIEWS = ["urlView", "readingView", "profileView", "channelsView", "toolsView", "auditView", "resultsView"];
  var STAGE = {
    urlView: "brand", readingView: "brand", profileView: "brand",
    channelsView: "channels", toolsView: "tools", auditView: "audit", resultsView: "audit",
  };
  var STATUS = { ok: "Sound", warn: "Weak", break: "Breaking" };
  var SURFACE = { site: "Site", blog: "Blog", linkedin: "LinkedIn", deck: "Deck", x: "X", instagram: "Instagram", youtube: "YouTube" };

  var brandId = null;
  var brandData = null;
  var confirmed = null;
  var channels = [];
  var toolStep = "tools";
  var pickedTools = [];
  var pickedFormats = [];
  var auditResult = null;
  var auditTimer = null;

  function $(id) { return document.getElementById(id); }
  function show(id) {
    VIEWS.forEach(function (view) { $(view).hidden = view !== id; });
    var stage = STAGE[id];
    var order = ["brand", "channels", "tools", "audit"];
    var active = order.indexOf(stage);
    document.querySelectorAll("#stageBar li").forEach(function (li, index) {
      li.dataset.state = index < active ? "done" : index === active ? "active" : "waiting";
    });
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
      else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function normaliseHex(value) {
    var hex = String(value || "").trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split("").map(function (ch) { return ch + ch; }).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return "#" + hex.toLowerCase();
  }
  function notAssessed(check) {
    var findings = (check && check.findings) || [];
    return findings.length > 0 && findings.every(function (item) {
      return String(item.detail || "").indexOf("Not assessed") === 0;
    });
  }
  function badgeFor(check) {
    if (notAssessed(check)) return el("span", { class: "badge na", text: "Not assessed" });
    return el("span", { class: "badge " + check.status, text: STATUS[check.status] || check.status });
  }
  function isAuditResult(value) {
    return Boolean(value && value.brand && typeof value.brand.name === "string" && Array.isArray(value.checks) && value.toolsAndFormats && Array.isArray(value.toolsAndFormats.requested));
  }
  function setChip(host, state, step) {
    $("statusChip").hidden = !host;
    $("chipHost").textContent = host || "";
    $("chipState").textContent = state || "";
    $("chipStep").textContent = step || "";
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (err) { return url || ""; }
  }

  function renderSample(result) {
    var body = $("sampleBody");
    body.innerHTML = "";
    var score = Math.round(Number(result.overallScore) || 0);
    body.appendChild(el("p", { class: "score-num", text: String(score) }));
    body.appendChild(el("p", { class: "quiet", text: result.brand.name + " example, " + score + " out of 100" }));
    var breaks = (result.topBreaks || []).slice(0, 2);
    breaks.forEach(function (item) {
      body.appendChild(el("p", { text: item.rank + ". " + item.title + ". " + item.whyItMatters }));
    });
    var row = el("div", { class: "chip-row" });
    (result.checks || []).forEach(function (check) {
      row.appendChild(badgeFor(check));
    });
    body.appendChild(row);
  }

  $("importForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("importError").hidden = true;
    var url = $("siteUrl").value.trim();
    try {
      var started = await api("/api/brands", { method: "POST", body: JSON.stringify({ url: url }) });
      brandId = started.brand.id;
      setChip(hostOf(url), "Reading", "step 1 of 3");
      show("readingView");
      paintRead(1, "Reading the public page.");
      var job = await pollJob(started.jobId, function (current) {
        var finding = current.progress === "finding_brand";
        setChip(hostOf(url), finding ? "Finding your brand" : "Reading", finding ? "step 2 of 3" : "step 1 of 3");
        paintRead(finding ? 2 : 1, finding ? "Finding colours, type, and channels." : "Reading the public page.");
      });
      if (job.status === "failed") return showBlocked();
      await openBrand();
    } catch (err) {
      $("importError").hidden = false;
      $("importError").textContent = err.message;
      show("urlView");
    }
  });

  function paintRead(step, status) {
    $("readCount").textContent = step + " of 3";
    $("readStatus").textContent = status;
    var bar = $("readBar");
    bar.innerHTML = "";
    for (var i = 1; i <= 3; i++) bar.appendChild(el("i", { class: i <= step ? "on" : "" }));
  }

  async function pollJob(jobId, onTick) {
    for (;;) {
      var job = await api("/api/jobs/" + jobId);
      onTick(job);
      if (job.status === "succeeded" || job.status === "failed") return job;
      await sleep(1000);
    }
  }

  async function showBlocked() {
    var data = await api("/api/brands/" + brandId);
    $("blockedBox").hidden = false;
    $("blockedText").textContent = data.error || "We could not read that address.";
    $("readStatus").textContent = "The import stopped";
  }

  $("retryImport").addEventListener("click", function () { $("importForm").requestSubmit(); });
  $("correctUrl").addEventListener("click", function () { show("urlView"); $("siteUrl").focus(); });
  $("noSite").addEventListener("click", function () { $("manualForm").hidden = false; $("manualName").focus(); });
  $("chipChange").addEventListener("click", function () { show("urlView"); });
  $("chipDetails").addEventListener("click", function () {
    $("chipDetail").hidden = !$("chipDetail").hidden;
    $("chipDetail").textContent = $("chipState").textContent;
  });

  $("manualForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    $("manualError").hidden = true;
    try {
      var created = await api("/api/brands/manual", {
        method: "POST",
        body: JSON.stringify({
          name: $("manualName").value.trim(),
          offer: $("manualOffer").value.trim(),
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
    setChip(hostOf(brandData.sourceUrl || ""), "Ready", "");
    paintRead(3, "Profile ready.");
    $("readLook").innerHTML = "";
    var colours = (context.colours || []).slice(0, 6);
    if (colours.length) {
      var row = el("div", { class: "swatches" });
      colours.forEach(function (colour) {
        row.appendChild(el("span", { class: "swatch", style: "background:" + colour.hex, title: colour.hex }));
      });
      $("readLook").appendChild(row);
    } else $("readLook").textContent = "No colours were found.";
    $("readVoice").textContent = context.description || context.textExcerpt || "No readable copy was found.";
    channels = (context.channels || []).map(function (channel) {
      return { kind: channel.kind, url: channel.url, name: channel.name, kept: true };
    });
    $("readChannels").textContent = channels.length
      ? channels.map(function (channel) { return channel.name; }).join(", ")
      : "No public channel links were found.";
    renderProfile();
    show("profileView");
  }

  function logoAsset() {
    var assets = (brandData && brandData.assets) || [];
    return assets.find(function (asset) { return asset.kind === "logo"; })
      || assets.find(function (asset) { return asset.kind === "favicon"; })
      || null;
  }

  function renderProfile() {
    var context = brandData.context || {};
    var grid = $("profileGrid");
    grid.innerHTML = "";
    var logo = logoAsset();
    var brandCard = el("article", { class: "info-card" });
    brandCard.appendChild(el("header", {}, [el("h2", { text: "Brand" }), el("button", { class: "text-btn", type: "button", text: "Edit", id: "editName" })]));
    if (logo) brandCard.appendChild(el("img", { class: "logo", src: "/api/assets/" + logo.id, alt: "Logo from the site" }));
    else brandCard.appendChild(el("p", { class: "quiet", text: "Logo: unknown" }));
    brandCard.appendChild(el("input", { id: "brandName", type: "text", value: shortName(context.siteName || context.title || "") }));
    brandCard.appendChild(el("p", { class: "quiet", text: brandData.sourceUrl || "" }));
    var swatches = el("div", { class: "swatches", id: "colourFields" });
    (context.colours || []).slice(0, 8).forEach(function (colour) {
      swatches.appendChild(el("span", { class: "swatch", style: "background:" + colour.hex, title: colour.hex }));
    });
    if (!context.colours || !context.colours.length) swatches.appendChild(el("p", { class: "quiet", text: "Colours: unknown" }));
    brandCard.appendChild(swatches);
    grid.appendChild(brandCard);

    var voiceCard = el("article", { class: "info-card" });
    voiceCard.appendChild(el("header", {}, [el("h2", { text: "Voice" })]));
    voiceCard.appendChild(el("p", { text: context.description || "No description was found on the site." }));
    voiceCard.appendChild(el("textarea", { id: "voiceNotes", rows: "4", placeholder: "How you should sound. Leave this blank if you are not sure." }));
    grid.appendChild(voiceCard);

    var typeCard = el("article", { class: "info-card" });
    typeCard.appendChild(el("header", {}, [el("h2", { text: "Type" })]));
    var fonts = [];
    (context.fonts || []).forEach(function (font) {
      if (!font.family || /placeholder$/i.test(font.family) || fonts.indexOf(font.family) !== -1) return;
      fonts.push(font.family);
    });
    typeCard.appendChild(el("p", { id: "fontList", text: fonts.slice(0, 6).join(", ") || "Fonts: unknown" }));
    typeCard.dataset.fonts = fonts.slice(0, 6).join("|");
    grid.appendChild(typeCard);
    $("profileTitle").textContent = "Here's " + ($("brandName").value || "the brand") + ", as we read it.";
  }

  function shortName(value) {
    var text = String(value || "").trim();
    var pipe = text.split(" | ")[0].trim();
    return pipe || text;
  }

  $("backToUrl").addEventListener("click", function () { show("urlView"); });
  $("useBrand").addEventListener("click", async function () {
    $("approveError").hidden = true;
    var name = $("brandName").value.trim();
    if (!name) {
      $("approveError").hidden = false;
      $("approveError").textContent = "Add a business name before you continue.";
      return;
    }
    var colours = [];
    document.querySelectorAll("#colourFields .swatch").forEach(function (node) {
      var hex = normaliseHex(node.getAttribute("title") || "");
      if (hex) colours.push(hex);
    });
    var fontNode = document.getElementById("fontList");
    var fonts = fontNode && fontNode.parentElement.dataset.fonts
      ? fontNode.parentElement.dataset.fonts.split("|").filter(Boolean)
      : [];
    var logo = logoAsset();
    try {
      await api("/api/brands/" + brandId, {
        method: "PATCH",
        body: JSON.stringify({
          approvedContext: {
            logoAssetId: logo ? logo.id : null,
            colours: colours,
            fonts: fonts,
            voiceNotes: $("voiceNotes").value.trim(),
            approvedImageAssetIds: [],
            englishVariant: "uk",
          },
        }),
      });
      var context = brandData.context || {};
      confirmed = {
        name: name,
        siteUrl: brandData.sourceUrl,
        logoUrl: logo ? "/api/assets/" + logo.id : undefined,
        palette: colours,
        fonts: fonts,
        voiceSummary: $("voiceNotes").value.trim() || context.description || "",
      };
      $("snapshotLink").href = "/api/brands/" + brandId + "/snapshot.md";
      renderChannels();
      show("channelsView");
    } catch (err) {
      $("approveError").hidden = false;
      $("approveError").textContent = err.message;
    }
  });

  function renderChannels() {
    var grid = $("channelGrid");
    grid.innerHTML = "";
    if (!channels.length) {
      grid.appendChild(el("p", { text: "No public LinkedIn, X, Instagram, YouTube, or blog links were found on the site." }));
      return;
    }
    channels.forEach(function (channel, index) {
      var card = el("article", { class: "pick" + (channel.kept ? " on" : ""), "data-index": String(index) });
      card.appendChild(el("span", { class: "num", text: String(index + 1) }));
      card.appendChild(el("span", { class: "icon-tile", text: SURFACE[channel.kind] || channel.kind }));
      card.appendChild(el("h2", { text: channel.name }));
      card.appendChild(el("p", { class: "domain", text: hostOf(channel.url) }));
      var row = el("div", { class: "row" });
      var keep = el("button", { type: "button", class: "text-btn", text: channel.kept ? "Keeping" : "Dropped" });
      var drop = el("button", { type: "button", class: "text-btn", text: "Drop" });
      keep.addEventListener("click", function () { channel.kept = true; renderChannels(); });
      drop.addEventListener("click", function () { channel.kept = false; renderChannels(); });
      row.appendChild(keep);
      row.appendChild(drop);
      card.appendChild(row);
      grid.appendChild(card);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (!$("channelsView") || $("channelsView").hidden) return;
    if (event.target && /input|textarea/i.test(event.target.tagName)) return;
    var n = Number(event.key);
    if (!n || !channels[n - 1]) return;
    channels[n - 1].kept = !channels[n - 1].kept;
    renderChannels();
  });

  $("backToProfile").addEventListener("click", function () { show("profileView"); });
  $("keepChannels").addEventListener("click", function () {
    if ($("linkedinText").value.trim().length > 12000) {
      $("channelsError").hidden = false;
      $("channelsError").textContent = "Paste a shorter LinkedIn excerpt. A few posts is enough.";
      return;
    }
    $("channelsError").hidden = true;
    toolStep = "tools";
    renderToolStep();
    show("toolsView");
  });

  function renderToolStep() {
    var names = toolStep === "tools" ? TOOLS : FORMATS;
    var selected = toolStep === "tools" ? pickedTools : pickedFormats;
    $("toolCount").textContent = toolStep === "tools" ? "1 of 2" : "2 of 2";
    $("toolTitle").textContent = toolStep === "tools" ? "Which tools do you use?" : "Which formats do you ship?";
    $("toolSub").textContent = "Pick at least one. You can also type a number.";
    var grid = $("choiceGrid");
    grid.innerHTML = "";
    names.forEach(function (name, index) {
      var on = selected.indexOf(name) !== -1;
      var chip = el("button", { type: "button", class: "choice" + (on ? " on" : ""), "data-name": name });
      chip.appendChild(document.createTextNode(name));
      chip.appendChild(el("span", { class: "num", text: String(index + 1) }));
      chip.addEventListener("click", function () { toggleChoice(name); });
      grid.appendChild(chip);
    });
    var otherOn = selected.indexOf("Other") !== -1;
    $("otherWrap").hidden = !otherOn;
  }

  function toggleChoice(name) {
    var list = toolStep === "tools" ? pickedTools : pickedFormats;
    var at = list.indexOf(name);
    if (at === -1) list.push(name);
    else list.splice(at, 1);
    renderToolStep();
  }

  document.addEventListener("keydown", function (event) {
    if ($("toolsView").hidden) return;
    if (event.target && /input|textarea/i.test(event.target.tagName)) return;
    var n = Number(event.key);
    var names = toolStep === "tools" ? TOOLS : FORMATS;
    if (!n || !names[n - 1]) return;
    toggleChoice(names[n - 1]);
  });

  $("toolBack").addEventListener("click", function () {
    if (toolStep === "formats") {
      toolStep = "tools";
      renderToolStep();
      return;
    }
    show("channelsView");
  });

  $("toolNext").addEventListener("click", async function () {
    $("toolsError").hidden = true;
    $("rateNote").hidden = true;
    var list = toolStep === "tools" ? pickedTools : pickedFormats;
    var other = $("otherText").value.trim();
    if (list.indexOf("Other") !== -1 && toolStep === "formats" && !other) {
      $("toolsError").hidden = false;
      $("toolsError").textContent = "Name the other format.";
      return;
    }
    if (toolStep === "tools" && list.indexOf("Other") !== -1 && !other) {
      $("toolsError").hidden = false;
      $("toolsError").textContent = "Name the other tool.";
      return;
    }
    var cleaned = list.filter(function (name) { return name !== "Other"; });
    if (list.indexOf("Other") !== -1 && other) cleaned.push(other);
    if (!cleaned.length) {
      $("toolsError").hidden = false;
      $("toolsError").textContent = toolStep === "tools" ? "Pick at least one tool." : "Pick at least one format.";
      return;
    }
    if (toolStep === "tools") {
      pickedTools = cleaned;
      toolStep = "formats";
      $("otherText").value = "";
      renderToolStep();
      return;
    }
    pickedFormats = cleaned;
    await runAudit();
  });

  async function runAudit() {
    var body = {
      siteUrl: confirmed.siteUrl,
      tools: pickedTools,
      formats: pickedFormats,
      channels: channels.filter(function (channel) { return channel.kept; }).map(function (channel) {
        return { kind: channel.kind, url: channel.url };
      }),
    };
    var blog = body.channels.filter(function (channel) { return channel.kind === "blog"; })[0];
    if (blog) body.blogUrl = blog.url;
    var linkedin = $("linkedinText").value.trim();
    if (linkedin) body.linkedinText = linkedin;
    show("auditView");
    setStep("site");
    var started = Date.now();
    if (auditTimer) clearInterval(auditTimer);
    auditTimer = setInterval(function () {
      var elapsed = Date.now() - started;
      setStep(elapsed < 900 ? "site" : elapsed < 2200 ? "channels" : "report");
    }, 400);
    try {
      auditResult = await postAudit(body);
      var wait = 1600 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      clearInterval(auditTimer);
      renderResults();
      show("resultsView");
    } catch (err) {
      clearInterval(auditTimer);
      show("toolsView");
      if (err.status === 429) $("rateNote").hidden = false;
      else {
        $("toolsError").hidden = false;
        $("toolsError").textContent = err.message;
      }
    }
  }

  function setStep(step) {
    var copy = { site: "Checking your site", channels: "Checking the channels you kept", report: "Writing your report" };
    $("auditStatus").textContent = copy[step];
    var seen = false;
    Array.prototype.forEach.call($("auditSteps").children, function (li) {
      if (li.dataset.step === step) { li.dataset.state = "active"; seen = true; }
      else li.dataset.state = seen ? "waiting" : "done";
    });
  }

  async function postAudit(body) {
    await api("/api/session");
    var res = await fetch("/api/audit", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrf() },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    if (res.ok && isAuditResult(data)) return data;
    var error = new Error((data && data.message) || "The audit did not finish. Please try again.");
    error.status = res.status;
    throw error;
  }

  function renderResults() {
    var result = auditResult;
    $("resultsTitle").textContent = "Where " + result.brand.name + " is breaking";
    var score = $("scoreBlock");
    score.innerHTML = "";
    if (result.brand.logoUrl) score.appendChild(el("img", { class: "logo", src: result.brand.logoUrl, alt: "" }));
    var n = Math.round(Number(result.overallScore) || 0);
    score.appendChild(el("p", { class: "score-num", text: String(n) }));
    score.appendChild(el("p", { class: "quiet", text: n + " out of 100. " + result.brand.name }));
    if (result.brand.palette && result.brand.palette.length) {
      var swatches = el("div", { class: "swatches" });
      result.brand.palette.forEach(function (hex) {
        swatches.appendChild(el("span", { class: "swatch", style: "background:" + hex, title: hex }));
      });
      score.appendChild(swatches);
    }
    score.appendChild(el("p", { text: result.brand.voiceSummary || "" }));

    var compare = $("compareBlock");
    compare.innerHTML = "";
    var pairs = [];
    (result.checks || []).forEach(function (check) {
      (check.findings || []).forEach(function (finding) {
        if (finding.comparison) pairs.push(finding);
      });
    });
    if (pairs.length) {
      compare.appendChild(el("h2", { text: "Side by side" }));
      var list = el("div", { class: "compare-list" });
      pairs.forEach(function (finding) { list.appendChild(compareCard(finding)); });
      compare.appendChild(list);
    }

    var breaks = $("breaksBlock");
    breaks.innerHTML = "";
    var anyBreak = (result.checks || []).some(function (check) { return check.status === "break" && !notAssessed(check); });
    breaks.appendChild(el("h2", { text: anyBreak ? "Where it breaks most" : "The weakest points" }));
    if (!(result.topBreaks || []).length) breaks.appendChild(el("p", { text: "Nothing in this report was marked as weak." }));
    (result.topBreaks || []).forEach(function (item) {
      var card = el("article", { class: "info-card" });
      card.appendChild(el("p", { class: "quiet", text: "Rank " + item.rank + ", " + (SURFACE[item.surface] || item.surface) }));
      card.appendChild(el("h3", { text: item.title }));
      card.appendChild(el("p", { text: "Why it matters: " + (item.whyItMatters || "") }));
      card.appendChild(el("p", { text: "The cost: " + safeCost(item.cost) }));
      breaks.appendChild(card);
    });

    var card = $("scorecardBlock");
    card.innerHTML = "";
    card.appendChild(el("h2", { text: "Scorecard" }));
    var table = el("table", { class: "scorecard" });
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "Check" }), el("th", { text: "Score" }), el("th", { text: "Status" }), el("th", { text: "What we saw" }),
    ])]));
    var tbody = el("tbody");
    (result.checks || []).forEach(function (check) {
      var seen = el("td");
      (check.findings || []).forEach(function (finding) {
        var line = el("p");
        line.appendChild(document.createTextNode((SURFACE[finding.surface] || finding.surface) + ": " + finding.detail + " "));
        if (finding.evidenceUrl && /^https?:\/\//i.test(finding.evidenceUrl)) {
          line.appendChild(el("a", { href: finding.evidenceUrl, rel: "noopener", target: "_blank", text: "Source" }));
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
    card.appendChild(table);

    var tools = $("toolsBlock");
    tools.innerHTML = "";
    tools.appendChild(el("h2", { text: "Tools and formats" }));
    var pack = result.toolsAndFormats || {};
    tools.appendChild(el("h3", { text: "Noticed" }));
    tools.appendChild(chipList(pack.detected && pack.detected.length ? pack.detected : ["Nothing extra was noticed on the site."]));
    tools.appendChild(el("h3", { text: "You asked for" }));
    tools.appendChild(chipList(pack.requested || []));

    var skipped = $("skippedBlock");
    skipped.innerHTML = "";
    skipped.appendChild(el("h2", { text: "Not checked" }));
    if (!(result.skippedSurfaces || []).length) skipped.appendChild(el("p", { text: "Every surface you added was included." }));
    (result.skippedSurfaces || []).forEach(function (item) {
      skipped.appendChild(el("p", { text: (SURFACE[item.surface] || item.surface) + ": " + item.reason }));
    });
    $("pdfStatus").textContent = "";
  }

  function compareCard(finding) {
    var card = el("article", { class: "info-card" });
    card.appendChild(el("h3", { text: (SURFACE[finding.surface] || finding.surface) + ": " + finding.detail }));
    if (finding.whyItMatters) card.appendChild(el("p", { text: finding.whyItMatters }));
    var grid = el("div", { class: "compare" });
    grid.appendChild(sideFigure(finding.comparison.site));
    grid.appendChild(sideFigure(finding.comparison.other));
    card.appendChild(grid);
    if (finding.evidenceUrl) card.appendChild(el("a", { href: finding.evidenceUrl, rel: "noopener", target: "_blank", text: "Source" }));
    return card;
  }

  function sideFigure(side) {
    var figure = el("figure");
    figure.appendChild(el("figcaption", { text: side.caption || "" }));
    if (side.imageUrl) figure.appendChild(el("img", { class: "logo", src: side.imageUrl, alt: "" }));
    if (side.swatches && side.swatches.length) {
      var row = el("div", { class: "swatches" });
      side.swatches.forEach(function (hex) {
        row.appendChild(el("span", { class: "swatch", style: "background:" + hex, title: hex }));
      });
      figure.appendChild(row);
    }
    if (side.text) figure.appendChild(el("p", { text: side.text }));
    return figure;
  }

  function chipList(items) {
    var list = el("div", { class: "chip-row" });
    (items || []).forEach(function (item) { list.appendChild(el("span", { class: "choice", text: item })); });
    return list;
  }

  function safeCost(text) {
    if (!text || /[£$€]|\bGBP\b|\bUSD\b/i.test(text)) return "The cost is trust, rework, or a design bottleneck. No figure is shown.";
    return text;
  }

  $("downloadPdf").addEventListener("click", async function () {
    if (!auditResult) return;
    $("pdfStatus").textContent = "Preparing the PDF.";
    try {
      var res = await fetch("/api/audit/pdf", {
        method: "POST",
        headers: { Accept: "application/pdf", "Content-Type": "application/json", "X-CSRF-Token": csrf() },
        credentials: "same-origin",
        body: JSON.stringify(auditResult),
      });
      var type = res.headers.get("content-type") || "";
      if (!res.ok || type.indexOf("pdf") === -1) {
        var data = null;
        try { data = JSON.parse(await res.text()); } catch (err) { data = null; }
        throw new Error((data && data.message) || "The PDF could not be saved. Try again.");
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var link = el("a", { href: url, download: "brand-audit.pdf" });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      $("pdfStatus").textContent = "PDF downloaded.";
    } catch (err) {
      $("pdfStatus").textContent = err.message || "The PDF could not be saved. Try again.";
    }
  });

  $("logoutBtn").addEventListener("click", async function () {
    try { await api("/api/logout", { method: "POST", body: JSON.stringify({}) }); } catch (err) { /* reload anyway */ }
    window.location.reload();
  });

  async function boot() {
    try {
      await api("/api/session");
      var sample = await api("/api/audit/sample");
      if (isAuditResult(sample)) renderSample(sample);
      show("urlView");
    } catch (err) {
      var body = $("sampleBody");
      if (body) body.textContent = err.message || "The example report could not be loaded.";
      show("urlView");
    }
  }
  boot();
})();
