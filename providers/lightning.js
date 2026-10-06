(() => {
  "use strict";
  const C = globalThis.StormtraceCore;
  const liveSource = C.getSource("lightningmaps"), historySource = C.getSource("lightning-history");
  function normalizeStrike(raw, now = Date.now()) {
    if (!raw || typeof raw !== "object" || raw.lat == null || raw.lon == null) return null;
    const timeValue = raw.time || now;
    const rawTime = typeof timeValue === "string" && !/^\d+(\.\d+)?$/.test(timeValue)
      ? Date.parse(timeValue.endsWith("Z") || /[+-]\d\d:\d\d$/.test(timeValue) ? timeValue : `${timeValue}Z`) : Number(timeValue);
    const time = rawTime > 1e15 ? Math.floor(rawTime / 1e6) : rawTime > 1e12 ? rawTime : rawTime * 1000;
    const lat = Number(raw.lat), lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(time) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const id = String(raw.id ?? `${time}:${lat.toFixed(5)}:${lon.toFixed(5)}`);
    return { id, time, lat, lon, deviation: Number(raw.dev || raw.mds || raw.deviation || 0), polarity: Number(raw.pol || raw.polarity || 0), ...(raw.provenance ? { provenance: raw.provenance } : {}) };
  }
  function normalizeHistoryFlashes(input) {
    if (!Array.isArray(input)) return [];
    return input.map((flash) => {
      const timestamp = String(flash?.flash_timestamp_utc || "");
      if (flash?.flash_id == null || flash?.lat == null || flash?.lon == null) return null;
      return { id: `provider:${flash.flash_id}`, time: Date.parse(`${timestamp}${timestamp.endsWith("Z") || /[+-]\d\d:\d\d$/.test(timestamp) ? "" : "Z"}`), lat: Number(flash.lat), lon: Number(flash.lon), polarity: 0, deviation: 0 };
    }).filter((f) => f && Number.isFinite(f.time) && Number.isFinite(f.lat) && Number.isFinite(f.lon) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180);
  }
  function withOrigin(strike, source, fetchedAt, upstreamId) { return { ...strike, provenance: C.provenance(source, { fetchedAt, upstreamId, observedAt: strike.time, transformations: ["lightning-normalization-v1"] }) }; }
  function lightningEvent(strike) {
    const origin = strike.provenance;
    if (!origin) return null; // Legacy cached records have no invented source/fetch timestamps.
    return C.event({ id: strike.id, kind: "lightning", provider: origin.provider, sourceAuthority: origin.sourceAuthority, observedAt: strike.time, geometry: { type: "Point", coordinates: [strike.lon, strike.lat] }, provenance: origin, domainPayload: { polarity: strike.polarity || 0, deviation: strike.deviation || 0 } });
  }
  class LightningMapsProvider {
    constructor({ now = Date.now, log = () => {} } = {}) { this.id = liveSource.id; this.source = liveSource; this.now = now; this.log = log; this.health = C.health(liveSource.expectedUpdateInterval); this.lastLogAt = null; this.recordsSinceLog = 0; }
    get url() { return "wss://live2.lightningmaps.org/"; }
    subscription() { return { v: 24, i: {}, s: false, x: 0, w: 0, tx: 0, tw: 1, a: 4, z: 2, b: true, h: "", l: 1, t: 1, p: [85, 180, -85, -180], r: "A" }; }
    attempted() { this.health.lastAttemptedFetch = this.now(); }
    failed(code = "network") { this.health.lastError = new C.ProviderError(code, this.id, "stream").toJSON(); this.health.consecutiveFailures++; this.emit({ operation: "stream", success: false, error: this.health.lastError }); }
    emit(context) { try { this.log({ provider: this.id, ...context }); } catch { /* logging is optional */ } }
    message(data) {
      const started = this.now(); this.attempted();
      let payload;
      try { payload = JSON.parse(data); } catch { this.failed("parse"); throw new C.ProviderError("parse", this.id, "stream"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload.strokes != null && !Array.isArray(payload.strokes))) { this.failed("malformed"); throw new C.ProviderError("malformed", this.id, "stream"); }
      const records = (payload.strokes || []).map((raw) => {
        const strike = normalizeStrike(raw, started); if (!strike) return null;
        const record = withOrigin(strike, liveSource, started, raw.id ?? null);
        if (!raw.time) { record.provenance.observedAt = null; record.provenance.transformations.push("time-inferred-from-fetch"); }
        return record;
      }).filter(Boolean);
      const rejected = (payload.strokes || []).length - records.length;
      if (rejected) this.emit({ operation: "normalize", success: false, rejected });
      if (payload.strokes?.length && !records.length) { this.failed("malformed"); throw new C.ProviderError("malformed", this.id, "stream"); }
      Object.assign(this.health, { lastSuccessfulFetch: started, available: true, consecutiveFailures: 0, lastError: rejected ? new C.ProviderError("malformed", this.id, "stream").toJSON() : null });
      if (records.length) this.health.sourceDataTimestamp = Math.max(...records.map((r) => r.time));
      this.recordsSinceLog += records.length;
      if (this.lastLogAt == null || started - this.lastLogAt >= 60000) {
        this.emit({ operation: "stream", duration: this.now() - started, success: !rejected, records: this.recordsSinceLog, sourceTimestamp: this.health.sourceDataTimestamp, freshness: C.freshness(this.health, started) });
        this.lastLogAt = started; this.recordsSinceLog = 0;
      }
      // Heartbeats signal a healthy connection, not newly observed lightning.
      return { records, receiver: payload.cid ? { viewers: Number(payload.con || 0), name: String(payload.port || "ready") } : null, health: { ...this.health, freshness: C.freshness(this.health, started) } };
    }
  }
  class LightningHistoryProvider {
    constructor({ fetch: fetcher = globalThis.fetch, apiKey, now = Date.now, log } = {}) { this.id = historySource.id; this.source = historySource; this.fetch = fetcher; this.apiKey = apiKey; this.runner = new C.ProviderRunner(this.source, { now, log }); this.now = now; }
    get health() { return this.runner.health; }
    async history(minutes = 1440) {
      return this.runner.run("history", async () => {
        if (!this.apiKey) throw new C.ProviderError("configuration", this.id, "history");
        const window = Math.min(1440, Math.max(1, Number.isFinite(Number(minutes)) ? Number(minutes) : 1));
        const response = await this.fetch(`https://api.lightningapi.dev/v1/flashes?since_minutes=${window}&limit=20000`, { headers: { "X-API-Key": this.apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw C.httpError(response.status, this.id, "history", response.headers?.get("retry-after"));
        let payload; try { payload = await response.json(); } catch { throw new C.ProviderError("parse", this.id, "history"); }
        if (!Array.isArray(payload?.flashes)) throw new C.ProviderError("malformed", this.id, "history");
        const normalized = normalizeHistoryFlashes(payload.flashes);
        if (payload.flashes.length && !normalized.length) throw new C.ProviderError("malformed", this.id, "history");
        const fetchedAt = this.now();
        const records = normalized.map((r) => withOrigin(r, historySource, fetchedAt, r.id.slice("provider:".length)));
        const rejected = payload.flashes.length - records.length;
        if (rejected) this.runner.emit({ operation: "normalize", rejected, success: false });
        return { records, rejectedRecords: rejected, sourceDataTimestamp: records.length ? Math.max(...records.map((r) => r.time)) : null };
      });
    }
  }
  function normalizeBackfillResponse(payload) {
    if (!Array.isArray(payload?.flashes)) return [];
    return payload.flashes.map((raw) => {
      const strike = normalizeStrike(raw);
      if (!strike) return null;
      return strike.provenance || !Number.isFinite(payload.fetchedAt) ? strike : withOrigin(strike, historySource, payload.fetchedAt, strike.id.startsWith("provider:") ? strike.id.slice(9) : strike.id);
    }).filter(Boolean);
  }
  const log = (entry) => { const method = entry.success === false ? "warn" : "debug"; globalThis.console?.[method]?.("Stormtrace provider", entry); };
  Object.assign(C, { normalizeStrike, normalizeHistoryFlashes, normalizeBackfillResponse, lightningEvent, LightningMapsProvider, LightningHistoryProvider });
  globalThis.StormtraceProviders = { live: new LightningMapsProvider({ log }), log };
})();
