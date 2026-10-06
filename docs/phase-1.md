# Phase 1: Met Office UK weather warnings

## Agreed scope and starting audit

Phase 0 was merged through [PR #21](https://github.com/Ashcutus/Stormtrace/pull/21); the user applied the update and reported no visible changes, as expected for foundations. This does not establish every native smoke-test gate. Phase 1 starts from main commit `db52d4417453df94f458f0bd8427d00e8234547d`.

The user initially selected official UK warnings and UK radar. After the access audit, they directed: “No radar access yet; build warnings first.” The initial slice implements warnings. After a successful user preview, the user approved the public ASDI radar route; [radar implementation and evidence](radar.md) records the scope extension. Paid radar remains deferred; earthquakes and the other hazard domains have no implementation scope agreed here.

Reuse: normalized event/provenance/severity envelopes, bounded XML/GeoJSON helpers, provider health, immutable revision history, IndexedDB adapters and the existing local server. Keep the lightning receiver, map stack, settings, location workflow, alert policy and GTK launch unchanged.

## Verified source and presentation decisions

Use the [Weather DataHub NSWWS documentation](https://datahub.metoffice.gov.uk/docs/g/category/warnings/type/nswws/api-documentation) and [v1.1 OpenAPI definition](https://datahub.metoffice.gov.uk/downloads/api-definitions/nswws_api_subscriber.json), reviewed 6 October 2026. The actual API base is `https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/`; credentials use the `apikey` header. This is an Atom feed linking GeoJSON snapshots, not a CAP transport. The shared CAP parser remains available for other providers.

- `/feed` identifies immutable `/issued/{uuid}` current snapshots and `/updated/{uuid}` change snapshots. Use the links supplied by the feed; restrict them to the expected HTTPS origin and object paths, and reject redirects so keys cannot follow an external link.
- Issued snapshots include warnings for the next seven days and exclude cancelled/expired warnings. Change snapshots retain explicit `ISSUED`, `CANCELLED` and `EXPIRED` transitions for at least 24 hours; there is no upstream archive. Never infer a cancellation from disappearance alone.
- Follow the [DataHub FAQs](https://datahub.metoffice.gov.uk/support/faqs) for subscription, one-minute polling, access limits and attribution. Poll while the warnings view is open and visible; coalesce concurrent requests and reuse a successful server response for one minute. Fetch new snapshots only when their feed links change. Replay cached change snapshots to each client so another client or a storage retry can record them.
- Feed timestamps are event driven. A quiet feed can be old while retrieval remains healthy. Warnings freshness uses successful fetch recency; source issue/update/validity dates remain separate and unchanged. Failed retrieval retains last-known data with an explicit degraded state. A successful empty collection alone supports the empty-feed message.
- Apply the [NSWWS style guide](https://www.metoffice.gov.uk/binaries/content/assets/metofficegovuk/pdf/about-us/what-we-do/nswws/nswws-style-guide-apr-2021-v1.1.pdf): title and attribution, official yellow/amber/red labels and colours, full headline/weather types/what-to-expect text, affected areas, and UK local dates. Theme settings cannot alter official warning colours. Show advice, details and update reasons when supplied.
- Present a dedicated warnings list. The style guide prohibits warning polygons overlaid with other weather information; do not put these polygons on the lightning map. Geometry is retained for monitoring-point relevance and historical records. Relevance indicates the saved point only, not a guarantee about a user's actual position or uncertainty area.
- Do not replace radar with a precipitation forecast. The [DataPoint retirement FAQ](https://www.metoffice.gov.uk/services/data/datapoint/datapoint-retirement-faqs) confirms no like-for-like radar replacement and separate radar access arrangements. For paid access, obtain product and format details first; the subsequently verified public ASDI channel has separate open-data terms.

## Setup

1. Create a Weather DataHub account and subscribe to the [warnings product](https://datahub.metoffice.gov.uk/docs/g/category/warnings/overview). Review the current product terms and presentation requirements, then generate its subscription API key. Stormtrace does not create accounts or accept terms for you.
2. In the installed Stormtrace directory (normally `~/.config/omarchy/plugins/stormtrace.lightning`), add this line to the existing `.env` file. Preserve any existing lightning key; use the plain value without surrounding quotes:

   ```dotenv
   METOFFICE_WARNINGS_API_KEY=your_subscription_key
   ```

   Keep the actual key private and out of commits/chat. `.env` is ignored by Git and hidden files are denied by both local servers. A process environment variable of the same name takes precedence; it must be inherited by the local service.
3. Exit Stormtrace and reopen it so the local server reads the new configuration. Node and the Python fallback both support warnings.
4. Select the warning triangle in the header. Without a key, the view reports **not configured**. With a valid subscription, it retrieves the latest feed. Authentication, rate-limit, network, timeout and malformed-data failures are separate provider error states; use **Check the Met Office** for current information if retrieval fails.

Warnings are optional. No key is needed to continue using the lightning viewer. Demo mode disables live warnings and warning persistence. No new warning desktop notifications are introduced in this slice.

## Persistence and compatibility

Normalize stable warning IDs, native colour/impact/likelihood, status/version, weather types, full wording, affected areas, MultiPolygon geometry, source issue/update/validity timestamps and provenance. Preserve additional source properties in `domainPayload.sourceFields`; presentation uses normalized fields only.

Store observed warning revisions in the existing independent `stormtrace-revisions` database, keyed by provider and warning ID. Repeated fetches do not create revisions; historical feed replay must not replace a newer revision. The **Observed history** view includes cancelled/expired warnings as well as earlier issued versions. Retain revisions for up to 90 days from local persistence time, with a 5,000-warning event budget scoped to `metoffice-warnings`. Pruning occurs after successful refreshes. This is observed local history, not a complete archive: closing the view/app or staying offline can miss transitions after their upstream 24-hour window. Browser storage may be cleared or unavailable.

Store the last successful normalized view separately in `stormtrace-warning-state`, version 1. It is explicitly cached on restore until a successful refresh. Storage failure leaves live warnings usable and reports unavailable history. The V1 `stormtrace` strike database/schema, local settings key and GTK profile directories are unchanged; no migration is needed. Application version receives one minor bump in the root manifest relative to the Phase 1 base.

## Validation evidence

Automated checks on this implementation:

- `STORMTRACE_RADAR_PYTHON=/tmp/stormtrace-radar-venv/bin/python npm test`: 85 deterministic tests pass, including the optional radar decoder and existing V1 regressions. New synthetic fixtures exercise Atom namespaces/links, malformed XML/GeoJSON, all official colour priorities, source identity/timestamps/text/geometry, update/cancellation snapshots, empty success, missing configuration, authentication/rate-limit/network/timeout/schema errors and recovery.
- Node/Python parity covers normalized fixtures, feed parsing, cache lifecycle and HTTP contracts. Local HTTP tests deny hidden credential files for GET and HEAD. No tests use a live subscription key.
- IndexedDB tests cover warning history deduplication/replay, cancellation persistence and reopen, snapshot restore, scoped retention and storage failure. A user preview exposed a browser-fetch receiver issue: default transports now call fetch through the global receiver, with regressions for the warnings controller and existing place/history providers. Presentation tests cover official text, UK daylight-saving dates, relevance, safe text insertion, cancellation history and demo isolation.
- `npm run check`: production JavaScript/Python syntax and manifest validation pass. `git diff --check`, launcher `bash -n` and `omarchy plugin validate .`: pass at handoff.

The user reviewed the warnings and radar previews positively. Implementation is ready for PR review; the remaining checks below are release gates.

Open checks before release:

- [ ] Authenticated live DataHub retrieval with a valid warnings subscription, including access-error recovery. No key is configured in the development environment.
- [ ] Browser/native visual inspection of warning dialog sizing, scroll, focus, keyboard dismissal and all official colours. Automated presentation tests exercise a lightweight DOM; browser inventory was unavailable in this session.
- [ ] Native GTK launch/focus/exit, saved-location relevance, warnings open/close/visibility polling and coexistence with lightning reception/map/theme/settings.
- [ ] Existing native location and desktop-notification smoke gates from the rollout tracker.
- [ ] Review/merge and publication under the publishing checklist. [PR #22](https://github.com/Ashcutus/Stormtrace/pull/22) is open for review; merge and publication remain pending.

The user subsequently approved public radar first. Anonymous Met Office ASDI observations and a real-file renderer are now implemented as an optional overlay; paid radar access remains deferred. See the [radar record](radar.md) for source, decoder setup and open map/native validation. The user confirmed the warnings preview looks good; this is separate from authenticated live access and a native smoke test.
