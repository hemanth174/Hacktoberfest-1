# APK Guard — Scan Before You Install 🛡️

## Team / attendee

- Team name (if applicable): _fill in_
- Members and GitHub usernames: _fill in_

## Challenge

- [x] Best Use of Gemma 4
- [ ] Best Open-Source AI Project

## Project links

- Public GitHub repository: _fill in after you push `apk-guard/`_
- Open-source license: [LICENSE](./LICENSE) (MIT)

## Problem and solution

**Who:** anyone downloading Android APKs outside the Play Store.
**Problem:** the moment of risk is a shady download page — users can't tell
`whatsapp-plus.apk` from malware asking for SMS + Accessibility.
**Workflow:** browsing → extension spots APK links → inline risk badge →
click **Scan** (or paste URL / upload APK / 📸 visual page scan) →
`androguard findings + page screenshot → Gemma 4 → verdict card`
injected on the page (🔴 dangerous perms · 👁️ visual flags · 🟢 clean).

## Approach and technologies

- **Extension (MV3, `extension/`):** `content.js` (APK detection + offline
  heuristics + auto-toast), `report-ui.js` (verdict card), `popup.html/js`
  (This page / Paste URL / Upload APK / 📸 visual scan via
  `chrome.tabs.captureVisibleTab`), `background.js` (context menu + badge).
- **Backend (`backend/`):** FastAPI → `analyzer.py` (androguard static
  analysis: permissions taxonomy, deadly combos, brand-impersonation check) →
  `llm_triage.py` (**Gemma 4 ONLY** via Gemini API, `google-genai` SDK) →
  report JSON. Multimodal endpoint `POST /scan-with-screenshot` sends
  **screenshot + findings** to Gemma 4 vision.
- **Why Gemma 4:** open-weight, multimodal (page screenshot + findings in one
  call), JSON mode, generous free tier via AI Studio — ideal for a 120-min build.
- Reused: androguard, FastAPI, `google-genai`. Dummy APK builder in
  `samples/` is original test tooling.

## Challenge evidence

### Best Use of Gemma 4

- **Model + integration:** `gemma-4-26b-a4b-it` (override via `GEMMA_MODEL`
  env; alt `gemma-4-31b-it`) through the Gemini API with the `google-genai`
  SDK — see `backend/llm_triage.py::_gemma_generate` and
  `triage_with_screenshot()`. Key from `GEMINI_API_KEY` (see
  `backend/.env.example`; never committed).
- **Code link:** `backend/main.py::scan_with_screenshot` →
  `llm_triage.triage_with_screenshot()` → verdict JSON → `report-ui.js`.
- **Input → output; multimodal value:** input = download-page screenshot +
  androguard findings; output = verdict card with *"What Gemma sees on this
  page"* (fake buttons, typos, lookalike domains) fused with static signals.
  Pure-text analysis can't catch visual deception — that's the multimodal win,
  visible in the first 30 s of the demo.

## Current status

- **Works:** APK detection + badges + auto-toast; paste-URL / upload / visual
  scan; androguard + rule fallback verified (`whatsapp-plus.apk`→malicious 100,
  `flashlight-free.apk`→clean); offline fallback when no API key.
- **Limitations:** needs `GEMINI_API_KEY` for live Gemma verdicts; visual scan
  blocked on `chrome://`/Web Store pages (use Paste URL there); dummy APKs are
  plain-zip manifests (real APKs exercise the androguard path).
- **Next:** signer/certificate pinning vs Play, VT-style URL reputation cache.

## Submission checklist

- [ ] Repository is public and links work.
- [ ] Required challenge evidence is included (above).
- [ ] Open-source license present ([LICENSE](./LICENSE)).
- [ ] Work and reused materials represented honestly.
- [ ] No API keys/tokens/passwords committed (`.env.example` only).
- [ ] Followed the 120-min build window and submission instructions.

## Quick start

```powershell
cd apk-guard\backend
pip install -r requirements.txt
$env:GEMINI_API_KEY="your_key_from_aistudio_google_com"  # required for live Gemma
uvicorn main:app --reload          # GET /health shows model + key status
cd ..\samples; python make_dummy_apks.py; python -m http.server 8080 -d .
# chrome://extensions -> Developer mode -> Load unpacked -> apk-guard\extension
# open docs\demo-page.html -> badges + auto-toast -> Scan / 📸 visual scan
```

## Repo layout (mirrors NIAT hub conventions)

```text
apk-guard/
├── LICENSE                 <- open-source license (checklist)
├── README.md                 <- this file (submission-shaped)
├── submissions/apk-guard.md  <- copy into your fork's submissions/ for the PR
├── extension/  manifest.json, content.js, report-ui.js, popup.html/js, background.js, styles.css
├── backend/    main.py, analyzer.py, llm_triage.py (Gemma-only), requirements.txt, .env.example
├── samples/    make_dummy_apks.py + 3 test APKs
└── docs/demo-page.html + DEMO.md (2-min demo script + fallback)
```
