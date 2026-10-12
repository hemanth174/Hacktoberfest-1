# DEMO script (under 2 minutes) — APK Guard + Gemma 4

Seeded setup (do BEFORE the clock-critical part):
1. `cd backend; uvicorn main:app --reload` → open `/health`, show
   `"model": "gemma-4-26b-a4b-it", "gemma_configured": true`.
2. `cd samples; python -m http.server 8080 -d .`
3. Load unpacked `extension/`; open `docs/demo-page.html`.

Live (0:00–1:45):
- 0:00–0:15 — one sentence: "APK Guard scans shady APK downloads before you install."
  Point at badges + auto-toast on the nasty link (offline heuristics, no API needed).
- 0:15–0:50 — click **Scan** on `whatsapp-plus.apk` → card appears:
  🔴 SMS + Accessibility, impersonation note. Say "androguard findings → Gemma 4".
- 0:50–1:20 — **multimodal moment:** click popup → 📸 *Visual page scan* →
  card gains *"What Gemma sees on this page"* (fake button / typo domain).
  This is the Gemma-4-vision payoff — show input screenshot, then result.
- 1:20–1:45 — click Scan on `flashlight-free.apk` → 🟢 clean contrast. Done.

Fallbacks (have ready):
- No API key / network → card says `rule-based (offline fallback…)`; still
  shows malicious/clean split from local analysis. State this honestly.
- `chrome://` screenshot block → use Paste-URL tab.
- Backend down → content.js heuristic verdict still renders.
