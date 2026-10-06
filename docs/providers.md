# Provider development and source registry

Use the [architecture guide](architecture.md) for core/platform boundaries and the [rollout tracker](rollout.md) for phase and release status. This guide owns provider development and source metadata interpretation.

`providers/registry.js` is the canonical immutable source/authority/attribution registry. `ProviderRegistry` separately tracks active implementations; metadata placeholders do not call APIs or create subscriptions. V1's application registers its live and place providers; the local Node server composes the historical provider. Retrieve metadata with `StormtraceCore.getSource(id)`.

Each entry describes ID/name/authority, purpose, geographic coverage, categories, homepage, attribution, licence/terms URL and notes, authentication, expected cadence (milliseconds or null), upstream historical availability, commercial-use review status, implementation status and caveats. Classification is a discovery/access category, **not a legal permission grant**. Supported categories are `OPEN_DATA`, `PUBLIC_GOVERNMENT`, `FREE_HOSTED_NONCOMMERCIAL`, `FREE_HOSTED_BEST_EFFORT`, `AUTH_REQUIRED_FREE` and `COMMERCIAL_PERMISSION_REQUIRED`. Conservative permission-review placeholders do not assert that a provider actually charges or prohibits commercial use. Government publication alone does not resolve all endpoint/third-party terms.

Only existing V1 access is active. Future sources deliberately use unknown cadence/auth/terms where not verified. Verify the chosen product rather than deriving refresh intervals or licensing from the organisation's name. For Met Office products, start with [Weather DataHub](https://www.metoffice.gov.uk/services/data/met-office-weather-datahub) and its [terms](https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/data/met-office-weatherdatahub-terms-and-conditions.pdf); this is not an assertion that every future warning/radar endpoint uses those terms. Existing community lightning has published [non-commercial restrictions](https://www.blitzortung.org/Compendium/Hardware/Documentation_20_6.html). Nominatim has a separate [hosted usage policy](https://operations.osmfoundation.org/policies/nominatim/) and OSM data attribution.

## Source matrix

| Registry ID | Source / authority | Domain | Implementation state |
| --- | --- | --- | --- |
| lightningmaps | LightningMaps / Blitzortung community network | Live lightning | Existing feed normalized, provenance and health |
| lightning-history | Lightning API | Historical lightning | Existing optional server-key backfill, Node/Python transport |
| nominatim | Nominatim / OpenStreetMap contributors | Place search | Normalized place models and provenance |
| metoffice-radar | Met Office UK radar observations | Radar frames/resources | Contract and metadata only |
| metoffice-warnings | Met Office NSWWS | Official warnings | Contract and metadata; shared CAP/GeoJSON ready |
| usgs | US Geological Survey | Earthquakes | Geographic/time-window contract and metadata |
| nhc | NOAA National Hurricane Center | Operational cyclones | Track/forecast/cone payload pattern and metadata |
| ibtracs | NOAA NCEI and contributors | Historical cyclones | Historical capability and metadata |
| gdacs | GDACS participating agencies | Supplementary global hazards | Metadata only; retain originating authority |
| gvp | Smithsonian Global Volcanism Program | Volcanoes | Bulletin/activity payload contract and metadata |
| noaa-tsunami | NOAA tsunami warning centres | Tsunamis | Bulletin/area/forecast payload contract and metadata |
| swpc | NOAA Space Weather Prediction Center | Measurements / current state | Separate current/series contracts and metadata |
| donki | NASA CCMC DONKI | Linked solar events | Discrete linked-event capability and metadata |

None of the deferred entries are treated as the sole source for a domain. Multiple implementations may serve the same category. Resolve event identity in a provider namespace; never merge differing official classifications into one danger score.

## Adding a provider

1. Choose a registry ID, update that entry with verified endpoint-specific authority/coverage/terms/auth/cadence/history, and set its implementation status. Keep metadata independent from credentials and transport URLs with secrets.
2. Implement the smallest relevant domain contract in `core/contracts.d.ts`. Radar returns frames; warning/earthquake providers return typed event envelopes; cyclone payloads retain tracks/cones; SWPC current/series capabilities return measurements; DONKI may implement only the event capability. Add historical/detail capability only when supported. Do not pretend an unsupported upstream historical API exists: local revisions are a separate concern.
3. Inject fetch/clock/logger (as in `LightningHistoryProvider` or `NominatimProvider`) and use `ProviderRunner.run(operation, retrieve)` for finite batches. Return `{records,sourceDataTimestamp,rejectedRecords?}`. Streaming providers can manage their own health using the same fields, as LightningMaps does. Use structured `ProviderError`/`httpError`, bound transport timeouts and validate schema/records before returning. Choose failure-isolation and logging per provider, without exposing secrets.
4. Normalize inside `providers/`, retaining native ID, observation/issue/update time, classifications and geometry. Build provenance from `getSource(id)` and an actual fetch timestamp. Build events with `core.event`; preserve domain-specific payloads. Call `parseCAP` for CAP, examine its diagnostics and retain update/cancellation relationships. Invalid essential identity must not create a seemingly healthy warning. Use `normalizeGeometry` and explicitly handle rejected/missing shapes.
5. At the composition root register the implementation, expose normalized models to the relevant application consumer, and call `RevisionHistory.record` for observed discrete events. History is local even when upstream only exposes current alerts. Set explicit provider-scoped retention; do not reuse lightning's 24-hour policy for warnings. Measurement/radar archives may use `StorageAdapter` with their distinct resource/time-series models.
6. Add captured/synthetic fixtures: schema validity, malformed records, native classifications, source IDs/times, freshness, error codes and recovery, local revision deduplication and update/cancellation semantics. Stub transport; CI must not fetch live feeds. Add regression coverage if touching existing presentation or lifecycle.
7. Update provider docs and the rollout tracker when scope/status changes, version the root manifest once per PR relative to its base branch, and run `npm test` and `npm run check`. New browser modules need an explicit script/composition entry; authenticated transport may use a local server route. A future Python fallback route must implement the same normalized endpoint contract or explicitly report unsupported capability; never expose an API key to the browser.

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

Run `npm ci` once, then `npm test` and `npm run check`. Production remains dependency-free beyond the existing vendored map libraries and native GTK/WebKit requirements. The sole new npm dependency is the test-only [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB), which exercises transactions, rollback and reopen behavior without live browser/network APIs. It does not claim to test physical disk durability or native GTK delivery. `npm run check` checks all production JavaScript modules and Python source syntax, plus manifest version validity.
