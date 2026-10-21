# UK flood information

Open **Floods** from the **Hazards** buttons and choose a country.

| Country | What Stormtrace shows |
| --- | --- |
| England | A live list of Environment Agency flood alerts and warnings |
| Wales | A link to Natural Resources Wales flood warnings |
| Scotland | A link to SEPA live flood information |
| Northern Ireland | A link to official nidirect flood information |

Only England has a live in-app list. For the other countries, Stormtrace says clearly that live coverage isn't available in the app; it never shows them as an empty, healthy feed. Natural Resources Wales requires an API subscription, SEPA's Floodline API is available by request only, and no public live warning feed for Northern Ireland has been verified.

## England live warnings

England needs no registration, API key or extra software. While the view is open and visible, it refreshes every 15 minutes; closing or hiding it stops checks. Demo mode does not retrieve floods.

The list shows active severe flood warnings, flood warnings and flood alerts, ordered by Environment Agency severity. Each card shows:

- the affected area, with county and river or sea where supplied
- the full official situation message
- review, message-change and severity-change times as supplied by the source
- a link to the area on GOV.UK

The Environment Agency currently supplies these times without a timezone. Stormtrace shows them exactly as supplied and labels the timezone as unspecified rather than guessing.

The heading, **Close**, **Country**, **Refresh**, and the **Current** / **Saved history** tabs stay visible while the list scrolls, and the list can be scrolled with the keyboard. **Show on map** on an England warning closes the list and outlines that warning area on the main map; it appears as **Selected** in **Layers**, where **Clear** removes it.

If retrieval fails, the last list is kept and labelled as cached. A successful empty feed is shown differently from unavailable data.

## Saved history

**Saved history** includes warnings Stormtrace has seen, including those marked "no longer in force". History is kept on this device for up to 90 days, with a limit of 5,000 warnings. A warning disappearing from the feed is not treated as withdrawn; only the source's explicit "no longer in force" status marks it withdrawn.

This is local history, not a complete archive.

## Map layer

England warning areas can also be shown on the main map. See [map layers](map-hazards.md). The polygons show the area a warning covers, not observed floodwater.

## Limitations

- Live coverage is England only. It is not UK-wide.
- The list does not check whether your saved monitoring point is affected, and there are no flood notifications.
- River levels and flood forecasts are not shown.
- The Environment Agency API is a beta service with no service-level guarantee and does not replace official warning channels. Use [GOV.UK flood warnings](https://check-for-flooding.service.gov.uk/alerts-and-warnings) for decisions about your safety.

Data: Environment Agency flood and river level data from the real-time data API (Beta), under the Open Government Licence v3.
