# Radar observations: UK, Europe and US

Stormtrace offers one selected radar overlay at a time, with observation timestamps, recent-frame selection and canonical source attribution. The sources are free to access without radar subscription keys. Ground radar coverage varies and does not cover the whole globe.

![UK radar rainfall with the radar panel open](screenshots/radar.png)

## Available sources

- **UK · Met Office rain rate:** public ASDI radar-derived rainfall estimates, 1 km source grid, 15-minute observations, publication up to 20 minutes later. Optional local ODIM decoder required. The Met Office service is public beta/non-operational.
- **Europe · EUMETNET rain rate:** public ORD OPERA NIMBUS instantaneous rain-rate composite, 2 km source grid and 15-minute observations. Optional local ODIM decoder required. Radar contribution and usable coverage vary across the European composite.
- **NOAA reflectivity:** regional quality-controlled base-reflectivity displays for the contiguous US, Alaska, Hawaii, Caribbean and Guam. Approximately two-minute observations; no scientific decoder required. Reflectivity in **dBZ** is not rainfall rate in **mm/h**.

The application links to each official source and displays its attribution. Source and licence metadata are maintained in `providers/registry.js`: Met Office derived imagery carries CC BY-SA attribution/share-alike; EUMETNET OPERA composites carry CC BY attribution; NOAA imagery retains NOAA/NWS attribution and identifies display transformations without implying endorsement. National radar volumes are not downloaded or mosaicked independently.

## Setup

UK and European rain-rate decoding is optional and uses the same environment. NOAA radar imagery does not need scientific packages; it uses the standard Python runtime. Lightning and other hazards keep their existing dependencies. **Create the Python environment outside the plugin directory.** Omarchy rejects symlinks anywhere inside a plugin, including ignored files; Python environments contain symlinks and can block updates.

From the installed app directory (normally `~/.config/omarchy/plugins/stormtrace.lightning`):

```bash
radar_env="${XDG_DATA_HOME:-$HOME/.local/share}/stormtrace/radar-venv"
python3 -m venv "$radar_env"
"$radar_env/bin/python" -m pip install -r requirements-radar.txt
```

Add the **expanded absolute Python executable path** to the existing `.env`, preserving other settings. For example:

```dotenv
STORMTRACE_RADAR_PYTHON=/home/your-user/.local/share/stormtrace/radar-venv/bin/python
```

Use the actual path printed by `printf '%s\n' "$radar_env/bin/python"`; `.env` values do not expand `$HOME`, `$XDG_DATA_HOME` or `~`. Do not add quotes around the value. Restart Stormtrace to read it. Both Node and the Python fallback use the same worker/decoder. If unset, Node uses `python3`; the fallback uses its own Python executable. If the selected interpreter lacks HDF5/projection packages, the UI explains that decoder setup is required. The decoder survives plugin replacement because it is outside the plugin folder.

### Recover an existing in-plugin environment

If an update reports `.venv-radar/lib64` or another decoder symlink, create the external environment above and update `.env` first. Move the old environment out of the plugin folder (preserve it as a backup), then validate and retry:

```bash
backup_dir="${XDG_DATA_HOME:-$HOME/.local/share}/stormtrace/radar-backups"
mkdir -p "$backup_dir"
mv .venv-radar "$backup_dir/venv-$(date +%Y%m%d-%H%M%S)"
omarchy plugin validate .
omarchy plugin update stormtrace.lightning --yes
```

Run these commands from the installed plugin directory. Do not replace the environment with a symlink pointing to its new location; that also fails validation. An old environment's scripts can retain absolute paths, so use the newly created external environment rather than assuming a moved environment is relocatable.

## Controls and limits

Select **Radar · UK / Europe / US** in Explore to enable or remove the overlay. Choose **Source / region**, then use the frame selector or **Latest / refresh**. **View selected region** explicitly centres the map on the selected display crop. Toggling radar and switching sources preserve the map centre and zoom. Enable or disable **Lightning strikes** independently in Map layers; this affects visibility only, while lightning collection and nearby alerts continue.

Radar draws above the basemap and below lightning markers. The panel displays the loaded observation time, source attribution, official-source link, product-specific legend and retrieval status. All displayed observation times use labelled UK local time; provenance retains the source timestamps. The NOAA source-generated legend can be scrolled horizontally with keyboard focus. Met Office warning polygons remain in their dedicated list.

Metadata refreshes every five minutes for UK/Europe and every minute for NOAA while enabled and visible. The server shares successful metadata for those intervals. European retrieval uses bounded hourly bucket prefixes across the displayed window, including midnight, rather than incomplete full-day listings. The timeline contains at most 12 observations from the past three hours; NOAA frames are sampled as the first observation in each 15-minute slot plus the latest scan, so this is not every two-minute scan; sampled frame identities stay stable between refreshes while scrubbing. Empty recent listings remove old imagery. Failed metadata/image requests retain the last loaded frame with its original timestamp and explicit error feedback. Switching sources removes the previous source's frame immediately. Demo mode makes no live radar requests.

Frame age is labelled delayed after 1.5 source update intervals and stale after three intervals. Met Office's normal publication lag can therefore produce a delayed label. These labels describe observation age, not forecast confidence.

<a id="implementation-and-validation"></a>

## Raster and coverage limitations

UK and European ODIM rain-rate grids are reprojected to Web Mercator with nearest-neighbour sampling at display-pixel centres. Source timestamps, RATE quantity, gain/offset, missing values and grid geometry are validated before rendering. Met Office's upper-left origin is explicit; OPERA Cartesian origin is checked against all supplied corner coordinates and grid scale.

The UK crop is west −13°, south 48°, east 4°, north 62°, rendered at 640 × 800 pixels. The European crop is west −40°, south 30°, east 60°, north 72°, rendered at 1000 × 700 pixels. NOAA WMS images are requested directly in Web Mercator at 960 × 600 pixels using fixed regional crops and source-supplied observation times. These are display images, not native-resolution analytical grids. Alaska is a western-longitude crop and does not include all Aleutian coverage across the antimeridian; Caribbean imagery does not imply coverage of every island.

For UK/Europe, zero/undetect, missing observations, rainfall below 0.1 mm/h and locations outside the source grid are transparent. NOAA transparency also does not guarantee dry conditions. Terrain, distance from radar, outages and source processing affect usable coverage. No interpolation fills coverage gaps, and this layer is neither a rainfall forecast nor complete global rainfall coverage.

The UK provider retains up to 12 on-demand PNGs. Each additional regional provider retains at most three on-demand images, including any legend. All radar caches are memory-only, disappear at server shutdown, and stay out of strike/event history. Downloads, XML listings, grid sizes and worker execution are bounded. New public-source retrieval rejects redirects and accepts only fixed upstream hosts/products. Decoder failures do not prevent lightning or other hazards starting.

## Troubleshooting

- **Decoder not configured:** complete Setup for UK/Europe, verify the expanded interpreter path, then restart. NOAA can be used without the scientific packages, but a configured interpreter must still exist.
- **No recent observations:** the selected source has no observations in the recent window. Older archive data is not substituted as live.
- **Feed/image/legend unavailable:** use **Latest / refresh** and check the official source. Existing loaded imagery retains its timestamp; it does not become a fresh observation after a failed request.
- **No coloured pixels:** use **View selected region**, check observation time and coverage. Transparent pixels alone cannot distinguish no rain from unavailable observations.
