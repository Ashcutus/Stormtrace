import C from '../core/index.js';
export const PUBLIC_HAZARD_IDS = ['nhc', 'usgs-volcano', 'gvp', 'noaa-tsunami', 'swpc', 'metoffice-warnings-rss', 'metoffice-warnings-esri'];
const clone = (v) => JSON.parse(JSON.stringify(v));
export function validateHazards(id, result) {
  if (!PUBLIC_HAZARD_IDS.includes(id) || !Array.isArray(result?.records) || !Array.isArray(result?.observations) || result.records.length > 2000 || result.observations.length > 2000) throw new C.ProviderError('malformed', id, 'local_response');
  if (new Set(result.records.map((r) => r?.id)).size !== result.records.length) throw new C.ProviderError('malformed', id, 'local_response');
  for (const r of [...result.records, ...result.observations]) {
    C.event(r);
    const p = r.domainPayload;
    if (r.provider !== id || r.kind !== C.getSource(id).categories[0] || !['title','badge','body','instruction','url','mode'].every((k) => typeof p[k] === 'string') || !Array.isArray(p.details) || !p.details.every((v) => typeof v === 'string')) throw new C.ProviderError('malformed', id, 'local_response');
  }
  return result;
}
export class PublicHazardProvider {
  constructor({ id, worker, now = Date.now } = {}) {
    if (!PUBLIC_HAZARD_IDS.includes(id)) throw new TypeError('Unknown public hazard provider');
    Object.assign(this, { id, worker, now, source: C.getSource(id), inflight: null, lastResult: null, retryAt: 0, lastError: null });
    this.runner = new C.ProviderRunner(this.source, { now, freshnessBasis: id === 'swpc' ? 'source' : 'fetch' });
  }
  get health() { return this.runner.health; }
  current() {
    if (this.inflight) return this.inflight;
    if (this.now() < this.retryAt) return Promise.reject(this.lastError);
    if (this.lastResult && this.now() - this.health.lastSuccessfulFetch < (this.lastResult.partial ? 60000 : this.source.expectedUpdateInterval)) return Promise.resolve(clone({ ...this.lastResult, health: { ...this.health, freshness: C.freshness(this.health, this.now()) } }));
    this.inflight = this.runner.run('current', async () => {
      const raw = await this.worker(this.lastResult);
      let result; try { result = JSON.parse(raw.toString()); } catch { throw new C.ProviderError('parse', this.id, 'current'); }
      return validateHazards(this.id, result);
    }).then((result) => { this.lastResult = clone(result); this.lastError = null; if(result.components){this.health.available=result.components.some(c=>c.lastSuccessfulFetch!=null);this.health.lastSuccessfulFetch=Math.max(...result.components.map(c=>c.lastSuccessfulFetch||0))||null;result.health={...this.health,freshness:C.freshness(this.health,this.now())};}return result; }).catch((error) => {
      this.lastError = C.providerError(error, this.id, 'current');
      this.retryAt = this.now() + Math.max(60000, Math.min(86400000, (this.lastError.retryAfter || 0) * 1000), Math.min(3600000, 60000 * 2 ** Math.min(this.health.consecutiveFailures - 1, 6)));
      throw this.lastError;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
}
