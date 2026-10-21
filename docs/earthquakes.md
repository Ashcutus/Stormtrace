# Earthquakes

Open **Earthquakes** from the **Hazards** buttons to see earthquakes from the past day, using the public [USGS earthquake feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php). It needs no key or extra software.

While the view is open and visible, it refreshes once a minute. Demo mode does not retrieve earthquakes.

## Using the list

Filter by the past hour, 6 hours or 24 hours, by minimum magnitude, or by place name. Events with an unknown magnitude are included under **All / unknown** and left out when you set a minimum magnitude.

Each card shows:

- magnitude and magnitude type, exactly as USGS reports them
- the place description (or "Location description unavailable" when USGS doesn't supply one)
- occurrence and update times in UK local time, or your device's time zone if chosen in **Appearance**
- depth, review status, reporting network and event ID
- a link to the official USGS event page

![Earthquakes of magnitude 4.5 and above from the past 24 hours](screenshots/earthquakes.png)

The list shows up to 500 events at a time. Narrow the filters to see others.

**Show on map** closes the view and highlights the earthquake on the main map, reusing its point when the Earthquakes layer is on. It appears as **Selected** in **Layers**, where **Clear** removes it. This doesn't change your saved monitoring point or lightning alerts. The marker shows where the earthquake was located, not the area affected.

If retrieval fails, the last list is kept and labelled as cached. A successful empty result is shown differently from unavailable data.

## Saved history

**Saved history** lists the versions of each earthquake that Stormtrace has seen, kept on this device for up to 30 days with a limit of 5,000 events. USGS often revises location and magnitude after first publication. An earthquake leaving the past-day feed is not treated as deleted.

This is local history, not a complete earthquake catalogue.

## Map layer and shaking

Past-day earthquakes can also be shown on the main map, with official USGS ShakeMap shaking contours where they are published. See [map layers](map-hazards.md).

## Limitations

- This is not earthquake early warning. Early locations and magnitudes are preliminary and can change.
- Detection and reporting vary by region.
- There is no historical catalogue search, multi-day view, near-location alert or desktop notification.
- Tsunami information in the source data is not presented as a tsunami warning. Use the [tsunami bulletins](hazards.md) view and local authorities for that.
- Non-earthquake events, such as quarry blasts, are left out.

Data: USGS / ANSS ComCat and contributing seismic networks.
