# UK weather warnings

Stormtrace shows Met Office National Severe Weather Warnings in a dedicated **Weather warnings** view. It works without any setup using the public Met Office summaries, and shows full warning details if you add a free Weather DataHub key.

Warnings are optional. You don't need a key to use the lightning viewer or any other view. Demo mode does not retrieve live warnings.

## Without a key: public summaries

Open **Weather warnings** from the **Hazards** buttons. Without a key, Stormtrace retrieves the official Met Office UK warnings RSS feed and refreshes it every five minutes while the view is open.

Each summary shows the warning title, the summary text, its official colour (yellow, amber or red) and a link to the full warning on the Met Office website. Select a summary, or its **Show on map** button, to open the warning map focused on the matching area. The two Met Office services share no warning ID, so Stormtrace matches them by colour, weather type and the places each lists. If the map service has no matching area yet, the map opens and says so.

The RSS feed is a summary only. It does not include:

- warning areas (polygons), so Stormtrace cannot tell you whether your saved monitoring point is affected
- per-warning issue and expiry times
- full advice and update reasons

![Met Office weather warning summaries in Stormtrace](screenshots/weather-warnings.png)

Summaries are not kept in local history. A warning disappearing from the feed does not mean it was cancelled. Always open the official warning for timing and advice.

## With a key: full DataHub warnings

<a id="setup"></a>

### Setup

1. Create a [Weather DataHub](https://datahub.metoffice.gov.uk/docs/g/category/warnings/overview) account, subscribe to the warnings product and generate its API key. Review the product terms first. Stormtrace does not create accounts or accept terms for you.
2. Open the installed Stormtrace folder (normally `~/.config/omarchy/plugins/stormtrace.lightning`) and add this line to its `.env` file. Keep any existing lines, such as a lightning key. Don't put quotes around the value:

   ```dotenv
   METOFFICE_WARNINGS_API_KEY=your_subscription_key
   ```

   Keep the key private. `.env` is ignored by Git, and Stormtrace's local server never sends the key to the browser or serves the file. An environment variable with the same name takes precedence.
3. Exit Stormtrace and open it again so the local server reads the key.

### What you get

With a valid key, the view refreshes once a minute while it is open and visible. Each warning shows:

- its official colour, weather types, headline and full "what to expect" text
- affected regions and sub-regions
- further details, advice and update reasons when the Met Office supplies them
- issue, update and validity times in UK local time (always, whatever the **Appearance** time setting)
- a highlight when your saved monitoring point is inside the warning area

Warning colours always follow the official Met Office colours, whatever theme you use. Cancelled and expired warnings are not shown as current.

If retrieval fails, Stormtrace keeps the last warnings it received and labels them as cached. A successful empty feed is shown differently from a failed check. An empty feed is not an all-clear. Use **Check the Met Office** for current information.

### Saved history

**Saved history** lists the warning versions Stormtrace has seen, including updates, cancellations and expiries. History is kept on this device for up to 90 days, with a limit of 5,000 warnings.

This is not a complete archive. The Met Office keeps change records for about 24 hours, so changes that happen while Stormtrace is closed or offline can be missed. Clearing browser storage removes the history.

## Warning map

Choose **Warning map** inside Weather warnings to see current warning areas on a dedicated UK map. It needs no key.

![The UK warning map focused on an amber wind warning, with severity filters and a colour-coded list of areas](screenshots/warning-map.png)

The map uses a public, Met Office-linked Esri beta service under the NSWWS Open Licence. The Met Office does not support that service's API, and it can lag behind the official website. Expired areas are left out, and future warnings stay visible. Select an area or its label to open the full warning. Each entry in the side list carries its official warning colour; hover over or focus an entry to highlight its area on the map, and hover over an area to highlight its entry. Select the Yellow, Amber or Red key to hide or show that level on the map and in the list; each shows how many areas it has.

Warning areas are kept separate from lightning, radar and other weather layers, as the Met Office style guide requires, so they never appear on the main map.

## Limitations

- No new desktop notifications are sent for weather warnings.
- Relevance only describes your saved monitoring point, not your actual position or its uncertainty.
- Internet delivery is best effort. For decisions about your safety, use the official Met Office service.
