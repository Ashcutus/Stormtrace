# Location implementation review — 4 October 2026

## Findings

- `5402276` introduced a 5 km accuracy ceiling for both new fixes and persisted settings. A valid network estimate became a failure after 30 seconds; saved estimates disappeared on restart. Its coarse-result error told Ethernet users to connect to Wi-Fi.
- The same commit replaced the earlier low-accuracy, cached `getCurrentPosition` request with a fresh high-accuracy watch. High accuracy is a provider hint, not a guarantee that desktop hardware can produce a precise fix.
- Any provider error ended that watch immediately, even a transient unavailable error followed by an improved fix.
- Both location buttons and the keyboard shortcut could start concurrent requests. Whichever completed last could overwrite the selected location.
- `58582aa` added GeoClue installation checks and actionable error messages, but did not add an Ethernet fallback or change the actual provider. The following version bump did not change location behaviour.
- The native WebKit shell permits geolocation requests. Both local servers send `Permissions-Policy: geolocation=(self)`. Coordinates are stored in local settings; distance calculation and notifications use those coordinates locally. No extra IP-geolocation endpoint is present in Stormtrace.
- The desktop GeoClue configuration has its IP source enabled. Service logs show successful starts and normal idle shutdowns, with no provider failure logged in the inspected entries. An inactive service after idle shutdown is not evidence of a broken installation.

## Changes

Validation now checks coordinate ranges and non-negative finite uncertainty separately from the 5 km automatic acceptance threshold. Accurate results are applied immediately; broader results are retained for explicit review with coordinates and uncertainty. The best estimate survives transient provider errors and cannot overwrite a saved point without selection. Previously saved broad fixes survive reload and show their uncertainty.

Requests use the network-oriented accuracy hint while retaining fresh results and a bounded 30-second watch. Duplicate requests share a pending operation. Permission denial stops immediately; transient errors allow the provider to recover. Watches and timers are cleaned up on completion.

Manual latitude/longitude entry provides a fixed monitoring point without GeoClue or wireless hardware. It is identified as manual rather than presented as measured precision. A pending automatic result cannot overwrite a manually selected point. Alerts and distances are calculated from the selected centre; approximate results clearly state this limitation.

## Verification and limits

All 30 automated tests pass, including new tests for Ethernet estimate review, saved uncertainty, manual coordinate validation, overlapping requests, pending automatic results, and transient provider errors. JavaScript/Python syntax checks and whitespace checks pass.

The actual GTK/WebKit geolocation request on this Ethernet desktop has not been exercised end to end. The application cannot manufacture a precise physical position from a broad provider estimate. Restart the app to load the changes; review the returned estimate or use a manual monitoring point if automatic precision is insufficient.
