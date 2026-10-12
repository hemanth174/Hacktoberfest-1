/* APK Guard — report-ui.js : glass verdict cards, page panel, download guard (no deps) */
window.ApkGuardUI = (() => {
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- floating shield button ---------- */
  function ensureFab(count, onOpen) {
    let fab = document.querySelector(".apk-guard-fab");
    if (!fab) {
      fab = el("button", "apk-guard-fab", `AG<span class="apk-guard-fab-n">${count}</span>`);
      fab.title = "APK Guard — show page report";
      fab.onclick = () => onOpen && onOpen();
      document.body.appendChild(fab);
    } else {
      fab.querySelector(".apk-guard-fab-n").textContent = count;
      fab.style.display = "";
    }
    return fab;
  }
  function hideFab() {
    const fab = document.querySelector(".apk-guard-fab");
    if (fab) fab.style.display = "none";
  }

  /* ---------- auto page-summary panel (shows on site open) ---------- */
  let lastSig = null;
  function showPagePanel(items, cb) {
    // items: [{url, fileName, score, level, topReason, status}]
    const sig = items.map((i) => i.url + "|" + i.score).join(";");
    let panel = document.querySelector(".apk-guard-panel");
    if (panel && sig === lastSig) return panel; // no flicker on DOM churn
    lastSig = sig;
    if (panel) panel.remove();
    if (!items.length) return null;

    const highs = items.filter((i) => i.level === "high").length;
    const meds = items.filter((i) => i.level === "medium").length;
    const lows = items.length - highs - meds;

    panel = el("div", "apk-guard-panel apk-guard-glass");
    panel.innerHTML = `
      <div class="apk-guard-panel-head">APK Guard
        <span class="apk-guard-count">${items.length} file${items.length > 1 ? "s" : ""}</span>
        <button class="apk-guard-x" aria-label="minimize">—</button></div>
      <div class="apk-guard-panel-sub">${highs} high · ${meds} medium · ${lows} low — pre-scan heuristics</div>
      <div class="apk-guard-prows"></div>
      <button class="apk-guard-scan-all">Scan all with Gemma</button>`;
    const rows = panel.querySelector(".apk-guard-prows");
    items.forEach((it) => {
      const row = el("div", "apk-guard-prow");
      row.dataset.url = it.url;
      row.innerHTML = `
        <span class="apk-guard-dot ${it.level}"></span>
        <div class="apk-guard-pmeta">
          <div class="apk-guard-fname" title="${escapeHtml(it.url)}">${escapeHtml(it.fileName)}</div>
          <div class="apk-guard-why">${escapeHtml(it.topReason || "No heuristic flags")}</div>
        </div>
        <span class="apk-guard-pscore">${it.score}</span>
        <span class="apk-guard-vstat">${it.status || ""}</span>
        <button class="apk-guard-mini-scan">Scan</button>`;
      row.querySelector(".apk-guard-mini-scan").onclick = () => cb.onScan && cb.onScan(it.url, it.fileName);
      rows.appendChild(row);
    });
    panel.querySelector(".apk-guard-scan-all").onclick = () => cb.onScanAll && cb.onScanAll();
    panel.querySelector(".apk-guard-x").onclick = () => {
      panel.remove(); lastSig = null;
      ensureFab(items.length, () => { lastSig = null; cb.onReopen && cb.onReopen(); });
    };
    document.body.appendChild(panel);
    hideFab();
    return panel;
  }

  function updatePanelRow(url, statusHtml) {
    const row = document.querySelector(`.apk-guard-prow[data-url="${CSS.escape(url)}"] .apk-guard-vstat`);
    if (row) row.innerHTML = statusHtml;
  }

  function showPageBar(info, onScan) {
    let bar = document.querySelector(".apk-guard-page-bar");
    if (!bar) {
      bar = el("div", "apk-guard-page-bar apk-guard-glass");
      document.documentElement.appendChild(bar);
    }
    const status = info.high > 0 ? "Review needed" : info.count ? "Ready to check" : "No APK detected";
    bar.innerHTML = `<span class="apk-guard-page-bar-brand">APK Guard</span>
      <span class="apk-guard-page-bar-domain">${escapeHtml(info.domain)}</span>
      <span class="apk-guard-page-bar-status">${status} · ${info.count} APK${info.count === 1 ? "" : "s"}</span>
      <span class="apk-guard-page-bar-legal">${info.legalFound ? "Terms and Privacy found" : "Legal information not found"}</span>
      <button class="apk-guard-page-bar-scan">Scan page</button>
      <button class="apk-guard-page-bar-close" aria-label="Hide APK Guard">×</button>`;
    bar.querySelector(".apk-guard-page-bar-scan").onclick = () => onScan && onScan();
    bar.querySelector(".apk-guard-page-bar-close").onclick = () => bar.remove();
    return bar;
  }

  function setPageBarStatus(status, busy = false) {
    const bar = document.querySelector(".apk-guard-page-bar");
    if (!bar) return;
    const label = bar.querySelector(".apk-guard-page-bar-status");
    const button = bar.querySelector(".apk-guard-page-bar-scan");
    if (label) label.textContent = status;
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? "Scanning…" : "Scan page";
    }
  }

  /* ---------- download-guard confirm modal ---------- */
  function showConfirmModal(info, actions) {
    closeModal();
    const riskWord = info.level === "high" ? "HIGH RISK" : info.level === "medium" ? "MEDIUM RISK" : "LOW RISK";
    const reasons = (info.reasons.length ? info.reasons : ["No heuristic red flags — still verify the source."])
      .map((r) => `<li>${escapeHtml(r)}</li>`).join("");
    const ov = el("div", "apk-guard-overlay");
    ov.innerHTML = `
      <div class="apk-guard-modal apk-guard-glass">
        <span class="apk-guard-m-risk ${info.level}">${riskWord} · ${info.score}/100</span>
        <h3>${escapeHtml(info.fileName)}</h3>
        <p class="apk-guard-m-q">Are you sure you want to download this APK file?</p>
        <ul>${reasons}</ul>
        <div class="apk-guard-m-actions">
          <button class="apk-guard-m-scan">Scan first</button>
          <button class="apk-guard-m-dl">Download anyway</button>
          <button class="apk-guard-m-cancel">Cancel</button>
        </div>
        <div class="apk-guard-m-note">Scanning runs androguard + Gemma 4 analysis before anything touches your device.</div>
      </div>`;
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) { closeModal(); actions.onCancel && actions.onCancel(); } });
    ov.querySelector(".apk-guard-m-scan").onclick = () => { closeModal(); actions.onScan && actions.onScan(); };
    ov.querySelector(".apk-guard-m-dl").onclick = () => { closeModal(); actions.onDownload && actions.onDownload(); };
    ov.querySelector(".apk-guard-m-cancel").onclick = () => { closeModal(); actions.onCancel && actions.onCancel(); };
    document.body.appendChild(ov);
    return ov;
  }
  function closeModal() {
    document.querySelectorAll(".apk-guard-overlay").forEach((o) => o.remove());
  }

  /* ---------- toast ---------- */
  function showToast(title, subtitle, onScan) {
    const t = el("div", "apk-guard-toast apk-guard-glass",
      `<div class="apk-guard-toast-title">${title}</div>
       <div class="apk-guard-toast-sub">${subtitle}</div>
       <div class="apk-guard-toast-actions"></div>`);
    const actions = t.querySelector(".apk-guard-toast-actions");
    const scan = el("button", "apk-guard-scan-btn", "Scan now");
    scan.onclick = () => { onScan && onScan(); t.remove(); };
    const dismiss = el("button", "apk-guard-dismiss-btn", "Later");
    dismiss.onclick = () => t.remove();
    actions.appendChild(scan);
    actions.appendChild(dismiss);
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 50);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 5000);
    return t;
  }

  /* ---------- verdict card ---------- */
  function showLoadingCard(anchorEl, fileName) {
    closeExisting();
    const card = el("div", "apk-guard-card apk-guard-toast-card apk-guard-glass apk-guard-loading",
      `<div class="apk-guard-card-head"><b>APK Guard</b><span class="apk-guard-toast-label">Scanning</span><button class="apk-guard-x" aria-label="close">✕</button></div>
       <div class="apk-guard-file">${escapeHtml(fileName)}</div>
       <div class="apk-guard-spinner"></div><div class="apk-guard-progress-detail">Queued for analysis…</div>`);
    document.body.appendChild(card);
    card.querySelector(".apk-guard-x").onclick = () => card.remove();
    return card;
  }

  function updateLoadingCard(card, detail) {
    const node = card?.querySelector(".apk-guard-progress-detail");
    if (node) node.textContent = detail || "Analyzing…";
  }

  function renderVerdict(card, data) {
    const verdict = (data.verdict || "unknown").toLowerCase();
    const color = verdict === "malicious" ? "red" : verdict === "suspicious" ? "red" : verdict === "clean" ? "green" : "amber";
    const reasons = (data.reasons || []).slice(0, 3).map((r) => `<li>${escapeHtml(typeof r === "string" ? r : JSON.stringify(r))}</li>`).join("");
    const recs = (data.recommendations || []).slice(0, 2).map((r) => `<li>${escapeHtml(r)}</li>`).join("");
    const visuals = (data.visual_flags || []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");
    const model = data.model ? ` · model ${escapeHtml(data.model)}` : "";
    card.className = `apk-guard-card apk-guard-toast-card apk-guard-glass apk-guard-${color}`;
    const isPageReview = data.filename === "page-scan" || data.filename === "page-review";
    const title = isPageReview ? "PAGE REVIEW" : verdict.toUpperCase();
    const displayFile = isPageReview ? "Current website" : (data.filename || "");
    card.innerHTML = `
      <div class="apk-guard-card-head"><b>${escapeHtml(title)}</b>
        <span class="apk-guard-score">risk ${escapeHtml(String(data.risk_score ?? "?"))}/100</span>
        <button class="apk-guard-x" aria-label="close">✕</button></div>
      <div class="apk-guard-file">${escapeHtml(displayFile)}</div>
      <p class="apk-guard-summary">${escapeHtml(data.summary || "No summary.")}</p>
      ${reasons ? `<div class="apk-guard-sec">Why</div><ul>${reasons}</ul>` : ""}
      ${visuals ? `<div class="apk-guard-sec">Visual signals</div><ul>${visuals}</ul>` : ""}
      ${recs ? `<div class="apk-guard-sec">Next step</div><ul>${recs}</ul>` : ""}
      <div class="apk-guard-meta">Source: ${escapeHtml(data.source || "backend")}${model} · <a href="#" class="apk-guard-detail">details</a></div>
      <pre class="apk-guard-raw" hidden>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    card.querySelector(".apk-guard-x").onclick = () => card.remove();
    const det = card.querySelector(".apk-guard-detail");
    const raw = card.querySelector(".apk-guard-raw");
    det.onclick = (e) => { e.preventDefault(); raw.hidden = !raw.hidden; };
  }

  function insertNear(card, anchorEl) {
    if (anchorEl && anchorEl.insertAdjacentElement) anchorEl.insertAdjacentElement("afterend", card);
    else document.body.prepend(card);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function closeExisting() {
    document.querySelectorAll(".apk-guard-card").forEach((c) => c.remove());
  }
  return { ensureFab, showPageBar, setPageBarStatus, showPagePanel, updatePanelRow, showConfirmModal, showToast, showLoadingCard, updateLoadingCard, renderVerdict };
})();
