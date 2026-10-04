import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function bridge() {
  const calls = [];
  const L = {
    Layer: { extend: (methods) => methods },
    DomUtil: {
      setPosition: (_, position) => calls.push(["position", position.x, position.y]),
      setTransform: (_, offset, scale) => calls.push(["transform", scale]),
      addClass() {},
    },
    extend: Object.assign,
  };
  const context = vm.createContext({ L, maplibregl: { Map: null } });
  vm.runInContext(readFileSync(new URL("../vendor/maplibre/leaflet-maplibre-gl.js", import.meta.url), "utf8"), context);
  const layer = Object.create(L.MaplibreGL);
  const view = { x: 0, y: 0, lng: 0, zoom: 4 };
  layer.options = { padding: 0.1 };
  layer._container = {};
  layer._map = {
    getCenter: () => ({ lat: 18, lng: view.lng }),
    getZoom: () => view.zoom,
    getZoomScale: () => 1,
    getSize: () => ({ multiplyBy: () => ({ x: 80, y: 60 }) }),
    containerPointToLayerPoint: () => ({
      x: view.x, y: view.y,
      subtract: (offset) => ({ x: view.x - offset.x, y: view.y - offset.y }),
    }),
  };
  layer._glMap = {
    jumpTo: (camera) => calls.push(["camera", camera.center[0], camera.zoom]),
    redraw: () => calls.push(["paint"]),
  };
  layer._update();
  calls.length = 0;
  return { layer, view, calls, context };
}

test("dragging keeps the padded basemap in the same moving pane as markers", () => {
  const { layer, view, calls } = bridge();
  for (const x of [1, 20, 79]) {
    view.x = x;
    layer.getEvents().move.call(layer, { type: "move" });
  }
  assert.equal(calls.length, 0, "pan within padding uses only the shared pane transform");
  view.x = 80;
  view.lng = 2;
  layer.getEvents().move.call(layer, { type: "move" });
  assert.deepEqual(calls, [["position", 0, -60], ["camera", 2, 3], ["paint"]]);
  calls.length = 0;
  view.x = 90;
  layer.getEvents().move.call(layer, { type: "move" });
  assert.equal(calls.length, 0, "padding is measured from the last painted origin");
  view.y = -60;
  layer.getEvents().move.call(layer, { type: "move" });
  assert.deepEqual(calls.map((call) => call[0]), ["position", "camera", "paint"]);
});

test("pan completion rebases and paints immediately even within padding", () => {
  const { layer, view, calls } = bridge();
  view.x = 5;
  layer.getEvents().moveend.call(layer, { type: "moveend" });
  assert.deepEqual(calls, [["position", -75, -60], ["camera", 0, 3], ["paint"]]);
});

test("continuous zoom rebases and paints each frame while zooming", () => {
  const { layer, view, calls } = bridge();
  layer.getEvents().zoomstart.call(layer);
  for (const zoom of [4.1, 4.2, 4.3]) {
    view.zoom = zoom;
    view.x += 10;
    view.lng += 1;
    layer.getEvents().zoom.call(layer, { type: "zoom" });
  }
  assert.deepEqual(calls.map((call) => call[0]), [
    "position", "camera", "paint", "position", "camera", "paint", "position", "camera", "paint",
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === "camera"), [
    ["camera", 1, 4.1 - 1], ["camera", 2, 4.2 - 1], ["camera", 3, 4.3 - 1],
  ]);
  layer.getEvents().move.call(layer, { type: "move" });
  layer._map = null;
  layer.getEvents().move.call(layer, { type: "move" });
  assert.equal(calls.length, 9, "animated zoom move events and detached layers skip pan updates");
});


test("GL initialization preserves the canvas image between pan updates", () => {
  const { layer, context } = bridge();
  let options;
  context.maplibregl.Map = class {
    constructor(value) { options = value; this._canvas = {}; }
    on() {}
    setTransformConstrain() {}
  };
  layer.getAttribution = () => "";
  layer._transformGL = () => {};
  layer._initGL();
  assert.equal(options.preserveDrawingBuffer, true);
});

test("CSS zoom retains the painted image until the scale transform is removed", () => {
  const { layer, view, calls } = bridge();
  layer._cssZooming = true;
  layer._zooming = true;
  view.zoom = 5;
  layer.getEvents().zoom.call(layer, { type: "zoom" });
  assert.equal(calls.length, 0, "no new camera image beneath the active CSS scale");
  layer.getEvents().zoomend.call(layer);
  assert.deepEqual(calls.map((call) => call[0]), ["transform", "position", "camera", "paint"]);
  assert.equal(layer._cssZooming, false);
  assert.equal(layer._zooming, false);
});

test("resize restores a painted camera without a deferred zoom transition", () => {
  const { layer, calls } = bridge();
  layer._resizeContainer = () => calls.push(["size"]);
  layer._glMap.resize = () => calls.push(["resize"]);
  layer.getEvents().resize.call(layer);
  assert.deepEqual(calls.map((call) => call[0]), ["size", "resize", "position", "camera", "paint"]);
});
