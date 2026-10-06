import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import C from '../core/index.js';
import '../platform/browser.js';
import '../platform/strike-cache.js';
import { loadApp } from './helpers/app-harness.js';
const P = globalThis.StormtracePlatform;
const source = C.getSource('metoffice-warnings');
const warning = () => C.event({ id: 'w1', kind: 'warning', provider: source.id, sourceAuthority: source.authority, observedAt: 100, updatedAt: 110, validFrom: 120, validTo: 500, provenance: C.provenance(source, { fetchedAt: 130, upstreamId: 'official-w1', observedAt: 100, updatedAt: 110 }), sourceSeverity: 'Amber', domainPayload: { headline: 'Heavy rain', classification: 'Amber' } });

test('IndexedDB revisions survive close/reopen, preserve timestamps, deduplicate across connections and roll back', async () => {
  const idb = new IDBFactory(); const a = await P.IndexedDBStorageAdapter.open(idb), b = await P.IndexedDBStorageAdapter.open(idb);
  const ha = new C.RevisionHistory(a, { now: () => 140 }), hb = new C.RevisionHistory(b);
  const results = await Promise.all([ha.record(warning()), hb.record(warning())]); assert.equal(results.filter((r) => r.added).length, 1);
  await assert.rejects(a.update('test', () => { throw new Error('abort'); }), /abort/); assert.equal(await a.get('test'), null);
  await ha.record({ ...warning(), updatedAt: 200, domainPayload: { headline: 'Updated rain', classification: 'Amber' } });
  a.close(); b.close();
  const reopened = await P.IndexedDBStorageAdapter.open(idb); const history = new C.RevisionHistory(reopened);
  const revisions = await history.revisions(source.id, 'w1'); assert.equal(revisions.length, 2);
  assert.equal(revisions[0].event.provenance.fetchedAt, 130); assert.equal(revisions[0].event.observedAt, 100); assert.equal(revisions[0].event.updatedAt, 110); assert.equal(revisions[0].persistedAt, 140);
  assert.equal((await history.query({ from: 140, to: 140, time: 'persistedAt' })).length, 2);
  assert.equal(await history.retain({ before: 10000, provider: 'lightningmaps', keepLatest: false }), 0);
  assert.equal((await history.revisions(source.id, 'w1')).length, 2);
  reopened.close();
});

test('existing strike database and settings survive additive revision database initialization', async () => {
  const idb = new IDBFactory(); globalThis.indexedDB = idb; globalThis.IDBKeyRange = IDBKeyRange;
  const db = await P.strikeStorage.open();
  await new Promise((resolve) => P.strikeStorage.write(db, [{ id: 'legacy', time: 100, lat: 51, lon: -1 }], resolve));
  const revisions = await P.IndexedDBStorageAdapter.open(idb); revisions.close();
  assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames], ['strikes']);
  assert.deepEqual(await P.strikeStorage.load(db, 0, 30000), [{ id: 'legacy', time: 100, lat: 51, lon: -1 }]);
  db.close(); const again = await P.strikeStorage.open(); assert.equal((await P.strikeStorage.load(again, 0, 30000)).length, 1); again.close();
  const app = loadApp({ storage: { getItem: () => JSON.stringify({ userLocation: { lat: 51, lon: -1, accuracy: 20000, source: 'automatic' }, radiusMiles: 25 }), setItem() {} } });
  assert.equal(app.state.userLocation.accuracy, 20000); assert.equal(app.state.radiusMiles, 25);
  delete globalThis.indexedDB; delete globalThis.IDBKeyRange;
});

test('notification intent and location use replaceable browser adapters', async () => {
  const original = { navigator: globalThis.navigator, Notification: globalThis.Notification, location: globalThis.StormtraceLocation };
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { mock: true } } });
    globalThis.StormtraceLocation = { locate: async (geo) => { assert.equal(geo.mock, true); return { coords: { latitude: 51, longitude: -1, accuracy: 100 } }; } };
    assert.equal(P.locationAdapter.available(), true); assert.equal((await P.locationAdapter.current()).coords.latitude, 51);
    let received;
    globalThis.Notification = class { static permission = 'granted'; static async requestPermission() { return 'granted'; } constructor(title, options) { received = { title, ...options }; } close() {} };
    const intent = { title: 'Nearby lightning', body: '1 mile away', tag: 'nearby' }; assert.equal(P.notificationAdapter.permission(), 'granted'); assert.equal(await P.notificationAdapter.requestPermission(), 'granted'); P.notificationAdapter.show(intent); assert.equal(received.title, intent.title); assert.equal(received.body, intent.body);
  } finally { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator }); globalThis.Notification = original.Notification; globalThis.StormtraceLocation = original.location; }
});

test('core and presentation boundaries prevent Linux APIs, raw upstream payloads and persistence APIs leaking back', () => {
  for (const file of ['core/model.js', 'core/geometry.js', 'core/history.js', 'core/cap.js']) assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /node:|GeoClue|DBus|Gio\.|GLib\.|hyprctl|localStorage|indexedDB|Notification|navigator\./);
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8'); assert.doesNotMatch(app, /payload\.strokes|flash_timestamp_utc|display_name|navigator\.geolocation|new Notification|indexedDB\.|IDBKeyRange|localStorage|\.objectStore\(/);
});

test('Python Linux storage adapter retains original profile locations without requiring GTK', () => {
  const output = execFileSync('python3', ['-c', 'import tempfile, pathlib, stormtrace_platform; root=tempfile.mkdtemp(); G=type("G",(),{"get_user_data_dir":staticmethod(lambda:root+"/data"),"get_user_cache_dir":staticmethod(lambda:root+"/cache")}); a,b=stormtrace_platform.profile_paths(G); assert a==pathlib.Path(root)/"data"/"stormtrace"; assert b==pathlib.Path(root)/"cache"/"stormtrace"; print("ok")'], { encoding: 'utf8' }); assert.equal(output.trim(), 'ok');
});

test('V1 application receives normalized live/backfill data and persists source revisions end to end', async () => {
  const idb = new IDBFactory();
  const app = loadApp({ indexedDB: idb, keyRange: IDBKeyRange, fetch: async () => ({ ok: true, json: async () => ({ configured: true, fetchedAt: 1800000000000, flashes: [{ id: 'provider:historic', time: 1799999999000, lat: 51, lon: -1, polarity: 0, deviation: 0 }], health: { freshness: 'fresh' } }) }) });
  await app.initializeRevisionHistory();
  app.connectFeed();
  app.sockets[0].onmessage({ data: JSON.stringify({ strokes: [{ id: 'live', time: app.now(), lat: 51, lon: -1, pol: -1, dev: 20 }] }) });
  await app.loadProviderHistory();
  await app.persistRevisions([...app.state.strikes.values()]);
  const live = await app.state.revisionHistory.revisions('lightningmaps', 'live');
  const backfill = await app.state.revisionHistory.revisions('lightning-history', 'provider:historic');
  assert.equal(live.length, 1); assert.equal(live[0].event.provenance.upstreamId, 'live'); assert.equal(live[0].event.domainPayload.polarity, -1);
  assert.equal(backfill.length, 1); assert.equal(backfill[0].event.provenance.upstreamId, 'historic'); assert.equal(backfill[0].event.provenance.fetchedAt, app.now());
  assert.equal(app.state.providerHealth['lightningmaps'].freshness, 'fresh');
  app.state.revisionHistory.storage.close();
});
