# UK radar: public Met Office observations

The user approved the free radar route after the warnings preview. This extends Phase 1 with an optional UK rainfall overlay and a selector for the latest three hours (up to 12 frames). No account, subscription key, AWS credentials, cloud backend or paid radar contract is required.

## Source and availability

The [Met Office](https://www.metoffice.gov.uk/services/data/external-data-channels) publishes radar observations on [AWS Open Data](https://registry.opendata.aws/met-office-uk-radar-observations/). Anonymous HTTPS listing/downloads from `met-office-radar-obs-data.s3.eu-west-2.amazonaws.com` were verified on 6 October 2026. A real observation valid at 22:00 BST was published at 22:05:32 BST and downloaded/rendered successfully (705,918-byte HDF5 source). This verifies access and decoding, not a guaranteed operational service level.

The documented product provides 1 km radar-derived surface rainfall estimates every 15 minutes, published within 20 minutes of validity time. It is a public beta/non-operational service. Retain observation time separately from fetch/publication time. The CC BY-SA 4.0 licence requires attribution and share-alike treatment of derived imagery; the app identifies Crown copyright and reprojecting/cropping. Do not treat publication as a forecast or absence of coloured pixels as a guarantee of dry conditions.

The earlier access audit identified the retired DataPoint imagery API and paid replacement arrangements but missed this separate public channel. Paid access remains deferred; public ASDI access removes the account prerequisite for this implementation.

## Setup

Radar decoding is optional. Lightning and warnings keep their existing dependencies. In the installed app directory (normally `~/.config/omarchy/plugins/stormtrace.lightning`), create a dedicated Python environment:

```bash
python3 -m venv .venv-radar
.venv-radar/bin/python -m pip install -r requirements-radar.txt
```

Add its **absolute Python executable path** to the existing `.env`, preserving other settings:

```dotenv
STORMTRACE_RADAR_PYTHON=/absolute/path/to/Stormtrace/.venv-radar/bin/python
```

Do not add quotes around the value. Restart Stormtrace to read it. Both Node and the Python fallback use the same worker/decoder. If unset, Node uses `python3`; the fallback uses its own Python executable. If the selected interpreter lacks HDF5/projection packages, the UI explains that decoder setup is required. The environment is ignored by Git and hidden files are not served.

## Controls and limits

Select **UK radar** to enable it; select again to remove it. Toggling radar preserves the current map centre and zoom. The sidebar shows the actual loaded observation time, rainfall-rate legend, recent frame selector and **Latest / refresh** button. Radar draws below lightning markers and above the existing basemap. Warnings remain in their separate list; no warning polygons are overlaid.

Metadata refreshes every five minutes while radar is enabled and the page is visible. New frames arrive at the upstream 15-minute cadence. Frame age over 22.5 minutes is labelled delayed, and over 45 minutes stale. Failed image/metadata requests retain a last-loaded frame with its original time and an error message. An empty recent listing removes old imagery; older archive data is not presented as current. Demo mode does not request live radar.

The source grid uses ODIM HDF5, RATE quantity, upper-left origin, native projection, gain/offset and no-data/undetect values. The renderer samples into Web Mercator at pixel centres using nearest-neighbour lookup. The image is a UK display crop (west −13°, south 48°, east 4°, north 62°), at 640 × 800 display pixels; it is not a native-resolution analytical grid. Colour bands start at 0.1 mm/h. Zero/undetect, missing coverage, values below 0.1 mm/h and pixels outside the source grid are transparent. Transparent areas therefore do not distinguish no rain from missing observations. Native datum metadata is used as supplied; no survey-grade positional accuracy is claimed.

The app keeps at most 12 listed frames and their on-demand PNGs in memory. It downloads only a selected uncached frame, limits HDF5 download size to 10 MB, rejects unexpected grids/timestamps, and bounds worker execution. Disabling the UI stops polling; cache is lost at server shutdown. This does not copy the upstream two-year archive into local strike/event history.

## Implementation and validation

- `providers/metoffice_radar.py`: bounded anonymous listing, strict source keys/dates, three-hour manifest and lazy optional HDF5/projection renderer. PNG encoding uses the standard library.
- `platform/node.js` / `stormtrace_platform.py`: select the local decoder interpreter and run the bounded worker. The Node provider and Python adapter cache manifests/resources; `/api/radar` and `/api/radar/frame` expose the same normalized models and PNG contract.
- `client/radar.js`: frame selection, image loading/swap/failure, source timestamps, opt-in polling and demo isolation. UI does not parse upstream S3/ODIM fields.
- Automated tests exercise source parsing, size/date errors, coalescing/caching, arbitrary-key rejection, dependency failures, renderer timestamp and no-data handling, image lifecycle and existing V1 regressions. The optional decoder test requires `requirements-radar.txt`; run `STORMTRACE_RADAR_PYTHON=/absolute/venv/bin/python npm test` to include it.
- Final validation: 85 tests pass with the optional decoder enabled; `npm run check` validates 21 JavaScript modules, Python syntax and the manifest; `git diff --check` passes. The minor version bump remains once in the Phase 1 manifest diff.
- Live anonymous metadata and image checks were performed separately from deterministic tests. Both local Node and Python routes returned the same 11 recent frames and byte-identical 640 × 800 PNGs (27,552 bytes) for the checked observation. Rendering a real source file verifies decoding; native/browser alignment and visual interaction remain a manual validation gate.

The user reviewed the radar preview positively. Outstanding: detailed native/browser inspection of alignment, raster/strike stacking, timeline interaction, responsive layout, open/close/visibility lifecycle and cold-start decoder errors. Phase 1 review/merge/publication remain outstanding. [Phase 1 PR #22](https://github.com/Ashcutus/Stormtrace/pull/22) is open for review. Publication remains separate from review/merge.
