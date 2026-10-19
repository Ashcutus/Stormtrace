# Cyclones, volcanoes, tsunami bulletins and space weather

Stormtrace provides four optional views in **Explore**. They retrieve public data without subscription keys. Each view shows its source, coverage, source times, last successful retrieval, and explicit loading/error/cached feedback. Internet delivery is best effort; use the official source and local authorities for current guidance.

![Tropical Storm Trudy in the cyclones view](screenshots/cyclones.png)

## Available views

| View | What it shows | Coverage and limitations |
| --- | --- | --- |
| Cyclones · NHC / CPHC | Current storm summaries, source classification, reported centre, sustained wind in knots, pressure and movement where supplied; links to official public/forecast advisories and forecast graphics; selected centre on the map | North Atlantic and eastern/central North Pacific. The map shows a reported centre, not a forecast track, cone or affected area. Track/cone graphics remain at the official source; global operational cyclone coverage is not delivered. |
| Volcanoes · USGS / global reports | USGS elevated-volcano notices with separate ground alert level and aviation colour, observatory, issue time and official notice link; source selector for Smithsonian / USGS weekly reports | USGS monitoring is regional. GVP reports are global weekly summaries with incomplete activity coverage, not real-time warnings. Hosted GVP access can be blocked; the view reports retrieval failure and keeps its official link available. No volcano danger score or ash dispersion forecast is inferred. |
| Tsunamis · NOAA centres | Latest English CAP bulletin from each of NTWC and PTWC; original classifications, wording, instructions, affected-area descriptions, source expiry and update/cancellation references | Two latest centre bulletins are not a complete active-alert inventory or worldwide national warning coverage. Expired, cancellation and non-operational messages are labelled. An earthquake location or described forecast zone is not an inundation/evacuation map; no tsunami map overlay is produced. |
| Space weather · NOAA | Current and previous-24-hour R/S/G scales, separately labelled forecasts/probabilities, and recent issued messages with full source text | Preserve radio-blackout, solar-radiation and geomagnetic scales separately. Forecast reference times are not observation/issue times. Recent messages may be expired or superseded; they are not presented as a complete active-warning list. No local aurora-visibility prediction is inferred. |

All source links open the official service. Cyclone forecast products show their own advisory numbers and issue times when supplied. Missing metadata stays absent. Tsunami instructions remain source text alongside actionable official-source links; Stormtrace does not reinterpret them into evacuation advice.

## Access and fair use

Canonical source, authority, attribution and terms are in `providers/registry.js`. NOAA/NWS and USGS-produced material is generally available without charge, subject to source-specific exceptions, attribution and no implied endorsement. Smithsonian permits personal, educational and other non-commercial uses subject to its terms, citation and retained notices; third-party images are not imported.

Only the open, visible view polls. The shared [interface guide](interface.md) describes Current/History modes, filters, source-state messages and keyboard controls. Successful results are shared by the local server: cyclones every 15 minutes, USGS volcano notices and space weather every 5 minutes, tsunami bulletins every minute, and weekly GVP reports every 6 hours. Manual refresh uses those same caches. Failures use increasing backoff, starting at one minute, and honour numeric upstream `Retry-After` values within a bounded delay. Requests have timeouts, response-size limits and redirect rejection. These are Stormtrace request policies, not claims of a universal provider quota or guaranteed source update cadence.

Hazard retrieval uses Python 3's standard library in both local servers. The Node server selects the worker through its platform adapter; the Python fallback uses the same provider normalizers. No radar decoder or scientific package is required. A missing Python executable produces unavailable feedback in these views without preventing the other Node services from starting.

## Local state and history

Each source has its own latest snapshot. Tsunami centres and SWPC conditions/messages have independent component caches and health; partial failure retains the other successful product and labels cached components. When a request fails, previously retrieved records remain visible with a cached/error label; failure does not become a successful empty result. A successfully fetched quiet bulletin feed remains healthy even when its issue time is old. Space-weather current-condition freshness uses the current scale product time, independently of future forecast dates.

**Observed history** records locally seen source bulletins and meaningful revisions. Cyclone, volcano and tsunami sources retain up to 90 days; SWPC issued messages retain up to 30 days. Each source has a 5,000-event limit. Repeated fetches do not create revisions, older replay cannot revert a newer revision of the same source event, and disappearance does not establish cancellation. Source message identifiers and update/cancellation references remain available. Measurement/forecast snapshots stay out of discrete-event history. This is local observation history, not a complete upstream archive.

Existing application IDs, settings, profiles, lightning history and map stack remain unchanged. No saved-data migration is required.

## Not yet available

NASA DONKI, GDACS, IBTrACS historical tracks and additional regional authorities are not integrated.
