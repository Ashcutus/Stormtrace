import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createStormtraceServer, normalizeHistoryFlashes } from "../server.js";

function request(port, path) {
  return new Promise((resolve, reject) => {
    const call = http.request({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    call.on("error", reject);
    call.end();
  });
}

test("server rejects malformed and non-file paths without terminating", async (context) => {
  const server = createStormtraceServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const malformed = await request(port, "/%ZZ");
  assert.equal(malformed.status, 400);
  assert.deepEqual(JSON.parse(malformed.body), { error: "Invalid request path" });

  for (const path of ["/.env", "/%2eenv", "/.git/config", "/providers/../.env"]) assert.equal((await request(port, path)).status, 404);

  const directory = await request(port, "/vendor/");
  assert.equal(directory.status, 404);

  const health = await request(port, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);

  const home = await request(port, "/");
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.headers["content-security-policy"], /unpkg/);
});

test("Node and Python fallback servers normalize history identically", () => {
  const input = [
    { flash_id: "valid", flash_timestamp_utc: "2026-10-01T12:30:00", lat: "51.5", lon: "-0.12" },
    { flash_id: "offset", flash_timestamp_utc: "2026-10-01T14:30:00+02:00", lat: 1, lon: 2 },
    { flash_id: "bad-time", flash_timestamp_utc: "never", lat: 0, lon: 0 },
    { flash_id: "bad-lat", flash_timestamp_utc: "2026-10-01T12:30:00Z", lat: 91, lon: 0 },
    { flash_id: "missing-lat", flash_timestamp_utc: "2026-10-01T12:30:00Z", lat: null, lon: 0 },
    { flash_timestamp_utc: "2026-10-01T12:30:00Z", lat: 0, lon: 0 },
  ];
  const python = execFileSync("python3", ["-c", [
    "import json, server, sys",
    "print(json.dumps(server.normalize_history_flashes(json.loads(sys.stdin.read())), separators=(',', ':')))"
  ].join("; ")], { input: JSON.stringify(input), encoding: "utf8" });
  assert.deepEqual(normalizeHistoryFlashes(input), JSON.parse(python));
});

test("manifest is the only hard-coded application version", () => {
  const version = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const file of ["index.html", "package.json", "server.js", "server.py", "start-app.sh"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes(version), false, `${file} duplicates ${version}`);
  }
});


test("warnings endpoint keeps optional setup and typed failures distinct from empty success", async (context) => {
  const provider = { apiKey: "", health: { available: false }, current: async () => ({ records: [], observations: [], health: { available: true } }) };
  const server = createStormtraceServer({ warningsProvider: provider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const missing = JSON.parse((await request(port, "/api/warnings")).body); assert.equal(missing.configured, false); assert.equal(missing.health.freshness, "unavailable");
  provider.apiKey = "test-secret"; const empty = JSON.parse((await request(port, "/api/warnings")).body); assert.equal(empty.configured, true); assert.deepEqual(empty.records, []); assert.doesNotMatch(JSON.stringify(empty), /test-secret/);
  provider.current = async () => { throw new Error("test-secret"); };
  const failed = await request(port, "/api/warnings"); assert.equal(failed.status, 502); assert.equal(JSON.parse(failed.body).providerError.code, "network"); assert.doesNotMatch(failed.body, /test-secret/);
});

test("Python fallback exposes warnings setup, normalized success, errors and hidden-file denial", () => {
  const output = execFileSync("python3", ["-c", `
import json,threading,urllib.request,urllib.error,server
from providers.metoffice_warnings import WarningError
class Stub:
    api_key=''
    health={'available':False}
    mode='success'
    def current(self):
        if self.mode=='failure': raise WarningError('authentication',401)
        return {'records':[], 'observations':[], 'health':{'available':True}}
server.WARNINGS_PROVIDER=Stub()
http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
t=threading.Thread(target=http.serve_forever,daemon=True); t.start()
def get(path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:'+str(http.server_port)+path) as r: return r.status,json.load(r)
    except urllib.error.HTTPError as e: return e.code,json.load(e)
assert get('/api/warnings')[1]['configured'] is False
server.WARNINGS_PROVIDER.api_key='test-secret'
assert get('/api/warnings')[1]['records']==[]
server.WARNINGS_PROVIDER.mode='failure'
status,body=get('/api/warnings'); assert status==502 and body['providerError']['code']=='authentication'
assert 'test-secret' not in json.dumps(body)
for path in ['/.env','/%2eenv','/.git/config']:
    assert get(path)[0]==404
    try: urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(http.server_port)+path,method='HEAD')); raise AssertionError('HEAD exposed hidden file')
    except urllib.error.HTTPError as e: assert e.code==404
http.shutdown(); http.server_close(); print('ok')
`], { encoding: 'utf8' }); assert.equal(output.trim(), 'ok');
});

test('radar HTTP routes serve normalized frames and PNG resources and sanitize failures', async (context) => {
  const provider = { health: {}, frames: async () => ({ records: [], missingDependencies: [] }), image: async (key) => { if (key !== 'test-frame') throw new Error('private details'); return Buffer.from([137,80,78,71]); } };
  const server = createStormtraceServer({ radarProvider: provider }); await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  context.after(() => new Promise((resolve) => server.close(resolve))); const { port } = server.address();
  const metadata=await request(port,'/api/radar');assert.equal(metadata.status,200);assert.deepEqual(JSON.parse(metadata.body).records,[]);
  const image=await request(port,'/api/radar/frame?key=test-frame');assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/png');
  const error=await request(port,'/api/radar/frame?key=arbitrary');assert.equal(error.status,502);assert.doesNotMatch(error.body,/private details/);
});
