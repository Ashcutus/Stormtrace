# Stormtrace for Omarchy

Stormtrace is a theme-aware Omarchy bar widget and local lightning monitor. It renders a draggable and zoomable global map, receives near-real-time strikes, keeps a rolling on-device history, calculates activity hot spots, and can notify you when lightning is detected inside a configurable radius around your location.

## Install as an Omarchy plugin

Once this repository is public, install and enable it with:

```bash
omarchy plugin add https://github.com/Ashcutus/Stormtrace.git --enable
```

The lightning icon is added to the right side of the Omarchy bar. Select it to start the local server and open or focus the Stormtrace app. The widget lights up while the local receiver is running.

Remove it cleanly with:

```bash
omarchy plugin remove stormtrace.lightning
```

The plugin does not use install hooks, sudo, or a background system service. Its server starts only when requested.

## Theme behaviour

Stormtrace follows the current Omarchy theme by default. It reads Omarchy's resolved semantic palette, supports dark and light themes, and checks for a new system theme while the app is open. The bar widget uses the same live Omarchy shell colours.

Open the palette button in the app header to:

- switch between **Omarchy** and **Custom** colour sources;
- edit the background, surfaces, text, accent, strike, safe, and warning colours;
- copy the current Omarchy palette as a starting point; or
- return to automatic Omarchy theme inheritance at any time.

Custom colours are stored only in that browser profile.

## Run without the plugin

```bash
./start.sh
```

Open `http://127.0.0.1:4177`, or use `./start-app.sh` to launch it in Omarchy's web-app window.

An optional standalone launcher entry can also be installed:

```bash
./install-omarchy.sh
```

Then press `SUPER + SPACE` and search for **Stormtrace**.

Stormtrace uses Node.js 20+ when available and falls back to Python 3. It has no package-manager dependencies.

## Data behavior

- Live strikes use the unofficial, unauthenticated LightningMaps/Blitzortung WebSocket feed. The connection is global and reconnects with exponential backoff.
- The last 24 hours are retained locally in IndexedDB, capped at 30,000 strikes. A new installation fills its historical timeline as it runs.
- Full 24-hour backfill is optional. Copy `.env.example` to `.env`, add a `LIGHTNING_API_KEY`, and restart. The key remains server-side. The provider plan must support a 1,440-minute window.
- Geolocation and the alert radius are stored only in the local browser profile. Proximity notifications use a two-minute cooldown to avoid alert storms.

The community network does not provide a supported public historical-strike API; participant archive access is restricted. Stormtrace labels local history honestly and offers the optional provider path rather than presenting generated data as live. Its demo mode is available only by adding `?demo=1` to the local URL.

## Controls

| Control | Action |
| --- | --- |
| Drag / scroll | Move and zoom the map |
| `/` | Focus place search |
| `L` | Return to the live time window |
| `G` | Request/update your location |
| `N` | Toggle proximity notifications |
| `R` | Reconnect the strike stream |

## Sources and limitations

- [Blitzortung project and data-use guidance](https://www.blitzortung.org/en/compendium.php)
- [LightningMaps documentation](https://docs.lightningmaps.org/)
- [Optional Lightning API documentation](https://lightningapi.dev/docs)

Blitzortung data is for private, non-commercial use. Coverage and detection latency vary by region. This app is situational awareness software, not a safety-critical warning system.

## Publishing

The repository includes the marketplace `manifest.json`, QML bar entry point, MIT licence, safe launcher scripts, and a [publishing checklist](PUBLISHING.md). Validate a release with:

```bash
omarchy plugin validate .
```
