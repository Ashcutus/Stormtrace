import C from '../core/index.js';
export class MetOfficeRadarProvider {
  constructor({ worker, now = Date.now } = {}) {
    this.id = 'metoffice-radar'; this.source = C.getSource(this.id); this.worker = worker; this.now = now;
    this.runner = new C.ProviderRunner(this.source, { now }); this.cached = null; this.inflight = null; this.images = new Map();
  }
  get health() { return this.runner.health; }
  frames() {
    if (this.inflight) return this.inflight;
    if (this.cached && this.now() - this.health.lastSuccessfulFetch < 300000) return Promise.resolve(structuredClone({ ...this.cached, health: { ...this.health, freshness: C.freshness(this.health, this.now()) } }));
    this.inflight = this.runner.run('frames', async () => {
      const result = JSON.parse((await this.worker('frames')).toString());
      if (!Array.isArray(result.records) || !Array.isArray(result.missingDependencies) || !result.legend) throw new C.ProviderError('malformed', this.id, 'frames');
      return result;
    }).then((result) => {
      if (!result.records.length) { this.health.available = false; result.health = { ...this.health, freshness: C.freshness(this.health, this.now()) }; }
      this.cached = structuredClone(result);
      const ids = new Set(result.records.map((r) => r.id)); for (const key of this.images.keys()) if (!ids.has(key)) this.images.delete(key);
      return result;
    }).finally(() => { this.inflight = null; }); return this.inflight;
  }
  async image(key) {
    const result = await this.frames();
    if (!result.records.some((r) => r.id === key)) throw new C.ProviderError('unavailable', this.id, 'render');
    if (result.missingDependencies.length) throw new C.ProviderError('configuration', this.id, 'render');
    if (!this.images.has(key)) this.images.set(key, this.worker('render', key).catch((error) => { this.images.delete(key); throw error; }));
    return this.images.get(key);
  }
}
