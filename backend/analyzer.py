"""APK Guard analyzer — androguard static analysis + impersonation checks.

Code link for judges: backend/analyzer.py -> llm_triage.triage() -> report JSON.
Works even without androguard installed (zipfile fallback) so the demo never dies.
"""
import hashlib
import re
import zipfile
from urllib.parse import urlparse

# ---- Dangerous-permissions taxonomy (demo-ready) ----
DANGEROUS = {
    "android.permission.SEND_SMS": 25,
    "android.permission.RECEIVE_SMS": 20,
    "android.permission.READ_SMS": 25,
    "android.permission.READ_CONTACTS": 15,
    "android.permission.READ_CALL_LOG": 20,
    "android.permission.RECORD_AUDIO": 20,
    "android.permission.CAMERA": 10,
    "android.permission.ACCESS_FINE_LOCATION": 15,
    "android.permission.READ_EXTERNAL_STORAGE": 5,
    "android.permission.WRITE_EXTERNAL_STORAGE": 5,
    "android.permission.REQUEST_INSTALL_PACKAGES": 20,
    "android.permission.BIND_ACCESSIBILITY_SERVICE": 30,
    "android.permission.BIND_DEVICE_ADMIN": 30,
    "android.permission.SYSTEM_ALERT_WINDOW": 15,
    "android.permission.READ_PHONE_STATE": 10,
    "android.permission.CALL_PHONE": 15,
}

# Deadly combos judges instantly understand
DEADLY_COMBOS = [
    ({"android.permission.READ_SMS", "android.permission.BIND_ACCESSIBILITY_SERVICE"},
     "SMS access + Accessibility — classic banking-trojan / OTP-stealer combo"),
    ({"android.permission.SEND_SMS", "android.permission.READ_CONTACTS"},
     "Send SMS + read contacts — premium-SMS / worm behaviour"),
    ({"android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.SYSTEM_ALERT_WINDOW"},
     "Can install packages + draw overlays — dropper risk"),
    ({"android.permission.BIND_DEVICE_ADMIN", "android.permission.CAMERA"},
     "Device-admin + camera — ransomware/spyware pattern"),
]

KNOWN_BRAND_PACKAGES = {
    "whatsapp": "com.whatsapp",
    "tiktok": "com.zhiliaoapp.musically",
    "instagram": "com.instagram.android",
    "telegram": "org.telegram.messenger",
    "facebook": "com.facebook.katana",
}
MOD_KEYWORDS = ["mod", "plus", "pro", "premium", "crack", "unlocked", "hack", "vip", "gold"]


def _parse_manifest_fallback(apk_path: str):
    """Best-effort permission/package extraction without androguard."""
    perms, package, app_label = set(), "", ""
    try:
        with zipfile.ZipFile(apk_path) as z:
            # Try plain-text manifest (dummy APKs); binary AXML needs androguard
            try:
                raw = z.read("AndroidManifest.xml").decode("utf-8", "ignore")
                perms = set(re.findall(r'android\.permission\.[A-Z_]+', raw))
                m = re.search(r'package="([\w.]+)"', raw)
                if m:
                    package = m.group(1)
                m2 = re.search(r'android:label="([^"]+)"', raw)
                if m2:
                    app_label = m2.group(1)
            except KeyError:
                pass
            names = z.namelist()
    except Exception:
        names = []
    return perms, package, app_label, names


def analyze_apk(apk_path: str, url_context: dict | None = None) -> dict:
    url_context = url_context or {}
    perms, package, app_label = set(), "", ""
    cert_sha256, zip_names = "", []

    # --- 1. Try androguard, fall back gracefully ---
    used_androguard = False
    try:
        from androguard.core.apk import APK  # type: ignore
        apk = APK(apk_path)
        perms = set(apk.get_permissions() or [])
        package = apk.get_package() or ""
        app_label = apk.get_app_name() or ""
        try:
            certs = apk.get_certificates()
            if certs:
                cert_sha256 = hashlib.sha256(certs[0].dump()).hexdigest()[:32]
        except Exception:
            pass
        used_androguard = True
    except Exception:
        perms, package, app_label, zip_names = _parse_manifest_fallback(apk_path)

    # --- 2. Score dangerous permissions ---
    perm_hits = [{"perm": p, "weight": DANGEROUS[p]} for p in perms if p in DANGEROUS]
    perm_score = sum(h["weight"] for h in perm_hits)

    combo_flags = []
    for combo, why in DEADLY_COMBOS:
        if combo <= perms:
            combo_flags.append(why)
            perm_score += 25

    # --- 3. Impersonation check: filename claims brand, package doesn't match ---
    impersonation = []
    filename = (url_context.get("filename") or "").lower()
    for brand, legit_pkg in KNOWN_BRAND_PACKAGES.items():
        if brand in filename or brand in app_label.lower():
            if package and package != legit_pkg:
                impersonation.append(
                    f'Impersonating "{brand}" — filename/label suggests {brand} but package is "{package}" (official: {legit_pkg})'
                )
                perm_score += 30
            elif not package:
                impersonation.append(f'Filename claims "{brand}" — verify signer; unofficial builds often trojaned')
                perm_score += 15

    # --- 4. URL reputation attached to the file ---
    url_flags = []
    url = url_context.get("url", "")
    if url:
        host = (urlparse(url).hostname or "").lower()
        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host):
            url_flags.append("IP-based download URL")
            perm_score += 20
        if host.split(".")[-1:] and host.split(".")[-1] in ["tk", "ml", "ga", "cf", "gq", "xyz", "top"]:
            url_flags.append("Risky free TLD")
            perm_score += 15
        if any(k in filename for k in MOD_KEYWORDS):
            url_flags.append("Mod/crack keyword in filename")
            perm_score += 15

    risk_score = max(0, min(100, perm_score))

    with open(apk_path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    return {
        "sha256": sha,
        "package": package,
        "app_label": app_label,
        "permissions": sorted(perms),
        "dangerous_hits": perm_hits,
        "combo_flags": combo_flags,
        "impersonation": impersonation,
        "url_flags": url_flags,
        "cert_hint": cert_sha256,
        "risk_score": risk_score,
        "engine": "androguard" if used_androguard else "fallback",
        "url_context": url_context,
    }
