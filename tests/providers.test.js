import assert from 'node:assert/strict';
import test from 'node:test';
import C from '../core/index.js';
import '../providers/lightning.js';
import '../providers/geocoding.js';
const now = Date.parse('2026-10-01T12:00:01Z');
const flash = { flash_id: 'native-1', flash_timestamp_utc: '2026-10-01T12:00:00', lat: '51', lon: '-1' };
const response = (payload, status = 200) => ({ ok: status === 200, status, headers: { get: () => '60' }, json: async () => payload });

test('V1 live subscription, timestamps, polarity, IDs and receiver status stay equivalent', () => {
  const p = new C.LightningMapsProvider({ now: () => now });
  assert.equal(p.url, 'wss://live2.lightningmaps.org/'); assert.equal(p.subscription().v, 24); assert.deepEqual(p.subscription().p, [85, 180, -85, -180]);
  const result = p.message(JSON.stringify({ strokes: [{ id: 42, time: 1790856000000000000, lat: 51, lon: -1, dev: 200, pol: -1 }] }));
  assert.equal(result.records.length, 1); const strike = result.records[0];
  assert.equal(strike.time, now - 1000); assert.equal(strike.id, '42'); assert.equal(strike.deviation, 200); assert.equal(strike.polarity, -1);
  assert.equal(strike.provenance.upstreamId, '42'); assert.equal(strike.provenance.fetchedAt, now);
  assert.equal(C.lightningEvent(strike).domainPayload.polarity, -1); assert.equal(C.lightningEvent(strike).geometry.type, 'Point');
  const normalizedAgain = C.normalizeStrike(strike, now); assert.equal(normalizedAgain.deviation, 200); assert.equal(normalizedAgain.polarity, -1);
  assert.deepEqual(normalizedAgain.provenance, strike.provenance);
  assert.deepEqual(p.message(JSON.stringify({ cid: 'client', con: 12, port: 8 })).receiver, { viewers: 12, name: '8' });
  assert.equal(C.lightningEvent({ id: 'legacy' }), null);
});

test('malformed live messages are isolated, observable, and partial rejection is degraded', () => {
  const logs = []; const p = new C.LightningMapsProvider({ now: () => now, log: (e) => logs.push(e) });
  for (const [data, code] of [['bad', 'parse'], ['null', 'malformed'], ['{"strokes":{}}', 'malformed'], ['{"strokes":[{"lat":999,"lon":0}]}', 'malformed']]) assert.throws(() => p.message(data), { code });
  assert.equal(p.health.consecutiveFailures, 4); assert.ok(logs.length >= 4);
  const result = p.message(JSON.stringify({ strokes: [{ time: now, lat: 0, lon: 0 }, { time: now, lat: 99, lon: 0 }] }));
  assert.equal(result.records.length, 1); assert.equal(result.health.freshness, 'malformed');
  assert.equal(p.message('{}').health.freshness, 'fresh');
});

test('history provider preserves V1 projection and attaches source IDs, times and health', async () => {
  let request; const logs = [];
  const p = new C.LightningHistoryProvider({ apiKey: 'secret-key', now: () => now, fetch: async (...args) => { request = args; return response({ flashes: [flash] }); }, log: (e) => logs.push(e) });
  const result = await p.history(9999);
  assert.match(request[0], /since_minutes=1440&limit=20000$/); assert.equal(request[1].headers['X-API-Key'], 'secret-key');
  const { provenance, ...legacy } = result.records[0];
  assert.deepEqual(legacy, C.normalizeHistoryFlashes([flash])[0]); assert.equal(provenance.upstreamId, 'native-1'); assert.equal(provenance.observedAt, now - 1000);
  assert.equal(result.health.lastSuccessfulFetch, now); assert.equal(result.health.freshness, 'fresh'); assert.doesNotMatch(JSON.stringify(logs), /secret-key/);
});

test('history classifies auth, rate limits, network, timeouts, parse/schema errors and recovers', async () => {
  for (const [reply, code] of [[response({}, 401), 'authentication'], [response({}, 429), 'rate_limited'], [response({}, 503), 'upstream'], [response({}), 'malformed'], [{ ok: true, json: async () => { throw new Error('bad'); } }, 'parse']]) {
    const p = new C.LightningHistoryProvider({ apiKey: 'key', fetch: async () => reply });
    await assert.rejects(p.history(), { code }); assert.equal(p.health.consecutiveFailures, 1);
  }
  await assert.rejects(new C.LightningHistoryProvider().history(), { code: 'configuration' });
  const p = new C.LightningHistoryProvider({ apiKey: 'key', fetch: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  await assert.rejects(p.history(), { code: 'timeout' });
  p.fetch = async () => response({ flashes: [] }); assert.equal((await p.history()).records.length, 0); assert.equal(p.health.consecutiveFailures, 0);
  p.fetch = async () => response({ flashes: [flash, { flash_id: 2, lat: 'invalid' }] }); assert.equal((await p.history()).health.freshness, 'malformed');
});

test('geocoding UI receives only normalized place models and provenance', async () => {
  const p = new C.NominatimProvider({ now: () => now, fetch: async () => response([{ place_id: 12, display_name: 'Warrington, England, UK', lat: '53.39', lon: '-2.59' }]) });
  const { records } = await p.search('Warrington'); assert.equal(records[0].name, 'Warrington'); assert.equal(records[0].label, 'Warrington, England'); assert.equal(records[0].lat, 53.39); assert.equal(records[0].provenance.upstreamId, '12'); assert.equal(records[0].display_name, undefined);
  p.fetch = async () => response({ bad: true }); await assert.rejects(p.search('test'), { code: 'malformed' });
});
