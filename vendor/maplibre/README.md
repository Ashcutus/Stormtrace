Vendored MapLibre GL JS 6.15.0 (BSD-3-Clause) and MapLibre GL Leaflet 0.1.4 (ISC).

- `maplibre-gl.mjs`, `maplibre-gl-worker.mjs`, `maplibre-gl.css` and `LICENSE.txt` are unmodified files from the `maplibre-gl@6.15.0` npm package (verified by `npm pack` integrity). The ESM build loads its worker from `./maplibre-gl-worker.mjs`, so both files must stay together. `client/maplibre-loader.js` imports the module and exposes it as the `maplibregl` global for the Leaflet bridge.
- `leaflet-maplibre-gl.js` is MapLibre GL Leaflet 0.1.4 with Stormtrace patches: camera and canvas updates are synchronized with Leaflet movement, the canvas is read through the public `getCanvas()` API, and the internal-transform fallback is skipped when MapLibre exposes `setTransformConstrain`.

Licenses are included alongside the files.

client/map-style.json is based on OpenFreeMap Positron, with English label expressions.
Source: https://tiles.openfreemap.org/styles/positron
Map attribution remains visible in index.html.
