# Run Gemma 4 LOCALLY and connect it to APK Guard (still Gemma-only)

The backend tries Gemma in this order: **local** (Ollama `gemma4:*`) →
**cloud** (`GEMINI_API_KEY` set, only if `GEMMA_MODE=auto|cloud`) →
labelled rule fallback. Default is **local-only**, so you stay fully on Gemma 4.

## Step 1 — install Ollama (Windows)

1. Download from https://ollama.com/download → install **Ollama for Windows**.
2. It auto-starts on `http://localhost:11434` (check the tray icon).

## Step 2 — download the smallest Gemma 4 (~4.3 GB)

```powershell
ollama pull gemma4:e2b-it-qat
```

| Ollama tag | Download | RAM needed | Notes |
|---|---|---|---|
| `gemma4:e2b-it-qat` | **~4.3 GB** | ~8 GB | **default — smallest, does text+vision** |
| `gemma4:e4b-it-qat` | ~6.1 GB | ~8–12 GB | better quality, still small |
| `gemma4:12b-it-qat` | ~7.2 GB | ~16 GB | best balance if you have RAM |

All are Gemma 4 with 128K context and image input (screenshots work even on E2B).
Avoid bare `gemma4` (Ollama can repoint it) and `:cloud` (that's hosted, not local).

## Step 3 — run the backend (local is now the default)

```powershell
cd apk-guard\backend
pip install -r requirements.txt
uvicorn main:app --reload
```

No env vars needed — defaults are `GEMMA_MODE=local`,
`GEMMA_LOCAL_MODEL=gemma4:e2b-it-qat`. Verify:
open http://localhost:8000/health → `"mode": "local"`.

To use a bigger local tag instead:

```powershell
$env:GEMMA_LOCAL_MODEL="gemma4:e4b-it-qat"
uvicorn main:app --reload
```

## Step 4 — connect the extension (it just needs the backend URL)

The extension never talks to Ollama directly — flow is
`extension → backend (localhost:8000) → Ollama (localhost:11434)`.
In the popup footer, keep backend URL `http://localhost:8000`.
Scan once → card footer should read `source: gemma-local`
(📸 scans: `gemma-local-vision`) with `model: gemma4:e2b-it-qat`.

## Switching to cloud Gemma 4 (judged demo)

The challenge brief wants Gemma 4 **through the Gemini API**, so for judging use:

```powershell
$env:GEMMA_MODE="cloud"
$env:GEMINI_API_KEY="your_key_from_aistudio_google_com"
uvicorn main:app --reload
```

Cards then show `source: gemma-4 / gemma-4-vision`, `model: gemma-4-26b-a4b-it`.

## Troubleshooting

- `Local Gemma call failed` in backend logs → Ollama not running or tag missing:
  `ollama list` must show `gemma4:e2b-it-qat`. Run `ollama serve` / re-pull.
- Slow first scan (~1–2 min) → model loading into memory; later scans are faster.
- Disk full → `ollama rm <other-models>`; E2B is only 4.3 GB.
- Card shows `rule-based (offline fallback)` → Ollama unreachable and no cloud
  key. Fix Ollama; the card tells you which.
