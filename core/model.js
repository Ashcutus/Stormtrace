(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const ERROR_CODES = new Set(["network", "upstream", "timeout", "authentication", "rate_limited", "malformed", "unsupported_schema", "stale", "configuration", "parse", "unavailable"]);
  class ProviderError extends Error {
    constructor(code, provider, operation, { status = null, retryAfter = null } = {}) {
      if (!ERROR_CODES.has(code)) throw new TypeError("Unknown provider error code");
      super(`${provider}: ${operation}: ${code}`);
      this.name = "ProviderError";
      Object.assign(this, { code, provider, operation, status, retryAfter });
    }
    toJSON() { const { code, provider, operation, status, retryAfter } = this; return { code, provider, operation, status, retryAfter }; }
  }
  function providerError(error, provider, operation) {
    if (error instanceof ProviderError) return error;
    return new ProviderError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network", provider, operation);
  }
  function httpError(status, provider, operation, retryAfter = null) {
    return new ProviderError(status === 401 || status === 403 ? "authentication" : status === 429 ? "rate_limited" : "upstream", provider, operation, { status, retryAfter });
  }
  function health(expectedUpdateInterval = null) {
    return { lastAttemptedFetch: null, lastSuccessfulFetch: null, sourceDataTimestamp: null, expectedUpdateInterval, lastError: null, consecutiveFailures: 0, available: false };
  }
  function freshness(state, now = Date.now()) {
    if (state.lastError?.code === "malformed" || state.lastError?.code === "parse" || state.lastError?.code === "unsupported_schema") return "malformed";
    if (state.lastError?.code === "stale") return "stale";
    if (state.lastError) return state.lastError.code === "unavailable" || state.lastError.code === "configuration" ? "unavailable" : "provider_error";
    if (state.lastSuccessfulFetch == null) return state.lastAttemptedFetch == null ? "never_loaded" : "unavailable";
    if (!state.available) return "unavailable";
    const age = now - (state.freshnessBasis === "fetch" ? state.lastSuccessfulFetch : Math.min(state.lastSuccessfulFetch, state.sourceDataTimestamp ?? state.lastSuccessfulFetch));
    if (!state.expectedUpdateInterval) return "fresh";
    if (age > state.expectedUpdateInterval * 3) return "stale";
    return age > state.expectedUpdateInterval * 1.5 ? "delayed" : "fresh";
  }
  class ProviderRunner {
    constructor(source, { now = Date.now, log = () => {}, freshnessBasis = "source" } = {}) {
      this.source = source; this.now = now; this.log = log;
      this.health = { ...health(source.expectedUpdateInterval), freshnessBasis };
    }
    async run(operation, retrieve) {
      const started = this.now();
      this.health.lastAttemptedFetch = started;
      try {
        const result = await retrieve();
        if (!result || !Array.isArray(result.records) || (result.sourceDataTimestamp != null && !Number.isFinite(result.sourceDataTimestamp))) throw new ProviderError("malformed", this.source.id, operation);
        Object.assign(this.health, { lastSuccessfulFetch: this.now(), sourceDataTimestamp: result.sourceDataTimestamp ?? null, lastError: result.rejectedRecords ? new ProviderError("malformed", this.source.id, operation).toJSON() : null, consecutiveFailures: 0, available: true });
        this.emit({ operation, duration: this.now() - started, success: true, sourceTimestamp: this.health.sourceDataTimestamp, records: result.records.length, freshness: freshness(this.health, this.now()) });
        return { ...result, health: { ...this.health, freshness: freshness(this.health, this.now()) } };
      } catch (error) {
        const typed = providerError(error, this.source.id, operation);
        this.health.lastError = typed.toJSON(); this.health.consecutiveFailures++;
        this.emit({ operation, duration: this.now() - started, success: false, error: typed.toJSON(), freshness: freshness(this.health, this.now()) });
        throw typed;
      }
    }
    emit(context) { try { this.log({ provider: this.source.id, ...context }); } catch { /* diagnostics must not break retrieval */ } }
  }
  function provenance(source, { fetchedAt, upstreamId = null, observedAt = null, updatedAt = null, transformations = [] }) {
    if (!Number.isFinite(fetchedAt)) throw new TypeError("A fetch timestamp is required");
    for (const value of [observedAt, updatedAt]) if (value != null && !Number.isFinite(value)) throw new TypeError("Invalid provenance timestamp");
    return { provider: source.id, sourceAuthority: source.authority, sourceUrl: source.homepage, upstreamId: upstreamId == null ? null : String(upstreamId), fetchedAt, observedAt, updatedAt, transformations: [...transformations] };
  }
  function event({ id, kind, provider, sourceAuthority, provenance: origin, geometry = null, observedAt = null, updatedAt = null, validFrom = null, validTo = null, sourceSeverity = null, displayPriority = "normal", domainPayload }) {
    if (!id || !kind || !provider || !origin || origin.provider !== provider || origin.sourceAuthority !== sourceAuthority || !domainPayload || typeof domainPayload !== "object") throw new TypeError("Invalid event envelope");
    if (!sourceAuthority || !Number.isFinite(origin.fetchedAt) || !Array.isArray(origin.transformations) || !origin.transformations.every((v) => typeof v === "string") || Array.isArray(domainPayload)) throw new TypeError("Invalid event provenance/payload");
    for (const value of [origin.observedAt, origin.updatedAt, observedAt, updatedAt, validFrom, validTo]) if (value != null && !Number.isFinite(value)) throw new TypeError("Invalid event timestamp");
    if (!["low", "normal", "high", "urgent"].includes(displayPriority)) throw new TypeError("Invalid display priority");
    const normalizedGeometry = geometry == null ? null : C.normalizeGeometry(geometry);
    if (geometry != null && !normalizedGeometry) throw new TypeError("Invalid event geometry");
    return { id: String(id), kind, provider, sourceAuthority, observedAt, updatedAt, validFrom, validTo, geometry: normalizedGeometry, sourceSeverity, displayPriority, provenance: origin, domainPayload };
  }
  function provenanceFreshness(origin, now = Date.now()) {
    const source = C.getSource(origin.provider);
    return freshness({ ...health(source.expectedUpdateInterval), lastSuccessfulFetch: origin.fetchedAt, sourceDataTimestamp: origin.updatedAt ?? origin.observedAt, available: true }, now);
  }
  Object.assign(C, { provenanceFreshness, ProviderError, providerError, httpError, health, freshness, ProviderRunner, provenance, event });
})();
