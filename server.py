#!/usr/bin/env python3
"""Zero-dependency fallback server for Stormtrace."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import os
import re
import subprocess


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("STORMTRACE_HOST", "127.0.0.1")
PORT = int(os.environ.get("STORMTRACE_PORT", "4177"))
APP_VERSION = "1.4.1"
UPDATE_MANIFEST_URL = os.environ.get(
    "STORMTRACE_UPDATE_MANIFEST_URL",
    "https://raw.githubusercontent.com/Ashcutus/Stormtrace/main/manifest.json",
)
REPOSITORY_URL = "https://github.com/Ashcutus/Stormtrace"


def local_api_key():
    if os.environ.get("LIGHTNING_API_KEY"):
        return os.environ["LIGHTNING_API_KEY"]
    env_file = ROOT / ".env"
    if not env_file.exists():
        return ""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("LIGHTNING_API_KEY="):
            return line.split("=", 1)[1].strip()
    return ""


API_KEY = local_api_key()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self.send_json(200, {
                "ok": True,
                "app": "stormtrace",
                "version": APP_VERSION,
                "root": str(ROOT),
                "pid": os.getpid(),
                "historyProvider": bool(API_KEY),
            })
        if parsed.path == "/api/update":
            return self.update_check()
        if parsed.path == "/api/theme":
            return self.send_json(200, read_omarchy_theme())
        if parsed.path == "/api/history":
            return self.history(parsed)
        return super().do_GET()

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Permissions-Policy", "geolocation=(self)")
            self.send_header("Content-Security-Policy", "; ".join([
                "default-src 'self'",
                "script-src 'self' https://unpkg.com",
                "style-src 'self' 'unsafe-inline' https://unpkg.com",
                "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
                "connect-src 'self' wss://live2.lightningmaps.org https://nominatim.openstreetmap.org",
                "font-src 'self'",
                "worker-src 'self' blob:",
            ]))
        super().end_headers()

    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def history(self, parsed):
        if not API_KEY:
            return self.send_json(200, {"configured": False, "flashes": []})
        query = parse_qs(parsed.query)
        try:
            minutes = max(1, min(1440, int(query.get("since_minutes", ["1440"])[0])))
        except ValueError:
            minutes = 1440
        request = Request(
            f"https://api.lightningapi.dev/v1/flashes?since_minutes={minutes}&limit=20000",
            headers={"X-API-Key": API_KEY, "Accept": "application/json"},
        )
        try:
            with urlopen(request, timeout=15) as upstream:
                body = json.load(upstream)
            flashes = [{
                "id": f"provider:{flash.get('flash_id')}",
                "time": flash.get("flash_timestamp_utc"),
                "lat": flash.get("lat"),
                "lon": flash.get("lon"),
                "polarity": 0,
                "deviation": 0,
            } for flash in body.get("flashes", [])]
            return self.send_json(200, {"configured": True, "flashes": flashes})
        except HTTPError as error:
            return self.send_json(error.code, {"configured": True, "error": f"History provider returned {error.code}"})
        except Exception as error:
            return self.send_json(502, {"configured": True, "error": str(error)})

    def update_check(self):
        request = Request(
            UPDATE_MANIFEST_URL,
            headers={
                "Accept": "application/json",
                "User-Agent": f"Stormtrace/{APP_VERSION}",
            },
        )
        try:
            with urlopen(request, timeout=8) as upstream:
                manifest = json.load(upstream)
            latest_version = normalize_version(manifest.get("version"))
            if not latest_version:
                raise ValueError("Published manifest has an invalid version")
            comparison = compare_versions(latest_version, APP_VERSION)
            return self.send_json(200, {
                "ok": True,
                "currentVersion": APP_VERSION,
                "latestVersion": latest_version,
                "updateAvailable": comparison > 0,
                "developmentBuild": comparison < 0,
                "repositoryUrl": REPOSITORY_URL,
            })
        except Exception as error:
            self.log_error("Update check failed: %s", error)
            return self.send_json(502, {
                "ok": False,
                "currentVersion": APP_VERSION,
                "error": "The published version could not be checked right now.",
            })

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and self.path != "/api/health":
            super().log_message(fmt, *args)


def read_omarchy_theme():
    try:
        name = subprocess.run(["omarchy", "theme", "current"], check=True, capture_output=True, text=True, timeout=2).stdout.strip()
        output = subprocess.run(["omarchy", "theme", "color", "--all"], check=True, capture_output=True, text=True, timeout=2).stdout
        colors = dict(line.split("\t", 1) for line in output.splitlines() if "\t" in line)
        return {"available": True, "name": name or "Omarchy", "mode": colors.get("mode", "dark"), "colors": colors}
    except Exception:
        return {"available": False, "name": "Stormtrace default", "mode": "dark", "colors": {}}


def normalize_version(value):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", str(value or "").strip())
    return ".".join(str(int(part)) for part in match.groups()) if match else ""


def compare_versions(left, right):
    left_parts = tuple(int(part) for part in left.split("."))
    right_parts = tuple(int(part) for part in right.split("."))
    return (left_parts > right_parts) - (left_parts < right_parts)


if __name__ == "__main__":
    print(f"Stormtrace ready at http://{HOST}:{PORT}")
    print("Historical API backfill enabled." if API_KEY else "Using local rolling history (no LIGHTNING_API_KEY set).")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
