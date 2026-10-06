(() => {
  "use strict";
  const C = globalThis.StormtraceCore;
  class NominatimProvider {
    constructor({ fetch: fetcher = globalThis.fetch, now = Date.now, log } = {}) { this.id = "nominatim"; this.source = C.getSource(this.id); this.fetch = fetcher; this.now = now; this.runner = new C.ProviderRunner(this.source, { now, log }); }
    get health() { return this.runner.health; }
    async search(query) {
      return this.runner.run("search", async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let response;
        try { response = await this.fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" }, signal: controller.signal }); }
        finally { clearTimeout(timer); }
        if (!response.ok) throw C.httpError(response.status, this.id, "search");
        let payload; try { payload = await response.json(); } catch { throw new C.ProviderError("parse", this.id, "search"); }
        if (!Array.isArray(payload)) throw new C.ProviderError("malformed", this.id, "search");
        const fetchedAt = this.now();
        const records = payload.map((raw) => {
          const lat = raw?.lat == null ? NaN : Number(raw.lat), lon = raw?.lon == null ? NaN : Number(raw.lon);
          if (!C.normalizeGeometry({ type: "Point", coordinates: [lon, lat] }) || typeof raw.display_name !== "string") return null;
          const [name, ...rest] = raw.display_name.split(",");
          return { name, description: rest.slice(0, 3).join(",").trim(), label: raw.display_name.split(",").slice(0, 2).join(","), lat, lon, provenance: C.provenance(this.source, { fetchedAt, upstreamId: raw.place_id ?? null, transformations: ["place-normalization-v1"] }) };
        }).filter(Boolean);
        if (payload.length && !records.length) throw new C.ProviderError("malformed", this.id, "search");
        return { records, rejectedRecords: payload.length - records.length, sourceDataTimestamp: null };
      });
    }
  }
  C.NominatimProvider = NominatimProvider;
})();
