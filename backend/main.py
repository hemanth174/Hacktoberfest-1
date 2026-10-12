"""APK Guard backend — FastAPI endpoints (Gemma 4 brain)."""
import base64
import asyncio
import functools
import logging
import os
import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
import httpx
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analyzer import analyze_apk
from llm_triage import triage, triage_with_screenshot, GEMMA_MODEL, GEMMA_MODE, GEMMA_LOCAL_MODEL

app = FastAPI(title="APK Guard backend")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("apk-guard")

# Gemma inference is synchronous and memory-heavy. Keep it off FastAPI's event
# loop and limit concurrent model calls so health checks and logs remain live.
MODEL_POOL_SIZE = max(1, int(os.environ.get("GEMMA_POOL_SIZE", "1")))
MODEL_POOL = ThreadPoolExecutor(max_workers=MODEL_POOL_SIZE, thread_name_prefix="gemma")
MODEL_SLOTS = asyncio.Semaphore(MODEL_POOL_SIZE)
MODEL_TIMEOUT = float(os.environ.get("GEMMA_TIMEOUT_SECONDS", "150"))


@app.middleware("http")
async def request_logging(request, call_next):
    started = time.perf_counter()
    logger.info("request.start method=%s path=%s", request.method, request.url.path)
    try:
        response = await call_next(request)
        elapsed = time.perf_counter() - started
        logger.info("request.end method=%s path=%s status=%s elapsed=%.1fs", request.method, request.url.path, response.status_code, elapsed)
        return response
    except Exception:
        logger.exception("request.error method=%s path=%s", request.method, request.url.path)
        raise


async def run_model(fn, *args):
    """Run blocking Gemma/Ollama work in a bounded pool."""
    async with MODEL_SLOTS:
        logger.info("gemma.start function=%s pool=%s", fn.__name__, MODEL_POOL_SIZE)
        started = time.perf_counter()
        loop = asyncio.get_running_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(MODEL_POOL, functools.partial(fn, *args)),
                timeout=MODEL_TIMEOUT,
            )
            logger.info("gemma.end function=%s elapsed=%.1fs", fn.__name__, time.perf_counter() - started)
            return result
        except asyncio.TimeoutError:
            logger.error("gemma.timeout function=%s after=%.1fs", fn.__name__, MODEL_TIMEOUT)
            raise
        except Exception:
            logger.exception("gemma.error function=%s", fn.__name__)
            raise
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
        report = await run_model(triage, findings)
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
        report = await run_model(triage, findings)
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
        report = await run_model(
            triage_with_screenshot, findings, base64.b64decode(png), page_url or url
        ) if png else await run_model(triage, findings)
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
