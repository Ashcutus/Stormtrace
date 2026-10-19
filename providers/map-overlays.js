import C from '../core/index.js';
const fail = () => { throw new C.ProviderError('malformed', 'usgs', 'overlay'); };
// Large enough for one map refresh of flood areas (client cap: 100) plus quakes.
const CACHE_SIZE = 128;
export function normalizeOverlay(payload, { provider, sourceUrl, fetchedAt, updatedAt = null, intensity = false }) {
  const features = payload?.type === 'FeatureCollection' ? payload.features : payload?.type === 'Feature' ? [payload] : null;
  if (!Array.isArray(features) || features.length > 2000) fail();
  if (payload.crs && !['urn:ogc:def:crs:OGC:1.3:CRS84','EPSG:4326'].includes(payload.crs.properties?.name)) fail();
  return features.map((f) => {
    if (!f || typeof f !== 'object' || (f.properties != null && typeof f.properties !== 'object')) fail();
    const geometry = C.normalizeGeometry(f.geometry), value = intensity ? f.properties?.value : null;
    if (!geometry || !(intensity ? ['LineString','MultiLineString'] : ['Polygon','MultiPolygon']).includes(geometry.type) || intensity && (f.properties?.units !== 'mmi' || !Number.isFinite(value) || value < 0 || value > 12)) fail();
    return { geometry, intensity: value, provenance: { ...C.provenance(C.getSource(provider), { fetchedAt, updatedAt, transformations: [intensity ? 'shakemap-mmi-contours' : 'ea-warning-area-geometry'] }), sourceUrl } };
  });
}
export class MapOverlayProvider {
  constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now } = {}) { this.fetch = fetcher; this.now = now; this.cache = new Map(); this.pending = new Map(); }
  async json(url) {
    const r = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new C.ProviderError('upstream', 'usgs', 'overlay', { status: r.status });
    let body = '', bytes = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of r.body) { bytes += chunk.byteLength; if (bytes > 2000000) fail(); body += decoder.decode(chunk, { stream: true }); }
    return JSON.parse(body + decoder.decode());
  }
  resource(key, work) {
    const previous = this.cache.get(key); if (previous && this.now() - previous.at < 900000) return Promise.resolve(structuredClone(previous.value));
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 8) fail();
    const task = work().then(value => { if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value); this.cache.set(key, { at: this.now(), value }); return value; }).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  flood(id) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id || '')) fail();
    return this.resource(`flood:${id}`, async () => { const sourceUrl = `https://environment.data.gov.uk/flood-monitoring/id/floodAreas/${id}/polygon`; return { features: normalizeOverlay(await this.json(sourceUrl), { provider: 'ea-floods', sourceUrl, fetchedAt: this.now() }) }; });
  }
  earthquake(id) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id || '')) fail();
    return this.resource(`quake:${id}`, async () => {
      const detail = await this.json(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${id}.geojson`);
      if (detail.id !== id) fail();
      const products = detail.properties?.products?.shakemap || [];
      const product = [...products].sort((a,b) => (b.preferredWeight || 0) - (a.preferredWeight || 0) || b.updateTime - a.updateTime)[0];
      if (!product || product.status === 'DELETE') return { features: [], available: false };
      const value = product.contents?.['download/cont_mi.json']?.url;
      if (!value) return { features: [], available: false };
      const url = new URL(value);
      if (url.origin !== 'https://earthquake.usgs.gov' || url.username || url.password || url.search || url.hash || !/^\/pdl\/products\/[^/]+\/contents\/download\/cont_mi\.json$/.test(url.pathname) || !Number.isSafeInteger(product.updateTime)) fail();
      return { available: true, features: normalizeOverlay(await this.json(url.href), { provider: 'usgs', sourceUrl: url.href, fetchedAt: this.now(), updatedAt: product.updateTime, intensity: true }) };
    });
  }
}
