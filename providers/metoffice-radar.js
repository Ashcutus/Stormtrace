import C from '../core/index.js';
export class RadarResourceProvider {
  constructor({ worker, now = Date.now, id = 'metoffice-radar', source = null } = {}) {
    this.id = id; this.source = C.getSource(this.id); this.selection = source; this.cacheMs = id === 'noaa-radar' ? 60000 : 300000; this.worker = worker; this.now = now;
    this.runner = new C.ProviderRunner(this.source, { now }); this.cached = null; this.inflight = null; this.images = new Map();
  }
  get health() { return this.runner.health; }
  // Forget cached frames so a newly set-up decoder is used on the next check.
  invalidate() { this.cached = null; this.images.clear(); }
  frames() {
    if (this.inflight) return this.inflight;
    if (this.cached && this.now() - this.health.lastSuccessfulFetch < this.cacheMs) return Promise.resolve(structuredClone({ ...this.cached, health: { ...this.health, freshness: C.freshness(this.health, this.now()) } }));
    this.inflight = this.runner.run('frames', async () => {
      const result = JSON.parse((await this.worker('frames')).toString());
      if (!Array.isArray(result.records) || !Array.isArray(result.missingDependencies) || !result.legend) throw new C.ProviderError('malformed', this.id, 'frames');
      return result;
    }).then((result) => {
      if (!result.records.length) { this.health.available = false; result.health = { ...this.health, freshness: C.freshness(this.health, this.now()) }; }
      this.cached = structuredClone(result);
      const ids = new Set(result.records.map((r) => r.id)); if (this.id === 'noaa-radar') ids.add('legend'); for (const key of this.images.keys()) if (!ids.has(key)) this.images.delete(key);
      return result;
    }).finally(() => { this.inflight = null; }); return this.inflight;
  }
  async image(key) {
    const result = await this.frames();
    if (!(key === 'legend' && this.id === 'noaa-radar') && !result.records.some((r) => r.id === key)) throw new C.ProviderError('unavailable', this.id, 'render');
    if (result.missingDependencies.length) throw new C.ProviderError('configuration', this.id, 'render');
    if (!this.images.has(key)) {
      while (this.images.size >= (this.selection ? 3 : 12)) this.images.delete(this.images.keys().next().value);
      this.images.set(key, this.worker('render', key).catch((error) => { this.images.delete(key); throw error; }));
    }
    return this.images.get(key);
  }
}

// Preserve the existing UK composition/test import while sharing the resource cache.
export { RadarResourceProvider as MetOfficeRadarProvider };
