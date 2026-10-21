# Views, controls and source states

Stormtrace combines a continuously connected lightning viewer with optional on-demand hazard information. The layout has four parts:

- **Toolbar**: place search, the **Hazards** buttons, the **Lightning window** (Live, 1h, 6h, 24h) and **Set location**.
- **Map**: **Layers** (top left), the strike-age legend, zoom controls, the latest-strike strip and notifications.
- **Sidebar**: the radar panel (when radar is on), **Lightning activity** (counts and hotspots), **Alerts near you** (location, alert radius, desktop alerts and hazard alerts), and lightning source details.
- **Footer**: the visible region and centre coordinates, common shortcuts and the clock.

On narrow windows, **Map** and **Lightning & location** tabs switch between the map and the sidebar.

## Alerts near you

Desktop alerts cover nearby lightning plus any hazards ticked under **Also alert me about**: amber and red Met Office warning areas that contain your location (from the public map service, no key), England flood warnings (levels 1 and 2) whose published area contains your location, and earthquakes from the past day at or above a chosen magnitude within a chosen distance. Ticked hazards are checked every ten minutes while Stormtrace is open, from the same normalized sources as the views. Each source revision notifies once, remembered across restarts; a failed check keeps the last known result and says so. If Desktop alerts are off, alerts appear in the window only. Opening a hazard view alone does not enable alerts.

The Omarchy bar icon mirrors the most urgent current alert: a bolt while lightning is inside your radius (any strike in the last ten minutes), an alert symbol while a ticked hazard affects you, the storm cloud otherwise, and a dimmed icon when Stormtrace is not running. The window reports this to the local server, which shares it through `/api/health` and lets it expire after five minutes without an update.

A new install shows a short welcome with Locate me, Pick on map and Explore first. Existing settings mean it never appears.

## Layers and selected events

**Layers** is the single control for everything drawn on the main map: lightning strikes, radar, England flood warning areas and past-day earthquakes. Its closed summary names the layers that are on. The toolbar **Radar** button is a shortcut to the same radar layer; turning radar on from it moves keyboard focus to the radar panel. Turning radar on opens its source, timeline and legend in the sidebar; **Turn off radar** there, or the Layers checkbox, removes it. Hiding lightning strikes keeps collection, statistics and alerts running.

**Show on map** in the Floods, Earthquakes and Cyclones lists closes the list and highlights one event on the main map. If the Earthquakes layer already shows that earthquake, its existing point opens instead of a second marker. The highlighted event appears as **Selected** in Layers, with **Clear** to remove it. Selecting another event replaces it. Weather warning areas stay on their own **Weather warning map**, which has **Back to warnings list**.

## Hazard views

Each **Hazards** button shows a small status dot: neutral until checked, yellow while checking or when showing cached data, cyan after a successful check, red after a failed retrieval, and an outline when setup is required. Hovering or focusing the button gives the full status.

Every hazard dialog uses the same header layout: title and **Close**, labelled scope selectors (country, time, magnitude, product or source) with **Refresh** and other actions, retrieval status, attribution and official links, then **Current** and **Saved history** tabs with a text filter. The header stays in place above a keyboard-scrollable content region. Coverage notes open the content region in plain language.

**Current** and **Saved history** select separate lists. Use the filter for title, place, source, area or status; filtering does not imply saved-location matching. Lists initially display up to 100 matches, with **Show 100 more** for additional records. Saved history is what this device saw while the view was open; it can be incomplete, and the storage note describing it appears only in the Saved history tab.

Unchanged refreshes preserve record elements, expanded source text and keyboard focus. When a source record changes, its disclosure state and corresponding focused control are restored. Loading/status changes do not rebuild the list. Source text uses a readable body font, while authoritative severity colours remain fixed across themes.

Space weather has separate **Current and previous conditions**, **Dated forecasts** and **Recent issued messages** views. Forecast probabilities retain their source meaning; R/S/G scales have an official explanation link. Tsunami bulletin lifecycle (expiry, cancellation, test/exercise) is shown prominently before the original source classification. Neither a latest bulletin nor a quiet condition summary establishes an all-clear statement.

## Retrieval, caching and missing coverage

Views show the last successful check, source age where available, cache/failure feedback and when another check is eligible. Refresh rechecks the local receiver; successful cached results remain refreshable, while failed-source backoff displays the next eligible attempt. Closing a dialog stops its source polling. Reopening uses the same local server cache; manual refresh does not bypass fair-access limits.

NTWC and PTWC tsunami products have independent results and health. SWPC conditions and issued messages are also retrieved independently. Failure of one product does not hide a successful result from another. Previously retrieved data remains explicitly cached; a failed request is not a successful empty feed. Provider-native classifications, issue/update/expiry metadata and cancellation references are retained without fabricating missing source fields.

Map popups include retrieval/cache feedback alongside source times, uncertainty and official links. A selected cyclone marker is a reported centre, not a forecast position; refreshed summaries update its centre. A centre absent from a later summary is identified without inferring cancellation.

## Times

Displayed instants use labelled UK local time by default. **Appearance → Show times in** can switch to this device's time zone; Met Office weather warnings and the warning map always use UK local time. Source timestamps lacking a timezone stay raw and are labelled as such. UTC epoch values and upstream source timestamps remain unchanged in stored provenance. A lightning count describes records in the selected window and current map view; the UI separately discloses a hidden layer and the 4,000-marker display limit.

## Colours

Interface colours follow the active Omarchy palette or a custom palette. Dialogs and popups use opaque surfaces derived from that palette, with a minimum text contrast. Strike-age colours (yellow under 5 minutes, orange to the end of the first hour, crimson older) and official warning colours are fixed in every theme. The strike-age legend lists only the ages the selected window can contain.

## Keyboard, location and saved settings

Press `?` for the full shortcut list. Main-view shortcuts are suspended while a dialog is open or an editable field/source selector is active. Place search supports arrow selection, Enter and Escape with combobox state. Late results from an older query cannot replace a newer result; invalid coordinate pairs are rejected locally.

All location controls are in **Your location** in the sidebar: **Locate me** (`G`), **Pick on map** and **Enter coordinates**. The toolbar **Set location** button requests your position in one click, like **Locate me**. Location source/uncertainty feedback is separate from notification permission and delivery state. A manual monitoring point is identified as chosen manually; **Locate me** can replace it. **Desktop alerts** shows whether alerts are off, on (with the radius) or blocked by the system.

Settings that apply in the current session but fail to save show a persistent warning row with **Retry saving**. **Reading size** offers Default, Larger and Large settings. Reading size, time display, colour source and map controls apply immediately; custom colour edits require **Apply custom colours**. **Start custom from Omarchy colours** explicitly switches to custom mode. Reduced-motion preferences suppress UI transitions and animated map travel.

Nearby-lightning notifications require a source-observed timestamp no more than two minutes old, and reject inferred or missing source times and times more than 30 seconds in the future, which allows for a slightly slow local clock. Archive ingestion still accepts older records. Notification text reports the event's actual age; rejected old events do not consume the alert cooldown.

Monitoring coordinates are stored locally and distances/alerts are calculated locally. External map services receive tile requests, place searches go to OpenStreetMap Nominatim, and automatic location uses the system location service. Stormtrace does not send its saved monitoring coordinates to a hazard provider for these local distance calculations.

## Weather warning map

Weather warnings include a **Warning map** action opening a dedicated UK map of official warning areas, separate from other weather layers. It uses the public Met Office map service (beta) without a key; summaries remain available in the list. Severity/type labels and the area buttons open full source-backed popups. The source link and retrieval/delay caveats remain visible. See [UK weather warnings](warnings.md).

Existing plugin IDs, profile paths, saved settings and storage keys are unchanged. The time display preference (`timeZone`), hazard alert choices (`hazardAlerts`) and `welcomeSeen` are additive settings with safe defaults, and notified hazard revisions are kept under the new `stormtrace:hazard-alerts-notified` key; no data migration is required.
