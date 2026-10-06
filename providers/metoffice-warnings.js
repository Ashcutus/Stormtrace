import C from '../core/index.js';

export const WARNINGS_BASE = 'https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/';
const PROVIDER = 'metoffice-warnings';
const source = C.getSource(PROVIDER);
const fail = (code = 'malformed', operation = 'normalize') => { throw new C.ProviderError(code, PROVIDER, operation); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const date = (value) => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) fail();
  const parsed = Date.parse(value); if (!Number.isFinite(parsed)) fail(); return parsed;
};
const strings = (value, nonempty = false) => Array.isArray(value) && (!nonempty || value.length > 0) && value.every((s) => typeof s === 'string' && s.trim());

export function warningLink(value, kind) {
  let url; try { url = new URL(value); } catch { fail('malformed', 'feed_link'); }
  const base = new URL(WARNINGS_BASE);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(base.pathname)) fail('malformed', 'feed_link');
  const tail = url.pathname.slice(base.pathname.length);
  if (!new RegExp(`^${kind}/[a-zA-Z0-9-]+/?$`).test(tail)) fail('malformed', 'feed_link');
  return url.href;
}

export function parseWarningFeed(xml) {
  let root; try { root = C.parseXML(xml); } catch { fail('parse', 'feed'); }
  const NS = 'http://www.w3.org/2005/Atom';
  if (root.name !== 'feed' || root.namespace !== NS) fail('unsupported_schema', 'feed');
  const children = (node, name) => node.children.filter((n) => n.name === name && n.namespace === NS);
  const text = (node, name) => children(node, name)[0]?.text.trim();
  const links = children(root, 'link').filter((n) => n.attributes.rel === 'related');
  if (links.length !== 1 || !text(root, 'id')) fail('malformed', 'feed');
  const entries = children(root, 'entry').map((node) => {
    const links = children(node, 'link').filter((n) => n.attributes.rel === 'alternate');
    if (links.length !== 1 || !text(node, 'id')) fail('malformed', 'feed');
    return { id: text(node, 'id'), updatedAt: date(text(node, 'updated')), url: warningLink(links[0].attributes.href, 'updated') };
  });
  if (entries.length > 500 || new Set(entries.map((e) => e.id)).size !== entries.length) fail('malformed', 'feed');
  return { id: text(root, 'id'), updatedAt: date(text(root, 'updated')), issuedUrl: warningLink(links[0].attributes.href, 'issued'), entries: entries.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id)) };
}

export function normalizeWarning(feature, fetchedAt) {
  const p = feature?.properties;
  if (feature?.type !== 'Feature' || !p || typeof p.warningId !== 'string' || !p.warningId || typeof p.warningVersion !== 'string' || !/^\d+(?:\.\d+)?$/.test(p.warningVersion) || !['YELLOW', 'AMBER', 'RED'].includes(p.warningLevel) || !['ISSUED', 'CANCELLED', 'EXPIRED'].includes(p.warningStatus)) fail();
  if (!strings(p.weatherType, true) || !strings(p.whatToExpect, true) || typeof p.warningHeadline !== 'string' || !p.warningHeadline.trim() || !Array.isArray(p.affectedAreas) || !p.affectedAreas.length || !p.affectedAreas.every((a) => a && typeof a.regionName === 'string' && typeof a.regionCode === 'string' && strings(a.subRegions))) fail();
  for (const field of ['warningFurtherDetails', 'whatShouldIDo', 'warningUpdateDescription']) if (p[field] != null && typeof p[field] !== 'string') fail();
  for (const field of ['warningImpact', 'warningLikelihood']) if (!Number.isInteger(p[field]) || p[field] < 1 || p[field] > 4) fail();
  const observedAt = date(p.issuedDate), updatedAt = date(p.modifiedDate), validFrom = date(p.validFromDate), validTo = date(p.validToDate);
  if (validTo < validFrom) fail();
  const geometry = C.normalizeGeometry(feature.geometry);
  if (!geometry || geometry.type !== 'MultiPolygon') fail();
  return C.event({
    id: p.warningId, kind: 'warning', provider: PROVIDER, sourceAuthority: source.authority,
    observedAt, updatedAt, validFrom, validTo, geometry,
    sourceSeverity: { classification: p.warningLevel, impact: p.warningImpact, likelihood: p.warningLikelihood },
    displayPriority: p.warningLevel === 'RED' ? 'urgent' : p.warningLevel === 'AMBER' ? 'high' : 'normal',
    provenance: C.provenance(source, { fetchedAt, upstreamId: p.warningId, observedAt, updatedAt, transformations: ['metoffice-nswws-v1.1-normalization'] }),
    domainPayload: { classification: p.warningLevel, status: p.warningStatus, version: p.warningVersion, weatherTypes: [...p.weatherType], headline: p.warningHeadline, description: p.warningFurtherDetails || '', instruction: p.whatShouldIDo || '', whatToExpect: [...p.whatToExpect], updateReason: p.warningUpdateDescription || '', affectedAreas: clone(p.affectedAreas), sourceFields: clone(p) },
  });
}

export function normalizeWarningCollection(payload, fetchedAt) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features) || payload.features.length > 2000) fail();
  const records = payload.features.map((f) => normalizeWarning(f, fetchedAt));
  if (new Set(records.map((r) => r.id)).size !== records.length) fail();
  return records;
}

export class MetOfficeWarningsProvider {
  constructor({ apiKey = '', fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, log } = {}) {
    this.id = PROVIDER; this.source = source; this.apiKey = apiKey; this.fetch = fetcher; this.now = now;
    this.runner = new C.ProviderRunner(source, { now, log, freshnessBasis: 'fetch' });
    this.cached = null; this.updates = new Map(); this.inflight = null; this.lastResult = null;
  }
  get health() { return this.runner.health; }
  async request(url, format) {
    const response = await this.fetch(url, { headers: { apikey: this.apiKey, Accept: format === 'xml' ? 'application/atom+xml' : 'application/geo+json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw C.httpError(response.status, this.id, 'current');
    const limit = format === 'xml' ? 2_000_000 : 20_000_000;
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0; text = '';
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > limit) { await reader.cancel(); fail('malformed', 'response_size'); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        if (error instanceof TypeError) fail('parse', 'current');
        throw C.providerError(error, this.id, 'current');
      } finally { reader.releaseLock(); }
    } else {
      text = await response.text();
      if (text.length > limit) fail('malformed', 'response_size');
    }
    if (format === 'xml') return parseWarningFeed(text);
    try { return JSON.parse(text); } catch { fail('parse', 'current'); }
  }
  current() {
    if (this.inflight) return this.inflight;
    if (this.lastResult && this.now() - this.health.lastSuccessfulFetch < 60000) return Promise.resolve(clone(this.lastResult));
    this.inflight = this.runner.run('current', async () => {
      if (!this.apiKey) fail('configuration', 'current');
      const feed = await this.request(`${WARNINGS_BASE}feed`, 'xml');
      const updates = new Map();
      for (const entry of feed.entries) {
        updates.set(entry.id, this.updates.get(entry.id) || normalizeWarningCollection(await this.request(entry.url, 'json'), this.now()));
      }
      const records = this.cached?.url === feed.issuedUrl ? this.cached.records : normalizeWarningCollection(await this.request(feed.issuedUrl, 'json'), this.now());
      if (records.some((r) => r.domainPayload.status !== 'ISSUED')) fail('malformed', 'issued');
      this.cached = { url: feed.issuedUrl, records }; this.updates = updates;
      return { records: clone(records), observations: clone([...updates.values()].flat()), sourceDataTimestamp: feed.updatedAt };
    }).then((result) => { this.lastResult = clone(result); return result; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
}
