# APK Guard — Scan Before You Install

## Team / attendee

- Team name (if applicable):
- Members and GitHub usernames:
- Profile links (optional):

## Challenge

- [x] Best Use of Gemma 4
- [ ] Best Open-Source AI Project

## Project links

- Public GitHub repository:
- Open-source license (link to the license file): [LICENSE](../LICENSE)

## Problem and solution

Users get tricked on unofficial APK download pages. APK Guard (Chrome MV3
extension + FastAPI backend) spots APK links at the moment of risk, shows
inline badges, and on Scan sends androguard findings plus a page screenshot to
Gemma 4, injecting a plain-English verdict card (dangerous perms, impersonation,
visual deception flags) right on the page.

## Approach and technologies

MV3 extension (detection/badges/popup/visual capture) + FastAPI backend
(androguard `analyzer.py` → Gemma 4 `llm_triage.py` via `google-genai` SDK,
model `gemma-4-26b-a4b-it`). Multimodal endpoint `/scan-with-screenshot`.
Credit: androguard, FastAPI, google-genai; rest original.

## Challenge evidence

### Best Use of Gemma 4

- Gemma 4 model identifier and Gemini API integration: `gemma-4-26b-a4b-it`
  (env `GEMMA_MODEL`) via `google-genai` in `backend/llm_triage.py::_gemma_generate`.
- Code link showing the integration: `backend/main.py::scan_with_screenshot` →
  `llm_triage.triage_with_screenshot()` → card in `extension/report-ui.js`.
- Input and useful output; multimodal value: screenshot + findings → verdict
  with `visual_flags` (fake buttons/typos/lookalike domains) fused with static
  analysis. Demo: open `docs/demo-page.html`, click 📸 visual scan, verdict in ~30 s.

## Current status

- What works: detection/badges/toast, paste-URL/upload/visual scan, offline fallback.
- Known limitations: needs GEMINI_API_KEY for live Gemma; screenshot blocked on chrome:// pages.
- What you would improve next: cert pinning, reputation cache.

## Submission checklist

- [ ] Project repository is public and links work.
- [ ] Required challenge evidence is included.
- [ ] Project uses an open-source license where required by the challenge.
- [ ] Work and reused materials are represented honestly.
- [ ] No API keys, tokens, passwords, or private data are included.
- [ ] I followed the organizers' build window and submission instructions.
