import C from '../core/index.js';
export const EARTHQUAKES_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const source = C.getSource('usgs');
const fail = (code = 'malformed', operation = 'normalize') => { throw new C.ProviderError(code, source.id, operation); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const timestamp = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000;
export function earthquakeLink(value) {
  let url; try { url = new URL(value); } catch { fail(); }
  if (url.origin !== 'https://earthquake.usgs.gov' || url.username || url.password || url.search || url.hash || !/^\/earthquakes\/eventpage\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) fail();
  return url.href;
}
export function normalizeEarthquakes(payload, fetchedAt) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features) || payload.features.length > 10000 || !timestamp(payload.metadata?.generated) || payload.metadata.status !== 200 || payload.metadata.count !== payload.features.length) fail();
  const seen = new Set(), records = [];
  for (const feature of payload.features) {
    const p = feature?.properties;
    if (feature?.type !== 'Feature' || typeof feature.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(feature.id) || seen.has(feature.id) || !p || typeof p.type !== 'string') fail();
    seen.add(feature.id);
    // ComCat also carries quarry blasts and other non-earthquake events.
    if (p.type !== 'earthquake') continue;
    if (!timestamp(p.time) || !timestamp(p.updated) || p.updated < p.time || (p.mag != null && !Number.isFinite(p.mag)) || !['status','net','code'].every((k) => typeof p[k] === 'string') || (p.place != null && typeof p.place !== 'string') || (p.magType != null && typeof p.magType !== 'string') || (p.alert != null && !['green','yellow','orange','red'].includes(p.alert))) fail();
    const geometry = C.normalizeGeometry(feature.geometry);
    if (geometry?.type !== 'Point' || geometry.coordinates.length !== 3) fail();
    const url = earthquakeLink(p.url);
    records.push(C.event({ id: feature.id, kind: 'earthquake', provider: source.id, sourceAuthority: source.authority, observedAt: p.time, updatedAt: p.updated, geometry,
      sourceSeverity: { magnitude: p.mag ?? null, magnitudeType: p.magType ?? null, alert: p.alert ?? null, status: p.status }, displayPriority: 'normal',
      provenance: C.provenance(source, { fetchedAt, upstreamId: feature.id, observedAt: p.time, updatedAt: p.updated, transformations: ['usgs-summary-v1-normalization'] }),
      domainPayload: { magnitude: p.mag ?? null, magnitudeType: p.magType ?? null, depthKm: geometry.coordinates[2], status: p.status, place: p.place ?? null, url, network: p.net, sourceCode: p.code, sourceFields: clone(p) } }));
  }
  // Current records are archived by the client; there are no separate revisions.
  return { records, observations: [], sourceDataTimestamp: payload.metadata.generated };
}
export class USGSEarthquakeProvider {
  constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, log } = {}) {
    this.id = source.id; this.source = source; this.fetch = fetcher; this.now = now;
    this.runner = new C.ProviderRunner(source, { now, log }); this.lastResult = null; this.inflight = null;
  }
  get health() { return this.runner.health; }
  current() {
    if (this.inflight) return this.inflight;
    if (this.lastResult && this.now() - this.health.lastSuccessfulFetch < 60000) return Promise.resolve(clone(this.lastResult));
    this.inflight = this.runner.run('current', async () => {
      const response = await this.fetch(EARTHQUAKES_URL, { headers: { Accept: 'application/geo+json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw C.httpError(response.status, this.id, 'current');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0;
        try {
          while (true) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 10000000) { await reader.cancel(); fail('malformed', 'response_size'); } text += decoder.decode(value, { stream: true }); }
          text += decoder.decode();
        } catch (error) { if (error instanceof TypeError) fail('parse', 'current'); throw error; }
        finally { reader.releaseLock(); }
      } else { text = await response.text(); if (text.length > 10000000) fail('malformed', 'response_size'); }
      let payload; try { payload = JSON.parse(text); } catch { fail('parse', 'current'); }
      return normalizeEarthquakes(payload, this.now());
    }).then((result) => { this.lastResult = clone(result); return result; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
  async query({ from, to, bounds } = {}) {
    if (!timestamp(from) || !timestamp(to) || to < from || (bounds && (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90 || bounds[2] < bounds[0] || bounds[3] < bounds[1]))) fail('configuration', 'query');
    const result = await this.current();
    const records = result.records.filter((r) => r.observedAt >= from && r.observedAt <= to && (!bounds || r.geometry.coordinates[0] >= bounds[0] && r.geometry.coordinates[0] <= bounds[2] && r.geometry.coordinates[1] >= bounds[1] && r.geometry.coordinates[1] <= bounds[3]));
    return { ...result, records, observations: [] };
  }
}
