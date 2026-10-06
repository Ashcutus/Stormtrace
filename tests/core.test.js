import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import C from '../core/index.js';
import '../platform/browser.js';
const { MemoryStorageAdapter } = globalThis.StormtracePlatform;
const source = C.getSource('usgs');
const observedAt = Date.parse('2026-10-01T12:00:00Z');
const makeEvent = (overrides = {}) => C.event({ id: 'eq1', kind: 'earthquake', provider: source.id, sourceAuthority: source.authority, observedAt, sourceSeverity: { magnitude: 5.2, status: 'reviewed' }, geometry: { type: 'Point', coordinates: [-1, 51] }, provenance: C.provenance(source, { fetchedAt: observedAt + 1000, observedAt, upstreamId: 'native-eq1', transformations: ['fixture-v1'] }), domainPayload: { magnitude: 5.2, depthKm: 10, status: 'reviewed' }, ...overrides });

test('source registry is complete, immutable and does not activate deferred providers', () => {
  const categories = new Set(Object.values(C.sourceRegistry).flatMap((s) => s.categories));
  for (const kind of ['radar', 'warning', 'earthquake', 'cyclone', 'volcano', 'tsunami', 'space_weather']) assert.ok(categories.has(kind));
  for (const s of Object.values(C.sourceRegistry)) for (const key of ['name', 'authority', 'description', 'coverage', 'categories', 'homepage', 'attribution', 'licence', 'authentication', 'expectedUpdateInterval', 'historicalData', 'commercialUse', 'status', 'notes']) assert.ok(Object.hasOwn(s, key), `${s.id}.${key}`);
  assert.throws(() => { source.name = 'wrong'; }, TypeError);
  assert.throws(() => C.getSource('missing'), { code: 'configuration' });
  assert.throws(() => C.getSource('__proto__'), { code: 'configuration' });
  const registry = new C.ProviderRegistry(); assert.equal(registry.get('usgs'), null);
  const provider = { id: 'lightningmaps' }; registry.register(provider); assert.equal(registry.get(provider.id), provider);
  assert.throws(() => registry.register(provider), { code: 'configuration' });
});

test('event provenance retains authority, timestamps, native classification and domain payload', () => {
  const event = makeEvent();
  assert.deepEqual(event.sourceSeverity, { magnitude: 5.2, status: 'reviewed' });
  assert.equal(event.displayPriority, 'normal'); assert.equal(event.provenance.upstreamId, 'native-eq1');
  assert.equal(event.provenance.fetchedAt, observedAt + 1000); assert.equal(event.provenance.observedAt, observedAt);
  assert.throws(() => C.provenance(source, { fetchedAt: NaN }), TypeError);
  assert.throws(() => makeEvent({ observedAt: NaN }), TypeError);
  assert.throws(() => makeEvent({ displayPriority: 'danger-score-99' }), TypeError);
  assert.throws(() => makeEvent({ provider: 'other' }), TypeError);
  const cyclone = makeEvent({ kind: 'cyclone', domainPayload: { tracks: [{ type: 'LineString', coordinates: [[0, 0], [1, 1]] }], forecast: [{ at: observedAt + 10000, classification: 'Tropical Storm' }], cones: [] }, sourceSeverity: 'Tropical Storm' });
  assert.equal(cyclone.domainPayload.forecast[0].classification, 'Tropical Storm');
});

test('immutable revisions deduplicate fetches and key order but retain meaningful changes and reversions', async () => {
  const storage = new MemoryStorageAdapter(); let now = observedAt + 2000;
  const history = new C.RevisionHistory(storage, { now: () => now++ });
  const event = makeEvent(); const first = await history.record(event); assert.equal(first.added, true);
  event.domainPayload.depthKm = 999;
  assert.equal((await history.revisions('usgs', 'eq1'))[0].event.domainPayload.depthKm, 10);
  const refetched = makeEvent({ provenance: { ...makeEvent().provenance, fetchedAt: observedAt + 3000 }, domainPayload: { status: 'reviewed', depthKm: 10, magnitude: 5.2 } });
  assert.equal((await history.record(refetched)).added, false);
  const changed = makeEvent({ updatedAt: observedAt + 3000, domainPayload: { magnitude: 5.3, depthKm: 11, status: 'reviewed' } });
  assert.equal((await history.record(changed)).revision.sequence, 2);
  assert.equal((await history.record(makeEvent())).revision.sequence, 3);
  const reopened = new C.RevisionHistory(storage);
  const revisions = await reopened.revisions('usgs', 'eq1'); assert.equal(revisions.length, 3);
  revisions[0].event.sourceSeverity.magnitude = 99;
  assert.equal((await reopened.revisions('usgs', 'eq1'))[0].event.sourceSeverity.magnitude, 5.2);
  assert.equal((await history.query({ from: observedAt, to: observedAt })).length, 3);
  assert.equal((await history.query({ from: observedAt + 3000, to: observedAt + 3000, time: 'updatedAt' })).length, 1);
  assert.equal((await history.query({ provider: 'other' })).length, 0);
  assert.equal((await history.query({ from: observedAt + 1000, to: observedAt + 1000, time: 'fetchedAt' })).length, 3);
  assert.equal(await history.retain({ before: Infinity }).catch((e) => e.name), 'TypeError');
  assert.equal(await history.retain({ before: now, keepLatest: true }), 2);
  assert.equal((await history.revisions('usgs', 'eq1'))[0].sequence, 3);
  assert.equal((await history.record(changed)).revision.sequence, 4);
  assert.equal(await history.retain({ before: now + 100, keepLatest: false }), 2);
  assert.deepEqual(await storage.entries(), []);
});

test('atomic storage prevents concurrent duplicate revisions and isolates providers', async () => {
  const storage = new MemoryStorageAdapter(); const a = new C.RevisionHistory(storage), b = new C.RevisionHistory(storage);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).record(makeEvent())));
  assert.equal(results.filter((r) => r.added).length, 1);
  const other = C.getSource('metoffice-warnings');
  await a.record(makeEvent({ provider: other.id, sourceAuthority: other.authority, provenance: C.provenance(other, { fetchedAt: observedAt }) }));
  assert.equal((await storage.entries()).length, 2);
  await assert.rejects(storage.update('fail', () => { throw new Error('quota'); }));
  await storage.update('recovery', () => ({ ok: true })); assert.deepEqual(await storage.get('recovery'), { ok: true });
});

test('freshness distinguishes all required states and ages source data independently from fetching', () => {
  const state = C.health(100); assert.equal(C.freshness(state, 1000), 'never_loaded');
  state.lastAttemptedFetch = 1000; assert.equal(C.freshness(state, 1000), 'unavailable');
  Object.assign(state, { lastSuccessfulFetch: 1000, sourceDataTimestamp: 1000, available: true });
  assert.equal(C.freshness(state, 1100), 'fresh'); assert.equal(C.freshness(state, 1200), 'delayed'); assert.equal(C.freshness(state, 1400), 'stale');
  state.lastSuccessfulFetch = 1400; assert.equal(C.freshness(state, 1400), 'stale');
  state.lastError = { code: 'network' }; assert.equal(C.freshness(state, 1400), 'provider_error');
  state.lastError = { code: 'parse' }; assert.equal(C.freshness(state, 1400), 'malformed');
  state.lastError = { code: 'configuration' }; assert.equal(C.freshness(state, 1400), 'unavailable');
});

test('provider runner isolates failures, sanitizes logs, validates results and recovers', async () => {
  let now = 1000; const logs = [];
  const runner = new C.ProviderRunner(source, { now: () => now++, log: (e) => logs.push(e) });
  await assert.rejects(runner.run('query', async () => { throw new Error('secret-token-and-raw-payload'); }), { code: 'network' });
  assert.equal(runner.health.consecutiveFailures, 1); assert.equal(runner.health.lastSuccessfulFetch, null);
  await assert.rejects(runner.run('query', async () => ({ records: {} })), { code: 'malformed' });
  assert.equal(runner.health.consecutiveFailures, 2);
  const result = await runner.run('query', async () => ({ records: [makeEvent()], sourceDataTimestamp: 1000 }));
  assert.equal(result.health.consecutiveFailures, 0); assert.equal(result.health.lastError, null); assert.equal(result.records.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /secret-token/); assert.equal(logs.at(-1).provider, 'usgs'); assert.ok(logs.at(-1).duration >= 0);
  const healthy = new C.ProviderRunner(C.getSource('swpc')); await healthy.run('current', async () => ({ records: [] })); assert.equal(healthy.health.lastError, null);
  for (const [status, code] of [[401, 'authentication'], [403, 'authentication'], [429, 'rate_limited'], [503, 'upstream']]) assert.equal(C.httpError(status, 'usgs', 'query').code, code);
  assert.equal(C.providerError({ name: 'TimeoutError' }, 'usgs', 'query').code, 'timeout');
  assert.equal(C.providerError({ name: 'AbortError' }, 'usgs', 'query').code, 'timeout');
});

test('GeoJSON validation, detached normalization, bounds, distance and map interchange', () => {
  for (const geometry of [ { type: 'Point', coordinates: [-1, 51] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }, { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] }, { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 0]]]] } ]) {
    assert.deepEqual(C.normalizeGeometry(JSON.stringify(geometry)), geometry);
    assert.equal(C.geometryFeature(geometry).type, 'Feature');
  }
  for (const geometry of [null, 'bad-json', { type: 'Point', coordinates: [181, 0] }, { type: 'Point', coordinates: [0, NaN] }, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] }, { type: 'LineString', coordinates: [[0, 0]] }, { type: 'constructor', coordinates: [] }]) assert.equal(C.normalizeGeometry(geometry), null);
  assert.deepEqual(C.geometryBounds({ type: 'LineString', coordinates: [[-1, 50], [3, 55]] }), [-1, 50, 3, 55]);
  assert.ok(Math.abs(C.distanceKm([0, 0], [1, 0]) - 111.195) < 0.01); assert.equal(C.distanceKm([0, 91], [1, 0]), null);
  const g = { type: 'Point', coordinates: [0, 0] }; const copy = C.normalizeGeometry(g); copy.coordinates[0] = 2; assert.equal(g.coordinates[0], 0);
});

test('point in polygons handles holes, boundaries, multipolygons and dateline', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  const g = { type: 'Polygon', coordinates: [outer, hole] };
  assert.equal(C.pointInPolygon([2, 2], g), true); assert.equal(C.pointInPolygon([5, 5], g), false); assert.equal(C.pointInPolygon([0, 2], g), true); assert.equal(C.pointInPolygon([20, 2], g), false);
  assert.equal(C.pointInPolygon([2, 2], { type: 'MultiPolygon', coordinates: [g.coordinates] }), true);
  const dateline = { type: 'Polygon', coordinates: [[[179, -2], [-179, -2], [-179, 2], [179, 2], [179, -2]]] };
  assert.equal(C.pointInPolygon([180, 0], dateline), true); assert.equal(C.pointInPolygon([0, 0], dateline), false);
});

test('CAP fixtures preserve native severity, languages, geometry, references and extensions', () => {
  const cap = C.parseCAP(readFileSync(new URL('./fixtures/warning.cap.xml', import.meta.url), 'utf8'));
  assert.equal(cap.identifier, 'warning-2'); assert.equal(cap.msgType, 'Update'); assert.equal(cap.info.length, 2);
  assert.equal(cap.info[0].severity, 'Severe'); assert.equal(cap.info[0].parameters[0].value, 'Amber');
  assert.equal(cap.info[0].headline, 'Rain & flooding'); assert.equal(cap.info[0].description, 'Water may rise <rapidly>.');
  assert.deepEqual(cap.info[0].areas[0].geometries[0].coordinates[0][0], [-2, 50]);
  assert.deepEqual(cap.info[0].areas[0].circles[0], { centre: [-1, 51], radiusKm: 25 });
  assert.equal(cap.references[0].identifier, 'warning-1'); assert.equal(cap.raw.children.find((n) => n.name === 'extension').text, 'retained'); assert.deepEqual(cap.diagnostics, []);
});

test('imperfect CAP produces diagnostics while unsafe or broken XML is rejected', () => {
  const cap = C.parseCAP(readFileSync(new URL('./fixtures/imperfect.cap.xml', import.meta.url), 'utf8'));
  assert.equal(cap.sent, null); assert.equal(cap.info[0].expires, null); assert.ok(cap.diagnostics.length >= 5);
  assert.equal(cap.info[0].areas[0].geometries[0].coordinates[0].length, 4); assert.equal(cap.info[0].areas[0].circles[0].radiusKm, 0);
  for (const xml of ['<alert><info></alert>', '<!DOCTYPE alert [<!ENTITY x SYSTEM "file:///etc/passwd">]><alert>&x;</alert>', '<alert>&unknown;</alert>', '<alert/><alert/>', '<alert><bad attr=unquoted /></alert>', '<alert>&#x110000;</alert>', '<alert a="1" a="2"/>', '<alert>' + '<x>'.repeat(70) + '</x>'.repeat(70) + '</alert>']) assert.throws(() => C.parseCAP(xml), { code: 'parse' });
  assert.throws(() => C.parseCAP('<alert xmlns="urn:unsupported"/>'), { code: 'unsupported_schema' });
});

test('provider-scoped count retention bounds local history without evicting other domains', async () => {
  const storage = new MemoryStorageAdapter(); let clock = 100;
  const history = new C.RevisionHistory(storage, { now: () => clock++ });
  for (let i = 0; i < 5; i++) await history.record(makeEvent({ id: `eq${i}` }));
  assert.equal(await history.retain({ before: 0, provider: 'lightningmaps', maxEvents: 0 }), 0);
  assert.equal(await history.retain({ before: 0, provider: 'usgs', maxEvents: 2 }), 3);
  assert.deepEqual((await storage.entries()).map(([, row]) => row.eventId).sort(), ['eq3', 'eq4']);
  await assert.rejects(history.retain({ before: 0, maxEvents: -1 }), TypeError);
});

test('CAP namespace extensions cannot overwrite native alert severity', () => {
  const cap = C.parseCAP('<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2" xmlns:ext="urn:extension"><identifier>a</identifier><sender>b</sender><sent>2026-10-01T12:00:00Z</sent><info><ext:severity>Extreme</ext:severity><severity>Minor</severity></info></alert>');
  assert.equal(cap.info[0].severity, 'Minor'); assert.equal(cap.info[0].raw.children[0].text, 'Extreme');
  assert.throws(() => C.parseCAP('<cap:alert/>'), { code: 'parse' });
});

test('CAP warnings can preserve official colour, provenance, geometry and local revisions', async () => {
  const cap = C.parseCAP(readFileSync(new URL('./fixtures/warning.cap.xml', import.meta.url), 'utf8'));
  const source = C.getSource('metoffice-warnings'), info = cap.info[0];
  const warning = C.event({ id: cap.identifier, kind: 'warning', provider: source.id, sourceAuthority: source.authority, observedAt: cap.sent, validFrom: info.onset, validTo: info.expires, geometry: info.areas[0].geometries[0], sourceSeverity: { colour: info.parameters[0].value, capSeverity: info.severity }, provenance: C.provenance(source, { fetchedAt: cap.sent + 1000, upstreamId: cap.identifier, observedAt: cap.sent, transformations: ['synthetic-cap-fixture'] }), domainPayload: { headline: info.headline, description: info.description, instruction: info.instruction, classification: 'Amber', cap } });
  const history = new C.RevisionHistory(new MemoryStorageAdapter());
  await history.record(warning); await history.record({ ...warning, updatedAt: cap.sent + 2000, domainPayload: { ...warning.domainPayload, instruction: 'Updated official advice' } });
  const revisions = await history.revisions(source.id, cap.identifier);
  assert.equal(revisions.length, 2); assert.equal(revisions[0].event.sourceSeverity.colour, 'Amber'); assert.equal(revisions[0].event.domainPayload.cap.references[0].identifier, 'warning-1');
  assert.equal(revisions[0].event.provenance.upstreamId, cap.identifier); assert.equal(revisions[0].event.geometry.type, 'Polygon');
  assert.equal(C.provenanceFreshness(C.provenance(C.getSource('lightningmaps'), { fetchedAt: 1000, observedAt: 1000 }), 200000), 'stale');
});
