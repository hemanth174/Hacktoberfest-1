"""Build two dummy APKs (plain zips with a text AndroidManifest.xml) for offline testing.
Usage:  python make_dummy_apks.py   -> writes samples/*.apk
The backend fallback parser reads these without androguard; androguard path
is exercised with real APKs during the event.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

CLEAN_MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest package="com.example.flashlight" xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.CAMERA"/>
    <application android:label="Flashlight Free"/>
</manifest>"""

NASTY_MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest package="com.evil.wpp" xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.READ_SMS"/>
    <uses-permission android:name="android.permission.SEND_SMS"/>
    <uses-permission android:name="android.permission.READ_CONTACTS"/>
    <uses-permission android:name="android.permission.BIND_ACCESSIBILITY_SERVICE"/>
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
    <application android:label="WhatsApp Plus"/>
</manifest>"""

MED_MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest package="com.mod.tiktokpro" xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
    <application android:label="TikTok Pro"/>
</manifest>"""


def make(name, manifest):
    path = os.path.join(HERE, name)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("AndroidManifest.xml", manifest)
        z.writestr("classes.dex", b"\\x00fake-dex for testing")
        z.writestr("res/values/strings.xml", b"<resources/>")
    print("wrote", path)


if __name__ == "__main__":
    make("flashlight-free.apk", CLEAN_MANIFEST)
    make("whatsapp-plus.apk", NASTY_MANIFEST)
    make("tIK-t0K-pro-mod.apk", MED_MANIFEST)
