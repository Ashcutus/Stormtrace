#!/usr/bin/env python3
"""Zero-dependency fallback server for Stormtrace."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote
from urllib.request import Request, urlopen
import json
import os
import re
from stormtrace_platform import local_api_key, local_setting, read_omarchy_theme, RadarAdapter
from providers.metoffice_radar import RadarError
from providers.metoffice_warnings import MetOfficeWarningsProvider, WarningError
from providers.lightning_history import LightningHistoryProvider, ProviderError, normalize_history_flashes


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("STORMTRACE_HOST", "127.0.0.1")
PORT = int(os.environ.get("STORMTRACE_PORT", "4177"))
APP_VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
UPDATE_MANIFEST_URL = os.environ.get(
    "STORMTRACE_UPDATE_MANIFEST_URL",
    "https://raw.githubusercontent.com/Ashcutus/Stormtrace/main/manifest.json",
)
REPOSITORY_URL = "https://github.com/Ashcutus/Stormtrace"


API_KEY = local_api_key(ROOT)
HISTORY_PROVIDER = LightningHistoryProvider(API_KEY)
WARNINGS_PROVIDER = MetOfficeWarningsProvider(local_setting(ROOT, "METOFFICE_WARNINGS_API_KEY"))

RADAR_PROVIDER = RadarAdapter(ROOT)

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
        if parsed.path in ("/api/radar", "/api/radar/frame"):
            try:
                if parsed.path == "/api/radar": return self.send_json(200, RADAR_PROVIDER.frames())
                key = parse_qs(parsed.query).get('key', [None])[0]
                image = RADAR_PROVIDER.image(key)
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(image)))
                self.send_header('Cache-Control', 'private, max-age=300')
                self.end_headers()
                return self.wfile.write(image)
            except RadarError as e:
                error = {'code': e.code, 'provider': 'metoffice-radar', 'operation': 'frames', 'status': None, 'retryAfter': None}
                return self.send_json(502, {'providerError': error, 'health': {**RADAR_PROVIDER.health, 'lastError': error}})
        if parsed.path == "/api/warnings":
            if not WARNINGS_PROVIDER.api_key:
                return self.send_json(200, {"configured": False, "records": [], "observations": [], "health": {**WARNINGS_PROVIDER.health, "freshness": "unavailable"}})
            try:
                return self.send_json(200, {"configured": True, **WARNINGS_PROVIDER.current()})
            except WarningError as error:
                freshness = "malformed" if error.code in ("parse", "malformed", "unsupported_schema") else "provider_error"
                return self.send_json(502, {"configured": True, "providerError": error.as_dict(), "health": {**WARNINGS_PROVIDER.health, "freshness": freshness}})
        if parsed.path == "/api/history":
            return self.history(parsed)
        if any(part.startswith(".") for part in unquote(parsed.path).split("/")):
            return self.send_json(404, {"error": "Not found"})
        return super().do_GET()

    def do_HEAD(self):
        if any(part.startswith(".") for part in unquote(urlparse(self.path).path).split("/")):
            return self.send_json(404, {"error": "Not found"})
        return super().do_HEAD()

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Permissions-Policy", "geolocation=(self)")
            self.send_header("Content-Security-Policy", "; ".join([
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tiles.openfreemap.org",
                "connect-src 'self' wss://live2.lightningmaps.org https://nominatim.openstreetmap.org https://tiles.openfreemap.org",
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
        try:
            result = HISTORY_PROVIDER.history(minutes)
            return self.send_json(200, {"configured": True, **result})
        except ProviderError as error:
            return self.send_json(error.status or 502, {
                "configured": True,
                "error": f"History provider returned {error.status}" if error.status else "The history provider could not be reached.",
                "providerError": error.as_dict(), "health": HISTORY_PROVIDER.health,
            })

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
