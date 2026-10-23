#!/usr/bin/env python3
"""Zero-dependency fallback server for Stormtrace."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote
from urllib.request import Request, urlopen
import json
import os
import re
import time
import math
from stormtrace_platform import local_api_key, local_setting, read_omarchy_theme, RadarAdapter, RadarSetup
from providers.metoffice_radar import RadarError
from providers.map_overlays import MapOverlayProvider
from providers.public_hazards import PublicHazardProvider, HazardError, SOURCES as HAZARD_SOURCES
from providers.usgs import USGSEarthquakeProvider, EarthquakeError
from providers.ea_floods import EnglandFloodProvider, FloodError
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

MAP_OVERLAYS = MapOverlayProvider()
EARTHQUAKES_PROVIDER = USGSEarthquakeProvider()
FLOODS_PROVIDER = EnglandFloodProvider()
HAZARD_PROVIDERS = {id: PublicHazardProvider(id) for id in HAZARD_SOURCES}
RADAR_PROVIDER = RadarAdapter(ROOT)
PUBLIC_RADAR_PROVIDERS = {source: RadarAdapter(ROOT, source) for source in ['opera-radar', 'noaa-conus', 'noaa-alaska', 'noaa-hawaii', 'noaa-carib', 'noaa-guam', 'noaa-ptype-conus', 'noaa-ptype-alaska', 'noaa-ptype-hawaii', 'noaa-ptype-carib', 'noaa-ptype-guam', 'eccc-rain', 'eccc-snow', 'eccc-ptype']}
# A finished setup clears radar caches so the new decoder is used straight away.
RADAR_SETUP = RadarSetup(ROOT, on_done=lambda: [provider.invalidate() for provider in [RADAR_PROVIDER, *PUBLIC_RADAR_PROVIDERS.values()] if hasattr(provider, 'invalidate')])

DIAGNOSTICS_ENABLED = os.environ.get("STORMTRACE_DIAGNOSTICS") == "1"
DIAGNOSTICS_SAMPLE = None
# Bar alert state reported by the open window; mirrors platform/bar-status.js.
BAR_ALERT = None
BAR_ALERT_KINDS = ("lightning", "warning", "flood", "earthquake")
BAR_ALERT_MAX_MS = 15 * 60 * 1000


def sanitize_bar_status(value, now):
    if value is None or (isinstance(value, dict) and "alert" in value and value["alert"] is None): return None
    alert = value.get("alert") if isinstance(value, dict) else None
    if not isinstance(alert, dict) or alert.get("kind") not in BAR_ALERT_KINDS: raise ValueError("invalid bar alert")
    until = alert.get("until")
    if isinstance(until, bool) or not isinstance(until, (int, float)) or not math.isfinite(until) or until <= now or until > now + BAR_ALERT_MAX_MS: raise ValueError("invalid bar alert expiry")
    title = alert.get("title") if isinstance(alert.get("title"), str) else ""
    title = "".join(" " if ord(ch) < 32 or ord(ch) == 127 else ch for ch in title).strip()[:140]
    return {"kind": alert["kind"], "title": title, "until": until}


def current_bar_alert(now):
    return {"kind": BAR_ALERT["kind"], "title": BAR_ALERT["title"]} if BAR_ALERT and BAR_ALERT["until"] > now else None
DIAGNOSTICS_FIELDS = json.loads((ROOT / "platform/diagnostics-fields.json").read_text())

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        global DIAGNOSTICS_SAMPLE, BAR_ALERT
        if self.path == "/api/radar/setup":
            if self.headers.get("Origin", "http://" + self.headers.get("Host", "")) != "http://" + self.headers.get("Host", ""): return self.send_json(403, {})
            if not self.headers.get("Content-Type", "").startswith("application/json"): return self.send_json(415, {})
            return self.send_json(202, RADAR_SETUP.start())
        if self.path == "/api/bar-status":
            if self.headers.get("Origin", "http://" + self.headers.get("Host", "")) != "http://" + self.headers.get("Host", ""): return self.send_json(403, {})
            if not self.headers.get("Content-Type", "").startswith("application/json"): return self.send_json(415, {})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 0 or size > 2048: return self.send_json(413, {})
                now = int(time.time() * 1000)
                BAR_ALERT = sanitize_bar_status(json.loads(self.rfile.read(size)), now)
                return self.send_json(200, {"alert": current_bar_alert(now)})
            except (ValueError, TypeError, AttributeError): return self.send_json(400, {})
        if self.path != "/api/diagnostics": return self.send_json(404, {})
        if not DIAGNOSTICS_ENABLED or self.headers.get("Origin", "http://" + self.headers.get("Host", "")) != "http://" + self.headers.get("Host", ""): return self.send_json(403, {})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 4096: return self.send_json(413, {})
            value = json.loads(self.rfile.read(size))
            DIAGNOSTICS_SAMPLE = {k: min(value[k], 9007199254740991) for k in DIAGNOSTICS_FIELDS if isinstance(value.get(k), (int, float)) and not isinstance(value[k], bool) and math.isfinite(value[k]) and value[k] >= 0}
            DIAGNOSTICS_SAMPLE["receivedAt"] = int(time.time() * 1000)
            return self.send_json(200, {})
        except (ValueError, TypeError, AttributeError): return self.send_json(400, {})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/diagnostics":
            return self.send_json(200, {"enabled": DIAGNOSTICS_ENABLED, "sample": DIAGNOSTICS_SAMPLE if DIAGNOSTICS_ENABLED else None})
        if parsed.path == "/api/health":
            return self.send_json(200, {
                "ok": True,
                "app": "stormtrace",
                "version": APP_VERSION,
                "root": str(ROOT),
                "pid": os.getpid(),
                "historyProvider": bool(API_KEY),
                "alert": current_bar_alert(int(time.time() * 1000)),
            })
        if parsed.path == "/api/update":
            return self.update_check()
        if parsed.path == "/api/theme":
            return self.send_json(200, read_omarchy_theme())
        if parsed.path == "/api/radar/setup":
            return self.send_json(200, RADAR_SETUP.snapshot())
        if parsed.path in ("/api/radar", "/api/radar/frame"):
            source = parse_qs(parsed.query).get('source', ['metoffice-radar'])[0]
            selected = RADAR_PROVIDER if source == 'metoffice-radar' else PUBLIC_RADAR_PROVIDERS.get(source)
            if selected is None: return self.send_json(400, {'error': 'Unknown radar source'})
            try:
                if parsed.path == "/api/radar": return self.send_json(200, selected.frames())
                key = parse_qs(parsed.query).get('key', [None])[0]
                image = selected.image(key)
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(image)))
                self.send_header('Cache-Control', 'private, max-age=300')
                self.end_headers()
                return self.wfile.write(image)
            except RadarError as e:
                error = {'code': e.code, 'provider': selected.id, 'operation': 'frames', 'status': None, 'retryAfter': None}
                return self.send_json(502, {'providerError': error, 'health': {**selected.health, 'lastError': error}})
        if parsed.path in ("/api/floods/area", "/api/earthquakes/impact"):
            try:
                id = parse_qs(parsed.query).get('id', [None])[0]
                return self.send_json(200, MAP_OVERLAYS.flood(id) if parsed.path == '/api/floods/area' else MAP_OVERLAYS.earthquake(id))
            except (EarthquakeError, ValueError, OSError, TypeError, KeyError, AttributeError):
                return self.send_json(502, {'error': 'Map resource unavailable'})
        if parsed.path == "/api/hazards":
            selected = HAZARD_PROVIDERS.get(parse_qs(parsed.query).get('source', [''])[0])
            if selected is None: return self.send_json(400, {'error': 'Unknown hazard source'})
            try: return self.send_json(200, {'configured': True, **selected.current()})
            except HazardError as error:
                return self.send_json(502, {'configured': True, 'retryAt': selected.retry_at, 'providerError': error.as_dict(), 'health': {**selected.health, 'freshness': selected.freshness()}})
        if parsed.path == "/api/earthquakes":
            try:
                return self.send_json(200, {"configured": True, **EARTHQUAKES_PROVIDER.current()})
            except EarthquakeError as error:
                return self.send_json(502, {"configured": True, "providerError": error.as_dict(), "health": {**EARTHQUAKES_PROVIDER.health, "freshness": "malformed" if error.code in ("parse", "malformed") else "provider_error"}})
        if parsed.path == "/api/floods":
            try:
                return self.send_json(200, {"configured": True, **FLOODS_PROVIDER.current()})
            except FloodError as error:
                return self.send_json(502, {"configured": True, "providerError": error.as_dict(), "health": {**FLOODS_PROVIDER.health, "freshness": "malformed" if error.code in ("parse", "malformed") else "provider_error"}})
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
