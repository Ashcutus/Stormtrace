import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('Python fallback provider normalizes with fetch provenance timing, reports failures and recovers without live APIs', () => {
  const script = `
import io, json
from urllib.error import HTTPError, URLError
from providers.lightning_history import LightningHistoryProvider, ProviderError
raw = {"flashes":[{"flash_id":"a","lat":51,"lon":-1,"flash_timestamp_utc":"2026-10-01T12:00:00Z"}]}
logs=[]
p = LightningHistoryProvider("secret", opener=lambda *a, **kw:io.BytesIO(json.dumps(raw).encode()), clock=lambda:123, log=logs.append)
r=p.history()
assert r["fetchedAt"]==123 and r["flashes"][0]["id"]=="provider:a"
assert p.health["freshness"]=="fresh"
assert "secret" not in json.dumps(logs)
for expected, failure in [("authentication",HTTPError("url",401,"auth",{},None)),("rate_limited",HTTPError("url",429,"rate",{},None)),("upstream",HTTPError("url",503,"outage",{},None)),("network",URLError("network")),("timeout",TimeoutError())]:
    def opener(*a, **kw): raise failure
    p.opener=opener
    try: p.history(); raise AssertionError("expected failure")
    except ProviderError as error: assert error.code==expected
assert p.health["consecutiveFailures"]==5
for payload, expected in [(b"broken","parse"),(b"{}","malformed")]:
    p.opener=lambda *a, **kw:io.BytesIO(payload)
    try: p.history(); raise AssertionError("expected failure")
    except ProviderError as error: assert error.code==expected
p.opener=lambda *a, **kw:io.BytesIO(b'{"flashes":[]}')
p.history()
assert p.health["consecutiveFailures"]==0 and p.health["lastError"] is None
print("ok")
`;
  assert.equal(execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim(), 'ok');
});
