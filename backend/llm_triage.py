"""APK Guard LLM triage — Gemma ONLY (Best Use of Gemma 4 challenge).

Model: Gemma 4 via the Gemini API (default: gemma-4-26b-a4b-it).
Integration: google-genai SDK (pip install google-genai), key from
GEMINI_API_KEY env var (get one at https://aistudio.google.com).

Two triage modes:
  triage(findings)                    -> text-only (androguard findings -> report)
  triage_with_screenshot(findings, png_bytes, page_url)
                                      -> MULTIMODAL (findings + download-page
                                         screenshot -> report with visual flags)

A deterministic rule-based fallback exists ONLY so the 2-min demo survives
without network/API key. It is never presented as the AI result: reports are
tagged source="gemma-4" vs source="rule-based (offline fallback, no API key)".
"""
import base64
import json
import os

# Load backend/.env if present (so GEMINI_API_KEY / GEMMA_* persist across
# terminals — copy .env.example to .env first). Silently skipped if
# python-dotenv is not installed.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:
    pass

# ---- Challenge evidence: model identifier (single source of truth) ----
# Cloud (challenge path): Gemma 4 via Gemini API. Local (offline path): Gemma
# via Ollama — still 100% Gemma 4 (e.g. gemma4:e2b-it-qat, ~4.3GB), no other vendors.
GEMMA_MODEL = os.environ.get("GEMMA_MODEL", "gemma-4-26b-a4b-it")
GEMMA_MODE = os.environ.get("GEMMA_MODE", "local").lower()  # local | cloud | auto
GEMMA_LOCAL_MODEL = os.environ.get("GEMMA_LOCAL_MODEL", "gemma4:e2b-it-qat")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

TRIAGE_PROMPT = """You are APK Guard, an Android-malware triage assistant powered by Gemma.
Given static-analysis findings (permissions, combos, impersonation, URL flags),
produce a plain-English risk report for a NON-TECHNICAL user.

Rules:
- Lead with the verdict: CLEAN / SUSPICIOUS / MALICIOUS and a 0-100 risk score.
- Call out deadly combos explicitly (e.g. SMS + Accessibility = OTP theft).
- Flag brand impersonation (filename says WhatsApp but package differs).
- Keep summary <= 3 sentences. Reasons = short bullets. Recommendations = actions.
- Reply ONLY as JSON: {"verdict": "...", "risk_score": 0-100, "summary": "...",
  "reasons": [...], "recommendations": [...]}
"""

VISION_PROMPT = """You are APK Guard (Gemma multimodal). You get TWO inputs:
1) a SCREENSHOT of the page offering an APK download, 2) static-analysis findings JSON.
Look at the screenshot for visual trust signals: fake download buttons, countdown
timers, brand-logo misuse / typos (e.g. "Whatsaap"), lookalike domains, HTTP badges,
excessive ads, permission screenshots asking for SMS/Accessibility.

Combine visual + static signals into one verdict. Reply ONLY as JSON:
{"verdict": "clean|suspicious|malicious", "risk_score": 0-100,
 "summary": "<=3 sentences", "reasons": [...], "recommendations": [...],
 "visual_flags": ["..."]}
"""


def _gemma_generate(system_text: str, user_parts: list) -> dict | None:
    """Call Gemma 4 through the Gemini API. Returns parsed JSON dict or None."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai  # google-genai SDK
        from google.genai import types

        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=GEMMA_MODEL,
            contents=[{"role": "user", "parts": user_parts}],
            config=types.GenerateContentConfig(
                system_instruction=system_text,
                response_mime_type="application/json",
            ),
        )
        text = (resp.text or "").strip()
        # strip accidental code fences
        if text.startswith("```"):
            text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(text)
    except Exception as e:
        print(f"[apk-guard] Gemma call failed: {e}")
        return None


def _local_gemma_generate(system_text: str, prompt_text: str, image_b64: str | None = None) -> dict | None:
    """Local Gemma 4 via Ollama (gemma4 tags only — smallest is e2b-it-qat, ~4.3GB).

    Requires: `ollama serve` + `ollama pull gemma4:e2b-it-qat` (see docs/LOCAL_GEMMA.md).
    E2B/E4B/12B all do vision (screenshots); E2B is the lightest.
    """
    import urllib.request
    try:
        user_msg: dict = {"role": "user", "content": prompt_text}
        if image_b64:
            user_msg["images"] = [image_b64]
        body = json.dumps({
            "model": GEMMA_LOCAL_MODEL,
            "messages": [{"role": "system", "content": system_text}, user_msg],
            "stream": False,
            "format": "json",
            # Structured security reports need a prompt answer, not an
            # unbounded hidden reasoning trace. Progress is shown by the API
            # stages in main.py instead.
            "think": False,
            "keep_alive": "10m",
            "options": {"temperature": 0.1, "num_predict": 256, "num_ctx": 4096},
        }).encode()
        req = urllib.request.Request(OLLAMA_HOST.rstrip("/") + "/api/chat",
                                     data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read().decode())
        return json.loads(out["message"]["content"])
    except Exception as e:
        print(f"[apk-guard] Local Gemma call failed: {e}")
        return None


def _use_cloud() -> bool:
    return GEMMA_MODE in ("auto", "cloud") and bool(os.environ.get("GEMINI_API_KEY"))


def _use_local() -> bool:
    return GEMMA_MODE in ("auto", "local")


def _rule_fallback(findings: dict) -> dict:
    s = findings.get("risk_score", 0)
    verdict = "malicious" if s >= 70 else "suspicious" if s >= 35 else "clean"
    reasons = [f"Dangerous permission: {h['perm']}" for h in findings.get("dangerous_hits", [])]
    reasons += findings.get("combo_flags", []) + findings.get("impersonation", []) + findings.get("url_flags", [])
    if not reasons:
        reasons = ["No dangerous permissions or impersonation signals found."]
    summary = {
        "malicious": "This APK shows strong malware signals. Do not install it.",
        "suspicious": "This APK shows suspicious signals. Avoid installing unless from the official store.",
        "clean": "No major red flags in static analysis. Still prefer the Play Store.",
    }[verdict]
    return {
        "verdict": verdict, "risk_score": s, "summary": summary, "reasons": reasons,
        "recommendations": [
            "Install only from Google Play or the developer's official site.",
            "If already installed: uninstall, revoke SMS/Accessibility permissions, run Play Protect.",
        ],
    }


def _finalize(out: dict, findings: dict, source: str, model: str | None = None) -> dict:
    out["verdict"] = str(out.get("verdict", "unknown")).lower()
    out.setdefault("risk_score", findings.get("risk_score", 50))
    out.setdefault("reasons", [])
    out.setdefault("recommendations", [])
    out["source"] = source
    out["model"] = model or GEMMA_MODEL
    out["engine"] = findings.get("engine")
    out["sha256"] = findings.get("sha256")
    out["package"] = findings.get("package")
    return out


def triage(findings: dict) -> dict:
    """Text-only: androguard findings -> Gemma (cloud, else local) -> report JSON."""
    if _use_cloud():
        out = _gemma_generate(TRIAGE_PROMPT, [{"text": json.dumps(findings)[:8000]}])
        if out and isinstance(out, dict) and "verdict" in out:
            return _finalize(out, findings, source="gemma-4")
    if _use_local():
        out = _local_gemma_generate(TRIAGE_PROMPT, json.dumps(findings)[:8000])
        if out and isinstance(out, dict) and "verdict" in out:
            return _finalize(out, findings, source="gemma-local", model=GEMMA_LOCAL_MODEL)
    return _finalize(_rule_fallback(findings), findings,
                     source="rule-based (offline fallback — no Gemma reachable)")


def triage_with_screenshot(findings: dict, png_bytes: bytes, page_url: str = "") -> dict:
    """Multimodal: findings + page screenshot -> Gemma vision -> report JSON."""
    b64 = base64.b64encode(png_bytes).decode()
    if _use_cloud():
        parts = [
            {"inline_data": {"mime_type": "image/png", "data": b64}},
            {"text": f"Page URL: {page_url}\nStatic findings:\n{json.dumps(findings)[:8000]}"},
        ]
        out = _gemma_generate(VISION_PROMPT, parts)
        if out and isinstance(out, dict) and "verdict" in out:
            return _finalize(out, findings, source="gemma-4-vision")
    if _use_local():
        out = _local_gemma_generate(
            VISION_PROMPT,
            f"Page URL: {page_url}\nStatic findings:\n{json.dumps(findings)[:8000]}",
            image_b64=b64)
        if out and isinstance(out, dict) and "verdict" in out:
            return _finalize(out, findings, source="gemma-local-vision", model=GEMMA_LOCAL_MODEL)
    fb = _rule_fallback(findings)
    fb["visual_flags"] = ["Screenshot could not be analysed (no Gemma reachable)."]
    return _finalize(fb, findings,
                     source="rule-based (offline fallback — no Gemma reachable)")
