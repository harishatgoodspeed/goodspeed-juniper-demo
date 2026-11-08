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
  let freeRunUsed = false;
  const CONTACT_URL = "https://goodspeed.studio/contact";

  function $(id) { return document.getElementById(id); }
  function show(id) {
    views.forEach((view) => { $(view).hidden = view !== id; });
    document.querySelectorAll(".steps li").forEach((li) => {
      li.setAttribute("aria-current", li.dataset.step === stepFor[id] ? "step" : "false");
    });
    const heading = $(id).querySelector("h1");
    if (heading) heading.focus();
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
      error.contactUrl = data && data.contactUrl;
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

  async function pollJob(jobId, onTick) {
    for (;;) {
      const job = await api("/api/jobs/" + jobId);
      onTick(job);
      if (job.status === "succeeded" || job.status === "failed") return job;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  function showTalk(node, lead) {
    node.hidden = false;
    node.textContent = "";
    if (lead) node.appendChild(document.createTextNode(lead + " "));
    const link = document.createElement("a");
    link.href = CONTACT_URL;
    link.textContent = "Talk to Goodspeed";
    node.appendChild(link);
  }

  $("importForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("importError").hidden = true;
    if (freeRunUsed) {
      showTalk($("runCap"), "This workspace already used its free run.");
      return;
    }
    const url = $("siteUrl").value.trim();
    try {
      const started = await api("/api/brands", { method: "POST", body: JSON.stringify({ url }) });
      brandId = started.brand.id;
      show("progressView");
      $("blockedBox").hidden = true;
      $("progressText").textContent = "Reading your website";
      const job = await pollJob(started.jobId, (current) => {
        $("progressText").textContent = progressCopy(current.progress, current.phase);
      });
      if (job.status === "failed") return showBlocked();
      await openBrand();
    } catch (err) {
      $("importError").hidden = false;
      $("importError").textContent = err.message;
    }
  });

  async function showBlocked() {
    const data = await api("/api/brands/" + brandId);
    $("blockedBox").hidden = false;
    $("blockedText").textContent = data.error || "We could not read that address. Try again, correct the URL, or enter a short description.";
    $("progressText").textContent = "The import stopped";
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

  $("approveBtn").addEventListener("click", async () => {
    $("approveError").hidden = true;
    if (freeRunUsed) {
      showTalk($("approveError"), "This workspace already used its free run.");
      return;
    }
    if (brandData && brandData.siteLanguage === "other" && !$("confirmEnglish").checked) {
      $("approveError").hidden = false;
      $("approveError").textContent = "This site does not look like English. Tick the box if you still want English posts.";
      return;
    }
    const englishVariant = document.querySelector('input[name="english"]:checked').value;
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
            approvedImageAssetIds: [],
          },
        }),
      });
      const started = await api("/api/brands/" + brandId + "/runs", {
        method: "POST",
        body: JSON.stringify({
          task,
          englishVariant,
          channel: "linkedin",
          confirmEnglish: $("confirmEnglish").checked,
        }),
      });
      runId = started.run.id;
      freeRunUsed = true;
      show("resultsView");
      $("nextStep").hidden = true;
      $("keepBar").hidden = true;
      await pollRun();
    } catch (err) {
      $("approveError").hidden = false;
      if (err.code === "run_cap" || err.contactUrl) {
        freeRunUsed = true;
        showTalk($("approveError"), "This workspace already used its free run.");
        return;
      }
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
    $("nextStep").hidden = !anyReady;
    $("snapshotLink").href = "/api/brands/" + brandId + "/snapshot.md";
  }

  function familyName(family) {
    if (family === "carousel") return "Carousel";
    if (family === "explainer") return "Checklist";
    if (family === "hook") return "Hook post";
    return "Post";
  }

  function imageAsset(post) {
    return post.assets && post.assets.find((asset) => asset.kind === "png" || asset.kind === "page_png");
  }

  function postCard(post) {
    const card = el("article", { class: "post-card" });
    card.appendChild(el("div", { class: "row" }, [
      el("strong", { text: familyName(post.formatFamily) }),
      badge(post.label),
    ]));
    if (post.formatFamily === "hook") {
      card.appendChild(el("p", { class: "hook-preview", text: post.hook || "" }));
    } else {
      const preview = imageAsset(post);
      if (preview) card.appendChild(el("img", { src: "/api/post-assets/" + preview.id, alt: post.altText || post.title }));
      else if (post.status === "failed") card.appendChild(el("p", { class: "hint", text: post.error || "This post did not render." }));
      else if (post.status !== "ready") card.appendChild(el("p", { class: "hint", text: "Still working on this one." }));
    }
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
    explainer: ["explainer-framework"],
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
    const options = layouts[post.formatFamily] || [];
    options.forEach((id) => {
      const option = el("option", { value: id, text: id.replaceAll("-", " ") });
      if (id === post.compositionId) option.selected = true;
      layout.appendChild(option);
    });
    $("layoutBlock").hidden = options.length < 2;
    const textOnly = post.formatFamily === "hook";
    $("altField").hidden = textOnly;
    $("altLabel").hidden = textOnly;
    const usedRegen = (post.regenerateCount || 0) >= 1;
    $("regenBtn").hidden = usedRegen;
    $("regenCap").hidden = !usedRegen;
    renderEditorPreview(post);
    show("editorView");
  }

  function renderEditorPreview(post) {
    const box = $("editorPreview");
    box.innerHTML = "";
    if (post.formatFamily === "hook") {
      box.appendChild(el("p", { class: "hook-preview", text: post.hook || "" }));
    } else {
      const preview = imageAsset(post);
      if (preview) box.appendChild(el("img", { src: "/api/post-assets/" + preview.id + "?v=" + post.revision, alt: post.altText || "" }));
    }
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
    const current = (runData.posts || []).find((item) => item.id === editingPostId);
    if (current && (current.regenerateCount || 0) >= 1) {
      $("regenBtn").hidden = true;
      $("regenCap").hidden = false;
      return;
    }
    $("editorStatus").textContent = "Regenerating this post only.";
    try {
      await api("/api/posts/" + editingPostId + "/regenerate", {
        method: "POST",
        body: JSON.stringify({ instruction: $("instruction").value.trim() }),
      });
      await refreshEditor();
      $("editorStatus").textContent = "This post was replaced. The other two were not.";
    } catch (err) {
      if (err.code === "regenerate_cap" || err.contactUrl) {
        $("regenBtn").hidden = true;
        $("regenCap").hidden = false;
        $("editorStatus").textContent = "";
        showTalk($("editorError"), "This post has already been regenerated once.");
        return;
      }
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

  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
    window.location.reload();
  });

  async function boot() {
    await api("/api/session");
    const listed = await api("/api/brands");
    freeRunUsed = Boolean(listed.freeRunUsed);
    const brands = listed.brands || [];
    if (!brands.length) {
      show("urlView");
      return;
    }
    brandId = brands[0].id;
    const data = await api("/api/brands/" + brandId);
    if (data.status === "failed") {
      show("progressView");
      $("blockedBox").hidden = false;
      $("blockedText").textContent = data.error || "We could not read that address.";
      return;
    }
    if (data.status !== "ready") {
      show("progressView");
      $("progressText").textContent = "Reading your website";
      return;
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
  boot().catch(() => show("urlView"));
})();
