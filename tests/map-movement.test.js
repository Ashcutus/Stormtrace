import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("panning paints the matching GL camera immediately on every Leaflet move", () => {
  const calls = [];
  const L = {
    Layer: { extend: (methods) => methods },
    DomUtil: { setPosition: (_, position) => calls.push(["position", position]) },
  };
  const context = vm.createContext({ L, maplibregl: {} });
  vm.runInContext(readFileSync(new URL("../vendor/maplibre/leaflet-maplibre-gl.js", import.meta.url), "utf8"), context);
  const layer = Object.create(L.MaplibreGL);
  let longitude = 0;
  layer.options = { padding: 0.1 };
  layer._container = {};
  layer._map = {
    getCenter: () => ({ lat: 18, lng: longitude }),
    getZoom: () => 4,
    getSize: () => ({ multiplyBy: () => ({ x: 80, y: 60 }) }),
    containerPointToLayerPoint: () => ({ subtract: () => ({ x: longitude, y: 0 }) }),
  };
  layer._glMap = {
    jumpTo: (camera) => calls.push(["camera", camera.center[0], camera.zoom]),
    redraw: () => calls.push(["paint"]),
  };
  const move = layer.getEvents().move;
  for (longitude of [1, 2, 3]) move.call(layer);
  assert.deepEqual(calls.map((call) => call[0]), [
    "position", "camera", "paint", "position", "camera", "paint", "position", "camera", "paint",
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === "camera"), [
    ["camera", 1, 3], ["camera", 2, 3], ["camera", 3, 3],
  ]);
  layer._zooming = true;
  move.call(layer);
  layer._map = null;
  move.call(layer);
  assert.equal(calls.length, 9, "animated zoom and detached layers skip pan updates");
});
