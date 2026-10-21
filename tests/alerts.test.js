import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import vm from 'node:vm';
import C from '../core/index.js';
import '../client/presentation.js';
import '../client/warnings.js';
import '../client/public-hazards.js';
import '../client/floods.js';
import '../client/earthquakes.js';
import '../client/warning-map.js';
import '../client/hazard-alerts.js';
import { createStormtraceServer } from '../server.js';
import { sanitizeBarStatus, currentBarAlert, BAR_ALERT_MAX_MS } from '../platform/bar-status.js';

const A = globalThis.StormtraceHazardAlerts;
const now = Date.parse('2026-10-21T20:00:00Z');
const home = { lat: 50.4, lon: -4.1 }; // Plymouth
const square = (west, south, east, north) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const warning = (id, badge, geometry, validTo = now + 3600000) => ({ id, geometry, observedAt: now - 60000, validFrom: now, validTo, domainPayload: { badge, title: 'WIND' } });

test('only amber and red, unexpired warning areas containing the point match, most severe first', () => {
  const records = [warning('y', 'YELLOW', square(-6, 49, -2, 52)), warning('a', 'AMBER', square(-6, 49, -2, 52)), warning('r', 'RED', square(-5, 50, -3, 51)), warning('far', 'RED', square(0, 51, 1, 52)), warning('old', 'RED', square(-6, 49, -2, 52), now - 1)];
  const matches = A.warningMatches(records, home, now).sort((x, y) => x.rank - y.rank);
  assert.deepEqual(matches.map((m) => m.id), ['r', 'a']);
  assert.match(matches[0].title, /^Red weather warning at your location/);
  assert.match(matches[1].body, /Met Office: wind warning until .* UK local/);
});

test('flood alerts need an active warning (level 1 or 2) whose published area contains the point', () => {
  const flood = (id, level, areaId) => ({ id, domainPayload: { status: 'ACTIVE', level, areaId, classification: level === 1 ? 'Severe Flood Warning' : level === 2 ? 'Flood Warning' : 'Flood Alert', headline: 'River Tamar at Gunnislake', sourceTimes: { reviewed: '2026-10-21T19:00:00' } } });
  const areas = new Map([['inside', [square(-5, 50, -3, 51)]], ['outside', [square(0, 51, 1, 52)]]]);
  const matches = A.floodMatches([flood('w', 2, 'inside'), flood('alert', 3, 'inside'), flood('away', 1, 'outside'), flood('nogeometry', 1, 'missing')], areas, home);
  assert.deepEqual(matches.map((m) => m.id), ['w']);
  assert.match(matches[0].title, /^Flood Warning at your location/);
});

test('earthquake alerts respect magnitude, radius, unknown magnitude and the past day', () => {
  const quake = (id, magnitude, lon, lat, observedAt = now - 3600000) => ({ id, observedAt, geometry: { type: 'Point', coordinates: [lon, lat] }, domainPayload: { magnitude, place: 'Test place' } });
  const settings = A.readSettings({ quakes: true, quakeMagnitude: 5, quakeRadiusMiles: 300 });
  const matches = A.quakeMatches([quake('near', 5.4, -3, 51), quake('small', 4.2, -3, 51), quake('far', 7, 140, 35), quake('unknown', null, -3, 51), quake('old', 6, -3, 51, now - 2 * 86400000)], home, settings, now);
  assert.deepEqual(matches.map((m) => m.id), ['near']);
  assert.match(matches[0].title, /^M 5.4 earthquake \d+ miles away$/);
  assert.deepEqual(A.readSettings({ quakeMagnitude: 9, quakeRadiusMiles: -1, warnings: 'yes' }), { warnings: false, floods: false, quakes: false, quakeMagnitude: 5, quakeRadiusMiles: 300 });
});

test('checks notify each source revision once across restarts, keep matches through a failed retrieval, and stay off in demo or without a location', async () => {
  const esri = { configured: true, records: [], observations: [], health: { ...C.health(300000), available: true, lastSuccessfulFetch: now } };
  const geometry = square(-6, 49, -2, 52);
  esri.records.push({ id: 'metoffice-warnings-esri:1', provider: 'metoffice-warnings-esri', kind: 'warning', sourceAuthority: 'Met Office', observedAt: now - 60000, updatedAt: null, validFrom: now, validTo: now + 3600000, geometry,
    sourceSeverity: { level: 'AMBER' }, displayPriority: 'high', provenance: { provider: 'metoffice-warnings-esri', sourceAuthority: 'Met Office', upstreamId: '1', fetchedAt: now, observedAt: now - 60000, updatedAt: null, transformations: [] },
    domainPayload: { title: 'WIND', badge: 'AMBER', url: 'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings', body: 'Storm', instruction: '', mode: 'warning', details: [], headline: 'Damaging winds', whatToExpect: 'Disruption' } });
  let fail = false, calls = 0; const stored = {}; const delivered = [];
  const storage = { getItem: (k) => stored[k] ?? null, setItem: (k, v) => { stored[k] = v; } };
  const fetcher = async (url) => { calls++; if (fail) throw new Error('offline'); assert.equal(url, '/api/hazards?source=metoffice-warnings-esri'); return { ok: true, json: async () => esri }; };
  const make = (options = {}) => A.create({ fetch: fetcher, now: () => now, getLocation: () => home, getSettings: () => ({ warnings: true }), notify: (m) => { delivered.push(m.key); return true; }, storage, ...options });
  let alerts = make();
  try { globalThis.StormtraceWarningMap.valid(esri); } catch (error) { assert.fail('fixture must satisfy the warning-map validator: ' + error.message); }
  await alerts.check();
  assert.equal(alerts.state.matches.length, 1); assert.equal(delivered.length, 1);
  await alerts.check(); assert.equal(delivered.length, 1, 'same revision is not notified twice');
  alerts = make(); await alerts.check(); assert.equal(delivered.length, 1, 'remembered across a restart');
  fail = true; await alerts.check();
  assert.equal(alerts.state.matches.length, 1, 'a failed retrieval keeps the last known match'); assert.equal(alerts.state.status.warning.error, true);
  const before = calls;
  await make({ demo: true }).check(); await make({ getLocation: () => null }).check(); await make({ getSettings: () => ({}) }).check();
  assert.equal(calls, before, 'demo, missing location and disabled alerts make no requests');
});

test('bar alerts are bounded, expire on their own and reject unknown kinds', () => {
  const ok = sanitizeBarStatus({ alert: { kind: 'lightning', title: 'Lightning\nwithin 20 miles', until: now + 60000 } }, now);
  assert.deepEqual(ok, { kind: 'lightning', title: 'Lightning within 20 miles', until: now + 60000 });
  assert.deepEqual(currentBarAlert(ok, now), { kind: 'lightning', title: 'Lightning within 20 miles' });
  assert.equal(currentBarAlert(ok, now + 60000), null);
  assert.equal(sanitizeBarStatus({ alert: null }, now), null);
  for (const bad of [{ alert: { kind: 'other', until: now + 1 } }, { alert: { kind: 'flood', until: now - 1 } }, { alert: { kind: 'flood', until: now + BAR_ALERT_MAX_MS + 1 } }, {}]) assert.throws(() => sanitizeBarStatus(bad, now));
  assert.equal(sanitizeBarStatus({ alert: { kind: 'warning', title: 'x'.repeat(400), until: now + 1 } }, now).title.length, 140);
});

const request = (port, path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, data })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});

test('both servers accept same-origin bar status, expose it through health and reject foreign origins', async (context) => {
  const make = (id) => ({ id, health: {}, frames: async () => ({ records: [] }), image: async () => Buffer.from('') });
  const server = createStormtraceServer({ radarProvider: make('metoffice-radar'), publicRadarProviders: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port, body = JSON.stringify({ alert: { kind: 'flood', title: 'Flood Warning at your location', until: Date.now() + 60000 } });
  assert.equal((await request(port, '/api/bar-status', { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(port, '/api/bar-status', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request(port, '/api/bar-status', { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` } })).status, 200);
  assert.deepEqual(JSON.parse((await request(port, '/api/health')).data).alert, { kind: 'flood', title: 'Flood Warning at your location' });
  await request(port, '/api/bar-status', { method: 'POST', body: JSON.stringify({ alert: null }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(JSON.parse((await request(port, '/api/health')).data).alert, null);
  assert.equal(execFileSync('python3', ['-c', `
import json,threading,time,urllib.request,urllib.error,server
http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(http.server_port)
def post(body,headers):
 req=urllib.request.Request(base+'/api/bar-status',data=json.dumps(body).encode(),headers=headers,method='POST')
 try:
  with urllib.request.urlopen(req) as r:return r.status
 except urllib.error.HTTPError as e:return e.code
alert={'alert':{'kind':'flood','title':'Flood Warning at your location','until':int(time.time()*1000)+60000}}
assert post(alert,{'Content-Type':'application/json','Origin':'https://evil.example'})==403
assert post(alert,{'Content-Type':'text/plain'})==415
assert post({'alert':{'kind':'other','until':int(time.time()*1000)+1000}},{'Content-Type':'application/json'})==400
assert post(alert,{'Content-Type':'application/json'})==200
with urllib.request.urlopen(base+'/api/health') as r:assert json.load(r)['alert']=={'kind':'flood','title':'Flood Warning at your location'}
assert post({'alert':None},{'Content-Type':'application/json'})==200
with urllib.request.urlopen(base+'/api/health') as r:assert json.load(r)['alert'] is None
http.shutdown();http.server_close();print('ok')
`], { encoding: 'utf8' }).trim(), 'ok');
});

test('the bar widget reads only known alert kinds from health and ignores anything else', () => {
  const qml = readFileSync(new URL('../BarWidget.qml', import.meta.url), 'utf8');
  const code = qml.match(/  function alertFrom\(output\) \{[\s\S]*?\n  \}/)[0];
  const context = vm.createContext({}); vm.runInContext(code, context);
  assert.equal(JSON.stringify(context.alertFrom(JSON.stringify({ alert: { kind: 'lightning', title: 'Lightning within 20 miles' } }))), JSON.stringify({ kind: 'lightning', title: 'Lightning within 20 miles' }));
  for (const text of ['invalid', '{}', JSON.stringify({ alert: { kind: 'other' } }), JSON.stringify({ alert: null })]) assert.equal(context.alertFrom(text).kind, '');
  assert.ok(qml.includes('dimmed: !root.serverReady') && qml.includes('active: root.serverReady && root.alertKind !== ""'), 'urgent colour is reserved for alerts');
});
