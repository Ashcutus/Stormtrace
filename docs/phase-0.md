# Phase 0: foundations delivery record

This is the audit and validation record for introducing the shared foundations. Current implementation/release status and outstanding rollout checks are maintained in [rollout.md](rollout.md); the ongoing design is documented in [architecture.md](architecture.md) and [providers.md](providers.md).

## Audit and decisions

V1 is a local lightning viewer. It has no general weather forecast provider or hazard backend. The browser uses plain JavaScript, Leaflet overlays, and an existing MapLibre/OpenFreeMap basemap bridge with an OpenStreetMap fallback. `server.js` serves assets, proxies optional Lightning API history, checks the published manifest, and reads the system theme. `server.py` provides the same local endpoints when Node is absent. `stormtrace_app.py` is the GTK/WebKit desktop shell; `start-app.sh`, the installer, and `BarWidget.qml` implement Omarchy launch/service integration.

The live source is the unofficial LightningMaps/Blitzortung WebSocket. Optional backfill comes from Lightning API. Place search uses Nominatim. Existing normalization already retained stable strike IDs and UTC times. Settings use `stormtrace:settings` in localStorage. The rolling cache is IndexedDB `stormtrace`, version 1, store `strikes`, keyed by `id` with a `time` index. V1 retains 24 hours and at most 30,000 strikes. The GTK profile uses the existing GLib user data/cache directories under `stormtrace`.

GeoClue is not called by the browser application. WebKit implements browser geolocation through the Linux location stack. `client/location.js` already has the useful watch/precision policy, permission handling, best coarse estimate and cleanup. Browser notifications are forwarded to Gio by the GTK shell. These working mechanisms were reused. The baseline had 37 deterministic Node tests, including Python/Node normalization parity and map movement regressions; all passed before changes.

The original coupling was in `app.js`: WebSocket subscription/payload decoding, Nominatim result fields, browser platform APIs and database operations lived beside rendering. Theme subprocesses and native profile/notification code were embedded in the servers/shell. Phase 0 extracts those responsibilities without replacing map libraries, launch scripts, settings or UI flows.

Implementation sequence: establish core/provider contracts and metadata; normalize V1 providers behind those contracts; isolate browser and Linux platform mechanisms; add additive revision persistence, geometry and CAP; exercise them with fixtures and regression tests; review compatibility and run the complete suite.

## Delivered foundations

- Provider contracts and a central source/authority/licence registry, including deferred future source metadata.
- Shared discrete-event envelopes with domain payloads, provenance and separate native severity/display priority.
- Immutable local revisions, meaningful-change deduplication, time queries and provider-scoped time/count retention.
- Provider freshness/health, structured errors and aggregate diagnostics.
- GeoJSON validation/interchange utilities and reusable CAP parsing with synthetic fixtures.
- Location, notification, storage and Linux system adapter boundaries.
- V1 live-feed, backfill and place-search normalization through providers; existing strike-cache mechanics behind an adapter.

Existing settings, configured locations, GTK profile paths and the V1 IndexedDB schema were retained. The revision database is additive; no conversion of existing user data is required. The existing Leaflet/MapLibre map stack and Omarchy launch flow were retained. No future hazard API or UI was implemented.

## Validation evidence

At the initial Phase 0 handoff, the baseline 37 tests had expanded to 62 passing tests, with none skipped. Coverage included provider contracts/errors/recovery, provenance, history/deduplication/retention, IndexedDB transactions and reopen, GeoJSON, CAP, platform boundaries, Python/Node parity and affected V1 behaviour. `npm run check` and `git diff --check` also passed.

This is recorded test evidence, not a permanent test-count requirement. Subsequent handoffs must report their actual checks and results. Native GTK launch, GeoClue delivery, notification delivery and interactive map behaviour were not manually verified in the desktop session; their outstanding checks are recorded in the rollout tracker.

## Readiness for independent providers

Met Office Radar, Met Office Warnings and USGS Earthquakes can be added independently using the shared contracts and infrastructure without changing location or platform mechanisms. Warnings/earthquakes can use shared event revisions; radar uses frame/resource models and the storage adapter rather than forcing frames into warning/earthquake events.

Implementation still requires endpoint-specific normalization, verified source terms/authentication/cadence, representative fixtures, provider composition and the relevant presentation. That work belongs to a separately agreed next phase.

## Deliberate deferrals

The application still manages WebSocket pause/reconnect lifecycle, and the V1 strike cache remains separate from general revisions. Python retains a tested historical transport/normalizer because Node is optional. Revision time queries currently scan local rows; larger archives may require indices and explicit domain storage budgets. These are documented incremental choices rather than invitations to rewrite V1.

Full radar/hazard features, cloud services, accounts, map migration and speculative platform ports were outside Phase 0. The phase added replaceable foundations while preserving the working product.
