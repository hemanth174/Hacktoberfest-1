// APK Guard — background service worker (MV3)
// Use the persistent Side Panel as the only toolbar surface. This prevents
// the action popup and Side Panel from appearing together during scans.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "apk-guard-scan",
    title: "Scan APK with APK Guard",
    contexts: ["link", "selection"],
  });
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "apk-guard-scan" || !tab?.id) return;
  const url = info.linkUrl || (info.selectionText || "").trim();
  if (!url) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SCAN_URL", url, fileName: url.split("/").pop() });
  } catch {
    // Content scripts are unavailable on protected pages; open the report UI.
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  }
});

// Keep the toolbar badge synchronized with the active tab. A zero count must
// clear the badge, otherwise Chrome keeps showing the previous page's count.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "OPEN_PANEL") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.sidePanel.open({ tabId }).then(() => {
        setTimeout(() => chrome.runtime.sendMessage({ type: "REFRESH_ACTIVE_PAGE" }).catch(() => {}), 150);
      }).catch(() => {});
    }
    return;
  }
  if (msg.type !== "APK_COUNT" || !sender.tab?.id) return;
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.count > 0 ? String(msg.count) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#d93025" });
});

const jobs = new Map();

function makeJobId() {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function backendUrl() {
  return new Promise((resolve) => chrome.storage.sync.get({ backendUrl: "http://localhost:8000" }, (v) => {
    resolve((v.backendUrl || "http://localhost:8000").replace(/\/$/, ""));
  }));
}

function publish(job, patch) {
  Object.assign(job, patch);
  jobs.set(job.id, job);
  const message = { type: "SCAN_PROGRESS", jobId: job.id, status: job.status, detail: job.detail };
  if (job.status === "complete") message.data = job.data;
  if (job.status === "error") message.error = job.error;
  if (job.status === "complete" && job.data) {
    chrome.storage.local.get({ apkGuardHistory: [] }, (value) => {
      const history = value.apkGuardHistory || [];
      history.unshift({
        t: Date.now(),
        filename: job.data.filename || job.filename,
        pageUrl: job.data.page_url || job.pageUrl || "",
        verdict: job.data.verdict || "unknown",
        score: job.data.risk_score ?? null,
        source: job.data.source || "background",
        model: job.data.model || "",
        data: job.data,
      });
      chrome.storage.local.set({ apkGuardHistory: history.slice(0, 6) });
    });
    if (job.data.page_url) {
      chrome.storage.local.get({ apkGuardPageResults: {} }, (value) => {
        const results = value.apkGuardPageResults || {};
        results[job.data.page_url] = { t: Date.now(), data: job.data };
        const keys = Object.keys(results).sort((a, b) => (results[b].t || 0) - (results[a].t || 0)).slice(0, 20);
        chrome.storage.local.set({ apkGuardPageResults: Object.fromEntries(keys.map((key) => [key, results[key]])) });
      });
    }
  }
  chrome.runtime.sendMessage(message).catch(() => {});
  if (job.tabId) chrome.tabs.sendMessage(job.tabId, message).catch(() => {});
}

async function request(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function runUrlJob(job) {
  try {
    publish(job, { status: "running", detail: "Downloading APK for analysis" });
    const base = await backendUrl();
    publish(job, { detail: "Running androguard static analysis" });
    const response = await request(`${base}/scan-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: job.url, filename: job.filename, page_url: job.pageUrl || "" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Backend ${response.status}`);
    publish(job, { status: "complete", detail: "Gemma report ready", data: { ...data, filename: job.filename, url: job.url } });
  } catch (error) {
    publish(job, { status: "error", detail: "Scan failed", error: error.name === "AbortError" ? "Scan timed out" : error.message });
  }
}

async function runFileJob(job) {
  try {
    publish(job, { status: "running", detail: "Uploading APK to local backend" });
    const binary = Uint8Array.from(atob(job.fileBase64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new Blob([binary], { type: "application/vnd.android.package-archive" }), job.filename);
    publish(job, { detail: "Running androguard static analysis" });
    const response = await request(`${await backendUrl()}/scan-file`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Backend ${response.status}`);
    publish(job, { status: "complete", detail: "Gemma report ready", data: { ...data, filename: job.filename } });
  } catch (error) {
    publish(job, { status: "error", detail: "Scan failed", error: error.name === "AbortError" ? "Scan timed out" : error.message });
  }
}

async function runPageJob(job) {
  try {
    publish(job, { status: "running", detail: "Sending page screenshot to Gemma 4" });
    const form = new FormData();
    form.append("screenshot_b64", job.screenshot);
    form.append("page_url", job.pageUrl || "");
    if (job.url) { form.append("url", job.url); form.append("filename", job.filename || "download.apk"); }
    const response = await request(`${await backendUrl()}/scan-with-screenshot`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Backend ${response.status}`);
    publish(job, { status: "complete", detail: "Gemma vision report ready", data: { ...data, filename: job.filename, page_url: job.pageUrl || "", url: job.url || "" } });
  } catch (error) {
    publish(job, { status: "error", detail: "Page scan failed", error: error.name === "AbortError" ? "Scan timed out" : error.message });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!["START_URL_SCAN", "START_FILE_SCAN", "START_PAGE_SCAN", "GET_SCAN_JOB", "GET_ACTIVE_PAGE_JOB"].includes(msg.type)) return;
  if (msg.type === "GET_SCAN_JOB") {
    sendResponse(jobs.get(msg.jobId) || { status: "unknown" });
    return true;
  }
  if (msg.type === "GET_ACTIVE_PAGE_JOB") {
    const job = [...jobs.values()].find((item) => item.pageUrl === msg.pageUrl && !["complete", "error"].includes(item.status));
    sendResponse(job || { status: "none" });
    return true;
  }
  const job = {
    id: msg.jobId || makeJobId(),
    type: msg.type,
    tabId: msg.tabId || sender.tab?.id,
    url: msg.url || "",
    filename: msg.filename || "download.apk",
    pageUrl: msg.pageUrl || "",
    screenshot: msg.screenshot || "",
    fileBase64: msg.fileBase64 || "",
    status: "queued",
    detail: "Queued in background",
  };
  jobs.set(job.id, job);
  sendResponse({ ok: true, jobId: job.id });
  if (msg.type === "START_URL_SCAN") runUrlJob(job);
  if (msg.type === "START_FILE_SCAN") runFileJob(job);
  if (msg.type === "START_PAGE_SCAN") runPageJob(job);
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.sendMessage(tabId, { type: "REFRESH_APK_COUNT" }).catch(() => {});
});
