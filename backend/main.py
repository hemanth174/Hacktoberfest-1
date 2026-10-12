"""APK Guard backend — FastAPI endpoints (Gemma 4 brain)."""
import base64
import os
import shutil
import tempfile
import httpx
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analyzer import analyze_apk
from llm_triage import triage, triage_with_screenshot, GEMMA_MODEL, GEMMA_MODE, GEMMA_LOCAL_MODEL

app = FastAPI(title="APK Guard backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class ScanUrlReq(BaseModel):
    url: str
    filename: str = "download.apk"
    page_url: str = ""


@app.get("/health")
def health():
    return {"ok": True, "service": "apk-guard", "model": GEMMA_MODEL,
            "mode": GEMMA_MODE, "local_model": GEMMA_LOCAL_MODEL,
            "gemma_configured": bool(os.environ.get("GEMINI_API_KEY"))}


@app.post("/scan-url")
async def scan_url(req: ScanUrlReq):
    """Download APK from URL -> androguard analysis -> LLM triage -> report JSON."""
    tmp = tempfile.mkdtemp(prefix="apkguard_")
    apk_path = os.path.join(tmp, req.filename or "download.apk")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60) as c:
            r = await c.get(req.url)
            r.raise_for_status()
            with open(apk_path, "wb") as f:
                f.write(r.content)
        findings = analyze_apk(apk_path, url_context={"url": req.url, "page_url": req.page_url, "filename": req.filename})
        report = triage(findings)
        report["filename"] = req.filename
        report.setdefault("source", "backend")
        return report
    except Exception as e:
        return {
            "verdict": "unknown", "risk_score": 50,
            "summary": f"Could not download/analyze URL: {e}",
            "reasons": [f"Download or analysis failed: {e}"],
            "recommendations": ["Check the URL and try again.", "Upload the APK file directly via the Upload tab."],
            "filename": req.filename, "source": "backend-error",
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.post("/scan-file")
async def scan_file(file: UploadFile = File(...)):
    tmp = tempfile.mkdtemp(prefix="apkguard_")
    apk_path = os.path.join(tmp, file.filename or "upload.apk")
    try:
        with open(apk_path, "wb") as f:
            f.write(await file.read())
        findings = analyze_apk(apk_path, url_context={"filename": file.filename})
        report = triage(findings)
        report["filename"] = file.filename
        report.setdefault("source", "backend")
        return report
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.post("/scan-with-screenshot")
async def scan_with_screenshot(
    file: UploadFile | None = None,
    screenshot_b64: str = Form(""),
    url: str = Form(""),
    filename: str = Form("download.apk"),
    page_url: str = Form(""),
):
    """Multimodal endpoint: APK (upload or URL) + page screenshot -> Gemma 4 vision.

    The extension sends a dataURL screenshot of the download page; Gemma reads
    visual trust signals (fake buttons, typos, lookalike domains) together with
    androguard findings. This is the Best-Use-of-Gemma-4 demo moment.
    """
    tmp = tempfile.mkdtemp(prefix="apkguard_")
    try:
        findings: dict
        if file is not None:
            apk_path = os.path.join(tmp, file.filename or filename)
            with open(apk_path, "wb") as f:
                f.write(await file.read())
            findings = analyze_apk(apk_path, url_context={"filename": file.filename, "page_url": page_url or url})
            filename = file.filename or filename
        elif url:
            apk_path = os.path.join(tmp, filename)
            async with httpx.AsyncClient(follow_redirects=True, timeout=60) as c:
                r = await c.get(url)
                r.raise_for_status()
                with open(apk_path, "wb") as f:
                    f.write(r.content)
            findings = analyze_apk(apk_path, url_context={"url": url, "page_url": page_url, "filename": filename})
        else:
            # screenshot-only: page triage without an APK (Gemma vision judges the page)
            findings = {"package": "", "permissions": [], "dangerous_hits": [],
                        "combo_flags": [], "impersonation": [], "url_flags": [f"Page: {page_url or url}"],
                        "risk_score": 20, "engine": "page-only", "url_context": {"page_url": page_url or url}}
        png = screenshot_b64.split(",", 1)[-1] if screenshot_b64 else ""
        report = triage_with_screenshot(findings, base64.b64decode(png), page_url or url) if png \
            else triage(findings)
        report["filename"] = filename
        report["page_url"] = page_url or url
        return report
    except Exception as e:
        return {"verdict": "unknown", "risk_score": 50,
                "summary": f"Visual scan failed: {e}",
                "reasons": [str(e)], "recommendations": ["Retry with the Paste-URL tab."],
                "filename": filename, "source": "backend-error"}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
