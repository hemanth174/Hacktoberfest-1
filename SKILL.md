# APK Triage Skill (Agent Skill Open Standard) — Gemma 4 edition

Reusable pipeline: raw androguard findings (+ optional page screenshot) ->
Gemma 4 via Gemini API -> verdict JSON. Invoked by the backend and demoable standalone.

## Skill files

- `backend/analyzer.py` — `analyze_apk()` produces `findings` (permissions,
  combos, impersonation, url_flags, risk_score, sha256).
- `backend/llm_triage.py` — `GEMMA_MODEL` (`gemma-4-26b-a4b-it`),
  `triage(findings)`, `triage_with_screenshot(findings, png_bytes, page_url)`.

## Input schema (findings)

```json
{ "package": "com.evil.wpp", "permissions": ["android.permission.READ_SMS"],
  "dangerous_hits": [{"perm": "...", "weight": 25}], "combo_flags": ["..."],
  "impersonation": ["..."], "url_flags": ["..."], "risk_score": 85 }
```

Plus optional PNG screenshot bytes for the multimodal variant.

## Output schema (report)

```json
{ "verdict": "malicious|suspicious|clean|unknown", "risk_score": 0-100,
  "summary": "<=3 sentences", "reasons": [...], "recommendations": [...],
  "visual_flags": ["..."], "model": "gemma-4-26b-a4b-it", "source": "gemma-4-vision" }
```

## Invocation (Python)

```python
from analyzer import analyze_apk
from llm_triage import triage, triage_with_screenshot
report = triage(analyze_apk("app.apk", {"filename": "whatsapp-plus.apk"}))
report = triage_with_screenshot(findings, open("page.png","rb").read(), "http://site/")
```

## Invocation (HTTP, what the extension uses)

```text
POST /scan-url               {"url","filename","page_url"} -> report JSON (Gemma text)
POST /scan-file              multipart file -> report JSON (Gemma text)
POST /scan-with-screenshot   multipart: file? + screenshot_b64 + url/filename/page_url
                             -> report JSON (Gemma 4 vision, with visual_flags)
GET  /health                 -> {"model": "gemma-4-26b-a4b-it", "gemma_configured": bool}
```

## Compliance notes

- Single model family (Gemma 4, open-weight) via the Gemini API; model string is
  one constant (`GEMMA_MODEL`), explainable in demo.
- Deterministic offline fallback keeps the skill usable without a key, always
  labelled `rule-based (offline fallback…)` — never mistaken for the AI result.
- No secrets in repo (`.env.example` only); no PII beyond the analysed page/APK.
