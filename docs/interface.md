# Views, controls and source states

Stormtrace combines a continuously connected lightning viewer with optional on-demand hazard information. **Explore** shows direct hazard-view buttons at every window width. Source coverage is explained in each view. Map layers sit in a collapsible sidebar section so monitoring controls remain easier to reach. Only lightning has nearby desktop notifications; opening a hazard view does not enable background hazard alerts.

## Reading current information and local history

Hazard dialogs keep their heading, retrieval status, attribution and primary official-source actions available above a scrolling content region. **Current** and **Observed history** select separate lists. Use the text filter for title, place, source, area or status; filtering does not imply saved-location matching. Lists initially display up to 100 matches, with **Show 100 more** for additional records. History is locally observed source information and can be incomplete.

Unchanged refreshes preserve record elements, expanded source text and keyboard focus. When a source record changes, its disclosure state and corresponding focused control are restored. Loading/status changes do not rebuild the list. Source text uses a readable body font, while authoritative severity colours remain fixed across themes.

Space weather has separate **Current and previous conditions**, **Dated forecasts** and **Recent issued messages** views. Forecast probabilities retain their source meaning; R/S/G scales have an official explanation link. Tsunami bulletin lifecycle (expiry, cancellation, test/exercise) is shown prominently before the original source classification. Neither a latest bulletin nor a quiet condition summary establishes an all-clear statement.

## Retrieval, caching and missing coverage

Views show the last successful check, source age where available, cache/failure feedback and when another check is eligible. Refresh rechecks the local receiver; successful cached results remain refreshable, while failed-source backoff displays the next eligible attempt. Closing a dialog stops its source polling. Reopening uses the same local server cache; manual refresh does not bypass fair-access limits.

NTWC and PTWC tsunami products have independent results and health. SWPC conditions and issued messages are also retrieved independently. Failure of one product does not hide a successful result from another. Previously retrieved data remains explicitly cached; a failed request is not a successful empty feed. Provider-native classifications, issue/update/expiry metadata and cancellation references are retained without fabricating missing source fields.

Map popups include retrieval/cache feedback alongside source times, uncertainty and official links. A selected cyclone marker is a reported centre, not a forecast position; refreshed summaries update its centre. A centre absent from a later summary is identified without inferring cancellation. **Clear selected event** removes selected earthquake/cyclone resources from the map. Radar controls are revealed and focused when enabled.

Displayed instants use labelled UK-local time; source timestamps lacking a timezone stay raw and are labelled as such. UTC epoch values and upstream source timestamps remain unchanged in stored provenance. A lightning count describes records in the selected area/time; the UI separately discloses hidden layers and the 4,000-marker display limit.

## Keyboard, location and saved settings

Main-view shortcuts are suspended while a dialog is open or an editable field/source selector is active. Place search supports arrow selection, Enter and Escape with combobox state. Late results from an older query cannot replace a newer result; invalid coordinate pairs are rejected locally.

Location source/uncertainty feedback is separate from notification permission and delivery state. A manual monitoring point is clearly identified; requesting current location can replace it. Settings that apply in the current session but fail to save show a persistent warning with **Retry saving**. **Reading size** offers Default, Larger and Large settings. Theme source, reading size and map controls apply immediately; custom colour edits require **Apply custom palette**. Copying Omarchy colours explicitly switches to custom mode. Reduced-motion preferences suppress UI transitions and animated map travel.

Nearby-lightning notifications require a source-observed timestamp no more than two minutes old, and reject inferred or missing source times and times more than 30 seconds in the future, which allows for a slightly slow local clock. Archive ingestion still accepts older records. Notification text reports the event's actual age; rejected old events do not consume the alert cooldown.

Monitoring coordinates are stored locally and distances/alerts are calculated locally. External map services receive tile requests, place searches go to OpenStreetMap Nominatim, and automatic location uses the system location service. Stormtrace does not send its saved monitoring coordinates to a hazard provider for these local distance calculations.

## Weather warning map

Weather warnings include a **Warning map** action opening a dedicated UK map of official warning areas, separate from other weather layers. It uses the public Esri beta mirror without a key; RSS summaries remain available in the list. Severity/type labels and text selection controls open full source-backed popups. The source link and retrieval/delay caveats remain visible. See [UK weather warnings](warnings.md).

Existing plugin IDs, profile paths, saved settings and storage keys are unchanged; no data migration is required.
