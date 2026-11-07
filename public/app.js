(function () {
  "use strict";

  const views = {
    import: document.getElementById("importView"),
    result: document.getElementById("resultView"),
  };

  function show(view) {
    Object.values(views).forEach((el) => (el.hidden = true));
    view.hidden = false;
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|; )gs_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (options.method && options.method !== "GET") {
      headers["X-CSRF-Token"] = csrfToken();
    }
    const res = await fetch(path, Object.assign({}, options, { headers, credentials: "same-origin" }));
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* no body */
    }
    if (!res.ok) {
      const message = (body && body.message) || (body && body.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return body;
  }

  // --- Start over (abandons this anonymous workspace; a brand-new one is
  // provisioned automatically on the next request) ---
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    if (!confirm("Start a new workspace? This import and anything generated from it will no longer be reachable.")) {
      return;
    }
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.reload();
  });

  // --- Import ---
  const importForm = document.getElementById("importForm");
  const importError = document.getElementById("importError");
  const jobStatus = document.getElementById("jobStatus");
  const jobStatusText = document.getElementById("jobStatusText");

  importForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    importError.hidden = true;
    const url = document.getElementById("siteUrl").value.trim();
    const submitBtn = importForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const { brand, jobId } = await api("/api/brands", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      jobStatus.hidden = false;
      jobStatusText.textContent = "Queued.";
      await pollJob(jobId);
      await openResult(brand.id);
    } catch (err) {
      importError.textContent = err.message;
      importError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  function pollJob(jobId) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const job = await api(`/api/jobs/${jobId}`);
          jobStatusText.textContent = describeJob(job);
          if (job.status === "succeeded") {
            resolve(job);
          } else if (job.status === "failed" || job.status === "cancelled") {
            reject(new Error(job.last_error || `Import ${job.status}.`));
          } else {
            setTimeout(tick, 1200);
          }
        } catch (err) {
          reject(err);
        }
      };
      tick();
    });
  }

  function describeJob(job) {
    switch (job.status) {
      case "queued":
        return "Queued, waiting for a free worker slot.";
      case "running":
        return "Importing: fetching the page and its stylesheets now.";
      case "succeeded":
        return "Import complete.";
      case "failed":
        return `Import failed: ${job.last_error || "unknown error"}`;
      case "cancelled":
        return "Import cancelled.";
      default:
        return job.status;
    }
  }

  async function loadBrandList() {
    const { brands } = await api("/api/brands");
    const container = document.getElementById("brandList");
    container.innerHTML = "";
    if (brands.length === 0) return;
    const heading = document.createElement("h2");
    heading.textContent = "Previous imports";
    container.appendChild(heading);
    for (const b of brands) {
      const row = document.createElement("div");
      row.className = "brand-row";
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = b.sourceUrl;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openResult(b.id);
      });
      const status = document.createElement("span");
      status.className = "status";
      status.textContent = b.status;
      row.appendChild(link);
      row.appendChild(status);
      container.appendChild(row);
    }
  }

  // --- Result / review ---
  let currentBrandId = null;
  let selectedLogoId = null; // "none" | source_asset id

  async function openResult(brandId) {
    currentBrandId = brandId;
    const data = await api(`/api/brands/${brandId}`);
    renderResult(data);
    document.getElementById("snapshotLink").href = `/api/brands/${brandId}/snapshot.md`;
    show(views.result);
    document.getElementById("runResult").innerHTML = "";
    document.getElementById("uploadCheckResult").innerHTML = "";
    document.getElementById("shareReveal").hidden = true;
    await loadShares(brandId);
  }

  document.getElementById("backBtn").addEventListener("click", async () => {
    show(views.import);
    await loadBrandList();
  });

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  function renderResult(data) {
    document.getElementById("resultTitle").textContent = data.sourceUrl;
    document.getElementById("resultMeta").textContent = `Status: ${data.status}. Fetched ${
      data.context ? new Date(data.context.fetchedAt).toLocaleString("en-GB") : "not yet"
    }.`;

    const unknownsBox = document.getElementById("resultUnknowns");
    const unknownsList = document.getElementById("unknownsList");
    unknownsList.innerHTML = "";
    const unknowns = (data.context && data.context.unknowns) || [];
    if (unknowns.length > 0) {
      unknowns.forEach((u) => unknownsList.appendChild(el("li", { textContent: u })));
      unknownsBox.hidden = false;
    } else {
      unknownsBox.hidden = true;
    }

    renderLogoCandidates(data);
    renderColourCandidates(data);
    renderFontCandidates(data);

    document.getElementById("textExcerpt").textContent =
      (data.context && data.context.textExcerpt) || "No readable copy was extracted.";

    renderSourceAssets(data.assets || []);

    const approvedAlready = data.approvedContext;
    if (approvedAlready && approvedAlready.logoAssetId) {
      selectedLogoId = approvedAlready.logoAssetId;
    } else {
      selectedLogoId = "none";
    }
    document.getElementById("voiceNotes").value = (approvedAlready && approvedAlready.voiceNotes) || "";
    const approvedColours = new Set((approvedAlready && approvedAlready.colours) || []);
    const approvedFonts = new Set((approvedAlready && approvedAlready.fonts) || []);
    document.querySelectorAll(".colour-approve").forEach((i) => {
      i.checked = approvedColours.has(i.value);
    });
    document.querySelectorAll(".font-approve").forEach((i) => {
      i.checked = approvedFonts.has(i.value);
    });
  }

  function renderLogoCandidates(data) {
    const container = document.getElementById("logoCandidates");
    container.innerHTML = "";
    const candidates = (data.context && data.context.logoCandidates) || [];
    const assetByUrl = new Map((data.assets || []).filter((a) => a.mime_type).map((a) => [a.origin_url, a]));

    if (candidates.length === 0) {
      container.appendChild(el("p", { className: "hint", textContent: "No candidates found." }));
      return;
    }

    candidates.forEach((cand) => {
      const asset = assetByUrl.get(cand.url);
      const card = el("div", { className: "candidate-card" });
      card.dataset.assetId = asset ? asset.id : "";
      if (asset) {
        const img = el("img", { src: `/api/assets/${asset.id}`, alt: `${cand.kind} candidate` });
        card.appendChild(img);
      } else {
        card.appendChild(el("p", { className: "hint", textContent: "Not downloaded (inline SVG, needs manual review)." }));
      }
      card.appendChild(el("div", { className: "meta-row" }, [
        el("span", { textContent: cand.kind }),
        el("span", { className: "confidence", textContent: `confidence ${cand.confidence.toFixed(2)}` }),
      ]));
      const radio = el("label", { className: "hint" });
      const input = el("input", { type: "radio", name: "logoChoice", value: asset ? asset.id : "" });
      input.addEventListener("change", () => {
        selectedLogoId = asset ? asset.id : "none";
        document.querySelectorAll("#logoCandidates .candidate-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
      radio.appendChild(input);
      radio.appendChild(document.createTextNode(" use this one"));
      card.appendChild(radio);
      container.appendChild(card);
    });
  }

  function renderColourCandidates(data) {
    const container = document.getElementById("colourCandidates");
    container.innerHTML = "";
    const colours = (data.context && data.context.colours) || [];
    if (colours.length === 0) {
      container.appendChild(el("p", { className: "hint", textContent: "No colour declarations found." }));
      return;
    }
    colours.slice(0, 12).forEach((c) => {
      const card = el("div", { className: "candidate-card" });
      card.appendChild(el("div", { className: "swatch", style: `background:${c.hex}` }));
      card.appendChild(el("div", { className: "meta-row" }, [
        el("span", { textContent: c.hex }),
        el("span", { className: "confidence", textContent: `${c.declarationCount} declaration(s)` }),
      ]));
      card.appendChild(el("p", { className: "hint", textContent: c.properties.join(", ") }));
      const label = el("label", { className: "hint" });
      const input = el("input", { type: "checkbox", value: c.hex, className: "colour-approve" });
      label.appendChild(input);
      label.appendChild(document.createTextNode(" approve"));
      card.appendChild(label);
      container.appendChild(card);
    });
  }

  function renderFontCandidates(data) {
    const container = document.getElementById("fontCandidates");
    container.innerHTML = "";
    const fonts = (data.context && data.context.fonts) || [];
    const links = (data.context && data.context.googleFontsLinks) || [];
    if (fonts.length === 0 && links.length === 0) {
      container.appendChild(el("p", { className: "hint", textContent: "No font declarations found." }));
      return;
    }
    fonts.forEach((f) => {
      const card = el("div", { className: "candidate-card" });
      card.appendChild(el("p", { textContent: f.family, style: "font-size:18px;margin:0;" }));
      card.appendChild(el("p", { className: "hint", textContent: `${f.source}${f.weight ? ", weight " + f.weight : ""}` }));
      const label = el("label", { className: "hint" });
      const input = el("input", { type: "checkbox", value: f.family, className: "font-approve" });
      label.appendChild(input);
      label.appendChild(document.createTextNode(" approve"));
      card.appendChild(label);
      container.appendChild(card);
    });
    links.forEach((href) => {
      const card = el("div", { className: "candidate-card" });
      card.appendChild(el("p", { className: "hint", textContent: "Google Fonts link" }));
      card.appendChild(el("p", { textContent: href, style: "font-size:12px;word-break:break-all;" }));
      container.appendChild(card);
    });
  }

  function renderSourceAssets(assets) {
    const list = document.getElementById("sourceAssets");
    list.innerHTML = "";
    if (assets.length === 0) {
      list.appendChild(el("li", { textContent: "No files stored yet." }));
      return;
    }
    assets.forEach((a) => {
      const li = el("li");
      const label = el("span", { textContent: `${a.kind}: ${a.origin_url}` });
      const link = el("a", { href: `/api/assets/${a.id}`, target: "_blank", rel: "noopener", textContent: "open" });
      li.appendChild(label);
      li.appendChild(link);
      list.appendChild(li);
    });
  }

  document.getElementById("approveBtn").addEventListener("click", async () => {
    const approveStatus = document.getElementById("approveStatus");
    const colours = Array.from(document.querySelectorAll(".colour-approve:checked")).map((i) => i.value);
    const fonts = Array.from(document.querySelectorAll(".font-approve:checked")).map((i) => i.value);
    const voiceNotes = document.getElementById("voiceNotes").value.trim();
    try {
      await api(`/api/brands/${currentBrandId}`, {
        method: "PATCH",
        body: JSON.stringify({
          approvedContext: {
            logoAssetId: selectedLogoId === "none" ? null : selectedLogoId,
            colours,
            fonts,
            voiceNotes,
          },
        }),
      });
      approveStatus.textContent = "Saved.";
    } catch (err) {
      approveStatus.textContent = `Could not save: ${err.message}`;
    }
  });

  // --- Runs ---
  const runForm = document.getElementById("runForm");
  const runError = document.getElementById("runError");
  const runStatus = document.getElementById("runStatus");
  const runStatusText = document.getElementById("runStatusText");

  runForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    runError.hidden = true;
    const task = document.getElementById("runTask").value.trim();
    const submitBtn = runForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const { run, jobId } = await api(`/api/brands/${currentBrandId}/runs`, {
        method: "POST",
        body: JSON.stringify({ task }),
      });
      runStatus.hidden = false;
      runStatusText.textContent = "Queued.";
      await pollRunJob(jobId);
      await pollRunUntilDone(run.id);
    } catch (err) {
      runError.textContent = err.message;
      runError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  function pollRunJob(jobId) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const job = await api(`/api/jobs/${jobId}`);
          runStatusText.textContent = `Job ${job.phase}: ${job.status}${job.last_error ? ` (${job.last_error})` : ""}`;
          if (job.status === "succeeded") {
            resolve(job);
          } else if (job.status === "failed" || job.status === "cancelled") {
            // The run's own status/last error is the useful signal here —
            // a failed brief job still means a real, inspectable run record.
            resolve(job);
          } else {
            setTimeout(tick, 1200);
          }
        } catch (err) {
          reject(err);
        }
      };
      tick();
    });
  }

  const POST_TYPES = ["linkedin_image", "instagram_image", "x_image", "post_copy"];
  const OUTPUT_TYPE_LABELS = {
    linkedin_image: "LinkedIn image",
    instagram_image: "Instagram image",
    x_image: "X image",
    post_copy: "Post caption",
    one_pager_pdf: "One page PDF",
    slide: "Slide",
  };
  const LABEL_CLASS = {
    "Brand approved": "label-approved",
    Draft: "label-draft",
    "Needs review": "label-needs-review",
  };

  function renderOutputCard(o) {
    const card = el("div", { className: "candidate-card output-card" });
    card.appendChild(
      el("div", { className: "meta-row" }, [
        el("span", { textContent: OUTPUT_TYPE_LABELS[o.type] || o.type }),
        el("span", { className: `label-chip ${LABEL_CLASS[o.label] || ""}`, textContent: o.label }),
      ])
    );
    if (o.status === "pending") {
      card.appendChild(el("p", { className: "hint", textContent: "Still working on this one." }));
    } else if (o.status === "failed") {
      card.appendChild(el("p", { className: "hint", textContent: "This one could not be rendered." }));
    } else if (o.type === "post_copy") {
      card.appendChild(el("p", { textContent: (o.brief && o.brief.postCopyText) || "" }));
    } else if (o.type !== "one_pager_pdf") {
      card.appendChild(
        el("img", { src: `/api/outputs/${o.id}/file`, alt: OUTPUT_TYPE_LABELS[o.type] || o.type, loading: "lazy" })
      );
    }
    if (o.status === "ready" && o.type !== "post_copy") {
      card.appendChild(
        el("a", { href: `/api/outputs/${o.id}/file`, target: "_blank", rel: "noopener", textContent: "Download, full resolution, no watermark" })
      );
    }
    return card;
  }

  function renderUpsellPanel() {
    const panel = el("div", { className: "upsell-panel" });
    panel.appendChild(el("h2", { textContent: "Want this built into your tools" }));
    panel.appendChild(
      el("p", { className: "hint", textContent: "Everything above is yours to keep, free. If you want it built properly, here is what Goodspeed offers next." })
    );
    const tiers = el("div", { className: "card-grid" }, [
      el("div", { className: "upsell-tier" }, [
        el("h3", { textContent: "Free starter" }),
        el("p", { textContent: "A starter set like this, delivered in 24 to 48 hours, still free." }),
      ]),
      el("div", { className: "upsell-tier" }, [
        el("h3", { textContent: "Built into your tools" }),
        el("p", { textContent: "A full set built directly into Canva, Gamma, Google Slides or Figma, ready for your team to use." }),
      ]),
      el("div", { className: "upsell-tier" }, [
        el("h3", { textContent: "Ongoing upkeep" }),
        el("p", { textContent: "We keep your brand assets current as your brand evolves, month to month." }),
      ]),
    ]);
    panel.appendChild(tiers);
    panel.appendChild(
      el("a", { className: "btn btn-primary", href: "https://goodspeed.studio/contact", target: "_blank", rel: "noopener", textContent: "Talk to Goodspeed" })
    );
    return panel;
  }

  function renderLeadForm(brandId) {
    const wrap = el("div", { className: "lead-form" });
    wrap.appendChild(el("h2", { textContent: "Want a call about the paid build" }));
    wrap.appendChild(el("p", { className: "hint", textContent: "Optional. Leave your email and we will reach out. No spam, no account needed." }));
    const form = el("form", { className: "stack" });
    const email = el("input", { type: "email", name: "email", placeholder: "you@example.com", required: true, ariaLabel: "Email address" });
    const tool = el("input", { type: "text", name: "preferredTool", placeholder: "Preferred tool, e.g. Figma, Canva, Slides (optional)", ariaLabel: "Preferred tool" });
    const notes = el("textarea", { name: "notes", rows: 2, placeholder: "Anything about your brand we should know (optional)", ariaLabel: "Notes" });
    const consentLabel = el("label", { className: "hint" });
    const consentInput = el("input", { type: "checkbox", required: true });
    consentLabel.appendChild(consentInput);
    consentLabel.appendChild(document.createTextNode(" I am happy for Goodspeed to contact me about this."));
    const submit = el("button", { type: "submit", className: "btn btn-primary", textContent: "Send" });
    const status = el("p", { className: "hint" });
    form.appendChild(email);
    form.appendChild(tool);
    form.appendChild(notes);
    form.appendChild(consentLabel);
    form.appendChild(submit);
    form.appendChild(status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await api(`/api/brands/${brandId}/leads`, {
          method: "POST",
          body: JSON.stringify({ email: email.value.trim(), preferredTool: tool.value.trim(), notes: notes.value.trim(), consent: consentInput.checked }),
        });
        form.hidden = true;
        status.hidden = false;
        wrap.appendChild(el("p", { textContent: "Thank you. We will be in touch." }));
      } catch (err) {
        status.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    });
    wrap.appendChild(form);
    return wrap;
  }

  async function renderRunResult(runId) {
    const run = await api(`/api/runs/${runId}`);
    renderRunFromData(run);
    return run;
  }

  const RUN_TERMINAL_STATUSES = ["completed", "partial", "failed"];

  /** The brief job (what pollRunJob below tracks) finishing doesn't mean the run is done — rendering/reviewing each output happens in a separate job straight after. Poll the run itself until it reaches a terminal status, redrawing outputs as they go from pending to ready. */
  function pollRunUntilDone(runId) {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const run = await api(`/api/runs/${runId}`);
          runStatusText.textContent = `Run status: ${run.status}`;
          renderRunFromData(run);
          if (RUN_TERMINAL_STATUSES.includes(run.status)) {
            resolve(run);
          } else {
            setTimeout(tick, 1500);
          }
        } catch (err) {
          reject(err);
        }
      };
      tick();
    });
  }

  function renderRunFromData(run) {
    const container = document.getElementById("runResult");
    container.innerHTML = "";
    container.appendChild(el("p", { textContent: `Run status: ${run.status}` }));
    if (run.outputs.length === 0) {
      container.appendChild(el("p", { className: "hint", textContent: "No outputs yet." }));
      return;
    }

    const posts = run.outputs.filter((o) => POST_TYPES.includes(o.type));
    const moreFormats = run.outputs.filter((o) => !POST_TYPES.includes(o.type));

    const grid = el("div", { className: "card-grid" });
    posts.forEach((o) => grid.appendChild(renderOutputCard(o)));
    container.appendChild(grid);

    if (moreFormats.length > 0) {
      const details = document.createElement("details");
      details.className = "more-formats";
      const summary = document.createElement("summary");
      summary.textContent = "More formats (one page PDF, slide)";
      details.appendChild(summary);
      const moreGrid = el("div", { className: "card-grid" });
      moreFormats.forEach((o) => moreGrid.appendChild(renderOutputCard(o)));
      details.appendChild(moreGrid);
      container.appendChild(details);
    }

    if (run.status === "completed" || run.status === "partial") {
      container.appendChild(renderUpsellPanel());
      container.appendChild(renderLeadForm(run.brandId));
    }
  }

  // --- Upload-and-check ---
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result || "";
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsDataURL(file);
    });
  }

  const uploadCheckForm = document.getElementById("uploadCheckForm");
  const uploadCheckError = document.getElementById("uploadCheckError");

  uploadCheckForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    uploadCheckError.hidden = true;
    const fileInput = document.getElementById("uploadCheckFile");
    const file = fileInput.files && fileInput.files[0];
    const resultBox = document.getElementById("uploadCheckResult");
    resultBox.innerHTML = "";
    if (!file) return;
    const submitBtn = uploadCheckForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const imageBase64 = await readFileAsBase64(file);
      const result = await api(`/api/brands/${currentBrandId}/check-upload`, {
        method: "POST",
        body: JSON.stringify({ mimeType: file.type, imageBase64 }),
      });
      resultBox.appendChild(
        el("p", { className: "hint", textContent: `Found ${result.foundCount} of ${result.totalApproved} approved colours in this image, colour only.` })
      );
      const grid = el("div", { className: "card-grid" });
      result.matches.forEach((m) => {
        const card = el("div", { className: "candidate-card" });
        card.appendChild(el("div", { className: "swatch", style: `background:${m.approvedHex}` }));
        card.appendChild(
          el("div", { className: "meta-row" }, [
            el("span", { textContent: m.approvedHex }),
            el("span", { className: m.found ? "label-chip label-approved" : "label-chip label-draft", textContent: m.found ? "Found" : "Not found" }),
          ])
        );
        card.appendChild(el("p", { className: "hint", textContent: `Closest colour in image: ${m.closestObservedHex}` }));
        grid.appendChild(card);
      });
      resultBox.appendChild(grid);
    } catch (err) {
      uploadCheckError.textContent = err.message;
      uploadCheckError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  // --- Sharing ---
  async function loadShares(brandId) {
    const { shares } = await api(`/api/brands/${brandId}/shares`);
    const list = document.getElementById("shareList");
    list.innerHTML = "";
    shares.forEach((s) => {
      const li = el("li");
      li.appendChild(el("span", { textContent: `Link created ${new Date(s.createdAt).toLocaleString("en-GB")}` }));
      const revokeBtn = el("button", { className: "btn btn-ghost", textContent: "Revoke" });
      revokeBtn.addEventListener("click", async () => {
        await api(`/api/brands/${brandId}/share/${s.id}`, { method: "DELETE" });
        await loadShares(brandId);
      });
      li.appendChild(revokeBtn);
      list.appendChild(li);
    });
  }

  document.getElementById("enableShareBtn").addEventListener("click", async () => {
    const reveal = document.getElementById("shareReveal");
    try {
      const share = await api(`/api/brands/${currentBrandId}/share`, { method: "POST" });
      reveal.hidden = false;
      reveal.innerHTML = "";
      reveal.appendChild(el("p", { textContent: "Share link (shown once, save it now)." }));
      const link = el("a", { href: share.url, target: "_blank", rel: "noopener", textContent: share.url });
      link.style.wordBreak = "break-all";
      reveal.appendChild(link);
      reveal.appendChild(el("p", { className: "hint", textContent: share.warning }));
      await loadShares(currentBrandId);
    } catch (err) {
      reveal.hidden = false;
      reveal.textContent = `Could not enable sharing: ${err.message}`;
    }
  });

  // --- Boot ---
  // No login step — the server silently provisions an isolated, anonymous
  // workspace on first visit (see attachSession in auth-middleware.ts).
  async function boot() {
    await api("/api/session");
    show(views.import);
    await loadBrandList();
  }

  boot().catch((err) => {
    console.error(err);
    importError.textContent = `Could not start: ${err.message}`;
    importError.hidden = false;
  });
})();
