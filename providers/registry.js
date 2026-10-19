(() => {
  "use strict";
  const C = globalThis.StormtraceCore ||= {};
  const commercial = "COMMERCIAL_PERMISSION_REQUIRED";
  function source(id, name, authority, categories, coverage, homepage, classification, extra = {}) {
    return { id, name, authority, description: name, categories, coverage, homepage, attribution: `Source: ${authority}`, licence: { classification, termsUrl: homepage, notes: "Endpoint-specific terms must be verified before implementation or redistribution." }, authentication: "verify_before_implementation", expectedUpdateInterval: null, historicalData: "verify_before_implementation", commercialUse: "review_required", status: "deferred", notes: "Metadata placeholder; no live API or entitlement implied.", ...extra };
  }
  // BEGIN HAZARD SOURCES JSON
  const hazardSources = [
  {
    "id": "nhc",
    "name": "NHC / CPHC tropical cyclones",
    "authority": "NOAA National Hurricane Center / Central Pacific Hurricane Center",
    "description": "NHC / CPHC tropical cyclones",
    "categories": [
      "cyclone"
    ],
    "coverage": "North Atlantic, eastern and central North Pacific",
    "homepage": "https://www.nhc.noaa.gov/",
    "attribution": "Source: NOAA National Hurricane Center / Central Pacific Hurricane Center",
    "licence": {
      "classification": "PUBLIC_GOVERNMENT",
      "termsUrl": "https://www.weather.gov/disclaimer",
      "notes": "Public current-storm summary; official advisory and forecast links. No global operational coverage or local forecast-cone overlay."
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permitted_subject_to_terms",
    "expectedUpdateInterval": 900000,
    "notes": "Public current-storm summary; official advisory and forecast links. No global operational coverage or local forecast-cone overlay."
  },
  {
    "id": "usgs-volcano",
    "name": "USGS monitored volcano alerts",
    "authority": "US Geological Survey / Volcano Hazards Program",
    "description": "USGS monitored volcano alerts",
    "categories": [
      "volcano"
    ],
    "coverage": "USGS monitored volcanoes; not global coverage",
    "homepage": "https://www.usgs.gov/programs/VHP/volcano-updates",
    "attribution": "Source: US Geological Survey / Volcano Hazards Program",
    "licence": {
      "classification": "PUBLIC_GOVERNMENT",
      "termsUrl": "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
      "notes": "Public HANS elevated volcano notices; native ground alert and aviation colour retained. Quiet issue times do not indicate fetch failure."
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permitted_subject_to_terms",
    "expectedUpdateInterval": 300000,
    "notes": "Public HANS elevated volcano notices; native ground alert and aviation colour retained. Quiet issue times do not indicate fetch failure."
  },
  {
    "id": "gvp",
    "name": "Smithsonian / USGS weekly volcanic reports",
    "authority": "Global Volcanism Program, Smithsonian Institution",
    "description": "Smithsonian / USGS weekly volcanic reports",
    "categories": [
      "volcano"
    ],
    "coverage": "Global reports; incomplete weekly activity coverage",
    "homepage": "https://volcano.si.edu/reports_weekly.cfm",
    "attribution": "Source: Global Volcanism Program, Smithsonian Institution",
    "licence": {
      "classification": "FREE_HOSTED_NONCOMMERCIAL",
      "termsUrl": "https://volcano.si.edu/gvp_termsofuse.cfm",
      "notes": "Weekly summaries, not real-time warnings. Cite report sources and link to GVP; retain notices. Images not included. Hosted access may be blocked."
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permission_required",
    "expectedUpdateInterval": 21600000,
    "notes": "Weekly summaries, not real-time warnings. Cite report sources and link to GVP; retain notices. Images not included. Hosted access may be blocked."
  },
  {
    "id": "noaa-tsunami",
    "name": "NOAA tsunami centre bulletins",
    "authority": "NOAA tsunami warning centres",
    "description": "NOAA tsunami centre bulletins",
    "categories": [
      "tsunami"
    ],
    "coverage": "NTWC / PTWC products; centre-specific regional coverage",
    "homepage": "https://www.tsunami.gov/",
    "attribution": "Source: NOAA tsunami warning centres",
    "licence": {
      "classification": "PUBLIC_GOVERNMENT",
      "termsUrl": "https://www.weather.gov/disclaimer",
      "notes": "Latest CAP bulletin from each centre, not a complete active-alert inventory. Preserve issue/expiry, update/cancel references, source wording and national authority distinctions; areas are not inundation maps."
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permitted_subject_to_terms",
    "expectedUpdateInterval": 60000,
    "notes": "Latest CAP bulletin from each centre, not a complete active-alert inventory. Preserve issue/expiry, update/cancel references, source wording and national authority distinctions; areas are not inundation maps."
  },
  {
    "id": "swpc",
    "name": "NOAA space weather",
    "authority": "NOAA Space Weather Prediction Center",
    "description": "NOAA space weather",
    "categories": [
      "space_weather"
    ],
    "coverage": "Global and near-Earth space",
    "homepage": "https://www.spaceweather.gov/",
    "attribution": "Source: NOAA Space Weather Prediction Center",
    "licence": {
      "classification": "PUBLIC_GOVERNMENT",
      "termsUrl": "https://www.weather.gov/disclaimer",
      "notes": "Public current/forecast R/S/G scale products and recent issued messages. Current/forecast snapshots are not discrete-event history; recent messages may be expired or superseded."
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permitted_subject_to_terms",
    "expectedUpdateInterval": 300000,
    "notes": "Public current/forecast R/S/G scale products and recent issued messages. Current/forecast snapshots are not discrete-event history; recent messages may be expired or superseded."
  },
  {
    "id": "metoffice-warnings-rss",
    "name": "Met Office public warning summaries",
    "authority": "Met Office",
    "description": "Official public RSS warning summaries",
    "categories": [
      "warning"
    ],
    "coverage": "UK",
    "homepage": "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings",
    "attribution": "Met Office Weather Warnings \u00b7 Crown copyright",
    "licence": {
      "classification": "FREE_HOSTED_BEST_EFFORT",
      "termsUrl": "https://www.metoffice.gov.uk/policies/tandc",
      "notes": "RSS feeds are free for any purpose subject to Met Office terms. Preserve supplied content and links; provide attribution and a direct official link.",
      "name": "Met Office RSS terms"
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permitted_subject_to_terms",
    "expectedUpdateInterval": 300000,
    "notes": "RSS summaries only. No warning geometry, full instructions or per-warning issue/expiry timestamps; check the official warning. Disappearance is not cancellation."
  },
  {
    "id": "metoffice-warnings-esri",
    "name": "Met Office public warning areas (Esri beta)",
    "authority": "Met Office",
    "description": "Official warning areas through the Met Office-linked Esri channel",
    "categories": [
      "warning"
    ],
    "coverage": "UK",
    "homepage": "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings",
    "attribution": "Met Office Weather Warnings \u00b7 Crown copyright",
    "licence": {
      "classification": "OPEN_DATA",
      "termsUrl": "https://www.metoffice.gov.uk/api/assets/file/NSWWSOpenLicencepdf?prefix=assets",
      "notes": "NSWWS Open Licence v1: unchanged information, Met Office Weather Warnings attribution, publication year, issue time, direct official link and delay disclaimer."
    },
    "status": "active_optional",
    "authentication": "none",
    "historicalData": false,
    "commercialUse": "permitted_subject_to_terms",
    "expectedUpdateInterval": 180000,
    "notes": "Public beta mirror; unsupported Feature Service API. Dedicated warning map, no other meteorological overlays. Source times and fields retained; disappearance does not establish cancellation."
  }
];
  // END HAZARD SOURCES JSON
  // Read by the Python fallback providers; keep this block valid JSON.
  // BEGIN PROVIDER SOURCES JSON
  const providerSources = [
    {
      "id": "ea-floods",
      "name": "England flood warnings",
      "authority": "Environment Agency",
      "description": "England flood warnings",
      "categories": [
        "warning"
      ],
      "coverage": "England",
      "homepage": "https://check-for-flooding.service.gov.uk/alerts-and-warnings",
      "attribution": "This uses Environment Agency flood and river level data from the real-time data API (Beta)",
      "licence": {
        "classification": "OPEN_DATA",
        "termsUrl": "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
        "notes": "OGL v3 with Environment Agency attribution; beta service, no service-level guarantee."
      },
      "authentication": "none",
      "expectedUpdateInterval": 900000,
      "historicalData": false,
      "commercialUse": "permitted_subject_to_terms",
      "status": "active_optional",
      "notes": "On-demand England warning list and warning-area polygons; not UK-wide. Polygons describe warning coverage, not observed inundation. Offset-free source timestamps are preserved without inventing a timezone. Withdrawal requires explicit level 4."
    },
    {
      "id": "usgs",
      "name": "USGS earthquake catalogue",
      "authority": "US Geological Survey",
      "description": "USGS earthquake catalogue",
      "categories": [
        "earthquake"
      ],
      "coverage": "Global; detection/reporting varies by region",
      "homepage": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
      "attribution": "Earthquake data: USGS / ANSS ComCat and contributing seismic networks",
      "licence": {
        "classification": "PUBLIC_GOVERNMENT",
        "termsUrl": "https://www.usgs.gov/faqs/are-usgs-reportspublications-copyrighted",
        "notes": "USGS-produced data are US public domain; retain contributing-network provenance and any applicable third-party notices. No third-party imagery is redistributed."
      },
      "authentication": "none",
      "expectedUpdateInterval": 60000,
      "historicalData": true,
      "commercialUse": "permitted_subject_to_terms",
      "status": "active_optional",
      "notes": "Uses the public all_day GeoJSON summary plus on-demand USGS ShakeMap MMI contours where published; no inferred felt radius or historical search API. Preliminary locations and magnitudes can change; this is not earthquake early warning."
    }
  ];
  // END PROVIDER SOURCES JSON
  const providerSource = (id) => providerSources.find((s) => s.id === id);
  const sources = [
    ...hazardSources,
    source("lightningmaps", "LightningMaps live feed", "Blitzortung community network", ["lightning"], "Global; station-dependent", "https://www.blitzortung.org/", "FREE_HOSTED_NONCOMMERCIAL", { status: "active", authentication: "none", historicalData: false, expectedUpdateInterval: 60000, commercialUse: "permission_required", notes: "Unofficial best-effort WebSocket interface; quiet periods do not prove feed failure.", licence: { classification: "FREE_HOSTED_NONCOMMERCIAL", termsUrl: "https://www.blitzortung.org/Compendium/Hardware/Documentation_20_6.html", notes: "Private non-commercial viewer; commercial data use prohibited by published documentation.", displayText: "Private, non-commercial viewer. Coverage and detection latency vary by region.", detailText: "The live interface is unofficial and may change. Data is provided for private, non-commercial use and must not be treated as a safety-critical warning system." } }),
    source("lightning-history", "Lightning API optional backfill", "Lightning API", ["lightning"], "Upstream coverage varies", "https://lightningapi.dev/", commercial, { status: "active_optional", authentication: "server_api_key", historicalData: true, expectedUpdateInterval: null, notes: "Existing V1 integration; access and requested history depend on subscribed plan. Terms unverified." }),
    source("nominatim", "Nominatim place search", "OpenStreetMap contributors", ["geocoding"], "Global", "https://nominatim.openstreetmap.org/", "FREE_HOSTED_BEST_EFFORT", { status: "active", authentication: "none", historicalData: false, licence: { classification: "FREE_HOSTED_BEST_EFFORT", termsUrl: "https://operations.osmfoundation.org/policies/nominatim/", notes: "Hosted usage policy applies; OpenStreetMap attribution and ODbL apply to data." } }),
    source("metoffice-radar", "Met Office UK radar observations", "Met Office", ["radar"], "UK display crop", "https://registry.opendata.aws/met-office-uk-radar-observations/", "OPEN_DATA", { status: "active_optional", authentication: "none", expectedUpdateInterval: 900000, historicalData: true, commercialUse: "permitted_subject_to_terms", attribution: "Met Office radar · Crown copyright · CC BY-SA 4.0 · reprojected/cropped", licence: { classification: "OPEN_DATA", termsUrl: "https://creativecommons.org/licenses/by-sa/4.0/", notes: "ASDI public beta/non-operational service; 15-minute observations, published within 20 minutes. Derived imagery is reprojected/cropped and carries attribution/share-alike." }, notes: "Anonymous public S3 observations, not DataHub forecast imagery. Optional local HDF5/projection decoder required." }),
    source("opera-radar", "European OPERA rain-rate observations", "EUMETNET", ["radar"], "European composite; contributing-radar coverage varies", "https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/", "OPEN_DATA", { status: "active_optional", authentication: "none", expectedUpdateInterval: 900000, historicalData: true, commercialUse: "permitted_subject_to_terms", attribution: "European radar: EUMETNET OPERA · CC BY 4.0 · reprojected/cropped", licence: { classification: "OPEN_DATA", termsUrl: "https://creativecommons.org/licenses/by/4.0/", notes: "ORD OPERA composites are CC BY 4.0. National volumes have separate terms. Live checked NIMBUS RATE grid: 2 km, 15-minute frames." }, notes: "Anonymous ORD S3 24-hour cache; optional local ODIM decoder. Missing coverage is not dry weather; no service guarantee." }),
    source("noaa-radar", "US radar reflectivity", "NOAA / National Weather Service", ["radar"], "CONUS, Alaska, Hawaii, Caribbean and Guam regional displays; radar-dependent", "https://opengeo.ncep.noaa.gov/geoserver/www/index.html", "PUBLIC_GOVERNMENT", { status: "active_optional", authentication: "none", expectedUpdateInterval: 120000, historicalData: false, commercialUse: "permitted_subject_to_terms", attribution: "Radar: NOAA / National Weather Service · MRMS · WMS display crop; no NOAA endorsement", licence: { classification: "PUBLIC_GOVERNMENT", termsUrl: "https://www.weather.gov/disclaimer", notes: "Public NOAA observations and WMS imagery. Retain attribution and identify transformed imagery; no endorsement or availability guarantee." }, notes: "Quality-controlled base reflectivity (dBZ), not rainfall rate. Uses source time dimensions and source-generated legend; no local scientific decoder required. Regional bounds are display crops, not guarantees of coverage." }),
    source("metoffice-warnings", "Met Office Weather Warnings", "Met Office", ["warning"], "UK", "https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings", "AUTH_REQUIRED_FREE", { status: "active_optional", authentication: "server_api_key", expectedUpdateInterval: 60000, historicalData: false, commercialUse: "permitted_subject_to_terms", attribution: "Met Office Weather Warnings · Powered by Met Office data", licence: { classification: "AUTH_REQUIRED_FREE", termsUrl: "https://datahub.metoffice.gov.uk/support/faqs", notes: "DataHub subscription/terms and NSWWS style guide apply. Atom/GeoJSON v1.1; no upstream archive. Polling once per minute is recommended." }, notes: "Opt-in, server-side DataHub key. Feed change timestamps are not periodic measurements; freshness uses last successful polling." }),
    providerSource("ea-floods"),
    source("nrw-floods", "Wales flood warnings", "Natural Resources Wales", ["warning"], "Wales", "https://flood-warning.naturalresources.wales/", "AUTH_REQUIRED_FREE", { authentication: "server_api_key", historicalData: false, attribution: "Contains Natural Resources Wales information © Natural Resources Wales and Database Right. All rights Reserved.", licence: { classification: "AUTH_REQUIRED_FREE", termsUrl: "https://api-portal.naturalresources.wales/", notes: "NRW portal lists OGL reuse; supported v3 API requires a subscription key." }, notes: "Live integration is unavailable without NRW API access. Check the official Wales service for current warnings." }),
    source("sepa-floods", "Scotland flood warnings", "Scottish Environment Protection Agency", ["warning"], "Scotland", "https://floodline.sepa.org.uk/live-flood-information/", "PUBLIC_GOVERNMENT", { authentication: "access_by_request", historicalData: "verify_before_implementation", notes: "Live integration is unavailable: SEPA Floodline API access and endpoint-specific terms must be verified. Check the official Scotland service for current warnings." }),
    source("ni-floods", "Northern Ireland flood information", "Department for Infrastructure Rivers", ["warning"], "Northern Ireland", "https://www.nidirect.gov.uk/articles/check-risk-flooding-your-area", "PUBLIC_GOVERNMENT", { authentication: "verify_before_implementation", historicalData: "verify_before_implementation", notes: "No supported public live warning feed has been verified. Official flood-risk maps describe long-term risk, not current warnings." }),
    providerSource("usgs"),
    source("ibtracs", "IBTrACS historical tracks", "NOAA NCEI and contributing agencies", ["cyclone"], "Global", "https://www.ncei.noaa.gov/products/international-best-track-archive", "PUBLIC_GOVERNMENT", { historicalData: true }),
    source("gdacs", "GDACS supplementary hazard awareness", "GDACS participating agencies", ["earthquake", "cyclone", "volcano", "tsunami"], "Global", "https://www.gdacs.org/", commercial, { notes: "Supplementary context; retain originating authority; not a replacement for official warnings." }),
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
