/* APK Guard — content.js
 *  FLOW A (passive): APK links -> inline badge + auto page-summary panel on site open.
 *  FLOW B (guard):   clicking any APK download -> "Are you sure?" glass modal with summary.
 *  FLOW C (manual):  popup.html asks for links (GET_LINKS) or triggers scans.
 */

(() => {
  if (window.__apkGuardInjected) return;
  window.__apkGuardInjected = true;

  const BACKEND_DEFAULT = "http://localhost:8000";

  // ---------- Heuristics (offline, in-browser) ----------
  const BRANDS = ["whatsapp", "tiktok", "instagram", "telegram", "facebook", "snapchat", "spotify", "minecraft", "pubg", "freefire"];
  const MOD_KEYWORDS = ["mod", "plus", "pro", "premium", "crack", "cracked", "unlocked", "hack", "vip", "gold", "ultra"];
  const RISKY_TLDS = ["tk", "ml", "ga", "cf", "gq", "xyz", "top", "club", "site", "online", "buzz", "rest", "zip", "mov"];
  const BRAND_TYPO_PATTERNS = [/whats+a+p/i, /tik-?t+o+k/i, /tele+gram/i, /insta+gram/i, /face+book/i];

  const chipCache = new Map();
  const heuristicCache = new Map();
  let refreshTimer = null;
  let pageToastShown = false;
  let progressCard = null;

  function getBackendUrl() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get({ backendUrl: BACKEND_DEFAULT }, (v) => resolve(v.backendUrl));
      } catch { resolve(BACKEND_DEFAULT); }
    });
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function heuristicScore(linkUrl, fileName, pageHost) {
    let score = 0;
    const reasons = [];
    try {
      const u = new URL(linkUrl, location.href);
      const host = u.hostname.toLowerCase();
      const name = (fileName || u.pathname.split("/").pop() || "").toLowerCase();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { score += 30; reasons.push("IP-based download URL (no domain)"); }
      const tld = host.split(".").pop();
      if (RISKY_TLDS.includes(tld)) { score += 20; reasons.push(`Risky free TLD (.${tld})`); }
      for (const pat of BRAND_TYPO_PATTERNS) {
        if (pat.test(host) || pat.test(name)) { score += 25; reasons.push("Possible brand impersonation in domain/filename"); break; }
      }
      const hasBrand = BRANDS.some((b) => name.includes(b));
      const hasMod = MOD_KEYWORDS.some((k) => name.includes(k));
      if (hasBrand && hasMod) { score += 30; reasons.push(`"${name}" mixes a brand name with mod keyword (mod/plus/crack)`); }
      else if (hasMod) { score += 12; reasons.push("Mod/crack keyword in filename"); }
      if (/[0-9]/.test(name) && hasBrand) { score += 10; reasons.push("Leetspeak/numbers in brand filename (t0k, wh4tsapp)"); }
      if (/\.(apk.*){2,}/.test(name) || name.includes(".apk.")) { score += 10; reasons.push("Double extension trick"); }
      if (u.protocol === "http:") { score += 15; reasons.push("Insecure HTTP download link"); }
      if (pageHost && host !== pageHost && !host.includes("play.google.com")) { score += 5; reasons.push("Third-party host (not official store)"); }
    } catch { /* ignore URL parse errors */ }
    return { score: Math.min(score, 100), reasons };
  }

  function getHeuristic(linkUrl, fileName, pageHost) {
    const key = `${linkUrl}|${fileName}|${pageHost}`;
    if (!heuristicCache.has(key)) heuristicCache.set(key, heuristicScore(linkUrl, fileName, pageHost));
    return heuristicCache.get(key);
  }

  function pageCompliance() {
    const text = (document.body?.innerText || "").toLowerCase();
    const found = ["terms and conditions", "terms of service", "privacy policy", "privacy notice", "end user license agreement"]
      .filter((phrase) => text.includes(phrase));
    return { legalFound: found.length > 0, terms: found };
  }

  function riskLevel(score) {
    if (score >= 60) return "high";
    if (score >= 30) return "medium";
    return "low";
  }

  function anchorOf(url) {
    try {
      return document.querySelector(`[data-apk-guard-url="${CSS.escape(url)}"]`) || document.body;
    } catch { return document.body; }
  }

  // ---------- Link discovery ----------
  // Collects:
  //   1) plain .apk <a> tags
  //   2) <button> elements with download‑related text + a resolvable URL
  //   3) <a> tags with onclick that resolve to a non‑official download URL
  function findApkLinks() {
    const out = [];

    // 1) plain .apk anchors
    const anchors = document.querySelectorAll('a[href], button, [data-apk], [data-download-url]');
    anchors.forEach((el, idx) => {
      const href = el.getAttribute("href") || el.getAttribute("data-apk") || el.getAttribute("data-download-url") || "";
      const text = (el.textContent || "").toLowerCase();
      const isApk =
        /\.apk(\?.*)?$/i.test(href) ||
        /\.apk(\?.*)?$/i.test(text) ||
        (text.includes(".apk")) ||
        (el.hasAttribute("data-apk"));
      if (!isApk) return;
      if (el.dataset.apkGuardDone) return;
      const absUrl = href.startsWith("http") ? href : new URL(href, location.href).href;
      const fileName = (absUrl.split("/").pop() || el.textContent.trim().slice(0, 60) || `app-${idx}.apk`).split("?")[0];
      const { score, reasons } = getHeuristic(absUrl, fileName, location.hostname);
      out.push({ el, url: absUrl, fileName, preScore: score, preReasons: reasons, level: riskLevel(score) });
    });

    // 2) JS‑driven download buttons
    function extractJsUrlFromButton(node) {
      if (node.closest && node.closest(".apk-guard")) return null;
      const txt = (node.textContent || "").toLowerCase();
      if (!/download|get app|install|apk/.test(txt)) return null;
      const attr = node.getAttribute("data-href") || node.getAttribute("data-url") || node.getAttribute("data-apk");
      if (attr) {
        try {
          const u = new URL(attr.startsWith("http") ? attr : new URL(attr, location.href).href);
          if (u.hostname.includes("play.google.com") || u.hostname.includes("chrome.google.com")) return null;
          return { url: u.href, fileName: attr.split("/").pop().split("?")[0] };
        } catch { return null; }
      }
      const on = node.getAttribute("onclick") || "";
      const m1 = on.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
      if (m1) {
        try { return { url: new URL(m1[1], location.href).href, fileName: "" }; } catch { return null; }
      }
      const m2 = on.match(/window\.open\s*\(['"]([^'"]+)['"]/i);
      if (m2) {
        try { return { url: new URL(m2[1], location.href).href, fileName: "" }; } catch { return null; }
      }
      const form = node.closest("form");
      if (form && form.action) {
        try { return { url: new URL(form.action, location.href).href, fileName: "" }; } catch { return null; }
      }
      return null;
    }

    const buttons = document.querySelectorAll('button');
    buttons.forEach((b) => {
      const hit = extractJsUrlFromButton(b);
      if (!hit) return;
      const { url, fileName } = hit;
      if (out.some((o) => o.url === url)) return;
      const { score, reasons } = getHeuristic(url, fileName || "download.apk", location.hostname);
      out.push({ el: b, url, fileName: fileName || "download.apk", preScore: score, preReasons: reasons, level: riskLevel(score) });
    });

    // 3) <a> tags with onclick that resolve to a non‑official download URL
    const links = document.querySelectorAll('a[href]');
    links.forEach((el) => {
      if (el.dataset.apkGuardDone) return;
      const href = el.getAttribute("href");
      if (/\.apk(\?.*)?$/i.test(href)) return;
      if (el.dataset.apkGuardUrl === href) return;
      if (href.includes("play.google.com") || href.includes("chrome.google.com")) return;
      const lower = href.toLowerCase();
      if (!/download|apk|file/.test(lower)) return;
      try {
        const u = new URL(href, location.href).href;
        const fileName = (u.pathname.split("/").pop() || el.textContent.trim().slice(0, 60) || "download.apk").split("?")[0];
        const { score, reasons } = getHeuristic(u.href, fileName, location.hostname);
        out.push({ el, url: u.href, fileName, preScore: score, preReasons: reasons, level: riskLevel(score) });
      } catch { /* skip */ }
    });

    // 4) Download/redirect controls whose URL does not contain "apk".
    // Many sites use links such as /go/netmirror or JavaScript redirects.
    const intentNodes = document.querySelectorAll('a, button, [role="button"]');
    intentNodes.forEach((el, index) => {
      if (el.dataset.apkGuardDone || el.closest(".apk-guard")) return;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!/\b(download|download now|get apk|get app|install)\b/i.test(text)) return;
      const raw = el.getAttribute("href") || el.getAttribute("data-href") || el.getAttribute("data-url") || "";
      let target = "";
      try {
        if (raw && !/^javascript:|^#$/i.test(raw)) target = new URL(raw, location.href).href;
      } catch { target = ""; }
      if (out.some((item) => item.el === el || (target && item.url === target))) return;
      const fileName = `${text.slice(0, 42).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || `download-${index + 1}`}.apk`;
      const resolvedUrl = target || `${location.href}#apk-guard-target-${index}`;
      const { score, reasons } = getHeuristic(resolvedUrl, fileName, location.hostname);
      out.push({
        el,
        url: resolvedUrl,
        fileName,
        preScore: score,
        preReasons: target ? reasons : ["Download target is generated by this page; final APK URL is not exposed yet"],
        level: riskLevel(Math.max(score, target ? score : 25)),
        resolvable: Boolean(target),
        kind: "download-target",
      });
    });

    return out;
  }

  function collectPanelItems() {
    return [...document.querySelectorAll("[data-apk-guard-url]")].map((el) => {
      const url = el.dataset.apkGuardUrl;
      const fileName = el.dataset.apkGuardFile || "download.apk";
      const { score, reasons } = getHeuristic(url, fileName, location.hostname);
      const lv = riskLevel(score);
      return { url, fileName, score, level: lv, topReason: reasons[0] || "", status: chipCache.get(url) || "", resolvable: el.dataset.apkGuardResolvable !== "false", kind: el.dataset.apkGuardKind || "apk" };
    });
  }

  // ---------- Badge injection + auto page panel ----------
  function injectBadges() {
    const links = findApkLinks();
    links.forEach((item) => {
      const { el, url, fileName, preScore, preReasons, level } = item;
      el.dataset.apkGuardDone = "1";
      el.dataset.apkGuardUrl = url;
      el.dataset.apkGuardFile = fileName;
      el.dataset.apkGuardResolvable = item.resolvable === false ? "false" : "true";
      el.dataset.apkGuardKind = item.kind || "apk";

    });
    try {
      chrome.runtime.sendMessage({ type: "APK_COUNT", count: collectPanelItems().length });
    } catch {}
    refreshPanel();
    refreshPageBar();
    showPageToast();
  }

  function showPageToast() {
    if (pageToastShown) return;
    pageToastShown = true;
    const count = collectPanelItems().length;
    const label = count ? `${count} APK download target${count === 1 ? "" : "s"} found on ${location.hostname}` : `No APK links detected on ${location.hostname}`;
    ApkGuardUI.showToast("APK Guard", label, () => {
      chrome.runtime.sendMessage({ type: "OPEN_PANEL", tabId: null }).catch(() => {});
    });
  }

  function refreshPageBar() {
    document.querySelector(".apk-guard-page-bar")?.remove();
  }

  function refreshPanel() {
    document.querySelector(".apk-guard-panel")?.remove();
    document.querySelector(".apk-guard-fab")?.remove();
  }

  function verdictChip(data) {
    const v = (data.verdict || "?").toLowerCase();
    const label = v === "clean" ? "Clean" : v === "malicious" ? "Malicious" : v === "suspicious" ? "Suspicious" : "Unknown";
    return `${label} ${data.risk_score ?? "?"}`;
  }

  // ---------- Full scan via backend ----------
  async function fullScan(url, fileName, anchorEl) {
    const source = anchorEl?.dataset?.apkGuardResolvable;
    if (source === "false") {
      const card = ApkGuardUI.showLoadingCard(anchorEl, fileName);
      ApkGuardUI.renderVerdict(card, {
        verdict: "unknown",
        risk_score: null,
        summary: "This download button redirects or generates its APK URL dynamically. APK Guard cannot analyze the binary until the final APK URL is exposed.",
        reasons: ["The page did not expose a direct APK URL before the click."],
        recommendations: ["Use the download confirmation dialog.", "Use Upload APK after the file is downloaded, or paste the final APK URL."],
        source: "page-target-not-resolved",
        filename: fileName,
      });
      return;
    }
    const card = ApkGuardUI.showLoadingCard(anchorEl, fileName);
    const finish = (data) => {
      ApkGuardUI.renderVerdict(card, data);
      const chip = verdictChip(data);
      chipCache.set(url, chip);
      ApkGuardUI.updatePanelRow(url, chip);
    };
    try {
      const backend = await getBackendUrl();
      const res = await fetchWithTimeout(`${backend.replace(/\/$/, "")}/scan-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, filename: fileName, page_url: location.href }),
      }, 180000);
      if (!res.ok) throw new Error(`Backend ${res.status}`);
      finish({ ...(await res.json()), filename: fileName });
    } catch (err) {
      // Offline fallback: heuristic-only, no Gemma needed
      const { score, reasons } = getHeuristic(url, fileName, location.hostname);
      finish({
        verdict: score >= 60 ? "suspicious" : score >= 30 ? "unknown" : "clean",
        risk_score: score,
        summary: `Backend unreachable or timed‑out (${err.message}). Showing offline heuristic result only. Start backend: uvicorn main:app --reload`,
        reasons,
        recommendations: ["Start the backend for full androguard + Gemma analysis.", "Do not install from unofficial sites."],
        source: "offline-heuristic",
        filename: fileName,
      });
    }
  }

  // ---------- Scan-all: every APK on the page, riskiest card opens ----------
  async function scanAll() {
    const items = collectPanelItems();
    if (!items.length) return;
    const compliance = pageCompliance();
    let backend = BACKEND_DEFAULT;
    try { backend = (await getBackendUrl()).replace(/\/$/, ""); } catch {}
    let worst = null;
    for (const it of items) {
      if (!it.resolvable) {
        const unresolved = {
          verdict: "unknown",
          risk_score: null,
          summary: "This page controls the download through a redirect or script. The final APK URL was not exposed for binary analysis.",
          reasons: ["Download target is not a direct APK URL."],
          recommendations: ["Use the download confirmation dialog.", "Upload the downloaded APK or paste its final URL for a real scan."],
          source: "page-target-not-resolved",
          filename: it.fileName,
          url: it.url,
        };
        chipCache.set(it.url, "Target needs URL");
        ApkGuardUI.updatePanelRow(it.url, "Target needs URL");
        if (!worst) worst = unresolved;
        continue;
      }
      ApkGuardUI.updatePanelRow(it.url, '<span class="apk-guard-pulse">...</span>');
      try {
        const res = await fetchWithTimeout(`${backend}/scan-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: it.url, filename: it.fileName, page_url: location.href }),
        }, 180000);
        const data = { ...(await res.json()), filename: it.fileName };
        const chip = verdictChip(data);
        chipCache.set(it.url, chip);
        ApkGuardUI.updatePanelRow(it.url, chip);
        if (!worst || (data.risk_score ?? 0) > (worst.risk_score ?? 0)) worst = { ...data, url: it.url };
      } catch {
        const { score, reasons } = getHeuristic(it.url, it.fileName, location.hostname);
        const fb = { verdict: score >= 60 ? "suspicious" : "clean", risk_score: score, reasons, filename: it.fileName, url: it.url };
        const chip = verdictChip(fb);
        chipCache.set(it.url, chip);
        ApkGuardUI.updatePanelRow(it.url, chip);
        if (!worst || score > (worst.risk_score ?? 0)) worst = fb;
      }
    }
    if (worst) {
      const card = ApkGuardUI.showLoadingCard(anchorOf(worst.url), worst.filename || "result");
      ApkGuardUI.renderVerdict(card, worst);
    }
  }

  // ---------- Download-guard: intercept APK clicks -> Are-you-sure modal ----------
  function resolveApkTarget(node) {
    const t = node.closest ? node.closest("a[href], button, [data-apk], [data-download-url]") : null;
    if (!t) return null;
    if (t.dataset.apkGuardConfirmed) { delete t.dataset.apkGuardConfirmed; return null; }
    const href = t.getAttribute("href") || t.getAttribute("data-apk") || t.getAttribute("data-download-url") || t.dataset.apkGuardUrl || "";
    const text = (t.textContent || "").toLowerCase();
    const isApk = /\.apk(\?.*)?$/i.test(href) || /\.apk/i.test(text) || /\b(download|download now|get apk|get app)\b/i.test(text) || t.hasAttribute("data-apk") || !!t.dataset.apkGuardUrl;
    const isWebAppInstall = !isApk && /\binstall\b/i.test(text) && /\b(app|page|desktop|computer|home screen)\b/i.test(text);
    if (!isApk && !isWebAppInstall) return null;
    const url = t.dataset.apkGuardUrl || (href && !/^javascript:|^#$/i.test(href) ? (href.startsWith("http") ? href : new URL(href, location.href).href) : `${location.href}#apk-guard-click-target`);
    const fileName = isWebAppInstall ? "Website app install" : (t.dataset.apkGuardFile || url.split("/").pop() || t.textContent.trim().slice(0, 60) || "download.apk").split("?")[0];
    return { el: t, url, fileName, kind: isWebAppInstall ? "web-app-install" : "apk", resolvable: Boolean(href && !/^javascript:|^#$/i.test(href)) };
  }

  document.addEventListener("click", (e) => {
    try {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.target.closest && e.target.closest(".apk-guard-panel, .apk-guard-modal, .apk-guard-toast, .apk-guard-card, .apk-guard-fab, .apk-guard-wrap")) return;
      const hit = resolveApkTarget(e.target);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      const { score, reasons } = getHeuristic(hit.url, hit.fileName, location.hostname);
      if (!hit.resolvable) reasons.unshift("This button redirects or generates the final APK URL dynamically");
       ApkGuardUI.showConfirmModal(
         { fileName: hit.fileName, url: hit.url, kind: hit.kind, score, level: riskLevel(score), reasons },
         {
           onScan: () => hit.kind === "web-app-install"
             ? chrome.runtime.sendMessage({ type: "OPEN_PANEL", tabId: null }).catch(() => {})
             : fullScan(hit.url, hit.fileName, hit.el),
          onDownload: () => {
            hit.el.dataset.apkGuardConfirmed = "1";
            if (hit.el.tagName === "A" && hit.el.getAttribute("href")) hit.el.click();
            else if (hit.el.tagName === "A") window.location.assign(hit.url);
            else hit.el.click();
          },
          onCancel: () => {},
        }
      );
    } catch { /* never break the host page */ }
  }, true);

  // ---------- Messages from popup / background ----------
  function sendCount() {
    try { chrome.runtime.sendMessage({ type: "APK_COUNT", count: collectPanelItems().length }); } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_LINKS") {
      const links = collectPanelItems().map(({ url, fileName, score, level, resolvable, kind }) => ({ url, fileName, score, level, resolvable, kind }));
      sendResponse({ links: links.slice(0, 50), page: location.href, compliance: pageCompliance() });
      return true;
    }
    if (msg.type === "SCAN_URL") {
      fullScan(msg.url, msg.fileName || "download.apk", anchorOf(msg.url));
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "RENDER_VERDICT") {
      const card = ApkGuardUI.showLoadingCard(anchorOf(msg.data?.url || ""), msg.data?.filename || "upload.apk");
      ApkGuardUI.renderVerdict(card, msg.data);
      const chip = verdictChip(msg.data);
      if (msg.data?.url) { chipCache.set(msg.data.url, chip); ApkGuardUI.updatePanelRow(msg.data.url, chip); }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "SCAN_PROGRESS") {
      if (msg.status === "complete" && msg.data) {
        if (progressCard) progressCard.remove();
        progressCard = ApkGuardUI.showLoadingCard(document.body, msg.data.filename || "Current page");
        ApkGuardUI.renderVerdict(progressCard, msg.data);
      } else if (msg.status === "error") {
        if (!progressCard) progressCard = ApkGuardUI.showLoadingCard(document.body, "Current scan");
        ApkGuardUI.updateLoadingCard(progressCard, `Scan failed: ${msg.error || "Unknown error"}`);
      } else if (msg.detail) {
        if (!progressCard) progressCard = ApkGuardUI.showLoadingCard(document.body, "Current scan");
        ApkGuardUI.updateLoadingCard(progressCard, msg.detail);
      }
      return true;
    }
    if (msg.type === "REFRESH_APK_COUNT") {
      sendCount();
      return true;
    }
  });

  // ---------- Boot + watch for dynamic pages ----------
  injectBadges();
  const obs = new MutationObserver(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => injectBadges(), 120);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  sendCount();
})();
