# Contributing and submitting

APK Guard is an open-source Chrome Manifest V3 extension and local FastAPI
service for assessing APK download pages and APK files before installation.
Contributions should preserve the project's evidence-based behavior: security
findings must come from deterministic analysis or an explicitly labelled Gemma
result. Do not add fabricated verdicts, scores, permissions, or evidence.

## Project submissions

For a challenge or project submission, keep the implementation in its own
public repository and use `submissions/apk-guard.md` for the submission-shaped
summary. Update the same submission file when project links, team details, or
challenge evidence change. Do not place API keys, private contact details, or
credentials in the submission document.

If this project is submitted through an external event platform, follow that
platform's deadline and eligibility rules in addition to this repository's
contribution process. A merged pull request or accepted documentation change
does not by itself guarantee event eligibility or an award.

## Project scope

APK Guard has two cooperating parts:

- `extension/` contains the Chrome extension, Side Panel interface, content
  script, background service worker, report UI, and local scan history.
- `backend/` contains the FastAPI service, APK analysis pipeline, and Gemma 4
  triage integration.
- `samples/` contains demo APK fixtures and the fixture generator.
- `docs/` contains local Gemma setup and the short demonstration guide.
- `submissions/` contains the challenge-oriented project submission document.

The extension supports three scan paths:

1. **This Page** detects APK links and download targets on the active website.
2. **Paste URL** sends a direct APK URL to the backend for download and
   analysis.
3. **Upload APK** sends a user-selected APK to the backend without installing
   or executing it.

The page scan can also capture the visible page and send the screenshot to
Gemma 4 Vision when the user requests a visual scan or automatic page scanning
is enabled. Screenshot analysis is advisory and must not be presented as proof
that a website is safe or malicious.

## Local development setup

### Prerequisites

- Windows, macOS, or Linux.
- Python 3.10 or newer.
- Google Chrome or another Chromium browser with Chrome Side Panel support.
- Git, if working from a fork.
- Optional: Ollama for local Gemma 4 inference.
- Optional: a Gemini API key for cloud Gemma 4 inference.

### Clone and enter the project

```powershell
git clone https://github.com/<account>/<repository>.git
cd apk-guard
```

Replace the repository URL with the project's actual public URL when it is
available. Do not commit API keys, tokens, private APKs, or personal data.

### Install the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

On macOS or Linux, activate the environment with:

```bash
source .venv/bin/activate
```

### Configure Gemma

The default backend mode is local Gemma through Ollama. Copy the example file
and adjust it only on your machine:

```powershell
Copy-Item .env.example .env
```

Install Ollama, start its service, and download the default model:

```powershell
ollama pull gemma4:e2b-it-qat
```

The default configuration is:

```text
GEMMA_MODE=local
GEMMA_LOCAL_MODEL=gemma4:e2b-it-qat
OLLAMA_HOST=http://localhost:11434
```

For cloud Gemma 4, use a local `.env` containing a valid key:

```text
GEMMA_MODE=cloud
GEMINI_API_KEY=<your-key>
GEMMA_MODEL=gemma-4-26b-a4b-it
```

Never place the real key in source files, screenshots, issues, pull requests,
or browser extension settings. See `docs/LOCAL_GEMMA.md` for model sizes,
troubleshooting, and the local-to-cloud configuration differences.

### Start the backend

From `backend/`:

```powershell
uvicorn main:app --reload
```

Verify the service:

```powershell
Invoke-WebRequest http://localhost:8000/health
```

Open `http://localhost:8000/health` in a browser if preferred. The response
reports the configured Gemma mode, model, and whether a cloud API key is
available. A configured key does not prove that a request will succeed; the
backend still reports the actual source used by each result.

### Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension/` directory.
5. Click the APK Guard toolbar icon.

The toolbar opens the Side Panel as the single extension surface. The active
page is loaded there and, when automatic scanning is enabled, the page review
starts without opening a second popup. After changing extension files, select
**Reload** on the extension card.

The extension's backend URL defaults to `http://localhost:8000`. The value is
controlled by the extension settings and is not a substitute for an API key.

## Repository layout

```text
apk-guard/
├── CONTRIBUTING.md              <- this development and contribution guide
├── LICENSE                      <- MIT license
├── README.md                    <- project overview and challenge summary
├── submissions/apk-guard.md     <- challenge submission document
├── backend/
│   ├── main.py                  <- FastAPI application and HTTP endpoints
│   ├── analyzer.py              <- static APK analysis and risk signals
│   ├── llm_triage.py            <- local/cloud Gemma and labelled fallback
│   ├── requirements.txt         <- Python dependencies
│   └── .env.example             <- safe configuration template
├── extension/
│   ├── manifest.json            <- MV3 permissions and Side Panel entrypoint
│   ├── popup.html               <- Side Panel document and report markup
│   ├── popup.js                 <- tab flows, jobs, history, and reports
│   ├── background.js            <- service worker and persistent scan jobs
│   ├── content.js               <- page detection and content-script bridge
│   ├── report-ui.js              <- injected toast and verdict rendering
│   ├── styles.css               <- injected page UI styles
│   └── options.html/js           <- extension settings
├── samples/
│   ├── make_dummy_apks.py       <- test fixture generator
│   └── *.apk                    <- demo fixtures; never install them
└── docs/
    ├── LOCAL_GEMMA.md           <- Ollama and cloud Gemma setup
    ├── DEMO.md                  <- short demonstration script
    └── demo-page.html           <- local page for detection testing
```

## Architecture and data flow

### Website detection

`content.js` runs on ordinary web pages declared by the extension content-script
match pattern. It inspects links, buttons, download attributes, and relevant
script or redirect targets for APK-like URLs. It applies deterministic,
pre-scan signals such as:

- APK filename and extension detection.
- Mod, crack, premium, or unlocked naming indicators.
- Brand-looking filenames and domains.
- Non-HTTPS links.
- IP-address download hosts.
- Selected uncommon or risky free top-level domains.
- Whether the site exposes a final APK URL or hides it behind a redirect or
  script.

These signals are warnings, not malware proof. A page can be suspicious while
the APK itself has not been downloaded or analyzed.

### Extension scan flow

The normal flow is:

```text
Chrome toolbar
  -> Side Panel (popup.html / popup.js)
  -> background service worker
  -> local FastAPI backend
  -> APK analyzer and Gemma triage
  -> SCAN_PROGRESS message
  -> Side Panel report and optional page toast
```

The service worker owns long-running scan jobs so closing or changing focus from
the Side Panel does not cancel a request. Each job receives a generated scan ID
and publishes queued, running, complete, or error progress messages. Completed
reports are stored in `chrome.storage.local` for recent history.

### Backend scan flow

The backend uses this sequence for APK input:

1. Download or receive the APK into a temporary directory.
2. Analyze it with Androguard when available.
3. Fall back to best-effort ZIP and plain-text manifest parsing if Androguard
   cannot parse the fixture.
4. Calculate a SHA-256 hash.
5. Extract package name, application label, permissions, certificate hint,
   URL context, dangerous permission hits, combination flags, and possible
   brand impersonation.
6. Pass the findings to Gemma 4 text triage, local Gemma, or the explicitly
   labelled deterministic fallback according to configuration.
7. Return a JSON report containing the source and model used.
8. Delete the temporary directory in a `finally` block.

### Gemma responsibilities

Gemma explains and combines supplied evidence. It is not the source of
deterministic permissions, hashes, package metadata, or URL facts. The prompts
request JSON with a verdict, risk score, summary, reasons, and recommended
actions. Vision mode additionally returns `visual_flags`.

Reports identify their source, for example:

- `gemma-local`
- `gemma-local-vision`
- `gemma-4`
- `gemma-4-vision`
- `rule-based (offline fallback — no Gemma reachable)`

Contributors must keep this distinction visible. Do not rename a fallback to a
Gemma source or imply that screenshot appearance alone proves maliciousness.

## Backend API

### `GET /health`

Returns service and model configuration information.

Example response shape:

```json
{
  "ok": true,
  "service": "apk-guard",
  "model": "gemma-4-26b-a4b-it",
  "mode": "local",
  "local_model": "gemma4:e2b-it-qat",
  "gemma_configured": false
}
```

### `POST /scan-url`

Accepts JSON containing:

```json
{
  "url": "https://example.test/app.apk",
  "filename": "app.apk",
  "page_url": "https://example.test/downloads"
}
```

The backend follows redirects, downloads the response, analyzes the temporary
file, and returns a report. A download or analyzer exception returns an
`unknown` report with an error source and recommendations instead of claiming
that the file is safe.

### `POST /scan-file`

Accepts a multipart field named `file`. The backend reads the uploaded file to a
temporary path, performs static analysis, returns the report, and removes the
temporary data. Uploaded APKs are never installed or executed.

### `POST /scan-with-screenshot`

Accepts multipart form fields:

- `screenshot_b64`: PNG data URL or base64 image data.
- `url`: optional APK URL.
- `filename`: optional APK filename.
- `page_url`: page where the APK offer was found.
- `file`: optional APK upload.

This endpoint supports APK plus screenshot analysis and screenshot-only page
review. When there is no APK, the report must be understood as a page-level
review, not binary APK verification. Chrome may refuse screenshot capture on
`chrome://` pages, the Chrome Web Store, or other protected contexts.

## Report contract

The report is JSON and may contain the following fields:

```json
{
  "verdict": "clean|suspicious|malicious|unknown",
  "risk_score": 0,
  "summary": "Plain-language explanation",
  "reasons": ["Evidence-backed finding"],
  "recommendations": ["Recommended action"],
  "visual_flags": ["Optional screenshot observation"],
  "source": "gemma-local",
  "model": "gemma4:e2b-it-qat",
  "engine": "androguard",
  "sha256": "optional hash",
  "package": "optional package name",
  "filename": "app.apk",
  "page_url": "optional source page"
}
```

Missing fields must be displayed as `Not available`, `Not checked`, or
`Unable to verify`, depending on why the value is absent. Do not convert a
missing field into a positive security claim.

## Deterministic analysis signals

`backend/analyzer.py` currently assigns weighted signals to selected dangerous
permissions. It also checks combinations that deserve additional attention,
including:

- SMS access combined with Accessibility Service access.
- Sending SMS combined with reading contacts.
- Package installation combined with overlay capability.
- Device administration combined with camera access.

The analyzer checks known brand/package mismatches for WhatsApp, TikTok,
Instagram, Telegram, and Facebook. It also considers IP-based download hosts,
selected risky free TLDs, and mod/crack filename terms. These are triage
signals only. HTTPS, a low score, a permission by itself, or a visual match is
not proof of safety or maliciousness.

If changing weights or thresholds:

1. Explain the security rationale in the pull request.
2. Add or update a fixture-based test case.
3. Keep the raw evidence in the report.
4. Confirm that the user-facing wording does not overstate certainty.

## Testing and verification

### Static checks

Run JavaScript syntax checks from the repository root:

```powershell
node --check extension\background.js
node --check extension\content.js
node --check extension\popup.js
node --check extension\report-ui.js
node --check extension\options.js
```

Validate the manifest:

```powershell
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest ok')"
```

Compile-check the Python backend:

```powershell
python -m compileall backend
```

### Manual extension checks

Before opening a pull request, verify the following in a clean browser profile
or test profile:

- Toolbar click opens only the Side Panel, not a second popup.
- Side Panel shows the active hostname and starts the configured page scan.
- Switching tabs refreshes the active page context and does not retain the
  previous site's report as the current site.
- A normal page with APK links shows the expected files and deterministic
  pre-scan signals.
- A page without APK links clearly says no APK was detected and labels a
  screenshot-only result as a page review.
- `chrome://` and Chrome Web Store pages show an unsupported or inaccessible
  state instead of failing silently.
- Paste URL follows the URL scan path and displays redirect/download errors.
- Upload APK accepts a valid APK, shows progress, and displays its filename,
  hash, metadata, and report source when available.
- Closing or changing focus does not cancel a background scan.
- Recent history associates page-only scans with their hostname and APK scans
  with their filename.
- The injected page toast can be closed and does not block page interaction.
- A failed backend, timeout, unavailable Ollama service, and unavailable cloud
  key are shown as failures or labelled fallback results.
- The report view opens the selected result and does not mix page and APK data.

### Fixture checks

The `samples/` directory contains fixtures used for demonstrations. Generate
them when needed:

```powershell
python samples\make_dummy_apks.py
```

Serve the sample directory for URL testing:

```powershell
python -m http.server 8080 -d samples
```

The sample files are test inputs. Do not install them on a personal device.
Their results should be interpreted according to the analyzer engine and
report source, especially when a fixture contains a plain-text manifest rather
than a complete production APK structure.

## Making changes

### Branches

Create a focused branch from the current default branch:

```powershell
git switch -c feature/short-description
```

Use `fix/`, `docs/`, `test/`, or `refactor/` when those prefixes better describe
the work. Keep unrelated formatting or generated files out of the branch.

### Extension changes

- Preserve Manifest V3 compatibility.
- Request the smallest set of Chrome permissions needed for the feature.
- Keep long-running work in `background.js` rather than relying on the action
  popup lifetime.
- Keep the Side Panel as the single toolbar surface.
- Escape untrusted page text before inserting it into HTML.
- Do not inject UI into Chrome internal pages or the Chrome Web Store.
- Ensure dismiss and collapse state does not repeatedly interrupt a user.
- Keep page scans, URL scans, and file scans distinguishable in reports and
  history.

### Backend changes

- Keep temporary files inside a managed temporary directory.
- Delete temporary files in success and error paths.
- Do not execute, install, or emulate an APK.
- Preserve the report source and model fields.
- Return explicit `unknown` or error information when analysis cannot run.
- Validate filenames, URLs, upload sizes, and malformed inputs before analysis.
- Avoid logging uploaded file contents, API keys, or private page data.
- Update API and report documentation when fields change.

### UI changes

The intended visual language is compact and restrained: white surfaces, thin
borders, small rounded corners, compact typography, and subtle blue-purple
accents. Avoid oversized cards, heavy gradients, decorative animation, or
security claims that are stronger than the evidence. Existing extension UI is
plain HTML/CSS/JavaScript; do not introduce React or a bundler without first
discussing the migration and its maintenance cost.

### Commits

Prefer small commits that explain one change:

```text
fix: keep page history associated with its hostname
docs: describe local Gemma setup
test: add analyzer fixture for SMS accessibility combo
```

Do not commit:

- `.env` files containing secrets.
- API keys, access tokens, cookies, or session data.
- Unrequested generated build output.
- Private APKs or personal browsing screenshots.
- Python cache directories such as `__pycache__/`.

## Pull requests

Open a focused pull request against the repository's default branch. The pull
request description should include:

1. What behavior changed and why.
2. Which files and layers changed.
3. How the change preserves evidence-based reporting.
4. Commands and manual scenarios used for verification.
5. Screenshots or recordings for visible UI changes, with private data removed.
6. Known limitations, unavailable backend features, or follow-up work.

Before submitting, confirm:

- The extension loads from `chrome://extensions` without errors.
- The backend starts and `/health` responds.
- JavaScript and Python checks pass.
- No secrets or private data are present in the diff.
- Existing scan paths still work.
- Documentation matches the actual implementation.

Maintainers may request changes when a contribution introduces unsupported
permissions, unlabelled AI output, fabricated evidence, unsafe file handling,
or regressions between page and APK scan state.

## Documentation improvements

Documentation changes are welcome when they describe behavior that exists in
the repository or clearly label proposed work. Keep setup instructions aligned
with `backend/requirements.txt`, `backend/.env.example`, and the current
Manifest V3 entrypoints. If an endpoint, model, permission, or report field is
changed, update the relevant documentation in the same pull request.

When correcting a security or privacy statement, explain the source of the
correction. Do not remove limitations merely to make a demo appear more
confident. If documentation shows a screenshot, remove URLs, account names,
tokens, personal information, and private file metadata first.

## Security and privacy reporting

Do not disclose a suspected vulnerability, leaked key, private APK, or bypass
with live secrets in a public issue. Contact the repository maintainers through
the private channel configured for the project. Include:

- A concise description of the issue.
- Affected file, endpoint, or extension flow.
- Reproduction steps using sanitized inputs.
- Security impact and likely user exposure.
- A suggested mitigation, if known.

APK Guard sends data only according to the configured backend and Gemma mode.
Local mode routes analysis through the local backend and Ollama. Cloud mode may
send analysis text and, for visual scans, screenshots to the configured Gemini
service. Contributors must keep that distinction visible to users and must not
silently add remote collection.

## Current limitations

- Chrome blocks content scripts and visible-tab screenshots on protected pages
  such as `chrome://` and the Chrome Web Store.
- A page scan without a reachable final APK URL can review the page but cannot
  verify a hidden binary.
- A clean result means that the available checks found no major signals; it is
  not a safety guarantee.
- Local Gemma requires Ollama, a downloaded model, sufficient RAM, and startup
  time for the first request.
- Cloud Gemma requires a valid API key and network access.
- The deterministic fallback is a labelled triage fallback, not a replacement
  for complete malware analysis.
- Current history is limited to recent local results and is browser-profile
  specific.
- PDF report export is not currently part of the implemented report download
  path; the extension currently provides a downloadable text report and raw
  JSON evidence in the report view.

## License and attribution

APK Guard is distributed under the MIT license in [LICENSE](./LICENSE).
Contributors must preserve attribution for reused dependencies and must not
claim that Androguard, FastAPI, Ollama, Google GenAI, or Gemma are original
project code. Review dependency licenses before adding new libraries.

Read the [README](./README.md), [local Gemma guide](./docs/LOCAL_GEMMA.md), and
[demo guide](./docs/DEMO.md) before changing the setup or challenge evidence.
