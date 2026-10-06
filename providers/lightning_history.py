"""V1 zero-dependency Python transport; browser core owns event/history models."""
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import json
import time


def normalize_history_flashes(input_value):
    flashes = []
    if not isinstance(input_value, list):
        return flashes
    for raw in input_value:
        if not isinstance(raw, dict) or raw.get("flash_id") is None:
            continue
        try:
            timestamp = str(raw.get("flash_timestamp_utc") or "")
            parsed_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if parsed_time.tzinfo is None:
                parsed_time = parsed_time.replace(tzinfo=timezone.utc)
            latitude = float(raw.get("lat"))
            longitude = float(raw.get("lon"))
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                continue
            flashes.append({
                "id": f"provider:{raw['flash_id']}",
                "time": int(parsed_time.timestamp() * 1000),
                "lat": latitude,
                "lon": longitude,
                "polarity": 0,
                "deviation": 0,
            })
        except (TypeError, ValueError, OverflowError):
            continue
    return flashes



class ProviderError(Exception):
    def __init__(self, code, status=None):
        super().__init__(f"lightning-history: history: {code}")
        self.code, self.status = code, status

    def as_dict(self):
        return {"code": self.code, "provider": "lightning-history", "operation": "history", "status": self.status, "retryAfter": None}


class LightningHistoryProvider:
    def __init__(self, api_key, opener=urlopen, clock=lambda: int(time.time() * 1000), log=None):
        self.api_key, self.opener, self.clock = api_key, opener, clock
        self.log = log or (lambda entry: print(json.dumps(entry), flush=True))
        self.health = {"lastAttemptedFetch": None, "lastSuccessfulFetch": None, "sourceDataTimestamp": None, "expectedUpdateInterval": None, "lastError": None, "consecutiveFailures": 0, "available": False, "freshness": "never_loaded"}

    def history(self, minutes=1440):
        started = self.clock()
        self.health["lastAttemptedFetch"] = started
        try:
            if not self.api_key:
                raise ProviderError("configuration")
            request = Request(f"https://api.lightningapi.dev/v1/flashes?since_minutes={max(1, min(1440, minutes))}&limit=20000", headers={"X-API-Key": self.api_key, "Accept": "application/json"})
            try:
                with self.opener(request, timeout=15) as upstream:
                    body = json.load(upstream)
            except HTTPError as error:
                raise ProviderError("authentication" if error.code in (401, 403) else "rate_limited" if error.code == 429 else "upstream", error.code) from None
            except (TimeoutError, URLError) as error:
                raise ProviderError("timeout" if isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError) else "network") from None
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise ProviderError("parse") from None
            if not isinstance(body, dict) or not isinstance(body.get("flashes"), list):
                raise ProviderError("malformed")
            flashes = normalize_history_flashes(body["flashes"])
            if body["flashes"] and not flashes:
                raise ProviderError("malformed")
            rejected = len(body["flashes"]) - len(flashes)
            fetched = self.clock()
            self.health.update({"lastSuccessfulFetch": fetched, "sourceDataTimestamp": max((f["time"] for f in flashes), default=None), "lastError": ProviderError("malformed").as_dict() if rejected else None, "consecutiveFailures": 0, "available": True, "freshness": "malformed" if rejected else "fresh"})
            self.log({"provider": "lightning-history", "operation": "history", "success": not rejected, "duration": fetched - started, "records": len(flashes), "rejected": rejected, "sourceTimestamp": self.health["sourceDataTimestamp"], "freshness": self.health["freshness"]})
            # Authority/attribution are resolved by the canonical browser source registry.
            return {"flashes": flashes, "fetchedAt": fetched, "health": dict(self.health)}
        except ProviderError as error:
            self.health["lastError"] = error.as_dict()
            self.health["consecutiveFailures"] += 1
            self.health["freshness"] = "malformed" if error.code in ("parse", "malformed") else "unavailable" if error.code == "configuration" else "provider_error"
            self.log({"provider": "lightning-history", "operation": "history", "success": False, "duration": self.clock() - started, "error": error.as_dict(), "freshness": self.health["freshness"]})
            raise
