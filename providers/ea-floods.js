import C from '../core/index.js';
export const FLOODS_URL = 'https://environment.data.gov.uk/flood-monitoring/id/floods';
const ID = 'ea-floods', source = C.getSource(ID);
const clone = (v) => JSON.parse(JSON.stringify(v));
const fail = () => { throw new C.ProviderError('malformed', ID, 'normalize'); };
const time = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)?$/.test(v) || !Number.isFinite(Date.parse(v + (/(?:Z|[+-]\d\d:\d\d)$/.test(v) ? '' : 'Z')))) fail();
  const local = v.slice(0, 19), check = new Date(local + 'Z');
  if (check.toISOString().slice(0,19) !== local) fail();
  return /(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : null;
};
export function normalizeFloods(payload, fetchedAt) {
  if (payload?.meta != null && (typeof payload.meta !== 'object' || Array.isArray(payload.meta))) fail();
  for (const key of ['limit','offset']) if (payload?.meta?.[key] != null && (!Number.isInteger(payload.meta[key]) || payload.meta[key] < 0)) fail();
  if (!Array.isArray(payload?.items) || payload.items.length > 10000 || payload.meta?.offset > 0 || (payload.meta?.limit != null && payload.items.length >= payload.meta.limit)) fail();
  const records = payload.items.map((p) => {
    if (!p || typeof p.floodAreaID !== 'string' || !/^[A-Za-z0-9_-]+$/.test(p.floodAreaID) || !['http:', 'https:'].some((s) => p['@id'] === `${s}//environment.data.gov.uk/flood-monitoring/id/floods/${p.floodAreaID}`) || ![1,2,3,4].includes(p.severityLevel) || typeof p.severity !== 'string' || !p.severity.trim() || typeof p.description !== 'string' || !p.description.trim() || (p.message != null && typeof p.message !== 'string')) fail();
    const sourceTimes = { reviewed: p.timeRaised, messageChanged: p.timeMessageChanged, severityChanged: p.timeSeverityChanged };
    const times = Object.values(sourceTimes).map(time);
    const updatedAt = times.every((v) => v != null) ? Math.max(...times) : null;
    const area = p.floodArea;
    if (area != null && typeof area !== 'string' && (typeof area !== 'object' || Array.isArray(area))) fail();
    for (const k of ['county', 'riverOrSea']) if (area?.[k] != null && typeof area[k] !== 'string') fail();
    return C.event({ id: p['@id'], kind: 'warning', provider: ID, sourceAuthority: source.authority, updatedAt,
      sourceSeverity: { level: p.severityLevel, classification: p.severity }, displayPriority: ['urgent','high','normal','low'][p.severityLevel-1],
      provenance: C.provenance(source, { fetchedAt, upstreamId: p['@id'], updatedAt, transformations: ['ea-flood-monitoring-normalization-v1'] }),
      domainPayload: { status: p.severityLevel === 4 ? 'NO_LONGER_IN_FORCE' : 'ACTIVE', level: p.severityLevel, classification: p.severity, headline: p.description, description: p.message || '', areaId: p.floodAreaID, county: area?.county || '', riverOrSea: area?.riverOrSea || '', sourceTimes, sourceFields: clone(p) } });
  });
  if (new Set(records.map((r) => r.id)).size !== records.length) fail();
  return records;
}
export class EnglandFloodProvider {
  constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, log } = {}) {
    this.id = ID; this.fetch = fetcher; this.now = now; this.runner = new C.ProviderRunner(source, { now, log, freshnessBasis: 'fetch' }); this.lastResult = null; this.inflight = null;
  }
  get health() { return this.runner.health; }
  current() {
    if (this.inflight) return this.inflight;
    if (this.lastResult && this.now() - this.health.lastSuccessfulFetch < 900000) return Promise.resolve(clone(this.lastResult));
    this.inflight = this.runner.run('current', async () => {
      const response = await this.fetch(FLOODS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw C.httpError(response.status, this.id, 'current');
      let body = '', size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
        try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 10000000) { await reader.cancel(); fail(); } body += decoder.decode(value, { stream: true }); } body += decoder.decode(); }
        finally { reader.releaseLock(); }
      } else { body = await response.text(); if (body.length > 10000000) fail(); }
      let payload; try { payload = JSON.parse(body); } catch { throw new C.ProviderError('parse', ID, 'current'); }
      const records = normalizeFloods(payload, this.now());
      return { records, observations: [], sourceDataTimestamp: null };
    }).then((result) => { this.lastResult = clone(result); return result; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
}
