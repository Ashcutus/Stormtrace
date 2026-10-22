# Provider development and source registry

Use the [architecture guide](architecture.md) for core/platform boundaries. This guide owns provider development and source metadata interpretation.

`providers/registry.js` is the canonical immutable source/authority/attribution registry. `ProviderRegistry` separately tracks active implementations; metadata placeholders do not call APIs or create subscriptions. V1's application registers its live and place providers; the local Node server composes the historical provider. Retrieve metadata with `StormtraceCore.getSource(id)`.

Each entry describes ID/name/authority, purpose, geographic coverage, categories, homepage, attribution, licence/terms URL and notes, authentication, expected cadence (milliseconds or null), upstream historical availability, commercial-use review status, implementation status and caveats. Classification is a discovery/access category, **not a legal permission grant**. Supported categories are `OPEN_DATA`, `PUBLIC_GOVERNMENT`, `FREE_HOSTED_NONCOMMERCIAL`, `FREE_HOSTED_BEST_EFFORT`, `AUTH_REQUIRED_FREE` and `COMMERCIAL_PERMISSION_REQUIRED`. Conservative permission-review placeholders do not assert that a provider actually charges or prohibits commercial use. Government publication alone does not resolve all endpoint/third-party terms.

V1 access, optional Met Office warnings, radar, floods, earthquakes and the [additional hazard views](hazards.md) are implemented. Remaining future sources deliberately use unknown cadence/auth/terms where not verified. Verify the chosen product rather than deriving refresh intervals or licensing from the organisation's name. For Met Office products, start with [Weather DataHub](https://www.metoffice.gov.uk/services/data/met-office-weather-datahub) and its [terms](https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/data/met-office-weatherdatahub-terms-and-conditions.pdf); this is not an assertion that every future warning/radar endpoint uses those terms. Existing community lightning has published [non-commercial restrictions](https://www.blitzortung.org/Compendium/Hardware/Documentation_20_6.html). Nominatim has a separate [hosted usage policy](https://operations.osmfoundation.org/policies/nominatim/) and OSM data attribution.

## Source matrix

| Registry ID | Source / authority | Domain | Implementation state |
| --- | --- | --- | --- |
| lightningmaps | LightningMaps / Blitzortung community network | Live lightning | Existing feed normalized, provenance and health |
| lightning-history | Lightning API | Historical lightning | Existing optional server-key backfill, Node/Python transport |
| nominatim | Nominatim / OpenStreetMap contributors | Place search | Normalized place models and provenance |
| metoffice-radar | Met Office UK radar observations | Radar frames/resources | Optional public ASDI observations, shared Python decoder, Node/Python routes; paid service deferred |
| opera-radar | EUMETNET OPERA NIMBUS | European rain-rate frames/resources | Optional public ORD S3 composite, shared ODIM decoder and Node/Python routes |
| noaa-radar | NOAA / National Weather Service | Regional reflectivity and precipitation-type frames/resources | Optional timestamped WMS imagery and source legend for CONUS, Alaska, Hawaii, Caribbean and Guam |
| metoffice-warnings-esri | Met Office / official Esri beta mirror | Warning areas | Public no-key GeoJSON, NSWWS Open Licence; dedicated map with source-native fields, bounded geometry and three-minute cache; area text also parsed into `affectedAreas`; API unsupported by Met Office |
| metoffice-warnings-rss | Met Office official RSS | Warning summaries | Automatic no-key fallback; shared Python normalization/transport, five-minute cache, direct official links; region places parsed from the summary sentence into `affectedAreas` (empty when the wording differs); no geometry or per-warning source times |
| metoffice-warnings | Met Office NSWWS | Official warnings | Optional DataHub v1.1 Atom/GeoJSON integration; server key, Node/Python parity, dedicated warnings view |
| ea-floods | Environment Agency | England flood warnings | On-demand public JSON feed, Node/Python parity, dedicated list and local history |
| nrw-floods | Natural Resources Wales | Wales flood warnings | Official-information link only; supported v3 subscription access required, live integration deferred |
| sepa-floods | SEPA | Scotland flood warnings | Official-information link only; supported Floodline API access/terms unverified, live integration deferred |
| ni-floods | DfI Rivers | Northern Ireland flood information | Official-information link only; no supported public live warning feed verified |
| usgs | US Geological Survey / ANSS ComCat | Earthquakes | Public past-day summary, Node/Python normalization parity, dedicated filtered view and local revisions |
| nhc | NOAA NHC / CPHC | Regional operational cyclones | Public current-storm summary, selected centre, official advisory/forecast links; local tracks/cones deferred |
| ibtracs | NOAA NCEI and contributors | Historical cyclones | Historical capability and metadata |
| gdacs | GDACS participating agencies | Supplementary global hazards | Metadata only; retain originating authority |
| usgs-volcano | USGS Volcano Hazards Program / observatories | Regional volcano notices | Public HANS elevated notices joined by `vnum` to HANS `getUSVolcanoes` summit coordinates (`usgs-volcano-location-join-by-vnum` transformation; no location when none is published); separate ground/aviation levels and local revisions |
| gvp | Smithsonian Global Volcanism Program | Global volcano summaries | Optional weekly RSS summaries and local revisions; host can block retrieval |
| noaa-tsunami | NOAA NTWC / PTWC | Regional tsunami bulletins | Latest CAP bulletin per centre, source expiry/update/cancel references; not complete active-alert coverage |
| swpc | NOAA Space Weather Prediction Center | Space weather | Current/forecast scales and recent issued messages; only discrete messages archived |
| donki | NASA CCMC DONKI | Linked solar events | Discrete linked-event capability and metadata |

None of the deferred entries are treated as the sole source for a domain. Multiple implementations may serve the same category. Resolve event identity in a provider namespace; never merge differing official classifications into one danger score.

## Met Office warnings and radar access

The [warnings guide](warnings.md) covers user setup. NSWWS uses Atom links to current/change GeoJSON snapshots, not CAP. `providers/metoffice-warnings.js` and its Python fallback validate snapshots and retain native colour, impact/likelihood, status, version, full wording and provenance. `client/warnings.js` consumes normalized events through `/api/warnings`; credentials stay on the server. Current warning transport is optional and requires a Weather DataHub subscription.

The event-driven feed's update timestamp is retained as source metadata. Provider health uses `freshnessBasis: "fetch"` so an unchanged quiet feed is not falsely stale. Successful server responses are shared for one minute; immutable snapshots are reused while their links remain current. Change observations are replayed to each consumer and persisted with deduplication. Cancelled/expired records are historical, not active warnings. The dedicated list follows official presentation requirements and avoids overlaying warnings with other weather data.

Radar now uses the separately verified [public ASDI dataset](https://registry.opendata.aws/met-office-uk-radar-observations/); [radar setup and limitations](radar.md) explains its optional decoder, cache and display limitations. The [DataPoint retirement FAQ](https://www.metoffice.gov.uk/services/data/datapoint/datapoint-retirement-faqs) describes separate radar access and no like-for-like replacement. DataHub precipitation PNG forecasts are not observed radar. The registry identifies anonymous ASDI access and CC BY-SA terms. Paid access is still not configured; do not guess paid endpoints.

## Adding a provider

1. Choose a registry ID, update that entry with verified endpoint-specific authority/coverage/terms/auth/cadence/history, and set its implementation status. Keep metadata independent from credentials and transport URLs with secrets.
2. Implement the smallest relevant domain contract in `core/contracts.d.ts`. Radar returns frames; warning/earthquake providers return typed event envelopes; cyclone payloads retain tracks/cones; SWPC current/series capabilities return measurements; DONKI may implement only the event capability. Add historical/detail capability only when supported. Do not pretend an unsupported upstream historical API exists: local revisions are a separate concern.
3. Inject fetch/clock/logger (as in `LightningHistoryProvider` or `NominatimProvider`) and use `ProviderRunner.run(operation, retrieve)` for finite batches. Return `{records,sourceDataTimestamp,rejectedRecords?}`. Streaming providers can manage their own health using the same fields, as LightningMaps does. Use structured `ProviderError`/`httpError`, bound transport timeouts and validate schema/records before returning. Choose failure-isolation and logging per provider, without exposing secrets. Set an explicit fetch-based freshness policy for event-driven feeds while preserving their source timestamps.
4. Normalize inside `providers/`, retaining native ID, observation/issue/update time, classifications and geometry. Build provenance from `getSource(id)` and an actual fetch timestamp. Build events with `core.event`; preserve domain-specific payloads. Call `parseCAP` for CAP, examine its diagnostics and retain update/cancellation relationships. Invalid essential identity must not create a seemingly healthy warning. Use `normalizeGeometry` and explicitly handle rejected/missing shapes.
5. At the composition root register the implementation, expose normalized models to the relevant application consumer, and call `RevisionHistory.record` for observed discrete events. History is local even when upstream only exposes current alerts. Set explicit provider-scoped retention; do not reuse lightning's 24-hour policy for warnings. Measurement/radar archives may use `StorageAdapter` with their distinct resource/time-series models.
6. Add captured/synthetic fixtures: schema validity, malformed records, native classifications, source IDs/times, freshness, error codes and recovery, local revision deduplication and update/cancellation semantics. Stub transport; CI must not fetch live feeds. Add regression coverage if touching existing presentation or lifecycle.
7. Update provider docs when behaviour or source state changes, version the root manifest once per PR relative to its base branch, and run `npm test` and `npm run check`. New browser modules need an explicit script/composition entry; authenticated transport may use a local server route. A future Python fallback route must implement the same normalized endpoint contract or explicitly report unsupported capability; never expose an API key to the browser.

## Examples using the core

```js
const source = StormtraceCore.getSource('usgs');
const origin = StormtraceCore.provenance(source, {
  fetchedAt: fetchTime,
  upstreamId: upstreamEventId,
  observedAt: sourceObservationTime,
  updatedAt: sourceUpdateTime,
  transformations: ['usgs-normalization-v1'],
});
const event = StormtraceCore.event({
  id: upstreamEventId,
  kind: 'earthquake',
  provider: source.id,
  sourceAuthority: source.authority,
  observedAt: sourceObservationTime,
  updatedAt: sourceUpdateTime,
  geometry: normalizedGeometry,
  sourceSeverity: { magnitude, magnitudeType, status },
  displayPriority: 'normal',
  provenance: origin,
  domainPayload: { magnitude, magnitudeType, depthKm, status },
});
await history.record(event);
```

A Met Office warning can retain its official colour alongside CAP urgency/severity/certainty in source severity/domain payload. CAP `Severe` and an official warning colour are distinct fields; the generic parser does not translate one into the other. Local history can record changed/cancelled warnings even if upstream has no archive. A radar provider instead returns timestamped frame resources and provenance, with no invented warning severity or point-event payload.

## Testing and dependencies

Run `npm ci` once, then `npm test` and `npm run check`. Lightning/warnings remain dependency-free beyond the existing vendored map libraries and native GTK/WebKit requirements. Radar has optional Python HDF5/projection dependencies in `requirements-radar.txt`; it does not change Node/browser npm runtime dependencies. The sole new npm dependency is the test-only [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB), which exercises transactions, rollback and reopen behavior without live browser/network APIs. It does not claim to test physical disk durability or native GTK delivery. `npm run check` checks all production JavaScript modules and Python source syntax, plus manifest version validity.

## England flood warnings

See [flood information](floods.md) for user-facing behaviour. `providers/ea-floods.js` and `providers/ea_floods.py` normalize public flood-monitoring JSON behind `/api/floods`. The registry owns authority, coverage, licence and attribution. Successful results are shared for 15 minutes; failures do not become empty results. Native levels 1–4 and full source fields survive normalization. Health uses successful fetches, not quiet-period source timestamps. Offset-free timestamps stay raw with null normalized instants; `timeRaised` is last review, not an invented issue date. Level 4 establishes withdrawal; disappearance does not. Warning-area polygons are retrieved separately by the map-resource provider described below.

## USGS earthquakes

`providers/usgs.js` and `providers/usgs.py` normalize the official `all_day.geojson` feed behind `/api/earthquakes`. Successful snapshots are shared for one minute, with a single in-flight Node request and a serialized Python cache. Responses have a 15-second timeout, 10 MB limit and fail redirects explicitly. Source feed generation establishes freshness; occurrence and source-update times are kept separately. Preserve IDs, network/code, magnitude/type, depth, native review status/PAGER classification, unknown properties and actual fetch provenance. Null magnitudes remain null; non-earthquake ComCat records are excluded deliberately. Malformed earthquake records reject the entire snapshot rather than producing apparently complete data.

The dedicated client consumes normalized models; optional map selection shows only one event marker. Local revisions use provider-scoped 30-day/5,000-event retention, deduplicate fetch-only changes and reject older source-update replay. Leaving a rolling feed is not source deletion. Historical query APIs, early-warning/notification features and tsunami warnings are not implemented; ShakeMap contours are loaded on demand by the map-resource provider. The finite provider query filters the available past-day snapshot by time/bounds and makes no historical availability promise. See [earthquakes](earthquakes.md).

`providers/map-overlays.js` and `providers/map_overlays.py` serve England warning-area polygons and on-demand USGS ShakeMap MMI contours through `/api/floods/area?id=` and `/api/earthquakes/impact?id=`. Inputs are identifiers only, product links are restricted to official USGS paths, redirects are rejected and responses are limited to 2 MB. Each server caches up to 128 resources for 15 minutes, enough for one refresh of 100 flood areas; resources never enter event history. See [map layers](map-hazards.md).

## European and US radar

`providers/public_radar.py` retrieves anonymous OPERA NIMBUS RATE composites from the ORD 24-hour S3 cache and NOAA regional WMS base reflectivity. Both local servers select this shared worker through their platform adapters. Upstream S3 keys, WMS XML, time dimensions and product formats remain in providers; the browser receives normalized frame resources, source-specific units/legends and health. NOAA identities include the region and source time. All requests use fixed official endpoints, bounded responses and redirect rejection.

NOAA precipitation type uses the fixed `{region}_pcpn_typ` WMS layer (MRMS PrecipFlag) on the same host, with source ids `noaa-ptype-<region>` and the registry provider `noaa-radar`. The provider returns a categorical legend (`unit: "category"`) with colours matching NOAA's published legend, and records the `mrms-precipflag-display` transformation. Source ids are parsed against fixed regions and products, and frame keys are bound to their product, so a reflectivity key cannot be replayed against the precipitation-type source.

OPERA reuses the optional ODIM-to-Mercator renderer with Cartesian-corner validation and a European display crop. NOAA requests prepared Mercator PNGs and the source-generated reflectivity legend without scientific dependencies. Radar products/resources do not create discrete event revisions. Source metadata and licence/attribution remain canonical in the registry. See [radar setup and limits](radar.md).

## Additional public hazard providers

See [hazard behaviour and limitations](hazards.md). `providers/public_hazards.py` owns fixed anonymous endpoints, bounded JSON/RSS/CAP retrieval and normalization. The JSON metadata blocks in `providers/registry.js` remain canonical and are read through `providers/source_registry.py`; do not duplicate authority/licence entries in the fallback. `platform/node.js` selects the standard-library Python worker. `providers/public-hazards.js` validates normalized records and shares results/in-flight requests with backoff. Both local servers expose `/api/hazards?source=<registry-id>`; unknown sources are rejected. Failure of one provider does not prevent other views or lightning startup.

`client/public-hazards.js` consumes normalized models and reuses the warning controller, provider-scoped history and flood dialog styles. USGS notice authority is the issuing observatory. CAP retains instructions, source expiry, status and update/cancellation references, with fetch-based health for quiet feeds; latest messages must not be inferred to be active warnings. SWPC condition freshness uses the current product time, not future forecast dates, and measurements/forecasts are excluded from revisions. Official legacy HTTP bulletin links are explicitly upgraded to HTTPS; no arbitrary source-linked resources are fetched.

Tsunami centre products and SWPC conditions/messages now have independent component health/caches. Both local servers return the same `components`/`partial` metadata; Node passes prior normalized component state to its standard-library worker so failed components can recover without unnecessarily polling successful products. Failed components retain labelled cached records, with explicit retry times; cancellation messages without CAP info retain root identity/references without invented severity/areas. Native cyclone codes are retained alongside source-defined human labels, and SWPC probability labels are normalized for presentation.
