import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { IDBFactory } from 'fake-indexeddb';
import C from '../core/index.js';
import '../platform/browser.js';
import '../client/warnings.js';
import { MetOfficeWarningsProvider, WARNINGS_BASE, normalizeWarningCollection, parseWarningFeed, warningLink } from '../providers/metoffice-warnings.js';
const W = globalThis.StormtraceWarnings, P = globalThis.StormtracePlatform;
const fixture = (name) => readFileSync(new URL(`fixtures/nswws/${name}`, import.meta.url), 'utf8');
const collection = (name = 'issued') => JSON.parse(fixture(`${name}.json`));
const start = Date.parse('2026-10-06T11:00:00Z');
const reply = (value, status = 200) => ({ ok: status === 200, status, text: async () => value, json: async () => value });
const python = (code, input = '') => JSON.parse(execFileSync('python3', ['-c', code], { encoding: 'utf8', input }));

function upstream() {
  let phase = 'issued', time = start;
  const calls = [], logs = [];
  const provider = new MetOfficeWarningsProvider({ apiKey: 'test-secret', now: () => time, log: (e) => logs.push(e), fetch: async (url, options) => {
    calls.push(url); assert.equal(options.headers.apikey, 'test-secret'); assert.equal(options.redirect, 'error');
    if (url === `${WARNINGS_BASE}feed`) return reply(fixture(`${phase}.xml`));
    const kind = url.includes('/updated/') ? url.split('/').at(-2) : phase === 'cancelled' ? 'empty' : phase;
    return reply(fixture(`${kind}.json`));
  } });
  return { provider, calls, logs, next: (value) => { phase = value; time += 60000; }, clock: () => time };
}

test('NSWWS normalization retains native severity, geometry, official text, IDs, all dates and unknown fields', () => {
  const record = normalizeWarningCollection(collection(), start)[0];
  assert.equal(record.id, collection().features[0].properties.warningId);
  assert.deepEqual(record.sourceSeverity, { classification: 'YELLOW', impact: 2, likelihood: 3 });
  assert.equal(record.displayPriority, 'normal'); assert.equal(record.provenance.fetchedAt, start);
  assert.equal(record.provenance.observedAt, record.observedAt); assert.equal(record.provenance.updatedAt, record.updatedAt);
  assert.equal(record.domainPayload.sourceFields.futureSourceField.retained, true);
  assert.equal(record.domainPayload.whatToExpect.length, 2); assert.equal(record.geometry.type, 'MultiPolygon');
  assert.equal(C.pointInPolygon([-1, 51], record.geometry), true);
  assert.equal(normalizeWarningCollection(collection('updated'), start)[0].displayPriority, 'high');
  const red = collection(); red.features[0].properties.warningLevel = 'RED'; assert.equal(normalizeWarningCollection(red, start)[0].displayPriority, 'urgent');
});

test('invalid snapshots fail as a whole; empty success differs from malformed data', () => {
  assert.deepEqual(normalizeWarningCollection(collection('empty'), start), []);
  for (const mutate of [
    (p) => { p.features[0].properties.warningId = ''; },
    (p) => { p.features[0].properties.warningLevel = 'PURPLE'; },
    (p) => { p.features[0].properties.warningLikelihood = 0; },
    (p) => { p.features[0].properties.warningStatus = 'UNKNOWN'; },
    (p) => { p.features[0].properties.validToDate = '2026-10-01T00:00:00Z'; },
    (p) => { p.features[0].properties.modifiedDate = 'bad'; },
    (p) => { p.features[0].geometry.coordinates[0][0][0][0] = 200; },
    (p) => { p.features.push(p.features[0]); },
  ]) { const payload = collection(); mutate(payload); assert.throws(() => normalizeWarningCollection(payload, start), { code: 'malformed' }); }
  assert.throws(() => normalizeWarningCollection({ features: [] }, start), { code: 'malformed' });
});

test('Atom parsing supports namespaces and rejects unsafe links, DTDs, malformed XML and duplicate entries', () => {
  const feed = parseWarningFeed(fixture('cancelled.xml')); assert.equal(feed.entries.length, 3); assert.equal(feed.entries[0].id, 'urn:uuid:issued');
  const qualified = fixture('issued.xml').replace('<feed xmlns=', '<a:feed xmlns:a=').replace('</feed>', '</a:feed>').replace(/<(\/?)(id|updated|link|entry)(?=[ >])/g, '<$1a:$2');
  assert.deepEqual(parseWarningFeed(qualified), parseWarningFeed(fixture('issued.xml')));
  for (const url of ['https://evil.example/issued/abc', `${WARNINGS_BASE}updated/abc`, `${WARNINGS_BASE}issued/abc?key=x`, `${WARNINGS_BASE}issued/abc#x`, 'file:///issued/abc', `${WARNINGS_BASE}issued/a%2fb`]) assert.throws(() => warningLink(url, 'issued'), { code: 'malformed' });
  for (const xml of ['<!DOCTYPE feed [<!ENTITY a "x">]>' + fixture('issued.xml'), '<feed>', fixture('issued.xml').replace('</feed>', '<entry><id>urn:uuid:issued</id><updated>2026-10-06T08:00:00Z</updated><link rel="alternate" href="' + WARNINGS_BASE + 'updated/issued/"/></entry></feed>')]) assert.throws(() => parseWarningFeed(xml));
});

test('provider polls event-driven feed, reuses immutable snapshots, coalesces requests and replays observations to every client', async () => {
  const s = upstream(); const [first, other] = await Promise.all([s.provider.current(), s.provider.current()]); assert.deepEqual(first, other); assert.equal(s.calls.length, 3);
  first.records[0].domainPayload.headline = 'client mutation'; assert.notEqual((await s.provider.current()).records[0].domainPayload.headline, 'client mutation'); assert.equal(s.calls.length, 3);
  s.next('issued'); const unchanged = await s.provider.current(); assert.equal(s.calls.length, 4); assert.equal(unchanged.observations.length, 1);
  s.next('updated'); const updated = await s.provider.current(); assert.equal(updated.records[0].domainPayload.classification, 'AMBER'); assert.equal(updated.observations.length, 2);
  s.next('cancelled'); const cancelled = await s.provider.current(); assert.deepEqual(cancelled.records, []); assert.equal(cancelled.observations.at(-1).domainPayload.status, 'CANCELLED');
  assert.doesNotMatch(JSON.stringify(s.logs), /test-secret|Synthetic fixture/);
  // A quiet feed last changed hours ago is healthy after a successful poll.
  assert.equal(cancelled.health.freshness, 'fresh'); assert.equal(cancelled.health.freshnessBasis, 'fetch');
  assert.equal(C.freshness(cancelled.health, s.clock() + 200000), 'stale');
});

test('provider distinguishes missing access, HTTP failures, timeout, network, parse/schema failure and recovery', async () => {
  await assert.rejects(new MetOfficeWarningsProvider().current(), { code: 'configuration' });
  for (const [response, code] of [[reply('',401),'authentication'],[reply('',403),'authentication'],[reply('',429),'rate_limited'],[reply('',503),'upstream'],[reply('bad'),'parse'],[reply('<feed xmlns="wrong"/>'),'unsupported_schema']]) {
    const p = new MetOfficeWarningsProvider({ apiKey: 'key', fetch: async () => response }); await assert.rejects(p.current(), { code }); assert.equal(p.health.consecutiveFailures, 1);
  }
  for (const [error, code] of [[new DOMException('key', 'TimeoutError'), 'timeout'], [new Error('secret network'), 'network']]) {
    const p = new MetOfficeWarningsProvider({ apiKey: 'key', fetch: async () => { throw error; } }); await assert.rejects(p.current(), { code }); assert.doesNotMatch(JSON.stringify(p.health), /secret network/);
    const s = upstream(); p.apiKey = "test-secret"; p.fetch = s.provider.fetch; assert.equal((await p.current()).health.consecutiveFailures, 0);
  }
  const s = upstream(); await s.provider.current(); s.next('updated'); const fetcher = s.provider.fetch;
  s.provider.fetch = async (url, options) => url.includes('/issued/updated/') ? reply('{') : fetcher(url, options);
  await assert.rejects(s.provider.current(), { code: 'parse' });
  s.provider.fetch = fetcher; assert.equal((await s.provider.current()).observations.length, 2);
});

test('Node and Python normalize all fixture snapshots and Atom entries identically', () => {
  for (const name of ['issued','updated','cancelled','empty']) {
    const result = python('import json,sys; from providers.metoffice_warnings import normalize_collection; print(json.dumps(normalize_collection(json.loads(sys.stdin.read()), '+start+')))', fixture(`${name}.json`));
    assert.deepEqual(result, normalizeWarningCollection(collection(name), start));
  }
  assert.deepEqual(python('import json,sys; from providers.metoffice_warnings import parse_feed; print(json.dumps(parse_feed(sys.stdin.read())))', fixture('cancelled.xml')), parseWarningFeed(fixture('cancelled.xml')));
});

test('Python transport matches feed lifecycle, authentication, redirect protection and quiet-feed freshness', () => {
  const result = python(`
import io,json
from pathlib import Path
from urllib.error import HTTPError,URLError
from providers.metoffice_warnings import MetOfficeWarningsProvider,BASE,WarningError,NoRedirect
phase='issued'; now=${start}; calls=[]
def opener(req,timeout):
    calls.append(req.full_url)
    assert req.get_header('Apikey')=='test-secret' and timeout==15
    name=phase+'.xml' if req.full_url==BASE+'feed' else ((req.full_url.split('/')[-2] if '/updated/' in req.full_url else ('empty' if phase=='cancelled' else phase))+'.json')
    return io.BytesIO((Path('tests/fixtures/nswws')/name).read_bytes())
p=MetOfficeWarningsProvider('test-secret',opener,lambda:now,lambda e:None)
a=p.current(); p.current(); assert len(calls)==3
now+=60000; p.current(); assert len(calls)==4
phase='updated'; now+=60000; b=p.current()
phase='cancelled'; now+=60000; c=p.current()
assert len(b['observations'])==2 and c['records']==[] and c['observations'][-1]['domainPayload']['status']=='CANCELLED'
assert c['health']['freshness']=='fresh'
for status,code in [(401,'authentication'),(429,'rate_limited'),(503,'upstream')]:
    def failure(req,timeout): raise HTTPError(req.full_url,status,'secret',{},None)
    f=MetOfficeWarningsProvider('key',failure,lambda:now,lambda e:None)
    try: f.current(); raise AssertionError('expected failure')
    except WarningError as e: assert e.code==code
assert NoRedirect().redirect_request(None,None,302,'',{},'https://evil.example') is None
print(json.dumps(c))
`);
  const s = upstream(); return (async () => { await s.provider.current(); s.next('issued'); await s.provider.current(); s.next('updated'); await s.provider.current(); s.next('cancelled'); assert.deepEqual(result, await s.provider.current()); })();
});

test('warning controller persists revisions across reopen, prevents replay regression, and keeps cancellations out of active list', async () => {
  const idb = new IDBFactory(), storage = await P.IndexedDBStorageAdapter.open(idb), snapshots = await P.IndexedDBStorageAdapter.open(idb, 'warning-state-test');
  const s = upstream(); const fetcher = async () => reply({ configured: true, ...await s.provider.current() });
  const controller = new W.WarningController({ fetch: fetcher, now: s.clock, history: new C.RevisionHistory(storage, { now: s.clock }), snapshotStorage: snapshots });
  await controller.refresh(); s.next('updated'); await controller.refresh(); await controller.refresh(); s.next('cancelled'); await controller.refresh();
  const id = collection().features[0].properties.warningId; assert.equal((await controller.history.revisions('metoffice-warnings', id)).length, 3);
  assert.deepEqual(W.visibleWarnings(controller.state.records, s.clock()), []);
  storage.close(); snapshots.close();
  const reopened = await P.IndexedDBStorageAdapter.open(idb), snapshot2 = await P.IndexedDBStorageAdapter.open(idb, 'warning-state-test');
  const second = new W.WarningController({ fetch: fetcher, now: s.clock, history: new C.RevisionHistory(reopened), snapshotStorage: snapshot2 }); await second.restore(); assert.equal(second.state.cached, true);
  await second.refresh(); assert.equal((await second.history.revisions('metoffice-warnings', id)).length, 3);
  reopened.close(); snapshot2.close();
});

test('local failures retain previous data and mark it degraded; empty success and unconfigured access are explicit', async () => {
  const s = upstream(), controller = new W.WarningController({ now: s.clock, fetch: async () => reply({ configured: true, ...await s.provider.current() }), log: () => {} });
  await controller.refresh(); const original = structuredClone(controller.state.records);
  controller.fetch = async () => { throw new Error('offline'); }; await controller.refresh(); assert.deepEqual(controller.state.records, original); assert.equal(controller.state.cached, true); assert.equal(C.freshness(controller.state.health, s.clock()), 'provider_error');
  controller.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }); await controller.refresh(); assert.equal(C.freshness(controller.state.health, s.clock()), 'malformed');
  controller.fetch = async () => reply({ configured: true, records: [], observations: [], health: { ...C.health(60000), lastSuccessfulFetch: s.clock(), available: true, freshnessBasis: 'fetch' } }); await controller.refresh(); assert.deepEqual(controller.state.records, []); assert.equal(controller.state.cached, false);
  controller.fetch = async () => reply({ configured: false, records: [], observations: [], health: C.health(60000) }); await controller.refresh(); assert.equal(controller.state.configured, false);
});

test('storage failure does not hide live data, and source-scoped retention leaves lightning intact', async () => {
  const storage = new P.MemoryStorageAdapter(), history = new C.RevisionHistory(storage, { now: () => 1 });
  const warning = normalizeWarningCollection(collection(), start)[0];
  await history.record({ ...warning, provider: 'lightningmaps', provenance: { ...warning.provenance, provider: 'lightningmaps' } }); await history.record(warning);
  const controller = new W.WarningController({ now: () => start, history, fetch: async () => reply({ configured: true, records: [], observations: [], health: C.health() }) }); await controller.refresh();
  assert.equal((await history.query({ provider: 'metoffice-warnings' })).length, 0); assert.equal((await history.query({ provider: 'lightningmaps' })).length, 1);
  controller.snapshotStorage = { update: async () => { throw new Error('quota'); } }; controller.log = () => {};
  controller.fetch = async () => reply({ configured: true, records: [warning], observations: [], health: C.health() }); await controller.refresh(); assert.equal(controller.state.storageError, true); assert.equal(controller.state.records.length, 1);
});

test('UK timestamps account for daylight saving; future issued warnings remain visible, expired/cancelled are excluded', () => {
  assert.match(W.ukDate(Date.parse('2026-10-06T11:00:00Z')), /12:00 BST/); assert.match(W.ukDate(Date.parse('2026-12-06T11:00:00Z')), /11:00 GMT/);
  const record = normalizeWarningCollection(collection(), start)[0]; assert.equal(W.visibleWarnings([record], start).length, 1);
  assert.equal(W.visibleWarnings([record], record.validTo).length, 0);
  assert.equal(W.visibleWarnings(normalizeWarningCollection(collection('cancelled'), start), start).length, 0);
});

test('warnings dialog renders normalized text safely, exposes cancellation history and avoids demo requests', async () => {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.textContent = ''; this.open = false; }
    append(node) { this.children.push(node); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    showModal() { this.open = true; }
    get content() { return [this.textContent, ...this.children.map((n) => n.content)].join('\n'); }
  }
  const elements = Object.fromEntries(['warningsDialog','warningList','warningStatus','warningRefresh','warningAttribution','warningStorageStatus','warningsButton','warningHistory','warningArchive'].map((id) => [id, new Element()]));
  const originals = { document: globalThis.document, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  globalThis.document = { hidden: false, getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), addEventListener() {} };
  globalThis.indexedDB = new IDBFactory();
  const issued = normalizeWarningCollection(collection(), start), cancelled = normalizeWarningCollection(collection('cancelled'), start);
  issued[0].domainPayload.headline = '<img src=x onerror=attack()> Synthetic headline';
  globalThis.fetch = async () => reply({ configured: true, records: issued, observations: cancelled, health: { ...C.health(60000), available: true, lastSuccessfulFetch: start, freshnessBasis: 'fetch' } });
  let controller;
  try {
    controller = W.mountWarnings({ getLocation: () => ({ lat: 51, lon: -1 }) }); controller.now = () => start;
    elements.warningsButton.listeners.click();
    for (let n = 0; n < 30 && (controller.state.configured == null || controller.state.loading); n++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.state.loading, false); assert.equal(controller.state.configured, true);
    const view = elements.warningList.content;
    assert.match(view, /Synthetic headline/); assert.match(view, /Synthetic advice/); assert.match(view, /Synthetic travel disruption/); assert.match(view, /Test district/); assert.match(view, /within this warning area/); assert.match(view, /BST/);
    assert.equal(elements.warningList.children[0].dataset.level, 'YELLOW');
    assert.equal(elements.warningList.children[0].children.find((n) => n.tag === 'h4').textContent, issued[0].domainPayload.headline);
    await elements.warningHistory.listeners.click(); assert.match(elements.warningArchive.content, /CANCELLED/); assert.match(elements.warningArchive.content, /Synthetic cancellation/);
    elements.warningsDialog.listeners.close();
    let requests = 0; globalThis.fetch = async () => { requests++; throw new Error(); };
    W.mountWarnings({ demo: true }); elements.warningsButton.listeners.click(); assert.equal(requests, 0); assert.match(elements.warningStatus.textContent, /demo mode/); elements.warningsDialog.listeners.close();
  } finally {
    elements.warningsDialog.listeners.close?.(); controller?.history?.storage.close(); controller?.snapshotStorage?.close(); Object.assign(globalThis, originals);
  }
});


test('default browser fetch keeps its Window receiver instead of receiving the warning controller', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async function (url) {
    assert.equal(this, globalThis, 'browser fetch requires its global receiver');
    assert.equal(url, '/api/warnings'); calls++;
    return reply({ configured: true, records: normalizeWarningCollection(collection(), start), observations: [], health: { ...C.health(60000), lastSuccessfulFetch: start, available: true, freshnessBasis: 'fetch' } });
  };
  try {
    const controller = new W.WarningController(); await controller.refresh();
    assert.equal(calls, 1); assert.equal(controller.state.configured, true); assert.equal(controller.state.records.length, 1); assert.equal(controller.state.health.lastError, null);
  } finally { globalThis.fetch = original; }
});
