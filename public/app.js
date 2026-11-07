(function () {
  "use strict";

  const views = {
    login: document.getElementById("loginView"),
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

  // --- Login ---
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ code: document.getElementById("accessCode").value }),
      });
      await boot();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    document.getElementById("logoutBtn").hidden = true;
    show(views.login);
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
    show(views.result);
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
        card.appendChild(el("p", { className: "hint", textContent: "Not downloaded (inline SVG — needs manual review)." }));
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
      const label = el("span", { textContent: `${a.kind} — ${a.origin_url}` });
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
    try {
      await api(`/api/brands/${currentBrandId}`, {
        method: "PATCH",
        body: JSON.stringify({
          approvedContext: {
            logoAssetId: selectedLogoId === "none" ? null : selectedLogoId,
            colours,
            fonts,
          },
        }),
      });
      approveStatus.textContent = "Saved.";
    } catch (err) {
      approveStatus.textContent = `Could not save: ${err.message}`;
    }
  });

  // --- Boot ---
  async function boot() {
    const { authenticated } = await api("/api/session");
    if (!authenticated) {
      show(views.login);
      document.getElementById("logoutBtn").hidden = true;
      return;
    }
    document.getElementById("logoutBtn").hidden = false;
    show(views.import);
    await loadBrandList();
  }

  boot().catch((err) => {
    console.error(err);
    show(views.login);
  });
})();
