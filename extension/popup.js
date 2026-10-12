// APK Guard — popup.js (minimal premium UI, same flows + backend APIs)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const timeAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : Math.round(m / 60) + "h ago"; };

const P = (inner) => `<svg class="ic" viewBox="0 0 24 24">${inner}</svg>`;
const ICONS = {
  check: P('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  alert: P('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  x: P('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  info: P('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  file: P('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  clock: P('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  scan: P('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" x2="17" y1="12" y2="12"/>'),
  trash: P('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  lock: P('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
};
const pendingJobs = new Map();
let lastAutoScanKey = "";

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "REFRESH_ACTIVE_PAGE") {
    lastAutoScanKey = "";
    refreshActivePage();
    return;
  }
  if (message.type !== "SCAN_PROGRESS") return;
  handleScanProgress(message);
});

function handleScanProgress(message) {
  const pending = pendingJobs.get(message.jobId);
  const fallbackActivity = $("p-url")?.classList.contains("active") ? "urlActivity" : $("p-file")?.classList.contains("active") ? "fileActivity" : "pageActivity";
  if (message.detail) setActivity(pending?.activityId || fallbackActivity, message.detail);
  if (message.status === "complete" && message.data) {
    saveHistory(message.data);
    renderReport(message.data);
    openReport();
    pending?.resolve(true);
    pendingJobs.delete(message.jobId);
  }
  if (message.status === "error") {
    setActivity(pending?.activityId || fallbackActivity, message.error || "Background scan failed", "error");
    pending?.resolve(false);
    pendingJobs.delete(message.jobId);
  }
  if (message.status === "complete" || message.status === "error") {
    if (pending?.pollTimer) clearInterval(pending.pollTimer);
  }
}

function pollBackgroundJob(jobId) {
  const pending = pendingJobs.get(jobId);
  if (!pending) return;
  pending.pollTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: "GET_SCAN_JOB", jobId }, (job) => {
      if (chrome.runtime.lastError || !job) return;
      if (!pendingJobs.has(jobId)) {
        clearInterval(pending.pollTimer);
        return;
      }
      if (job.detail) setActivity(pending.activityId, job.detail);
      if (job.status === "complete" || job.status === "error") {
        clearInterval(pending.pollTimer);
        handleScanProgress({
          type: "SCAN_PROGRESS",
          jobId,
          status: job.status,
          detail: job.detail,
          error: job.error,
          data: job.data,
        });
      }
    });
  }, 2000);
}

/* ---------- backend URL (synced) ---------- */
function backendUrl() {
  return new Promise((res) => chrome.storage.sync.get({ backendUrl: "http://localhost:8000" }, (v) => res((v.backendUrl || "http://localhost:8000").replace(/\/$/, ""))));
}
$("settingsBtn").onclick = () => $("settingsRow").classList.toggle("open");
$("backend").addEventListener("change", () => {
  chrome.storage.sync.set({ backendUrl: $("backend").value });
  $("footStat").textContent = "Backend " + $("backend").value;
});
chrome.storage.sync.get({ backendUrl: "http://localhost:8000" }, (v) => {
  $("backend").value = v.backendUrl;
  $("footStat").textContent = "Backend " + v.backendUrl;
});
chrome.storage.sync.get({ autoScan: true }, (v) => { $("autoScan").checked = v.autoScan; });
$("autoScan").addEventListener("change", () => chrome.storage.sync.set({ autoScan: $("autoScan").checked }));

/* ---------- tabs ---------- */
const TABS = [["t-page", "p-page"], ["t-url", "p-url"], ["t-file", "p-file"]];
function selectTab(id) {
  TABS.forEach(([t, p]) => {
    const on = t === id;
    $(t).setAttribute("aria-selected", on ? "true" : "false");
    $(p).classList.toggle("active", on);
  });
}
TABS.forEach(([t]) => { $(t).onclick = () => selectTab(t); });

/* ---------- view switching ---------- */
function openReport() { $("view-main").classList.add("hidden"); $("view-report").classList.add("open"); $("backBtn").focus(); }
function closeReport() { $("view-report").classList.remove("open"); $("view-main").classList.remove("hidden"); }
$("backBtn").onclick = closeReport;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("view-report").classList.contains("open")) closeReport(); });

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function openPersistentScanPanel() {
  // The toolbar action already opens this page as the Side Panel.
}
function setActivity(id, text, state = "busy") {
  const node = $(id);
  if (!node) return;
  node.hidden = false;
  node.className = `activity ${state === "done" ? "done" : state === "error" ? "error" : ""}`;
  node.innerHTML = state === "busy" ? `<span class="spinner dark"></span><span>${esc(text)}</span>` : `<span>${state === "done" ? "Done" : "Error"}</span><span>${esc(text)}</span>`;
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function compactScreenshot(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  const maxWidth = 1024;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  if (scale === 1) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
function startBackgroundJob(type, payload, activityId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError || !response?.jobId) {
        if (activityId) setActivity(activityId, chrome.runtime.lastError?.message || "Could not start background scan", "error");
        resolve(false);
        return;
      }
      pendingJobs.set(response.jobId, { activityId, resolve, pollTimer: null });
      pollBackgroundJob(response.jobId);
    });
  });
}
async function injectCard(tabId, data) {
  if (!tabId) return;
  try { await chrome.tabs.sendMessage(tabId, { type: "RENDER_VERDICT", data }); } catch { /* page blocked — report view still shows */ }
}

/* ================= TAB 1 — THIS PAGE ================= */
let pageLinks = [];
let pageBlocked = false;
let pageCompliance = { legalFound: false, terms: [] };

async function loadPage() {
  const tab = await activeTab();
  let domain = "";
  try { domain = new URL(tab.url).hostname; } catch { domain = tab?.url || ""; }
  $("pageDomain").textContent = domain || "Unknown page";
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_LINKS" });
    pageLinks = (res?.links || []).slice(0, 50);
    pageCompliance = res?.compliance || { legalFound: false, terms: [] };
    pageBlocked = false;
  } catch {
    pageLinks = [];
    pageBlocked = true;
  }
  renderPageTab(tab);
}

function renderPageTab(tab) {
  const n = pageLinks.length;
  const targetWord = pageLinks.some((link) => link.kind === "download-target") ? "target" : "file";
  $("pageCount").textContent = `${n} ${targetWord}${n === 1 ? "" : "s"}`;
  const st = $("pageStatus"), fl = $("pageFindings"), tog = $("pageDetailsToggle"), det = $("pageDetails");
  fl.innerHTML = ""; det.innerHTML = ""; det.style.display = "none"; tog.style.display = "none";

  if (pageBlocked) {
    st.innerHTML = statusRow("na", "Unable to verify", "Chrome blocks this page. Use the Paste URL tab instead.");
    $("scanPageBtn").disabled = true;
    return;
  }
  $("scanPageBtn").disabled = false;
  if (!n) {
    st.innerHTML = statusRow("na", "Unable to verify", `No APK links detected. ${pageCompliance.legalFound ? "Terms and Privacy information found." : "Terms and Privacy information not found."}`);
    return;
  }
  const max = Math.max(...pageLinks.map((l) => l.score ?? 0));
  const unresolved = pageLinks.some((l) => l.resolvable === false);
  if (unresolved) {
    st.innerHTML = statusRow("na", "Unable to verify", `${n} download target${n === 1 ? "" : "s"} found, but this site hides the final APK URL. ${pageCompliance.legalFound ? "Terms and Privacy information found." : "Legal information not found."}`);
  } else if (max >= 30) {
    st.innerHTML = statusRow("bad", "Suspicious", `${n} download target${n === 1 ? "" : "s"} with elevated pre-scan signals. ${pageCompliance.legalFound ? "Terms and Privacy information found." : "Legal information not found."}`);
  } else {
    st.innerHTML = statusRow("ok", "Looks safe", `Low pre-scan signals. ${pageCompliance.legalFound ? "Terms and Privacy information found." : "Legal information not found."} Analysis is still recommended.`);
  }
  // up to 3 key findings (real data: filename + pre-scan score)
  const top = [...pageLinks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
  fl.innerHTML = top.map((l) =>
    `<div class="finding"><span class="sev ${(l.level === "high") ? "high" : (l.level === "medium") ? "medium" : "info"}"></span><p class="grow ellipsis" title="${esc(l.url)}"><strong>${esc(l.fileName)}</strong> <span class="muted">· pre-scan ${l.score ?? "?"}/100</span></p></div>`
  ).join("");
  // details: full list with per-link scan
  tog.style.display = "inline-flex";
  det.innerHTML = pageLinks.map((l, i) =>
    `<div class="prow"><span class="grow ellipsis small" title="${esc(l.url)}" style="font-weight:600">${esc(l.fileName)}</span><span class="pill ${l.level || "low"}">${l.score ?? "?"}</span><button data-i="${i}" ${l.resolvable === false ? "disabled title=\"Final APK URL is hidden by the site\"" : ""}>${l.resolvable === false ? "Needs URL" : "Scan"}</button></div>`
  ).join("");
  det.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      const l = pageLinks[+b.dataset.i];
      if (l.resolvable === false) return;
      openPersistentScanPanel();
      b.disabled = true;
      scanUrlRemote(l.url, l.fileName, tab?.id).finally(() => { b.disabled = false; });
    };
  });
}

function statusRow(cls, label, sub) {
  const ic = cls === "ok" ? ICONS.check : cls === "bad" ? ICONS.alert : ICONS.info;
  return `<div class="rowline"><span class="stat-${cls}">${ic}</span><div><div style="font-weight:700;font-size:12.5px">${esc(label)}</div><div class="muted small">${esc(sub)}</div></div></div>`;
}
$("pageDetailsToggle").onclick = () => {
  const det = $("pageDetails");
  const open = det.style.display !== "none";
  det.style.display = open ? "none" : "block";
  $("pageDetailsToggle").firstChild.textContent = open ? "View details " : "Hide details ";
};

/* visual page scan (screenshot + first file -> Gemma vision) */
$("scanPageBtn").onclick = async () => {
  const btn = $("scanPageBtn");
  openPersistentScanPanel();
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner dark"></span>Scanning page…`;
  setActivity("pageActivity", "Collecting page text, Terms, Privacy information, and APK links…");
  try {
    const tab = await activeTab();
    setActivity("pageActivity", "Capturing the visible page for Gemma 4 vision…");
    const shot = await compactScreenshot(await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }));
    const first = pageLinks[0];
    setActivity("pageActivity", first ? `Sending ${first.fileName} and the page screenshot to Gemma 4…` : "Sending the page screenshot to Gemma 4…");
    await startBackgroundJob("START_PAGE_SCAN", {
      screenshot: shot,
      pageUrl: tab.url || "",
      url: first?.url || "",
      filename: first?.fileName || "page-scan",
      tabId: tab.id,
    }, "pageActivity");
  } catch (e) {
    setActivity("pageActivity", e.name === "AbortError" ? "Scan timed out. Check Ollama and the backend." : e.message, "error");
    $("pageStatus").innerHTML = `<div class="errbox"><span>${ICONS.alert}</span><span>Visual scan failed: ${esc(e.message)}. Use Paste URL instead.</span></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = "";
    btn.appendChild(document.createRange().createContextualFragment(
      `<svg class="ic" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>Scan page`));
  }
};

/* ================= TAB 2 — PASTE URL ================= */
const RISKY_TLDS = ["tk", "ml", "ga", "cf", "gq", "xyz", "top"];
const BRANDS = ["whatsapp", "tiktok", "instagram", "telegram"];
const MODS = ["mod", "plus", "pro", "premium", "crack", "unlocked", "hack"];

function urlSignals(raw) {
  const out = [];
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const name = (u.pathname.split("/").pop() || "").toLowerCase();
    if (u.protocol !== "https:") out.push("Link is not HTTPS");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) out.push("Host is a raw IP address, not a domain");
    if (RISKY_TLDS.includes(host.split(".").pop())) out.push("Uncommon free top-level domain");
    if (BRANDS.some((b) => name.includes(b)) && MODS.some((m) => name.includes(m))) out.push("Filename pairs a brand name with a mod keyword");
  } catch { /* invalid URL — handled below */ }
  return out;
}

async function probeUrl(raw) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(raw, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(to);
    return { finalUrl: r.url || raw, redirected: r.redirected, status: r.status };
  } catch { return null; }
}

let probeTimer = null;
$("url").addEventListener("input", () => {
  clearTimeout(probeTimer);
  probeTimer = setTimeout(renderProbe, 450);
});

async function renderProbe() {
  const box = $("urlProbe");
  const raw = $("url").value.trim();
  if (!raw) { box.innerHTML = ""; return; }
  let host = "", proto = "";
  try { const u = new URL(raw); host = u.hostname; proto = u.protocol.replace(":", "").toUpperCase(); }
  catch { box.innerHTML = `<div class="errbox"><span>${ICONS.alert}</span><span>That does not look like a valid URL.</span></div>`; return; }
  box.innerHTML = `<div class="card"><div class="kv"><span class="k">Detected domain</span><span class="v mono">${esc(host)}</span></div>
    <div class="kv"><span class="k">Protocol</span><span class="v">${esc(proto)}</span></div>
    <div class="kv"><span class="k">Redirects</span><span class="v muted" id="redirCell">checking…</span></div></div>`;
  const probe = await probeUrl(raw);
  const cell = $("redirCell");
  if (!cell) return;
  if (!probe) { cell.textContent = "Unavailable — server blocked the check"; return; }
  try {
    const finalHost = new URL(probe.finalUrl).hostname;
    cell.innerHTML = probe.redirected ? `Yes <span class="muted">→ ${esc(finalHost)}</span>` : "None detected";
  } catch { cell.textContent = probe.redirected ? "Yes" : "None detected"; }
  const sigs = urlSignals(raw);
  if (sigs.length) {
    box.insertAdjacentHTML("beforeend",
      `<div class="card"><div class="tiny" style="font-weight:700;margin-bottom:3px">UNVERIFIED SIGNALS — confirm with Analyze</div>` +
      sigs.map((s) => `<div class="finding"><span class="sev medium"></span><p>${esc(s)}</p></div>`).join("") + `</div>`);
  }
}

$("scanUrlBtn").onclick = async () => {
  const btn = $("scanUrlBtn");
  openPersistentScanPanel();
  const raw = $("url").value.trim();
  if (!raw) { $("url").focus(); return; }
  try { new URL(raw); } catch {
    $("urlProbe").innerHTML = `<div class="errbox"><span>${ICONS.alert}</span><span>Paste a complete URL starting with https://</span></div>`;
    return;
  }
  const fileName = (raw.split("/").pop() || "download.apk").split("?")[0] || "download.apk";
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Analyzing…`;
  setActivity("urlActivity", "Validating URL and checking redirects…");
  try {
    await renderProbe();
    setActivity("urlActivity", "Downloading the APK for static analysis…");
    const ok = await scanUrlRemote(raw, fileName, null);
    if (ok) setActivity("urlActivity", "Gemma report received.", "done");
  } catch (e) {
    setActivity("urlActivity", e.message, "error");
    throw e;
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze URL";
  }
};

async function scanUrlRemote(url, fileName, tabId) {
  const target = tabId || (await activeTab())?.id;
  return startBackgroundJob("START_URL_SCAN", {
    url, filename: fileName, tabId: target, pageUrl: location.href,
  }, "urlActivity");
}

/* ================= TAB 3 — UPLOAD APK ================= */
let pickedFile = null;
const drop = $("drop"), fileInput = $("file");

drop.onclick = () => fileInput.click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0]); });
fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) pickFile(fileInput.files[0]); });

function pickFile(f) {
  $("fileErr")?.remove();
  if (!/\.apk$/i.test(f.name)) {
    drop.insertAdjacentHTML("afterend", `<div class="errbox" id="fileErr" style="margin-top:8px"><span>${ICONS.alert}</span><span>Only .apk files are accepted.</span></div>`);
    return;
  }
  pickedFile = f;
  $("fileChip").style.display = "block";
  $("fileChip").innerHTML = `<div class="filechip"><span class="fi">${ICONS.file}</span>
    <span class="grow" style="min-width:0"><span class="ellipsis" style="display:block;font-weight:650;font-size:12px" title="${esc(f.name)}">${esc(f.name)}</span>
    <span class="tiny">${fmtSize(f.size)}</span></span>
    <button class="iconbtn" id="rmFile" aria-label="Remove file">${ICONS.x}</button></div>`;
  $("rmFile").onclick = (e) => { e.stopPropagation(); pickedFile = null; fileInput.value = ""; $("fileChip").style.display = "none"; $("scanFileBtn").disabled = true; };
  $("scanFileBtn").disabled = false;
}

$("scanFileBtn").onclick = async () => {
  if (!pickedFile) return;
  const btn = $("scanFileBtn");
  openPersistentScanPanel();
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Analyzing…`;
  $("fileProg").classList.add("on");
  setActivity("fileActivity", `Uploading ${pickedFile.name} to the local scanner…`);
  $("fileErr")?.remove();
  try {
    setActivity("fileActivity", "Running androguard static analysis…");
    const bytes = new Uint8Array(await pickedFile.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    await startBackgroundJob("START_FILE_SCAN", {
      fileBase64: btoa(binary), filename: pickedFile.name, tabId: (await activeTab())?.id,
    }, "fileActivity");
  } catch (e) {
    setActivity("fileActivity", e.name === "AbortError" ? "Scan timed out. Check Ollama and the backend." : e.message, "error");
    drop.insertAdjacentHTML("afterend", `<div class="errbox" id="fileErr" style="margin-top:8px"><span>${ICONS.alert}</span><span><strong>Scan failed.</strong> ${esc(e.message)}. Is the backend running?</span></div>`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze APK";
    $("fileProg").classList.remove("on");
  }
};

/* ---------- history (local, last 6) ---------- */
function getHistory() {
  return new Promise((res) => chrome.storage.local.get({ apkGuardHistory: [] }, (v) => res(v.apkGuardHistory || [])));
}
function saveHistory(data) {
  getHistory().then((h) => {
    h.unshift({ t: Date.now(), filename: data.filename || "download.apk", pageUrl: data.page_url || "", scanKind: data.scan_kind || "apk", verdict: data.verdict || "unknown", score: data.risk_score ?? null, source: data.source || "", model: data.model || "", data });
    chrome.storage.local.set({ apkGuardHistory: h.slice(0, 6) });
    renderHistory();
  });
}
function historyLabel(item) {
  const pageUrl = item.pageUrl || item.data?.page_url || "";
  const isPage = item.scanKind === "page" || item.data?.scan_kind === "page" || item.filename === "page-scan" || (pageUrl && !item.data?.url);
  if (!isPage) return item.filename || "Scan result";
  try { return new URL(pageUrl).hostname || "Current website"; } catch { return "Current website"; }
}
async function renderHistory() {
  const h = await getHistory();
  if (!h.length) { $("history").innerHTML = `<p class="tiny" style="margin:6px 0 0">No scans yet.</p>`; return; }
  $("history").innerHTML = "";
  h.forEach((item, i) => {
    const b = document.createElement("button");
    b.className = "hist";
    const lvl = item.verdict === "clean" ? "low" : (item.verdict === "malicious" || item.verdict === "suspicious") ? "high" : "na";
    const label = historyLabel(item);
    b.innerHTML = `<span class="muted">${ICONS.clock}</span><span class="grow ellipsis hn" title="${esc(label)}" style="font-weight:600">${esc(label)}</span><span class="pill ${lvl}">${esc(item.verdict)}${item.score ?? item.score === 0 ? " · " + item.score : ""}</span><span class="tiny">${timeAgo(item.t)}</span>`;
    b.onclick = () => { renderReport(item.data); openReport(); };
    b.dataset.i = i;
    $("history").appendChild(b);
  });
}
function removeUnrecoverableLegacyHistory() {
  getHistory().then((history) => {
    const filtered = history.filter((item) => {
      const hasPage = item.pageUrl || item.data?.page_url;
      const generic = /^(download|download-now|page-scan)(-[\w]+)?\.apk$/i.test(item.filename || "") || item.filename === "page-scan";
      return !(generic && !hasPage);
    });
    if (filtered.length !== history.length) {
      chrome.storage.local.set({ apkGuardHistory: filtered });
      renderHistory();
    }
  });
}

/* ================= REPORT VIEW ================= */
function sevOf(s) {
  if (/dangerous|trojan|malware|steal|otp|ransomware|spyware|dropper|impersonat|mismatch|accessibility|device.admin|send sms|read sms/i.test(s)) return "high";
  if (/risky|suspicious|unverified|typo|third-party|mod|crack|overlay|install packages|http|caution|avoid/i.test(s)) return "medium";
  return "info";
}
function catOf(s) {
  if (/permission|SMS|contacts|camera|location|microphone|accessibility|admin|overlay|install/i.test(s)) return "Permission";
  if (/impersonat|mismatch|brand|official|signer/i.test(s)) return "Impersonation";
  if (/HTTP|TLD|domain|host|IP-based|third-party/i.test(s)) return "Download source";
  return "Analysis note";
}

function renderReport(d) {
  $("repFile").textContent = d.scan_kind === "page" || d.filename === "page-scan" ? historyLabel({ filename: d.filename, data: d, pageUrl: d.page_url, scanKind: d.scan_kind }) : (d.filename || "Scan result");
  const score = typeof d.risk_score === "number" ? d.risk_score : null;
  $("repScore").textContent = score ?? "–";
  const arc = $("scoreArc"), C = 2 * Math.PI * 27;
  arc.setAttribute("stroke-dasharray", score === null ? `0 ${C}` : `${(score / 100) * C} ${C}`);
  const v = (d.verdict || "unknown").toLowerCase();
  const lvl = $("repLevel");
  lvl.className = "pill " + (v === "clean" ? "low" : (v === "malicious" || v === "suspicious") ? "high" : v === "unknown" ? "na" : "medium");
  lvl.style.marginLeft = "auto";
  lvl.textContent = v === "clean" ? "Low risk" : v === "malicious" ? "Malicious" : v === "suspicious" ? "Suspicious" : "Unknown";
  $("repSummary").textContent = d.summary || "No summary returned.";

  // findings grouped by severity (real strings from the scan — never invented)
  const groups = { high: [], medium: [], info: [] };
  (d.reasons || []).forEach((r) => groups[sevOf(String(r))].push({ t: String(r), cat: catOf(String(r)) }));
  (d.visual_flags || []).forEach((r) => groups.medium.push({ t: String(r), cat: "Page signal (vision)" }));
  let fh = "";
  const titles = { high: "High severity", medium: "Medium severity", info: "Other notes" };
  let any = false;
  for (const g of ["high", "medium", "info"]) {
    if (!groups[g].length) continue;
    any = true;
    fh += `<div class="grp">${titles[g]} · ${groups[g].length}</div>` + groups[g].map((f) =>
      `<div class="finding"><span class="sev ${g}"></span><div class="grow"><p>${esc(f.t)}</p>
       <details class="ev"><summary>Evidence</summary><div class="evbody">Category: ${esc(f.cat)} · from this scan's report.</div></details></div></div>`
    ).join("");
  }
  if (!any) fh = `<div class="infobox" style="margin-top:8px"><span>${ICONS.info}</span><span>No specific issues were flagged in this report. This is not a safety guarantee — prefer official sources.</span></div>`;
  if ((d.recommendations || []).length) {
    fh += `<div class="grp">Recommended actions</div>` + d.recommendations.map((r) =>
      `<div class="finding"><span style="color:var(--green)">${ICONS.check}</span><p>${esc(r)}</p></div>`).join("");
  }
  $("repFindings").innerHTML = fh;

  // technical details — only what the scan actually returned
  const rows = [];
  const row = (k, vHtml) => rows.push(`<div class="kv"><span class="k">${k}</span><span class="v">${vHtml}</span></div>`);
  if (d.filename) row("File", esc(d.filename));
  if (d.package) row("Package", `<span class="mono">${esc(d.package)}</span>`);
  if (d.sha256) row("SHA-256", `<span class="mono" title="${esc(d.sha256)}">${esc(String(d.sha256).slice(0, 20))}…</span> <button class="linkbtn" id="copySha" style="padding:0">Copy</button>`);
  const cert = d.cert_hint || d.certificate || d.signer;
  row("Signing certificate", cert ? `<span class="mono">${esc(cert)}</span>` : `<span class="muted">Not included in this report</span>`);
  if (Array.isArray(d.permissions) && d.permissions.length) {
    const list = d.permissions.slice(0, 12).map((p) => `<span class="mono">${esc(p.replace("android.permission.", ""))}</span>`).join(", ");
    row("Permissions", esc("") + list + (d.permissions.length > 12 ? ` <span class="muted">+${d.permissions.length - 12} more (see raw)</span>` : ""));
  } else {
    row("Permissions", `<span class="muted">Not included — see raw evidence</span>`);
  }
  if (d.engine) row("Static engine", esc(d.engine));
  if (d.page_url) row("Page", `<span class="mono">${esc(d.page_url)}</span>`);
  $("repTech").innerHTML = rows.join("");
  const cbtn = $("copySha");
  if (cbtn) cbtn.onclick = async () => {
    try { await navigator.clipboard.writeText(d.sha256); cbtn.textContent = "Copied"; }
    catch { cbtn.textContent = "Copy failed"; }
    setTimeout(() => { cbtn.textContent = "Copy"; }, 1500);
  };

  $("repEvidence").innerHTML = `<details class="ev"><summary>Raw report (JSON)</summary>
    <div class="evbody"><pre class="mono" style="white-space:pre-wrap;background:var(--soft);border-radius:8px;padding:8px;max-height:180px;overflow:auto">${esc(JSON.stringify(d, null, 2))}</pre></div></details>`;
  $("repSource").textContent = `Source: ${d.source || "backend"}${d.model ? " · " + d.model : ""} · Scores are heuristic pre-scan/static signals, not proof of safety.`;
  const reviewUrl = d.page_url || d.url || "";
  let reviewHost = "";
  try { reviewHost = new URL(reviewUrl).hostname; } catch {}
  $("repWebReview").innerHTML = reviewHost
    ? `<button class="linkbtn" id="googleReviewsBtn">Search Google for ${esc(reviewHost)} reviews and safety reports</button><div class="tiny">External search results are not verified by APK Guard.</div>`
    : `<div class="tiny">Web review search unavailable: no source website was supplied.</div>`;
  $("googleReviewsBtn")?.addEventListener("click", () => {
    const query = encodeURIComponent(`${reviewHost} reviews scam malware`);
    chrome.tabs.create({ url: `https://www.google.com/search?q=${query}` });
  });
  $("dlReportBtn").onclick = () => {
    const reasons = (d.reasons || []).map((item) => `- ${item}`).join("\n") || "- None reported";
    const recommendations = (d.recommendations || []).map((item) => `- ${item}`).join("\n") || "- None reported";
    const permissions = Array.isArray(d.permissions) && d.permissions.length ? d.permissions.join("\n- ") : "Not included in this report";
    const reportText = [
      "APK GUARD SCAN REPORT",
      "======================",
      `File: ${d.filename || "Unknown"}`,
      `Verdict: ${(d.verdict || "unknown").toUpperCase()}`,
      `Risk score: ${d.risk_score ?? "Unknown"}/100 (heuristic)`,
      `Model: ${d.model || "Not available"}`,
      `Source: ${d.source || "Not available"}`,
      "",
      "SUMMARY",
      d.summary || "No summary returned.",
      "",
      "FINDINGS",
      reasons,
      "",
      "RECOMMENDED ACTIONS",
      recommendations,
      "",
      "TECHNICAL DETAILS",
      `Package: ${d.package || "Not available"}`,
      `SHA-256: ${d.sha256 || "Not available"}`,
      `Signing certificate: ${d.cert_hint || d.certificate || d.signer || "Not included"}`,
      `Static engine: ${d.engine || "Not available"}`,
      "Permissions:",
      `- ${permissions}`,
      "",
      "Generated by APK Guard. A clean result is not a safety guarantee."
    ].join("\n");
    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(d.filename || "scan").replace(/[^\w.-]+/g, "_")}-apk-guard-report.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}

/* ---------- boot ---------- */
async function refreshActivePage() {
  const tab = await activeTab();
  const key = `${tab?.id || ""}:${tab?.url || ""}`;
  if (key === lastAutoScanKey) return;
  await loadPage();
  lastAutoScanKey = key;
  const activeJob = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "GET_ACTIVE_PAGE_JOB", pageUrl: tab?.url || "" }, (response) => resolve(response || { status: "none" })));
  if (activeJob.status && !["none", "complete", "error"].includes(activeJob.status)) {
    setActivity("pageActivity", activeJob.detail || "Resuming the active page scan…");
    return;
  }
  const cached = await new Promise((resolve) => chrome.storage.local.get({ apkGuardPageResults: {} }, (value) => resolve(value.apkGuardPageResults?.[tab?.url || ""] || null)));
  if (cached?.data) {
    const data = cached.data;
    const label = String(data.verdict || "unknown").toUpperCase();
    setActivity("pageActivity", `Restored ${label} result from ${timeAgo(cached.t)}.`, "done");
    $("pageStatus").innerHTML = statusRow(data.verdict === "clean" ? "ok" : data.verdict === "unknown" ? "na" : "bad", `${label} · previous scan`, data.summary || "Previous report restored.");
    return;
  }
  chrome.storage.sync.get({ autoScan: true }, (settings) => {
    if (settings.autoScan && !pageBlocked) $("scanPageBtn").click();
  });
}
chrome.tabs.onActivated.addListener(() => refreshActivePage());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  activeTab().then((tab) => { if (tab?.id === tabId) { lastAutoScanKey = ""; refreshActivePage(); } });
});
refreshActivePage();
renderHistory();
removeUnrecoverableLegacyHistory();
