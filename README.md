<p align="center">
  <img src="icon.svg" width="112" alt="Stormtrace icon: a storm cloud and lightning bolt over radar rings">
</p>

<h1 align="center">Stormtrace</h1>

<p align="center">
  <strong>Live lightning, radar and world hazards in one calm window. Built for Omarchy.</strong>
</p>

<p align="center">
  <a href="manifest.json"><img alt="Version" src="https://img.shields.io/github/manifest-json/v/Ashcutus/Stormtrace?label=version&color=3d9cff"></a>
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/github/license/Ashcutus/Stormtrace?color=68d8f2"></a>
  <img alt="Built for Omarchy" src="https://img.shields.io/badge/built%20for-Omarchy-ffe600">
</p>

![Stormtrace showing live lightning across the world, with a new strike flashing and hotspots and activity in the sidebar](docs/screenshots/overview.png)

Watch thunderstorms light up the map as strikes are detected around the world, and get a quiet desktop alert if lightning comes close to you. When you want the bigger picture, one click brings up rain radar, UK weather warnings, floods, earthquakes, tropical cyclones, volcanoes, tsunami bulletins and space weather, all straight from official and public sources.

Your location stays on your computer. There's no account, no cloud service and nothing running in the background when Stormtrace is closed.

> Stormtrace is for keeping an eye on the weather, not a safety warning system. Always follow official guidance.

## What you can do with it

### ⚡ Follow lightning as it happens

New strikes appear within moments with a bright flash and spreading rings, so they catch your eye while you watch a storm. Strikes are coloured by age in your theme's colours: its yellow for the last five minutes, its accent for the last hour, and a muted shade for older ones. Switch between the live view and the last hour, six hours or 24 hours, and jump straight to the busiest storm with **Focus top**.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/regional-map.png" alt="Zoomed in on an active storm, with strikes coloured by age and a new strike flashing"></td>
    <td width="50%"><img src="docs/screenshots/strike-details.png" alt="Details for a single lightning strike, including time, coordinates and uncertainty"></td>
  </tr>
  <tr>
    <td align="center"><sub>Zoom straight into the busiest storm</sub></td>
    <td align="center"><sub>Every strike has its own details</sub></td>
  </tr>
</table>

### 🔔 Know when it's getting close

Set your location once, choose an alert radius between 5 and 50 miles, and turn on **Desktop alerts**. Stormtrace will let you know when lightning strikes inside that circle, at most once every two minutes. The sidebar keeps a running count and shows how far away the closest strike was.

You can also ask to hear about **amber and red Met Office weather warnings** covering your location, **England flood warnings** for your area, and **earthquakes** above a chosen size within a chosen distance. Each alert copies the official information once per update and links you back to the source.

Even with the window closed, the storm icon in your Omarchy bar keeps watch: it turns into a bolt while lightning is inside your radius and shows an alert symbol when a hazard affects you. It's dimmed when Stormtrace isn't running.

![The Alerts near you panel with an alert radius around a monitoring point, desktop alerts and hazard alert options](docs/screenshots/activity-monitoring.png)

### 🌧️ See the rain

Turn on **Radar** to see the last three hours of radar for the UK, Europe, the US and Canada. Press **Play** to watch the weather move, or scrub through the frames yourself.

- **UK and Europe:** rainfall rate from the Met Office and EUMETNET, every 15 minutes.
- **United States:** radar reflectivity from NOAA for the contiguous states, Alaska, Hawaii, the Caribbean and Guam, every couple of minutes. Switch to **precipitation type** to tell rain, snow and hail apart.
- **Canada:** rain and snowfall rates from Environment and Climate Change Canada, every 6 minutes. Its **precipitation type** goes further, picking out mixed rain and snow and freezing rain by intensity. Areas outside radar coverage are hatched, so a clear patch inside coverage really does mean nothing is falling.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/radar.png" alt="UK rain radar with the radar panel open"></td>
    <td width="33%"><img src="docs/screenshots/precipitation-type.png" alt="US precipitation type showing rain, snow and hail categories"></td>
    <td width="33%"><img src="docs/screenshots/precipitation-type-canada.png" alt="Canadian precipitation type showing snow, mixed rain and snow and rain bands over the Prairies, with areas outside radar coverage hatched"></td>
  </tr>
  <tr>
    <td align="center"><sub>UK rainfall from the Met Office</sub></td>
    <td align="center"><sub>US rain, snow and hail from NOAA</sub></td>
    <td align="center"><sub>Canadian snow, mixed and freezing rain from Environment Canada</sub></td>
  </tr>
</table>

### 🌍 Keep an eye on the wider world

The **Hazards** buttons along the top open each view. A small dot on each button shows how its last check went: cyan for up to date, yellow while checking or showing saved data, red if the source couldn't be reached.

| View | What you'll see | Source |
| --- | --- | --- |
| **Weather warnings** | UK warnings in the official yellow, amber and red, plus a dedicated warning map | Met Office |
| **Floods** | Live flood alerts and warnings for England, with links for Wales, Scotland and Northern Ireland | Environment Agency |
| **Earthquakes** | The past day of earthquakes worldwide, with estimated shaking where USGS publishes it | USGS |
| **Cyclones** | Active tropical storms in the Atlantic and eastern and central Pacific | NOAA NHC |
| **Volcanoes** | US volcano alerts, shown on the map in their official aviation colour, and weekly global activity reports | USGS, Smithsonian |
| **Tsunami bulletins** | The latest bulletins from the US tsunami warning centres | NOAA |
| **Space weather** | Current conditions, forecasts and recent alerts | NOAA SWPC |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/weather-warnings.png" alt="Met Office weather warnings, including an amber wind warning, each with a Show on map button"></td>
    <td width="50%"><img src="docs/screenshots/warning-map.png" alt="The UK warning map with an amber Storm Boelo wind warning open: when it starts, its period in UK local time, popup size buttons and a collapsible What to expect section, beside severity filters and a colour-coded list of areas"></td>
  </tr>
  <tr>
    <td align="center"><sub>UK warnings in their official colours</sub></td>
    <td align="center"><sub>Open any warning on the map, or filter by severity</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/earthquakes.png" alt="Earthquakes of magnitude 4.5 and above from the past day"></td>
    <td width="50%"><img src="docs/screenshots/cyclones.png" alt="Tropical storms Josephine (Atlantic) and Vance (eastern Pacific) in the cyclones view"></td>
  </tr>
  <tr>
    <td align="center"><sub>Filter earthquakes by time and size</sub></td>
    <td align="center"><sub>Follow active tropical storms</sub></td>
  </tr>
</table>

Use **Layers** in the top-left corner of the map to add flood areas or earthquakes to the map itself, and **Show on map** in a list to jump to one event. Every view says where its information comes from, when it last checked, and whether anything is delayed or unavailable.

![A magnitude 5.3 earthquake on the Reykjanes Ridge shown on the map with its details open](docs/screenshots/earthquake-map.png)

### 🎨 Make it yours

Stormtrace follows your Omarchy theme automatically, or you can pick your own colours. Prefer light or dark regardless of your theme? Choose **Light** or **Dark** under **Light or dark**: Stormtrace builds a matching version of your Omarchy theme that keeps its accent colours. **Appearance** also has larger text sizes, a choice of UK or local time, and map brightness and shading. Strike-age colours come from your theme, but Stormtrace switches to a fixed yellow, orange and crimson set if a theme's colours are too close to tell apart. Official warning colours never change, so they always mean the same thing.

![The Appearance panel with Omarchy or custom colours, the Light or dark choice, the palette and map settings](docs/screenshots/appearance-controls.png)

<sub>Screenshots show live data captured on 22 and 23 October 2026.</sub>

## Install

Stormtrace runs as an Omarchy plugin. First install the native runtime:

```bash
omarchy pkg add python-gobject gtk3 webkit2gtk-4.1 geoclue
```

Then add and enable Stormtrace:

```bash
omarchy plugin add https://github.com/Ashcutus/Stormtrace.git --enable
```

A storm icon appears on the right of your bar. Click it to open Stormtrace; click it again to bring the window back to the front.

Want it in the app launcher (`SUPER + SPACE`) too? Run:

```bash
~/.config/omarchy/plugins/stormtrace.lightning/install-omarchy.sh
```

No `sudo` is needed, and nothing runs at boot. The small local service starts when you open Stormtrace and stops when you close it.

## Getting started

1. **Set your location.** On a new install a short welcome walks you through this. Otherwise click **Set location** in the toolbar (or press `G`). On a wired connection, or if you'd rather not share your position, use **Pick on map** or **Enter coordinates** in the sidebar instead. If only a rough position is available, Stormtrace shows how rough it is and lets you decide.
2. **Choose your alerts.** Pick a radius, turn on **Desktop alerts**, and tick any hazards you'd like to hear about.
3. **Explore.** Try the **Hazards** buttons, turn on **Radar**, or press `?` to see every keyboard shortcut.

![The first-run welcome, with Locate me, Pick on map and Explore first](docs/screenshots/welcome.png)

The welcome appears once on a new install. If you already have saved settings, you won't see it.

### Weather warnings: full details

Weather warnings work straight away using the Met Office's public summaries. For the full warning text, affected areas, validity times, saved history and a highlight when your location is inside a warning, add a free Met Office Weather DataHub key to the app's `.env`:

```dotenv
METOFFICE_WARNINGS_API_KEY=your_subscription_key
```

Restart Stormtrace afterwards. The [warnings guide](docs/warnings.md#setup) walks you through getting a key.

### Radar

US and Canadian radar work out of the box. UK and European rainfall need a small decoder on your computer: when you first choose them, press **Set up UK and Europe radar** in the radar panel and Stormtrace installs it for you (about 40 MB, a few minutes). No radar account or key is needed. The [radar guide](docs/radar.md#setup) has the manual steps if you prefer.

UK and European frames arrive every 15 minutes (the Met Office can be up to 20 minutes behind), Canadian frames every 6 minutes, and US frames about every two minutes. US radar shows reflectivity (dBZ) while the UK, Europe and Canada show rainfall rate (mm/h), and Canadian snowfall is in cm/h, so their colours mean different things. Elsewhere a clear patch can mean dry weather or simply no radar coverage; Canadian radar hatches areas outside coverage so you can tell them apart.

US precipitation type is a NOAA classification that uses weather models as well as radar. It has no category for sleet or freezing rain, and it can miss some snow. Canadian precipitation type from Environment and Climate Change Canada combines radar with model surface temperature and does include mixed rain and snow and freezing rain. The UK and Europe don't publish precipitation type yet.

## Keyboard shortcuts

| Key | What it does |
| --- | --- |
| `/` | Search for a place or coordinates |
| `L` | Switch to the live lightning view |
| `G` | Find my location |
| `N` | Turn desktop alerts on or off |
| `P` | Pause or resume lightning |
| `R` | Reconnect the lightning feed |
| `+` / `−` | Zoom the map |
| `Esc` | Close a dialog, or stop picking a point on the map |
| `?` | Show all shortcuts |
| `F11` | Toggle fullscreen |
| `Ctrl+Q` | Quit Stormtrace |

Shortcuts pause while a dialog is open or you're typing. On narrow windows, the **Map** and **Lightning & location** tabs switch between the map and the sidebar.

## Your privacy

- Your location, alert settings, appearance and lightning history stay on your computer.
- Distances and alerts are worked out locally. Your location is never sent to any hazard source.
- The map downloads tiles from OpenFreeMap or OpenStreetMap, place searches go to OpenStreetMap Nominatim, and automatic location uses your system's location service.
- The lightning archive keeps up to 24 hours and 30,000 strikes.
- The local service only listens on `127.0.0.1` and stops when you quit.

## Where the data comes from

Live lightning comes from the LightningMaps/Blitzortung community network. It's an unofficial, volunteer-run feed, so coverage and delay vary from place to place, and its data is for private, non-commercial use only. Stormtrace reconnects automatically if the feed drops.

A new install builds up its lightning history as it runs. To load earlier history, add a `LIGHTNING_API_KEY` to `.env` (copy `.env.example` to start) and restart. The key stays on your local server, and your plan needs to cover the history you ask for.

Every other source has its own coverage and limits, explained in its guide. Everything arrives over the internet on a best-effort basis, so for decisions about your safety, check the official source and your local authorities.

- [Blitzortung project and data-use guidance](https://www.blitzortung.org/en/compendium.php)
- [LightningMaps documentation](https://docs.lightningmaps.org/)
- [Optional Lightning API documentation](https://lightningapi.dev/docs)
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright)

## Updating and removing

To see whether there's a new version, open **About** and select **Check for updates**. Stormtrace only checks; it never downloads or installs anything by itself.

To update:

```bash
omarchy plugin update stormtrace.lightning --yes
```

Then close and reopen Stormtrace.

To remove it:

```bash
~/.config/omarchy/plugins/stormtrace.lightning/uninstall-omarchy.sh
omarchy plugin remove stormtrace.lightning
```

## Troubleshooting

**Stormtrace won't open.** Check the local service and native runtime:

```bash
curl http://127.0.0.1:4177/api/health
systemctl --user status stormtrace-receiver.service
journalctl --user -u stormtrace-receiver.service
python3 -c 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1"); from gi.repository import Gtk, WebKit2'
```

If a crash left the service running, stop it with:

```bash
~/.config/omarchy/plugins/stormtrace.lightning/start-app.sh --stop
```

**The map is blank or there are no strikes.** The map and lightning feed need a network connection. Press `R` to reconnect. The demo (see below) is a quick way to check the app itself is working.

**The longer time windows are empty.** The 24-hour archive starts filling the first time you run Stormtrace. Earlier history needs the optional Lightning API key described above.

**Theme colours don't update.** Choose **Omarchy** in Appearance. Stormtrace checks for theme changes every five seconds and whenever the window regains focus.

**Radar says it needs setting up.** See [radar troubleshooting](docs/radar.md#troubleshooting).

## Contributing

Stormtrace has no npm runtime dependencies. Node.js 20+ runs the local server when it's available, with Python 3 as a fallback.

```bash
./start.sh        # start the local server
./start-app.sh    # open the native window
```

To try it without live data, open `http://127.0.0.1:4177/?demo=1`. The demo uses simulated lightning and turns off radar and other live sources.

Before committing, run:

```bash
npm ci
npm run check
npm test
bash -n start.sh start-app.sh install-omarchy.sh uninstall-omarchy.sh
git diff --check
omarchy plugin validate .
```

The tests are deterministic and need neither a desktop session nor live feeds, so they don't replace trying it in the real desktop.

Start with the [documentation index](docs/README.md), then the [architecture guide](docs/architecture.md) and [provider guide](docs/providers.md). There are optional [soak diagnostics](docs/diagnostics.md) for long-running tests, and releases follow the [publishing checklist](PUBLISHING.md).

## Licence

Stormtrace is released under the [MIT Licence](LICENSE). Lightning data remains subject to the source network's private, non-commercial terms.
