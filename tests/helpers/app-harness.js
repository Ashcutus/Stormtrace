import { readFileSync } from "node:fs";
import vm from "node:vm";

// Run the actual application functions without starting a network feed or GTK.
// These exports exist only in the in-memory test copy of the script.
const source = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const exports = [
  "state", "els", "ingestStrikes", "appendStrikeTimeline", "trimMemory",
  "timelineIndexAtOrAfter", "displayLongitude", "strikeIsInBounds", "render",
  "scheduleStats", "selectWindow", "handleVisibilityChange", "strikeDistance",
  "updateProximityStats", "loadHistory", "storeStrikes", "flushStrikes", "startDemo",
  "startReceiver",
];

function element() {
  let value = "";
  let html = null;
  return {
    writes: 0,
    dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {} },
    addEventListener() {},
    get textContent() { return value; },
    set textContent(text) { this.writes++; value = String(text); html = null; },
    get innerHTML() { return html ?? value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); },
    set innerHTML(text) { this.writes++; html = text; },
  };
}

export function loadApp({ search = "", indexedDB, fetch = async () => ({ ok: true, json: async () => ({ available: false }) }) } = {}) {
  let now = 1800000000000;
  let nextTimer = 1;
  const timers = new Map();
  const elements = new Map();
  const sockets = [];
  const document = {
    hidden: false,
    body: element(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    querySelectorAll: () => [],
    createElement: element,
  };
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    Date: TestDate,
    location: { search },
    URLSearchParams,
    window: {},
    document,
    localStorage: { getItem: () => null, setItem() {} },
    fetch,
    indexedDB,
    WebSocket: class {
      constructor(url) { this.url = url; sockets.push(this); }
      close() {}
      send() {}
    },
    setTimeout(callback, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { callback, time: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, interval) {
      const id = nextTimer++;
      timers.set(id, { callback, time: now + interval, interval });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    IDBKeyRange: { lowerBound: (lower) => ({ lower }) },
    L: {
      circleMarker([lat, lng], options) {
        return {
          latlng: { lat, lng }, options, events: {}, popupOpen: false, tooltipOpen: false,
          moves: 0, styleWrites: 0,
          bindTooltip(content) { this.tooltipContent = content; return this; },
          bindPopup(content) { this.popupContent = content; return this; },
          on(event, callback) { this.events[event] = callback; return this; },
          addTo(layer) { layer.addLayer(this); return this; },
          getLatLng() { return this.latlng; },
          setLatLng([newLat, newLng]) { this.moves++; this.latlng = { lat: newLat, lng: newLng }; },
          setStyle(style) { this.styleWrites++; Object.assign(this.options, style); },
          setRadius(radius) { this.options.radius = radius; },
          setTooltipContent(content) { this.tooltipContent = content; },
          setPopupContent(content) { this.popupContent = content; },
          isPopupOpen() { return this.popupOpen; },
          isTooltipOpen() { return this.tooltipOpen; },
          openPopup() { this.popupOpen = true; this.events.popupopen(); },
          closePopup() { this.popupOpen = false; this.events.popupclose(); },
          closeTooltip() { this.tooltipOpen = false; },
          bringToFront() {},
        };
      },
    },
  });
  vm.runInContext(source.replace("  init();", `  globalThis.app = {${exports.join(",")}};`), context);
  const app = context.app;
  app.state.themeSignature = JSON.stringify({ available: false });
  const bounds = { south: -90, north: 90, west: -180, east: 180 };
  app.state.map = {
    getBounds: () => ({
      getSouth: () => bounds.south, getNorth: () => bounds.north,
      getWest: () => bounds.west, getEast: () => bounds.east,
    }),
  };
  const markers = new Set();
  app.state.strikeLayer = {
    addLayer(marker) { markers.add(marker); },
    removeLayer(marker) { markers.delete(marker); },
  };
  return {
    ...app, document, elements, bounds, markers, timers, sockets,
    now: () => now,
    advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.time <= target)
          .sort((a, b) => a[1].time - b[1].time || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].time;
        if (next[1].interval) next[1].time += next[1].interval;
        else timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
  };
}

// Model the ordering and asynchronous request callbacks of the time index.
export function historyDatabase(records, { paused = false } = {}) {
  const calls = { bulk: 0, cursors: 0, advances: [], cursorCallbacks: 0, bulkValues: 0 };
  const ascending = [...records].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pending = [];
  function enqueue(callback) {
    if (paused) pending.push(callback);
    else queueMicrotask(callback);
  }
  function request(result) {
    const req = { result };
    enqueue(() => req.onsuccess());
    return req;
  }
  const index = {
    count(range) { return request(ascending.filter((row) => row.time >= range.lower).length); },
    getAll(range, limit) {
      calls.bulk++;
      const result = ascending.filter((row) => row.time >= range.lower).slice(0, limit);
      calls.bulkValues += result.length;
      return request(result);
    },
    openKeyCursor(range) {
      calls.cursors++;
      const matching = ascending.filter((row) => row.time >= range.lower);
      let position = 0;
      const req = {};
      function next() {
        calls.cursorCallbacks++;
        req.result = position < matching.length ? {
          key: matching[position].time,
          primaryKey: matching[position].id,
          advance(count) { calls.advances.push(count); position += count; enqueue(next); },
        } : null;
        req.onsuccess();
      }
      enqueue(next);
      return req;
    },
  };
  return {
    calls,
    db: { transaction: () => ({ objectStore: () => ({ index: () => index }) }) },
    resume() { paused = false; pending.splice(0).forEach(queueMicrotask); },
  };
}
