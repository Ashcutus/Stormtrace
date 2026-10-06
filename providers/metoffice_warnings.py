"""NSWWS v1.1 fallback transport/normalization, matching the JavaScript endpoint."""
from datetime import datetime
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
import json
import math
import re
import threading
import time
import xml.etree.ElementTree as ET

BASE = "https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/"
ID = "metoffice-warnings"
AUTHORITY = "Met Office"
SOURCE_URL = "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings"


class WarningError(Exception):
    def __init__(self, code, status=None, operation="current"):
        super().__init__(f"{ID}: {operation}: {code}")
        self.code, self.status, self.operation = code, status, operation

    def as_dict(self):
        return {"code": self.code, "provider": ID, "operation": self.operation, "status": self.status, "retryAfter": None}


def fail(code="malformed", operation="normalize"):
    raise WarningError(code, operation=operation)


def date(value):
    if not isinstance(value, str) or not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value):
        fail()
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, OverflowError):
        fail()


def strings(value, nonempty=False):
    return isinstance(value, list) and (not nonempty or bool(value)) and all(isinstance(s, str) and s.strip() for s in value)


def warning_link(value, kind):
    try:
        url, base = urlparse(value), urlparse(BASE)
        if url.scheme != base.scheme or url.netloc != base.netloc or url.query or url.fragment or not url.path.startswith(base.path) or not re.fullmatch(kind + r"/[a-zA-Z0-9-]+/?", url.path[len(base.path):]):
            fail("malformed", "feed_link")
        return value
    except (TypeError, ValueError):
        fail("malformed", "feed_link")


def parse_feed(xml):
    if not isinstance(xml, str) or len(xml) > 2_000_000 or re.search(r"<!DOCTYPE|<!ENTITY", xml, re.I):
        fail("parse", "feed")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        fail("parse", "feed")
    pending, count = [(root, 1)], 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if count > 20000 or depth > 64:
            fail("parse", "feed")
        pending.extend((child, depth + 1) for child in node)
    ns = "{http://www.w3.org/2005/Atom}"
    if root.tag != ns + "feed":
        fail("unsupported_schema", "feed")
    links = [n for n in root.findall(ns + "link") if n.get("rel") == "related"]
    identity = root.findtext(ns + "id")
    if len(links) != 1 or not identity:
        fail("malformed", "feed")
    entries = []
    for node in root.findall(ns + "entry"):
        links_entry = [n for n in node.findall(ns + "link") if n.get("rel") == "alternate"]
        identity_entry = node.findtext(ns + "id")
        if len(links_entry) != 1 or not identity_entry:
            fail("malformed", "feed")
        entries.append({"id": identity_entry.strip(), "updatedAt": date(node.findtext(ns + "updated")), "url": warning_link(links_entry[0].get("href"), "updated")})
    if len(entries) > 500 or len({e["id"] for e in entries}) != len(entries):
        fail("malformed", "feed")
    return {"id": identity.strip(), "updatedAt": date(root.findtext(ns + "updated")), "issuedUrl": warning_link(links[0].get("href"), "issued"), "entries": sorted(entries, key=lambda e: (e["updatedAt"], e["id"]))}


def geometry_valid(g):
    def point(p):
        return isinstance(p, list) and len(p) >= 2 and all(isinstance(n, (float, int)) and not isinstance(n, bool) and math.isfinite(n) for n in p) and abs(p[0]) <= 180 and abs(p[1]) <= 90
    def ring(r):
        return isinstance(r, list) and len(r) >= 4 and all(point(p) for p in r) and r[0] == r[-1]
    def polygon(p):
        return isinstance(p, list) and bool(p) and all(ring(r) for r in p)
    return isinstance(g, dict) and g.get("type") == "MultiPolygon" and isinstance(g.get("coordinates"), list) and bool(g["coordinates"]) and all(polygon(p) for p in g["coordinates"])


def normalize_warning(feature, fetched):
    p = feature.get("properties") if isinstance(feature, dict) else None
    if not isinstance(p, dict) or feature.get("type") != "Feature" or not isinstance(p.get("warningId"), str) or not p["warningId"] or not isinstance(p.get("warningVersion"), str) or not re.fullmatch(r"\d+(?:\.\d+)?", p["warningVersion"]) or p.get("warningLevel") not in ("YELLOW", "AMBER", "RED") or p.get("warningStatus") not in ("ISSUED", "CANCELLED", "EXPIRED"):
        fail()
    areas = p.get("affectedAreas")
    if not strings(p.get("weatherType"), True) or not strings(p.get("whatToExpect"), True) or not isinstance(p.get("warningHeadline"), str) or not p["warningHeadline"].strip() or not isinstance(areas, list) or not areas or not all(isinstance(a, dict) and isinstance(a.get("regionName"), str) and isinstance(a.get("regionCode"), str) and strings(a.get("subRegions")) for a in areas):
        fail()
    for field in ("warningFurtherDetails", "whatShouldIDo", "warningUpdateDescription"):
        if p.get(field) is not None and not isinstance(p[field], str):
            fail()
    for field in ("warningImpact", "warningLikelihood"):
        if type(p.get(field)) is not int or not 1 <= p[field] <= 4:
            fail()
    observed, updated, valid_from, valid_to = (date(p.get(field)) for field in ("issuedDate", "modifiedDate", "validFromDate", "validToDate"))
    g = feature.get("geometry")
    if valid_to < valid_from or not geometry_valid(g):
        fail()
    return {"id": p["warningId"], "kind": "warning", "provider": ID, "sourceAuthority": AUTHORITY, "observedAt": observed, "updatedAt": updated, "validFrom": valid_from, "validTo": valid_to, "geometry": {"type": "MultiPolygon", "coordinates": g["coordinates"]}, "sourceSeverity": {"classification": p["warningLevel"], "impact": p["warningImpact"], "likelihood": p["warningLikelihood"]}, "displayPriority": "urgent" if p["warningLevel"] == "RED" else "high" if p["warningLevel"] == "AMBER" else "normal", "provenance": {"provider": ID, "sourceAuthority": AUTHORITY, "sourceUrl": SOURCE_URL, "upstreamId": p["warningId"], "fetchedAt": fetched, "observedAt": observed, "updatedAt": updated, "transformations": ["metoffice-nswws-v1.1-normalization"]}, "domainPayload": {"classification": p["warningLevel"], "status": p["warningStatus"], "version": p["warningVersion"], "weatherTypes": p["weatherType"], "headline": p["warningHeadline"], "description": p.get("warningFurtherDetails") or "", "instruction": p.get("whatShouldIDo") or "", "whatToExpect": p["whatToExpect"], "updateReason": p.get("warningUpdateDescription") or "", "affectedAreas": areas, "sourceFields": p}}


def normalize_collection(payload, fetched):
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list) or len(payload["features"]) > 2000:
        fail()
    records = [normalize_warning(f, fetched) for f in payload["features"]]
    if len({r["id"] for r in records}) != len(records):
        fail()
    return records


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class MetOfficeWarningsProvider:
    def __init__(self, api_key="", opener=None, clock=lambda: int(time.time() * 1000), log=None):
        self.api_key, self.opener, self.clock = api_key, opener or build_opener(NoRedirect()).open, clock
        self.log = log or (lambda entry: print(json.dumps(entry), flush=True))
        self.cached, self.updates, self.lock, self.last_result = None, {}, threading.Lock(), None
        self.health = {"lastAttemptedFetch": None, "lastSuccessfulFetch": None, "sourceDataTimestamp": None, "expectedUpdateInterval": 60000, "lastError": None, "consecutiveFailures": 0, "available": False, "freshnessBasis": "fetch"}

    def request(self, url, format):
        request = Request(url, headers={"apikey": self.api_key, "Accept": "application/atom+xml" if format == "xml" else "application/geo+json"})
        try:
            with self.opener(request, timeout=15) as upstream:
                limit = 2_000_000 if format == "xml" else 20_000_000
                data = upstream.read(limit + 1)
                if len(data) > limit:
                    fail("malformed", "response_size")
                body = data.decode("utf-8")
        except HTTPError as e:
            raise WarningError("authentication" if e.code in (401, 403) else "rate_limited" if e.code == 429 else "upstream", e.code) from None
        except (TimeoutError, URLError, OSError) as e:
            raise WarningError("timeout" if isinstance(e, TimeoutError) or isinstance(getattr(e, "reason", None), TimeoutError) else "network") from None
        except UnicodeDecodeError:
            fail("parse", "current")
        if format == "xml":
            return parse_feed(body)
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            fail("parse", "current")

    def current(self):
        with self.lock:
            started = self.clock()
            if self.last_result and started - self.health["lastSuccessfulFetch"] < 60000:
                return json.loads(json.dumps(self.last_result))
            self.health["lastAttemptedFetch"] = started
            try:
                if not self.api_key:
                    fail("configuration", "current")
                feed = self.request(BASE + "feed", "xml")
                updates = {}
                for entry in feed["entries"]:
                    updates[entry["id"]] = self.updates.get(entry["id"])
                    if updates[entry["id"]] is None:
                        updates[entry["id"]] = normalize_collection(self.request(entry["url"], "json"), self.clock())
                records = self.cached["records"] if self.cached and self.cached["url"] == feed["issuedUrl"] else normalize_collection(self.request(feed["issuedUrl"], "json"), self.clock())
                if any(r["domainPayload"]["status"] != "ISSUED" for r in records):
                    fail("malformed", "issued")
                self.cached = {"url": feed["issuedUrl"], "records": records}
                self.updates = updates
                self.health.update({"lastSuccessfulFetch": self.clock(), "sourceDataTimestamp": feed["updatedAt"], "lastError": None, "consecutiveFailures": 0, "available": True})
                result = {"records": records, "observations": [r for records in updates.values() for r in records], "sourceDataTimestamp": feed["updatedAt"], "health": {**self.health, "freshness": "fresh"}}
                self.emit({"provider": ID, "operation": "current", "duration": self.clock() - started, "success": True, "records": len(records), "sourceTimestamp": feed["updatedAt"], "freshness": "fresh"})
                self.last_result = json.loads(json.dumps(result))
                return json.loads(json.dumps(result))
            except WarningError as error:
                self.health["lastError"] = error.as_dict()
                self.health["consecutiveFailures"] += 1
                self.emit({"provider": ID, "operation": "current", "duration": self.clock() - started, "success": False, "error": error.as_dict()})
                raise

    def emit(self, entry):
        try:
            self.log(entry)
        except Exception:
            pass  # Diagnostics cannot break retrieval.
