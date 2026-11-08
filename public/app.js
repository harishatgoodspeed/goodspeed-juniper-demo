(function () {
  const views = ["urlView", "progressView", "confirmView", "resultsView", "editorView"];
  const stepFor = { urlView: "url", progressView: "read", confirmView: "brand", resultsView: "posts", editorView: "posts" };
  let brandId = null;
  let runId = null;
  let brandData = null;
  let runData = null;
  let selectedLogo = null;
  let selectedColours = [];
  let selectedFonts = [];
  let editingPostId = null;

  function $(id) { return document.getElementById(id); }
  function show(id) {
    views.forEach((view) => { $(view).hidden = view !== id; });
    document.querySelectorAll(".steps li").forEach((li) => {
      li.setAttribute("aria-current", li.dataset.step === stepFor[id] ? "step" : "false");
    });
    const heading = $(id).querySelector("h1");
    if (heading) heading.focus();
    if (id !== "progressView") stopExtractClock();
    if (id === "urlView") {
      const submit = $("importForm") && $("importForm").querySelector("button[type=submit]");
      if (submit) submit.disabled = false;
    }
  }
  function csrf() {
    const match = document.cookie.match(/(?:^|; )gs_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  async function api(path, options = {}) {
    const headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf();
    const res = await fetch(path, Object.assign({}, options, { headers, credentials: "same-origin" }));
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = (data && data.message) || "Something went wrong. Please try again.";
      const error = new Error(message);
      error.status = res.status;
      error.code = data && data.error;
      throw error;
    }
    return data;
  }
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    (children || []).forEach((child) => node.appendChild(child));
    return node;
  }
  function progressCopy(progress, phase) {
    if (phase === "brief" || phase === "generate" || progress === "preparing_ideas") return "Preparing your ideas";
    if (progress === "finding_brand") return "Finding your brand";
    return "Reading your website";
  }

  const EXTRACT_KEY = "gs-extract-job";
  let extractTick = null;

  function rememberExtract(id, jobId, url) {
    try { sessionStorage.setItem(EXTRACT_KEY, JSON.stringify({ brandId: id, jobId, url })); } catch (err) { /* private mode */ }
  }
  function recallExtract() {
    try {
      const raw = sessionStorage.getItem(EXTRACT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }
  function forgetExtract() {
    try { sessionStorage.removeItem(EXTRACT_KEY); } catch (err) { /* private mode */ }
  }
  function startExtractClock(url) {
    const started = Date.now();
    const urlEl = $("extractUrl");
    if (urlEl) urlEl.textContent = url || "";
    const clock = $("extractClock");
    const paint = () => {
      if (!clock) return;
      const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
      clock.textContent = seconds === 1 ? "1 second" : seconds + " seconds";
    };
    paint();
    if (extractTick) clearInterval(extractTick);
    extractTick = setInterval(paint, 1000);
  }
  function stopExtractClock() {
    if (extractTick) clearInterval(extractTick);
    extractTick = null;
  }
  function renderExtractProgress(progress) {
    const finding = progress === "finding_brand";
    document.querySelectorAll("#extractSteps li").forEach((li) => {
      const step = li.getAttribute("data-step");
      let state = "waiting";
      if (step === "reading_website") state = finding ? "done" : "active";
      if (step === "finding_brand") state = finding ? "active" : "waiting";
      li.setAttribute("data-state", state);
      if (state === "active") li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    const detail = $("extractDetail");
    if (detail) {
      detail.textContent = finding
        ? "Reading colours, type, and the logo."
        : "Fetching the public page.";
    }
    if ($("progressText")) $("progressText").textContent = progressCopy(progress, "import");
  }
  function settleExtractSteps() {
    document.querySelectorAll("#extractSteps li").forEach((li) => {
      li.setAttribute("data-state", "waiting");
      li.removeAttribute("aria-current");
    });
  }

  async function pollJob(jobId, onTick) {
    for (;;) {
      const job = await api("/api/jobs/" + jobId);
      onTick(job);
      if (job.status === "succeeded" || job.status === "failed") return job;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  $("importForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("importError").hidden = true;
    const url = $("siteUrl").value.trim();
    const submit = event.submitter || $("importForm").querySelector("button[type=submit]");
    if (submit) submit.disabled = true;
    try {
      const started = await api("/api/brands", { method: "POST", body: JSON.stringify({ url }) });
      brandId = started.brand.id;
      rememberExtract(brandId, started.jobId, url);
      show("progressView");
      $("blockedBox").hidden = true;
      startExtractClock(url);
      renderExtractProgress("reading_website");
      const job = await pollJob(started.jobId, (current) => {
        renderExtractProgress(current.progress);
      });
      if (job.status === "failed") return showBlocked();
      forgetExtract();
      stopExtractClock();
      await openBrand();
    } catch (err) {
      if (submit) submit.disabled = false;
      stopExtractClock();
      $("importError").hidden = false;
      $("importError").textContent = err.message;
      if ($("progressView").hidden) return;
      show("urlView");
    }
  });

  async function showBlocked() {
    stopExtractClock();
    forgetExtract();
    const data = await api("/api/brands/" + brandId);
    $("blockedBox").hidden = false;
    $("blockedText").textContent = data.error || "We could not read that address. Try again, correct the URL, or enter a short description.";
    $("progressText").textContent = "The import stopped";
    settleExtractSteps();
    const detail = $("extractDetail");
    if (detail) detail.textContent = "The read stopped. Try again, use a different address, or type the basics.";
  }

  $("retryImport").addEventListener("click", () => $("importForm").requestSubmit());
  $("correctUrl").addEventListener("click", () => { show("urlView"); $("siteUrl").focus(); });

  $("manualForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("manualError").hidden = true;
    try {
      const created = await api("/api/brands/manual", {
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

  async function openBrand(reveal = true) {
    brandData = await api("/api/brands/" + brandId);
    const context = brandData.context || {};
    selectedLogo = (context.logoCandidates && context.logoCandidates[0] && brandData.assets.find((asset) => asset.kind === "logo")) || null;
    selectedColours = (context.colours || []).slice(0, 4).map((colour) => colour.hex);
    selectedFonts = (context.fonts || []).slice(0, 2).map((font) => font.family);
    const logoAsset = brandData.assets.find((asset) => asset.kind === "logo" || asset.kind === "favicon");
    selectedLogo = logoAsset ? logoAsset.id : null;
    renderBrandCard(context, logoAsset);
    const uk = brandData.englishSuggestion !== "us";
    document.querySelectorAll('input[name="english"]').forEach((input) => { input.checked = input.value === (uk ? "uk" : "us"); });
    $("englishHint").textContent = brandData.englishSuggestionSource === "site_spelling"
      ? "Prefilled from the spelling on the site. You can change it."
      : "No clear spelling signal. Prefilled as British English. You can change it.";
    $("languageGate").hidden = brandData.siteLanguage !== "other";
    $("snapshotLink").href = "/api/brands/" + brandId + "/snapshot.md";
    if (reveal) show("confirmView");
  }

  function renderBrandCard(context, logoAsset) {
    const card = $("brandCard");
    card.innerHTML = "";
    if (logoAsset) card.appendChild(el("img", { class: "logo-slot", src: "/api/assets/" + logoAsset.id, alt: "Logo from the site" }));
    else card.appendChild(el("p", { class: "hint", text: "Logo: unknown" }));
    const swatches = el("div", { class: "swatches" });
    if (selectedColours.length === 0) swatches.appendChild(el("p", { class: "hint", text: "Colours: unknown" }));
    selectedColours.forEach((hex) => swatches.appendChild(el("div", { class: "swatch", style: "background:" + hex, title: hex })));
    card.appendChild(swatches);
    card.appendChild(el("p", { class: "font-sample", text: selectedFonts[0] || "Font: unknown", style: selectedFonts[0] ? "font-family:" + selectedFonts[0] : "" }));
    card.appendChild(el("p", { text: context.description || "Business summary: unknown" }));
    card.appendChild(el("p", { class: "hint", text: "Audience: unknown until you add one. We will infer a useful reader from the site when we write." }));
    card.appendChild(el("p", { class: "hint", text: context.textExcerpt ? context.textExcerpt.slice(0, 280) : "No readable copy was found." }));
  }

  $("backToUrl").addEventListener("click", () => show("urlView"));

  $("ownedForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = $("ownedFile").files && $("ownedFile").files[0];
    if (!file) return;
    if (!$("ownConfirm").checked) {
      $("ownedStatus").textContent = "Tick the box to confirm you own the image.";
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    try {
      await api("/api/brands/" + brandId + "/owned-images", {
        method: "POST",
        body: JSON.stringify({ mimeType: file.type, imageBase64: base64, ownershipConfirmed: true }),
      });
      $("ownedStatus").textContent = "Image added. It will only be used because you confirmed you own it.";
    } catch (err) {
      $("ownedStatus").textContent = err.message;
    }
  });

  $("approveBtn").addEventListener("click", async () => {
    $("approveError").hidden = true;
    if (brandData && brandData.siteLanguage === "other" && !$("confirmEnglish").checked) {
      $("approveError").hidden = false;
      $("approveError").textContent = "This site does not look like English. Tick the box if you still want English posts.";
      return;
    }
    const englishVariant = document.querySelector('input[name="english"]:checked').value;
    const channel = document.querySelector('input[name="channel"]:checked').value;
    const task = $("runTask").value.trim() || "Three useful posts from this website";
    try {
      await api("/api/brands/" + brandId, {
        method: "PATCH",
        body: JSON.stringify({
          approvedContext: {
            logoAssetId: selectedLogo,
            colours: selectedColours,
            fonts: selectedFonts,
            voiceNotes: $("voiceNotes").value.trim(),
            englishVariant,
            approvedImageAssetIds: (brandData.approvedContext && brandData.approvedContext.approvedImageAssetIds) || [],
          },
        }),
      });
      brandData = await api("/api/brands/" + brandId);
      const imageIds = (await api("/api/brands/" + brandId + "/owned-images")).images.map((image) => image.id);
      if (imageIds.length) {
        await api("/api/brands/" + brandId, {
          method: "PATCH",
          body: JSON.stringify({
            approvedContext: Object.assign({}, brandData.approvedContext, { approvedImageAssetIds: imageIds, englishVariant }),
          }),
        });
      }
      const started = await api("/api/brands/" + brandId + "/runs", {
        method: "POST",
        body: JSON.stringify({
          task,
          englishVariant,
          channel,
          confirmEnglish: $("confirmEnglish").checked,
        }),
      });
      runId = started.run.id;
      show("resultsView");
      $("ladder").hidden = true;
      $("keepBar").hidden = true;
      await pollRun();
    } catch (err) {
      $("approveError").hidden = false;
      $("approveError").textContent = err.message;
    }
  });

  async function pollRun() {
    for (;;) {
      runData = await api("/api/runs/" + runId);
      renderPosts();
      if (["completed", "partial", "failed"].includes(runData.status)) return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  function badge(label) {
    const kind = label === "Checks passed" ? "ok" : label === "Needs review" ? "fail" : "draft";
    return el("span", { class: "badge " + kind, text: label });
  }

  function renderPosts() {
    const copy = {
      queued: "Preparing your ideas",
      briefing: "Preparing your ideas",
      generating: "Preparing your ideas",
      reviewing: "Preparing your ideas",
      completed: "Three posts are ready to keep.",
      partial: "Some posts are ready. Any that failed stay here so you can retry them.",
      failed: "The run stopped before the posts were ready.",
    };
    $("runStatusText").textContent = copy[runData.status] || runData.status;
    const grid = $("postGrid");
    grid.innerHTML = "";
    const posts = runData.posts || [];
    if (posts.length === 0 && !["completed", "partial", "failed"].includes(runData.status)) {
      grid.appendChild(el("p", { class: "hint", text: "Preparing your ideas" }));
    }
    posts.forEach((post) => grid.appendChild(postCard(post)));
    const anyReady = posts.some((post) => post.status === "ready");
    $("keepBar").hidden = !anyReady;
    $("ladder").hidden = !anyReady;
    $("snapshotLink").href = "/api/brands/" + brandId + "/snapshot.md";
  }

  function postCard(post) {
    const card = el("article", { class: "post-card" });
    card.appendChild(el("div", { class: "row" }, [
      el("strong", { text: post.formatFamily === "carousel" ? "Carousel" : post.formatFamily === "explainer" ? "Saveable image" : "Proof led post" }),
      badge(post.label),
    ]));
    const preview = post.assets && post.assets.find((asset) => asset.kind === "png" || asset.kind === "page_png" || asset.kind === "x_png");
    if (preview) card.appendChild(el("img", { src: "/api/post-assets/" + preview.id, alt: post.altText || post.title }));
    else if (post.status === "failed") card.appendChild(el("p", { class: "hint", text: post.error || "This post did not render." }));
    else if (post.status !== "ready") card.appendChild(el("p", { class: "hint", text: "Still working on this one." }));
    if (post.formatFamily === "carousel") card.appendChild(el("p", { class: "pages", text: (post.pageCount || 0) + " pages" }));
    card.appendChild(el("p", { class: "hint", text: post.formatNote || "Evergreen format" }));
    card.appendChild(el("p", { class: "caption", text: post.caption || "" }));
    const details = el("details", { class: "checks" });
    details.appendChild(el("summary", { text: "Sources and checks" }));
    details.appendChild(el("p", { text: post.labelNote }));
    (post.checks || []).forEach((check) => {
      details.appendChild(el("p", { text: check.kind + ": " + check.status + ". " + check.explanation }));
    });
    card.appendChild(details);
    const row = el("div", { class: "row" });
    if (post.status === "ready") {
      row.appendChild(el("a", { class: "btn btn-ghost", href: "/api/posts/" + post.id + "/package.zip", text: "Download" }));
      row.appendChild(el("button", { class: "btn btn-primary", type: "button", text: "Open", onclick: () => openEditor(post.id) }));
    }
    if (post.status === "failed") {
      row.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "Retry", onclick: () => retryPost(post.id) }));
    }
    card.appendChild(row);
    return card;
  }

  async function retryPost(postId) {
    await api("/api/posts/" + postId + "/retry", { method: "POST", body: JSON.stringify({}) });
    runData = await api("/api/runs/" + runId);
    renderPosts();
  }

  const layouts = {
    carousel: ["carousel-steps", "carousel-checklist"],
    explainer: ["explainer-framework", "explainer-comparison"],
    proof: ["text-pov", "text-columns", "proof-annotation", "proof-split"],
  };

  function openEditor(postId) {
    const post = (runData.posts || []).find((item) => item.id === postId);
    if (!post) return;
    editingPostId = postId;
    $("editorTitle").textContent = post.title || "Edit this post";
    $("captionField").value = post.caption || "";
    $("altField").value = post.altText || "";
    const hooks = $("hookSelect");
    hooks.innerHTML = "";
    (post.hookAlternatives || [post.hook]).forEach((hook) => {
      const option = el("option", { value: hook, text: hook });
      if (hook === post.hook) option.selected = true;
      hooks.appendChild(option);
    });
    const layout = $("layoutSelect");
    layout.innerHTML = "";
    (layouts[post.formatFamily] || []).forEach((id) => {
      const option = el("option", { value: id, text: id.replaceAll("-", " ") });
      if (id === post.compositionId) option.selected = true;
      layout.appendChild(option);
    });
    renderEditorPreview(post);
    show("editorView");
  }

  function renderEditorPreview(post) {
    const box = $("editorPreview");
    box.innerHTML = "";
    const preview = post.assets && post.assets.find((asset) => asset.kind === "png" || asset.kind === "page_png" || asset.kind === "x_png");
    if (preview) box.appendChild(el("img", { src: "/api/post-assets/" + preview.id + "?v=" + post.revision, alt: post.altText || "" }));
    if (post.formatFamily === "carousel") box.appendChild(el("p", { class: "pages", text: (post.pageCount || 0) + " pages" }));
    $("editorCaption").textContent = $("captionField").value;
  }

  $("captionField").addEventListener("input", () => { $("editorCaption").textContent = $("captionField").value; });
  $("closeEditor").addEventListener("click", () => show("resultsView"));
  $("backToBrand").addEventListener("click", () => show("confirmView"));
  $("tabEdit").addEventListener("click", () => { $("editorView").querySelector(".editor").className = "editor editing"; });
  $("tabPreview").addEventListener("click", () => { $("editorView").querySelector(".editor").className = "editor previewing"; });

  async function refreshEditor() {
    runData = await api("/api/runs/" + runId);
    const post = runData.posts.find((item) => item.id === editingPostId);
    if (post) openEditor(post.id);
    renderPosts();
  }

  $("saveCopy").addEventListener("click", async () => {
    $("editorError").hidden = true;
    try {
      await api("/api/posts/" + editingPostId, {
        method: "PATCH",
        body: JSON.stringify({
          caption: $("captionField").value,
          altText: $("altField").value,
          hook: $("hookSelect").value,
        }),
      });
      $("editorStatus").textContent = "Saved. Checks on this post were cleared until they run again. The other posts were left as they were.";
      await refreshEditor();
    } catch (err) {
      $("editorError").hidden = false;
      $("editorError").textContent = err.message;
    }
  });

  $("shorterBtn").addEventListener("click", () => {
    const text = $("captionField").value.trim();
    const cut = text.split(/(?<=\.)\s/)[0] || text;
    $("captionField").value = cut;
    $("editorCaption").textContent = cut;
    $("editorStatus").textContent = "Shortened in the box. Save it when you are happy. Nothing else has changed yet.";
  });

  $("regenBtn").addEventListener("click", async () => {
    $("editorError").hidden = true;
    $("editorStatus").textContent = "Regenerating this post only.";
    try {
      await api("/api/posts/" + editingPostId + "/regenerate", {
        method: "POST",
        body: JSON.stringify({ instruction: $("instruction").value.trim() }),
      });
      await refreshEditor();
      $("editorStatus").textContent = "This post was replaced. The other two were not.";
    } catch (err) {
      $("editorError").hidden = false;
      $("editorError").textContent = err.message;
    }
  });

  $("undoBtn").addEventListener("click", async () => {
    try {
      await api("/api/posts/" + editingPostId + "/undo", { method: "POST", body: JSON.stringify({}) });
      await refreshEditor();
      $("editorStatus").textContent = "Undone.";
    } catch (err) {
      $("editorError").hidden = false;
      $("editorError").textContent = err.message;
    }
  });

  $("applyLayout").addEventListener("click", async () => {
    try {
      await api("/api/posts/" + editingPostId + "/layout", {
        method: "POST",
        body: JSON.stringify({ compositionId: $("layoutSelect").value }),
      });
      await refreshEditor();
      $("editorStatus").textContent = "Layout updated for this post only.";
    } catch (err) {
      $("editorError").hidden = false;
      $("editorError").textContent = err.message;
    }
  });

  $("downloadAll").addEventListener("click", () => {
    window.location.href = "/api/runs/" + runId + "/package.zip";
  });

  $("leadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/brands/" + brandId + "/leads", {
        method: "POST",
        body: JSON.stringify({
          email: $("leadEmail").value.trim(),
          preferredTool: $("leadTool").value.trim(),
          notes: $("leadNotes").value.trim(),
          consent: $("leadConsent").checked,
        }),
      });
      $("leadStatus").textContent = "Thank you. We will be in touch.";
    } catch (err) {
      $("leadStatus").textContent = err.message;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
    window.location.reload();
  });

  async function boot() {
    await api("/api/session");
    const { brands } = await api("/api/brands");
    if (!brands.length) {
      show("urlView");
      return;
    }
    brandId = brands[0].id;
    const data = await api("/api/brands/" + brandId);
    if (data.status === "failed") {
      show("progressView");
      settleExtractSteps();
      $("blockedBox").hidden = false;
      $("blockedText").textContent = data.error || "We could not read that address.";
      $("progressText").textContent = "The import stopped";
      return;
    }
    if (data.status !== "ready") {
      show("progressView");
      $("blockedBox").hidden = true;
      const saved = recallExtract();
      const url = data.sourceUrl || (saved && saved.url) || "";
      startExtractClock(url);
      renderExtractProgress("reading_website");
      if (saved && saved.brandId === brandId && saved.jobId) {
        const job = await pollJob(saved.jobId, (current) => renderExtractProgress(current.progress));
        if (job.status === "failed") return showBlocked();
        forgetExtract();
        stopExtractClock();
        await openBrand();
        return;
      }
      for (;;) {
        const fresh = await api("/api/brands/" + brandId);
        if (fresh.status === "failed") return showBlocked();
        if (fresh.status === "ready") {
          forgetExtract();
          stopExtractClock();
          await openBrand();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    await openBrand(false);
    if (data.latestRun) {
      runId = data.latestRun.id;
      show("resultsView");
      if (["completed", "partial", "failed"].includes(data.latestRun.status)) {
        runData = await api("/api/runs/" + runId);
        renderPosts();
      } else {
        pollRun();
      }
      return;
    }
    show("confirmView");
  }

  function bindExampleCarousel() {
    const root = document.querySelector("[data-carousel]");
    if (!root) return;
    const track = root.querySelector(".carousel-track");
    const status = root.querySelector(".carousel-status");
    const pages = track ? Array.from(track.children) : [];
    if (!track || !pages.length) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const update = () => {
      const width = track.clientWidth || 1;
      const index = Math.min(pages.length - 1, Math.max(0, Math.round(track.scrollLeft / width)));
      if (status) status.textContent = (index + 1) + " of " + pages.length;
    };
    const go = (direction) => {
      track.scrollBy({ left: direction * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
    };
    const prev = root.querySelector("[data-carousel-prev]");
    const next = root.querySelector("[data-carousel-next]");
    if (prev) prev.addEventListener("click", () => go(-1));
    if (next) next.addEventListener("click", () => go(1));
    track.addEventListener("scroll", update, { passive: true });
    track.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    });
    update();
  }

  bindExampleCarousel();
  boot().catch(() => show("urlView"));
})();
