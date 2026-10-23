# Repository instructions

## Versioning

- Always bump the application version when making changes that require a pull request, and include the version bump in that same PR.
- Update `version` in the root `manifest.json`, the single source of truth. Do not hard-code the version elsewhere.
- Use a patch bump for fixes, documentation, maintenance, and other small changes; a minor bump for new backward-compatible features; and a major bump for breaking changes.
- Bump once per PR relative to its base branch. Further edits within the same PR do not require additional bumps unless the release scope changes.
- Before handing off or opening the PR, verify that its diff includes the appropriate version bump and run `npm run check`.

## Architecture and compatibility

- Omarchy first; the Stormtrace core must remain platform agnostic. No platform API above the platform-adapter boundary. Composition roots may select adapters; Linux launch/GTK/bar integration belongs to the platform layer.
- No UI component should understand an upstream provider API format. Normalize data in `providers/` before presentation and reuse the existing core/provider/platform modules.
- Preserve provider-native severity/classification separately from Stormtrace display priority. Retain upstream IDs, source timestamps, authority and transformations in provenance; do not invent missing source metadata.
- Keep source/authority/attribution/licence metadata canonical in `providers/registry.js`. Deferred registrations do not imply live integration, permission or an available feature.
- Preserve V1 settings, configured locations, profile paths, launch behaviour and the existing map stack. Prefer incremental extraction over rewriting working functionality. Any data/schema migration must be explicit, idempotent and tested.
- Scope retention to the provider/domain. Do not apply lightning's archive policy to warnings or other hazards. A repeated fetch alone must not create a historical revision.
- Keep Node and Python fallback endpoint contracts compatible; test affected normalization parity. Keep authenticated credentials server-side.
- Use deterministic fixtures/stubbed transports for provider tests and add regressions for affected V1 behaviour. Distinguish automated coverage from an actual native GTK/GeoClue/notification smoke test.

## Popup presentation

- All new or modified popups must follow the approved flood map popup style: opaque high-contrast surfaces, a clear heading and structured content, a domain/severity badge where applicable, readable spacing, and explicit readable controls with keyboard focus states.
- For source-backed information, show canonical provider/authority attribution, relevant source times without inventing missing metadata, an official source link where available, and concise coverage/uncertainty context. Preserve authoritative severity colours where required.
- Bound long content in a keyboard-accessible scrolling section; keep the heading, close control, attribution and primary actions accessible. Never present actionable instructions as inert text or hide retrieval/loading/unavailable feedback solely outside the popup.
- Reuse established popup styles/components instead of introducing another visual language. Render provider text safely through DOM text content. Apply this standard as existing popups are touched; do not imply untouched popups have already been migrated.

## Source integration findings

- Wrap or bind default browser `fetch` transports to the global receiver; assigning bare native fetch to a controller/provider property can cause an illegal invocation. Include a receiver-sensitive transport regression when adding browser retrieval.
- Event-driven warning feeds may have old source timestamps during quiet periods. Use an explicit fetch-based health policy for these feeds; preserve issue/update/validity times separately. Distinguish successful empty results from retrieval failure and label cached data.
- For NSWWS use verified DataHub product/version and feed-supplied immutable links. Keep keys server-side, restrict authenticated links to the expected origin/paths, reject redirects, and deny hidden credential files for GET/HEAD in both local servers.
- Replay shared warning change snapshots to every consumer; deduplicate local revisions and prevent historical replay from reverting a newer source version. Only explicit source status establishes cancellation/expiry; disappearance does not.
- Follow official NSWWS colours, wording, attribution and UK-local timestamps. Custom themes must not change authoritative warning colours. Do not overlay its warning polygons with lightning/other weather information; use the dedicated list and normalized affected areas.
- Radar observations and precipitation forecasts are different products. Verify the specific radar source, licence, access and format before activating a radar provider; a retired endpoint or forecast replacement is not evidence of radar availability.
- Check public Met Office ASDI channels as well as DataHub/paid products. Public ODIM observations need no key; a DataPoint retirement notice does not establish that all radar requires paid access.
- Reproject native radar grids to the map CRS before using image bounds. Validate ODIM quantity/origin/gain/offset/no-data and source time against the object key. Preserve observation time, label latency, and distinguish missing coverage from no rain. Keep radar resources out of discrete-event history.
- Optional radar decoding must not prevent lightning/warnings startup. Keep scientific imports lazy, decoder selection in platform adapters, bounded on-demand resources, and deterministic tests alongside separately recorded live-access evidence.

- For recurring IndexedDB archive maintenance, avoid per-row cursor enumeration and unchanged-row writes. The native WebKit soak investigation reproduced rising RSS with cursor scans; bounded bulk reads and provider-scoped mutation checks reduced that pressure. Preserve atomic rechecks and verify full viewer stability separately from isolated storage benchmarks.

- Hyprland restores a floating window after fullscreen to the position last set by `window.move`, not `window.center`; place the native window with an absolute move. WebKitGTK forgets notification permission between launches, so the shell seeds its own origin through `initialize-notification-permissions`; without it, restored desktop alerts read "On" while the page silently never notifies. Leaflet silently drops zoom requests made during a zoom animation; route button and key zooms through the queued `stepZoom` instead of calling `zoomIn`/`zoomOut` directly.

- Keep installed runtime environments outside the Omarchy plugin directory (for example under XDG_DATA_HOME/stormtrace). Plugin validation rejects symlinks even in ignored files; Python venvs and symlink shortcuts inside the plugin can block updates. Recreate environments at their final path instead of assuming relocated scripts still work.

## Multi-phase documentation

- Read `docs/README.md` and the local rollout tracker (`.local/plans/rollout.md`, not committed) before changing rollout scope. Phase 0 is foundations; implement later hazard APIs/UI only within the user's agreed scope.
- Keep the main README focused on available product behaviour, setup and limitations. Label planned/deferred capabilities clearly; contracts and metadata alone are not delivered features.
- Maintain phase/readiness status and open validation gates in the local rollout tracker; do not put rollout status, PR status or approval history in the README or public docs. Distinguish implementation, merge and publication, and do not invent phase numbers, deadlines or agreed future scope.
- Update `docs/architecture.md` for current boundaries/models/compatibility and `docs/providers.md` for provider development/source state. Keep audits, investigations and working plans local only. Public documentation may describe delivered compatibility, migrations and limitations; maintain `docs/README.md` as the navigation index.
- Record lasting findings here, not temporary PR status, fixed test counts or duplicate application versions. At handoff, report actual validation and leave unperformed native checks visibly outstanding. Follow `PUBLISHING.md` for release checks.

## Local investigations and plans

- Keep investigation notes, audits, working plans, validation logs and agent scratch material local only; do not commit them or publish them in the repository. Use the ignored `.local/` directory (`.local/investigations/`, `.local/plans/`) or a temporary directory.
- Public documentation should describe delivered behaviour, setup, compatibility and limitations. Do not add investigation or planning records for public consumption. This rule takes precedence over older instructions to publish phase-specific audits or plans.

## Product branding and compatibility

- The visible product name remains Stormtrace until the user decides otherwise. Keep existing plugin/application IDs, profile/storage keys, service names and repository/update URLs stable unless an explicit, tested migration is agreed. Changing display names or artwork must not reset saved settings or data.

- MSC GeoMet WMS rejects multi-layer GetMap requests and publishes time as a `start/end/PT6M` extent. Fetch the ECCC coverage mask as a separate per-frame image and expand the extent with bounds; do not assume NOAA's comma-separated time list.

- For OPERA radar, scope object listings to hourly prefixes covering the displayed observation window. Full-day listings can exceed the S3 page limit; reject incomplete listings rather than treating truncation as missing observations.

- Met Office public channels differ: RSS supplies unchanged summaries and links, without warning geometry or per-warning issue/expiry times. The official-linked Esri beta provides polygons and source fields under the NSWWS Open Licence, but its Feature Service API is unsupported by Met Office. Keep these separate provider identities and preserve their differing coverage/provenance and licence conditions. They share no warning ID (RSS link IDs group regions; Esri uses its own GlobalID), so the warning map links them only by level, weather type and normalized `affectedAreas` places; never present that match as source-confirmed identity.

## Dependencies and security updates

- Check for package updates and security advisories whenever making changes, so the project stays current. Run `npm outdated` and `npm audit`; check Python radar requirements against PyPI; and audit vendored libraries in `vendor/` separately, because `npm audit` cannot see them. Pin their exact versions in a scratch `package.json` outside the repository, run `npm audit --package-lock-only`, and compare with the latest releases.
- Apply patch and minor security fixes in the same change where practical. Plan major upgrades as their own change, with the breaking changes reviewed and native WebKit checks recorded. Report any advisory you leave open, with its actual exposure, rather than silently deferring it.
- Vendored files must match a named upstream release, or document their local patches. `vendor/maplibre/leaflet-maplibre-gl.js` carries local map-movement patches; the MapLibre `.mjs` files are unmodified upstream (see `vendor/maplibre/README.md`).
- MapLibre GL 6 is ESM-only: `client/maplibre-loader.js` imports it as a module and sets the `maplibregl` global, so the Leaflet bridge and `app.js` must stay deferred after it. Both servers must serve `.mjs` as JavaScript (`nosniff` is set), and `maplibre-gl-worker.mjs` must sit beside `maplibre-gl.mjs`. v6 requires WebGL2 and reports its absence as an event, so check `StormtraceUI.vectorMapAvailable()` before creating a vector map and keep the raster fallback. The bridge must use public APIs (`getCanvas()`, `setTransformConstrain`); `map.transform` no longer exists.

## Future development checks

Revisit these when touching the related area; they record verified gaps, not agreed scope.

- **Precipitation type (rain, sleet, snow, hail):** two free radar sources are delivered. NOAA's MRMS `{region}_pcpn_typ` WMS layer covers the five US regions; it is model-assisted and has no sleet or freezing-rain category. ECCC GeoMet `Radar_1km_SfcPrecipType` covers Canada with mixed rain/snow and freezing rain; it is also model-assisted (HRDPS surface temperature). UK (Met Office ASDI) and Europe (OPERA) public radar carry no precipitation type. The Met Office lists a 2D surface precipitation type product as in development; recheck whether it becomes public. Sleet or UK/European snow would need a forecast or nowcast source, which must be a separately labelled product with verified licence and access, never presented as a radar observation. Met Office DataHub's UKV model (free 1 GB/month plan, key, GRIB2) reportedly has rain, snowfall and hail fields but no identified sleet field; confirm parameter names in DataHub documentation before any work.
- **Wales flood warnings:** Natural Resources Wales offers a free Live Flood Warnings and Alerts API with a subscription key (15-minute refresh, no service-level guarantee). The endpoint, key header and schema were not verifiable without a key; obtain one and record fixtures before implementing.
