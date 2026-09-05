import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { historyDatabase, loadApp } from "./helpers/app-harness.js";

const ids = (strikes) => Array.from(strikes, (strike) => strike.id);
const strike = (id, time, lon = 0) => ({ id: String(id), time, lat: 0, lon });

test("late packets keep ordering and avoid traversing or copying the archive prefix", () => {
  const app = loadApp();
  app.ingestStrikes(Array.from({ length: 30000 }, (_, i) => strike(i, app.now() - 30000 + i)), false, false);
  let reads = 0;
  const timeline = new Proxy(app.state.strikeTimeline, {
    get(target, key) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key);
    },
  });
  app.state.strikeTimeline = timeline;
  app.ingestStrikes([strike("late", app.now() - 2.5)], false, false);
  assert.equal(app.state.strikeTimeline, timeline);
  assert.ok(reads < 200, `one late record read ${reads} archive elements`);
  assert.equal(app.state.strikes.size, 30000);
  const active = Array.from(timeline.slice(app.state.strikeTimelineStart));
  assert.equal(active.at(-3).id, "late");
  assert.equal(active[0].id, "1");
});

test("backfill, equal timestamps, duplicate packets, eviction and compaction retain newest records", () => {
  const app = loadApp();
  const input = Array.from({ length: 35000 }, (_, i) => strike(i, app.now() - 35000 + Math.floor(i / 2)));
  app.ingestStrikes(input.slice(30000), false, false);
  app.ingestStrikes(input.slice(0, 30000), false, false);
  app.ingestStrikes(input.slice(-100), false, false);
  const active = app.state.strikeTimeline.slice(app.state.strikeTimelineStart);
  assert.deepEqual(ids(active), ids(input.slice(-30000)));
  assert.equal(app.state.strikes.size, 30000);
  for (const cutoff of [app.now() - 40000, app.now() - 30000, app.now() - 20000, app.now()]) {
    assert.equal(app.state.strikeTimeline.length - app.timelineIndexAtOrAfter(cutoff),
      active.filter((row) => row.time >= cutoff).length);
  }
  app.advance(24 * 60 * 60 * 1000);
  app.trimMemory();
  assert.equal(app.state.strikes.size, 0);
});

test("oversized history loads the newest 30000 records, including timestamp ties", async () => {
  const app = loadApp();
  const input = Array.from({ length: 31000 }, (_, i) => strike(String(i).padStart(5, "0"), app.now() - 31000 + Math.floor(i / 7)));
  const history = historyDatabase(input);
  app.state.db = history.db;
  await app.loadHistory();
  assert.equal(app.state.loadedHistoryCount, 30000);
  assert.deepEqual([...app.state.strikes.keys()].sort(), input.slice(-30000).map((row) => row.id));
  assert.equal(history.calls.bulk, 1);
  assert.equal(history.calls.cursorCallbacks, 2);
  assert.deepEqual(history.calls.advances, [1000]);
  assert.equal(history.calls.bulkValues, 30006);
  assert.equal(app.state.lastStrike.time, input.at(-1).time);
});

test("history overflow by one record and an archive of tied timestamps keep the correct newest keys", async () => {
  for (const tied of [false, true]) {
    const app = loadApp();
    const input = Array.from({ length: 30001 }, (_, i) => strike(String(i).padStart(5, "0"),
      app.now() - (tied ? 0 : 30001 - i)));
    const history = historyDatabase([strike("expired", app.now() - 25 * 60 * 60 * 1000), ...input]);
    app.state.db = history.db;
    await app.loadHistory();
    assert.deepEqual([...app.state.strikes.keys()], input.slice(1).map((row) => row.id));
    assert.equal(history.calls.bulk, 1);
    assert.equal(history.calls.cursorCallbacks, 2);
    assert.deepEqual(history.calls.advances, [1]);
    assert.equal(history.calls.bulkValues, tied ? 30001 : 30000);
  }
});

test("normal history uses a bulk read and excludes expired records", async () => {
  const app = loadApp();
  const history = historyDatabase([
    strike("expired", app.now() - 25 * 60 * 60 * 1000), strike("recent", app.now()),
  ]);
  app.state.db = history.db;
  await app.loadHistory();
  assert.deepEqual([...app.state.strikes.keys()], ["recent"]);
  assert.equal(history.calls.bulk, 1);
  assert.equal(history.calls.cursors, 0);
});

test("live reception starts before cached and provider history finish and preserves early arrivals", async () => {
  const open = {};
  let providerStarted;
  const providerRequested = new Promise((resolve) => { providerStarted = resolve; });
  let completeProvider;
  const providerResponse = new Promise((resolve) => { completeProvider = resolve; });
  const app = loadApp({
    indexedDB: { open: () => open },
    fetch(url) {
      assert.equal(url, "/api/history?since_minutes=1440");
      providerStarted();
      return providerResponse;
    },
  });
  const history = historyDatabase([
    strike("shared", app.now() - 2000), strike("cached", app.now() - 3000),
  ], { paused: true });
  open.result = history.db;
  const starting = app.startReceiver();
  assert.equal(app.sockets.length, 0, "storage opens before receiving live data");
  open.onsuccess();
  await new Promise(setImmediate);
  assert.equal(app.sockets.length, 1, "cached history has not finished yet");
  assert.equal(app.state.strikes.size, 0);
  app.sockets[0].onmessage({ data: JSON.stringify({ strokes: [
    strike("live", app.now()), strike("shared", app.now() - 1),
  ] }) });
  assert.equal(app.state.pendingWrites.size, 2, "early live strikes are queued for storage");
  history.resume();
  await providerRequested;
  assert.equal(app.state.strikes.size, 3);
  completeProvider({ ok: true, json: async () => ({ configured: true, flashes: [
    strike("provider", app.now() - 4000), strike("shared", app.now() - 5000),
  ] }) });
  await starting;
  assert.equal(app.state.strikes.size, 4);
  assert.equal(app.state.lastStrike.id, "live");
  assert.equal(app.state.strikes.get("shared").time, app.now() - 1);
  assert.deepEqual(ids(app.state.strikeTimeline), ["provider", "cached", "shared", "live"]);
  assert.deepEqual([...app.state.pendingWrites.keys()].sort(), ["live", "provider", "shared"]);
});

test("storage failure permits live reception and startup respects a pending pause", async () => {
  for (const paused of [false, true]) {
    const open = {};
    const app = loadApp({ indexedDB: { open: () => open } });
    const starting = app.startReceiver();
    app.state.monitoringPaused = paused;
    open.onerror();
    await starting;
    assert.equal(app.state.db, null);
    assert.equal(app.sockets.length, paused ? 0 : 1);
  }
});

test("demo startup skips real storage, provider history and the live socket", async () => {
  let databaseOpens = 0;
  let requests = 0;
  const app = loadApp({
    search: "?demo=1",
    indexedDB: { open() { databaseOpens++; throw new Error("Unexpected database open"); } },
    fetch: async () => { requests++; return { ok: false }; },
  });
  await app.startReceiver();
  assert.equal(databaseOpens, 0);
  assert.equal(requests, 0);
  assert.equal(app.sockets.length, 0);
  assert.equal(app.state.strikes.size, 760);
  assert.ok([...app.state.strikes.keys()].every((id) => id.startsWith("demo:")));
  assert.equal(app.state.pendingWrites.size, 0);
  assert.notEqual(app.state.demoTimer, null);
});

test("markers stay in the counted world copy while panning and keep selection", () => {
  const app = loadApp();
  Object.assign(app.bounds, { west: 170, east: 190, south: -10, north: 10 });
  app.ingestStrikes([strike("dateline", app.now(), -175), strike("offscreen", app.now(), 0)], false, false);
  app.advance(500);
  const marker = app.state.strikeMarkers.get("dateline");
  assert.equal(app.els.visibleCount.textContent, "001");
  assert.equal(marker.getLatLng().lng, 185);
  assert.equal(app.markers.size, 1);
  marker.openPopup();
  assert.match(marker.popupContent(), /175\.00° W/);
  for (const [west, east, expected] of [[-190, -170, -175], [890, 910, 905]]) {
    Object.assign(app.bounds, { west, east });
    app.render();
    assert.equal(app.state.strikeMarkers.get("dateline"), marker);
    assert.equal(marker.getLatLng().lng, expected);
    assert.equal(app.state.selectedStrikeId, "dateline");
    assert.equal(marker.isPopupOpen(), true);
  }
  assert.equal(marker.moves, 2);
});

test("the final burst updates statistics at its deadline without another map render", () => {
  const app = loadApp();
  app.ingestStrikes([strike("initial", app.now())], false, false);
  app.advance(2000);
  const before = app.els.hotspotList.writes;
  app.ingestStrikes(Array.from({ length: 50 }, (_, i) => strike(`burst:${i}`, app.now())), false, false);
  app.advance(500);
  assert.equal(app.els.hotspotList.writes, before);
  const mapWrites = app.els.visibleCount.writes;
  app.advance(2500);
  assert.ok(app.els.hotspotList.writes > before);
  assert.match(app.els.hotspotList.innerHTML, /51 strikes/);
  assert.equal(app.els.globalRate.textContent, "10");
  assert.equal(app.els.visibleCount.writes, mapWrites);
  assert.equal(app.state.statsTimer, null);
});

test("latest strike DOM updates are batched and historical arrivals cannot replace it", () => {
  const app = loadApp();
  for (let i = 0; i < 100; i++) app.ingestStrikes([strike(i, app.now() + i)], false, false);
  assert.equal(app.els.latestLocation.writes, 0);
  app.advance(500);
  assert.equal(app.els.latestLocation.writes, 1);
  app.ingestStrikes([strike("old", app.now() - 10000)], false, false);
  app.advance(500);
  assert.equal(app.els.latestLocation.writes, 1);
  assert.equal(app.state.lastStrike.id, "99");
});

test("hidden pages cancel visual timers and refresh data once shown", () => {
  const app = loadApp();
  app.ingestStrikes([strike("one", app.now())], false, false);
  app.document.hidden = true;
  app.handleVisibilityChange();
  app.ingestStrikes([strike("two", app.now())], false, false);
  app.advance(6000);
  assert.equal(app.els.hotspotList.writes, 0);
  assert.equal(app.els.latestLocation.writes, 0);
  assert.equal(app.state.statsTimer, null);
  app.document.hidden = false;
  app.handleVisibilityChange();
  app.advance(500);
  assert.match(app.els.hotspotList.innerHTML, /2 strikes/);
  assert.equal(app.els.latestLocation.writes, 1);
});

test("window changes refresh statistics immediately and binary rate counts honor boundaries", () => {
  const app = loadApp();
  const ages = [0, 0, 0, 4, 5, 5, 6, 10, 10.01, 30, 59, 61];
  app.ingestStrikes(ages.map((age, i) => strike(i, app.now() - age * 60000)), false, false);
  app.advance(0);
  assert.equal(app.els.globalRate.textContent, "1");
  assert.equal(app.els.rateTrend.textContent, "↑ 200% vs previous 5m");
  assert.match(app.els.hotspotList.innerHTML, /9 strikes/);
  app.selectWindow("60");
  app.advance(0);
  assert.match(app.els.hotspotList.innerHTML, /11 strikes/);
  assert.equal(app.els.globalRate.textContent, "1");
});

test("distances are reused and invalidated only when the location coordinates change", () => {
  const app = loadApp();
  const row = strike("one", app.now());
  app.state.userLocation = { lat: 0, lon: 0 };
  assert.equal(app.strikeDistance(row), 0);
  const cache = app.state.distanceCache;
  // This cached sentinel proves subsequent calls do not redo the calculation.
  cache.set(row, 123);
  assert.equal(app.strikeDistance(row), 123);
  app.state.userLocation = { lat: 0, lon: 0, accuracy: 10 };
  assert.equal(app.strikeDistance(row), 123);
  app.state.radiusMiles = 50;
  assert.equal(app.strikeDistance(row), 123);
  app.state.userLocation.lon = 1;
  assert.ok(Math.abs(app.strikeDistance(row) - 69.09) < 0.1);
  assert.notEqual(app.state.distanceCache, cache);
  const movedCache = app.state.distanceCache;
  movedCache.set(row, 456);
  app.state.userLocation.lat = 1;
  assert.notEqual(app.strikeDistance(row), 456);
  assert.notEqual(app.state.distanceCache, movedCache);
  app.state.userLocation = null;
  assert.equal(app.strikeDistance(row), Infinity);
});

test("bar health validation rejects unrelated servers, bad JSON, wrong versions and paths", () => {
  const qml = readFileSync(new URL("../BarWidget.qml", import.meta.url), "utf8");
  const code = qml.match(/  function healthMatches\(output\) \{[\s\S]*?\n  \}/)[0];
  const canonicalSourceDir = "/tmp/Stormtrace with spaces";
  const appVersion = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
  const context = vm.createContext({ canonicalSourceDir, appVersion });
  vm.runInContext(code, context);
  const valid = { ok: true, app: "stormtrace", root: canonicalSourceDir, version: appVersion };
  assert.equal(context.healthMatches(JSON.stringify(valid)), true);
  assert.equal(context.healthMatches(JSON.stringify({ ...valid, root: `${canonicalSourceDir}/` })), true);
  for (const change of [{ ok: false }, { ok: "true" }, { app: "other" }, { version: "0.0.0" }, { root: "/tmp/other" }]) {
    assert.equal(context.healthMatches(JSON.stringify({ ...valid, ...change })), false);
  }
  for (const text of ["invalid", "null", "{}", "[]"]) assert.equal(context.healthMatches(text), false);
  context.canonicalSourceDir = "";
  assert.equal(context.healthMatches(JSON.stringify(valid)), false);
});
