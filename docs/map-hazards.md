# Map layers

Use **Layers**, at the top left of the map, to add hazard layers to the main map. The same panel controls lightning strikes and radar. The flood and earthquake layers are off by default. Enabled layers refresh every 15 minutes while Stormtrace is visible, and **Refresh layers** checks them straight away. Turning a layer off removes it.

## England flood warning areas

This layer shows the areas covered by current Environment Agency flood alerts and warnings. The polygons show the area a warning covers. They are not observed floodwater or evacuation boundaries.

Up to 100 active areas are shown, most severe first. If some areas can't be retrieved, the layer says that coverage is partial. Select an area to see its severity, area, county and river, the full source message, the source review time and a link to the official area page.

Other UK countries are not covered. See [flood information](floods.md).

## Earthquakes and estimated shaking

This layer shows earthquakes from the past day (up to 500 events). Select an earthquake, or use **Show on map** in the earthquake list, to open its details. Stormtrace then checks for an official USGS [ShakeMap](https://earthquake.usgs.gov/data/shakemap/).

Where a ShakeMap is published, Stormtrace draws its estimated shaking contours, measured in Modified Mercalli Intensity (MMI). These are estimates, not reported felt effects, damage footprints or early warning. Many earthquakes have no ShakeMap, and Stormtrace never draws a radius from magnitude, so for those events the extent of shaking is unknown.

![Estimated shaking contours for a magnitude 6.0 earthquake near Vanuatu](screenshots/earthquake-shaking.png)

Selecting another earthquake replaces the previous contours, and **Clear** next to **Selected** in Layers removes them. Loading, "no ShakeMap" and retrieval errors are shown inside the popup, with **Retry** after an error.

## Behaviour and limits

- If a refresh fails, the previous layer data stays on the map and is labelled as cached.
- Map resources are cached briefly in memory by the local server and are never added to local event history.
- Met Office warning areas never appear on this map; they have their own [warning map](warnings.md#warning-map).
- These layers don't change your monitoring point, lightning settings or alerts.
