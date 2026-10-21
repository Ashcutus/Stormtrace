// MapLibre GL JS 6 ships only as an ES module. Expose it as the global the
// Leaflet bridge expects; the bridge and app scripts are deferred, so they run
// after this module in document order. A failed import leaves the global
// unset and the app falls back to raster tiles.
import * as maplibregl from "/vendor/maplibre/maplibre-gl.mjs";

globalThis.maplibregl = maplibregl;
