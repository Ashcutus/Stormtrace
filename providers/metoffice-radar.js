import C from '../core/index.js';
// Renderable keys: each frame, its coverage mask where offered, and a WMS source legend.
function resourceKeys(id, result) {
  const keys = new Set(result.records.flatMap((r) => r.coverage ? [r.id, r.id + '@coverage'] : [r.id]));
  if (C.radarUsesWms(id)) keys.add('legend');
  return keys;
}
export class RadarResourceProvider {
  constructor({ worker, now = Date.now, id = 'metoffice-radar', source = null } = {}) {
    this.id = id; this.source = C.getSource(this.id); this.selection = source; this.cacheMs = C.radarUsesWms(id) ? 60000 : 300000; this.worker = worker; this.now = now;
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
      const ids = resourceKeys(this.id, result); for (const key of this.images.keys()) if (!ids.has(key)) this.images.delete(key);
      return result;
    }).finally(() => { this.inflight = null; }); return this.inflight;
  }
  async image(key) {
    const result = await this.frames();
    if (!resourceKeys(this.id, result).has(key)) throw new C.ProviderError('unavailable', this.id, 'render');
    if (result.missingDependencies.length) throw new C.ProviderError('configuration', this.id, 'render');
    if (!this.images.has(key)) {
      // Public selections keep the shown and pending frames, each with a possible coverage mask.
      while (this.images.size >= (this.selection ? 6 : 12)) this.images.delete(this.images.keys().next().value);
      this.images.set(key, this.worker('render', key).catch((error) => { this.images.delete(key); throw error; }));
    }
    return this.images.get(key);
  }
}

// Preserve the existing UK composition/test import while sharing the resource cache.
export { RadarResourceProvider as MetOfficeRadarProvider };
