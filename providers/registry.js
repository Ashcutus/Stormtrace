(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const commercial = "COMMERCIAL_PERMISSION_REQUIRED";
  function source(id, name, authority, categories, coverage, homepage, classification, extra = {}) {
    return { id, name, authority, description: name, categories, coverage, homepage, attribution: `Source: ${authority}`, licence: { classification, termsUrl: homepage, notes: "Endpoint-specific terms must be verified before implementation or redistribution." }, authentication: "verify_before_implementation", expectedUpdateInterval: null, historicalData: "verify_before_implementation", commercialUse: "review_required", status: "deferred", notes: "Metadata placeholder; no live API or entitlement implied.", ...extra };
  }
  const sources = [
    source("lightningmaps", "LightningMaps live feed", "Blitzortung community network", ["lightning"], "Global; station-dependent", "https://www.blitzortung.org/", "FREE_HOSTED_NONCOMMERCIAL", { status: "active", authentication: "none", historicalData: false, expectedUpdateInterval: 60000, commercialUse: "permission_required", notes: "Unofficial best-effort WebSocket interface; quiet periods do not prove feed failure.", licence: { classification: "FREE_HOSTED_NONCOMMERCIAL", termsUrl: "https://www.blitzortung.org/Compendium/Hardware/Documentation_20_6.html", notes: "Private non-commercial viewer; commercial data use prohibited by published documentation.", displayText: "Private, non-commercial viewer. Coverage and detection latency vary by region.", detailText: "The live interface is unofficial and may change. Data is provided for private, non-commercial use and must not be treated as a safety-critical warning system." } }),
    source("lightning-history", "Lightning API optional backfill", "Lightning API", ["lightning"], "Upstream coverage varies", "https://lightningapi.dev/", commercial, { status: "active_optional", authentication: "server_api_key", historicalData: true, expectedUpdateInterval: null, notes: "Existing V1 integration; access and requested history depend on subscribed plan. Terms unverified." }),
    source("nominatim", "Nominatim place search", "OpenStreetMap contributors", ["geocoding"], "Global", "https://nominatim.openstreetmap.org/", "FREE_HOSTED_BEST_EFFORT", { status: "active", authentication: "none", historicalData: false, licence: { classification: "FREE_HOSTED_BEST_EFFORT", termsUrl: "https://operations.osmfoundation.org/policies/nominatim/", notes: "Hosted usage policy applies; OpenStreetMap attribution and ODbL apply to data." } }),
    source("metoffice-radar", "Met Office UK radar observations", "Met Office", ["radar"], "UK", "https://www.metoffice.gov.uk/services/data/met-office-weather-datahub", commercial),
    source("metoffice-warnings", "National Severe Weather Warning Service", "Met Office", ["warning"], "UK", "https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings", commercial),
    source("usgs", "USGS earthquake catalogue", "US Geological Survey", ["earthquake"], "Global", "https://earthquake.usgs.gov/fdsnws/event/1/", "PUBLIC_GOVERNMENT", { historicalData: true }),
    source("nhc", "NOAA/NHC operational cyclones", "NOAA National Hurricane Center", ["cyclone"], "NHC areas of responsibility", "https://www.nhc.noaa.gov/", "PUBLIC_GOVERNMENT"),
    source("ibtracs", "IBTrACS historical tracks", "NOAA NCEI and contributing agencies", ["cyclone"], "Global", "https://www.ncei.noaa.gov/products/international-best-track-archive", "PUBLIC_GOVERNMENT", { historicalData: true }),
    source("gdacs", "GDACS supplementary hazard awareness", "GDACS participating agencies", ["earthquake", "cyclone", "volcano", "tsunami"], "Global", "https://www.gdacs.org/", commercial, { notes: "Supplementary context; retain originating authority; not a replacement for official warnings." }),
    source("gvp", "Global Volcanism Program", "Smithsonian Institution", ["volcano"], "Global", "https://volcano.si.edu/", commercial),
    source("noaa-tsunami", "NOAA tsunami warning centres", "NOAA tsunami warning centres", ["tsunami"], "Centre-specific areas of responsibility", "https://www.tsunami.gov/", "PUBLIC_GOVERNMENT"),
    source("swpc", "NOAA space weather", "NOAA Space Weather Prediction Center", ["space_weather"], "Global and near-Earth space", "https://www.swpc.noaa.gov/", "PUBLIC_GOVERNMENT"),
    source("donki", "NASA DONKI", "NASA Community Coordinated Modeling Center", ["space_weather"], "Heliosphere and near-Earth space", "https://ccmc.gsfc.nasa.gov/tools/DONKI/", "AUTH_REQUIRED_FREE"),
  ];
  function freeze(v) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
  const sourceRegistry = freeze(Object.fromEntries(sources.map((s) => [s.id, s])));
  function getSource(id) { if (!Object.hasOwn(sourceRegistry, id)) throw new C.ProviderError("configuration", String(id), "registry"); return sourceRegistry[id]; }
  class ProviderRegistry {
    constructor() { this.implementations = new Map(); }
    register(provider) {
      const metadata = getSource(provider.id);
      if (metadata.status === "deferred") throw new C.ProviderError("configuration", provider.id, "register_deferred");
      if (this.implementations.has(provider.id)) throw new C.ProviderError("configuration", provider.id, "duplicate_registration");
      this.implementations.set(provider.id, provider); return provider;
    }
    get(id) { return this.implementations.get(id) || null; }
    sources() { return Object.values(sourceRegistry); }
  }
  Object.assign(C, { sourceRegistry, getSource, ProviderRegistry });
})();
