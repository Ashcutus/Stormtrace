(() => {
  "use strict";

  const LIVE_WINDOW_MINUTES = 15;
  const HISTORY_HOURS = 24;
  const MAX_STORED_STRIKES = 30000;
  const MAX_RENDERED_STRIKES = 4000;
  const ALERT_COOLDOWN_MS = 2 * 60 * 1000;
  const FEED_URL = "wss://live2.lightningmaps.org/";
  const isDemo = new URLSearchParams(location.search).get("demo") === "1";

  const FALLBACK_PALETTE = {
    name: "Stormtrace default", mode: "dark",
    bg: "#09080d", surface: "#111019", surface2: "#171321", surface3: "#1d172a",
    text: "#f4efff", brightText: "#ffffff", muted: "#9d94ae", muted2: "#71697d",
    violet: "#a73cff", violetBright: "#c45cff", magenta: "#ff4fd8", cyan: "#68f2dc",
    blue: "#5960aa", yellow: "#ffd36b", danger: "#ff668b",
    line: "#2d2638", lineBright: "#4e3c66",
  };

  const REGIONS = [
    ["British Isles", 49, 61, -12, 3], ["Western Europe", 43, 55, -5, 16],
    ["Northern Europe", 55, 72, -10, 35], ["Mediterranean", 30, 45, -8, 38],
    ["Eastern Europe", 43, 60, 16, 42], ["West Africa", -2, 20, -20, 15],
    ["Central Africa", -12, 12, 15, 35], ["East Africa", -15, 15, 35, 52],
    ["Southern Africa", -36, -12, 12, 42], ["Middle East", 12, 40, 35, 62],
    ["Indian subcontinent", 5, 36, 62, 91], ["Bay of Bengal", 5, 24, 80, 100],
    ["Southeast Asia", -2, 28, 92, 113], ["Indonesia", -12, 8, 105, 142],
    ["East Asia", 20, 50, 110, 145], ["Japan & Pacific", 20, 52, 140, 180],
    ["Northern Australia", -27, -9, 112, 154], ["Southern Australia", -45, -27, 112, 155],
    ["New Zealand", -49, -33, 164, 180], ["Western United States", 25, 52, -130, -103],
    ["Central United States", 25, 52, -103, -88], ["Eastern United States", 25, 52, -88, -65],
    ["Mexico & Central America", 7, 30, -118, -77], ["Caribbean", 8, 28, -90, -58],
    ["Northern South America", -8, 15, -82, -50], ["Amazon Basin", -20, 2, -80, -45],
    ["Southern South America", -56, -20, -76, -35], ["Central Asia", 30, 57, 45, 90],
    ["North Atlantic", 0, 70, -70, -12], ["South Atlantic", -60, 0, -70, 12],
    ["Indian Ocean", -60, 12, 35, 112], ["North Pacific", 0, 65, -180, -118],
    ["South Pacific", -60, 0, 142, 180], ["South Pacific", -60, 0, -180, -76],
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const nativeBridge = window.webkit?.messageHandlers?.stormtrace || null;

  document.body.classList.toggle("native-shell", Boolean(nativeBridge));

  const els = {
    statusDot: $("#statusDot"),
    statusLabel: $("#statusLabel"),
    statusDetail: $("#statusDetail"),
    monitorButton: $("#monitorButton"),
    refreshButton: $("#refreshButton"),
    windowModeButton: $("#windowModeButton"),
    exitButton: $("#exitButton"),
    themeButton: $("#themeButton"),
    themeDialog: $("#themeDialog"),
    currentThemeName: $("#currentThemeName"),
    paletteGrid: $("#paletteGrid"),
    resetCustomTheme: $("#resetCustomTheme"),
    applyCustomTheme: $("#applyCustomTheme"),
    mapBrightness: $("#mapBrightness"),
    mapBrightnessValue: $("#mapBrightnessValue"),
    mapOpacity: $("#mapOpacity"),
    mapOpacityValue: $("#mapOpacityValue"),
    mapShade: $("#mapShade"),
    mapShadeValue: $("#mapShadeValue"),
    infoButton: $("#infoButton"),
    infoDialog: $("#infoDialog"),
    updatePanel: $("#updatePanel"),
    updateStatus: $("#updateStatus"),
    updateDetail: $("#updateDetail"),
    updateCommand: $("#updateCommand"),
    checkUpdateButton: $("#checkUpdateButton"),
    placeSearch: $("#placeSearch"),
    searchResults: $("#searchResults"),
    locationButton: $("#locationButton"),
    enableLocationButton: $("#enableLocationButton"),
    locationState: $("#locationState"),
    notificationToggle: $("#notificationToggle"),
    radiusRange: $("#radiusRange"),
    radiusValue: $("#radiusValue"),
    permissionNote: $("#permissionNote"),
    nearbyCount: $("#nearbyCount"),
    closestStrike: $("#closestStrike"),
    visibleCount: $("#visibleCount"),
    visibleWindow: $("#visibleWindow"),
    globalRate: $("#globalRate"),
    rateTrend: $("#rateTrend"),
    hotspotList: $("#hotspotList"),
    hotspotFocus: $("#hotspotFocus"),
    latestLocation: $("#latestLocation"),
    latestAge: $("#latestAge"),
    latestDistance: $("#latestDistance"),
    mapRegion: $("#mapRegion"),
    coordinates: $("#coordinates"),
    mapMessage: $("#mapMessage"),
    mapMessageTitle: $("#mapMessageTitle"),
    mapMessageBody: $("#mapMessageBody"),
    mapMessageAction: $("#mapMessageAction"),
    historyState: $("#historyState"),
    clock: $("#clock"),
    toastStack: $("#toastStack"),
  };

  const persisted = readSettings();
  const state = {
    map: null,
    tileLayer: null,
    strikeLayer: null,
    rangeLayer: null,
    homeLayer: null,
    strikes: new Map(),
    strikeTimeline: [],
    strikeTimelineStart: 0,
    pendingWrites: new Map(),
    writeTimer: null,
    databaseMaintenanceTimer: null,
    themeRefreshing: false,
    socket: null,
    socketRetry: null,
    retryCount: 0,
    connectedAt: 0,
    selectedWindow: persisted.window || "live",
    radiusMiles: persisted.radiusMiles || 20,
    notificationsEnabled: Boolean(persisted.notificationsEnabled),
    userLocation: persisted.userLocation || null,
    lastAlertAt: 0,
    lastStrike: null,
    strikeMarkers: new Map(),
    selectedStrikeId: null,
    hoveredStrikeId: null,
    renderTimer: null,
    statsTimer: null,
    lastStatsUpdate: 0,
    latestStrikeDirty: false,
    distanceCache: new WeakMap(),
    distanceLatitude: null,
    distanceLongitude: null,
    hotspots: [],
    hotspotSignature: null,
    db: null,
    demoTimer: null,
    loadedHistoryCount: 0,
    themeSource: persisted.themeSource === "custom" ? "custom" : "system",
    mapBrightness: readRangeSetting(persisted.mapBrightness, 100, 70, 140),
    mapOpacity: readRangeSetting(persisted.mapOpacity, 100, 55, 100),
    mapShade: readRangeSetting(persisted.mapShade, 45, 0, 60),
    systemPalette: FALLBACK_PALETTE,
    customPalette: persisted.customPalette || null,
    activePalette: FALLBACK_PALETTE,
    paletteVersion: 0,
    themeSignature: "",
    monitoringPaused: false,
  };

  init();

  async function init() {
    bindControls();
    updateClock();
    setInterval(() => { updateClock(); updateRelativeTimes(); }, 10000);
    updateRadiusUI();
    updateMapAppearanceUI();
    updateNotificationUI();
    await refreshOmarchyTheme();
    setInterval(refreshOmarchyTheme, 30000);
    setInterval(() => { trimMemory(); scheduleRender(); scheduleStats(); }, 60000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushStrikes);

    if (!window.L) {
      showMapMessage("Map engine unavailable", "The map library could not load. Check the connection, then retry.");
      setStatus("error", "OFFLINE", "Map library unavailable");
      return;
    }

    initMap();
    await startReceiver();
  }

  async function startReceiver() {
    if (isDemo) {
      startDemo();
      return;
    }

    state.db = await openDatabase().catch(() => null);
    if (state.db) scheduleDatabaseMaintenance(5000);
    // Open storage before receiving live strikes so early arrivals can persist.
    // Cached and provider history can then merge without delaying the feed.
    connectFeed();
    await loadHistory();
    await loadProviderHistory();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimeout(state.renderTimer);
      state.renderTimer = null;
      clearTimeout(state.statsTimer);
      state.statsTimer = null;
      flushStrikes();
    } else {
      state.latestStrikeDirty = true;
      updateClock();
      refreshOmarchyTheme();
      scheduleRender();
      scheduleStats(true);
    }
  }

  function initMap() {
    state.map = L.map("map", {
      center: [18, 6],
      zoom: 2,
      minZoom: 2,
      maxZoom: 12,
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      preferCanvas: true,
    });

    state.tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(state.map);
    applyMapAppearance();

    state.strikeLayer = L.layerGroup().addTo(state.map);
    state.rangeLayer = L.layerGroup().addTo(state.map);
    state.homeLayer = L.layerGroup().addTo(state.map);

    state.map.on("moveend zoomend", () => {
      updateMapReadout();
      scheduleRender();
    });
    updateMapReadout();
    updateLocationLayers();
  }

  function bindControls() {
    els.monitorButton.addEventListener("click", toggleMonitoring);
    els.refreshButton.addEventListener("click", reconnectFeed);
    els.windowModeButton.addEventListener("click", () => postNativeAction("toggle-fullscreen"));
    els.exitButton.addEventListener("click", () => {
      els.exitButton.disabled = true;
      postNativeAction("quit");
    });
    window.addEventListener("stormtrace:fullscreen-change", (event) => {
      updateWindowModeButton(Boolean(event.detail?.fullscreen));
    });
    els.themeButton.addEventListener("click", () => {
      syncThemeDialog();
      els.themeDialog.showModal();
    });
    els.infoButton.addEventListener("click", () => els.infoDialog.showModal());
    els.checkUpdateButton.addEventListener("click", checkForUpdates);
    els.mapMessageAction.addEventListener("click", () => location.reload());
    $("#zoomIn").addEventListener("click", () => state.map?.zoomIn());
    $("#zoomOut").addEventListener("click", () => state.map?.zoomOut());
    $("#worldView").addEventListener("click", () => state.map?.setView([18, 6], 2));
    els.locationButton.addEventListener("click", requestLocation);
    els.enableLocationButton.addEventListener("click", requestLocation);
    els.notificationToggle.addEventListener("change", toggleNotifications);
    els.radiusRange.addEventListener("input", () => {
      state.radiusMiles = Number(els.radiusRange.value);
      updateRadiusUI();
      updateLocationLayers();
      updateProximityStats();
      saveSettings();
    });
    els.hotspotFocus.addEventListener("click", () => focusHotspot(0));
    els.hotspotList.addEventListener("click", (event) => activateHotspotRow(event.target));
    els.hotspotList.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activateHotspotRow(event.target);
    });

    $$(".theme-source-button").forEach((button) => {
      button.addEventListener("click", () => selectThemeSource(button.dataset.themeSource));
    });
    els.paletteGrid.querySelectorAll('input[type="color"]').forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.paletteKey;
        state.customPalette = { ...(state.customPalette || editablePalette(state.systemPalette)), [key]: input.value };
        input.nextElementSibling.textContent = input.value;
      });
    });
    els.resetCustomTheme.addEventListener("click", () => {
      state.customPalette = editablePalette(state.systemPalette);
      selectThemeSource("custom");
      syncThemeDialog();
    });
    els.applyCustomTheme.addEventListener("click", () => {
      state.themeSource = "custom";
      applyActivePalette();
      saveSettings();
      syncThemeDialog();
      toast("Custom palette applied", "Stormtrace will keep this override until you return to Omarchy mode.");
    });

    els.mapBrightness.addEventListener("input", () => {
      state.mapBrightness = Number(els.mapBrightness.value);
      applyMapAppearance();
      saveSettings();
    });
    els.mapOpacity.addEventListener("input", () => {
      state.mapOpacity = Number(els.mapOpacity.value);
      applyMapAppearance();
      saveSettings();
    });
    els.mapShade.addEventListener("input", () => {
      state.mapShade = Number(els.mapShade.value);
      applyMapAppearance();
      saveSettings();
    });

    $$(".segment").forEach((button) => {
      button.addEventListener("click", () => selectWindow(button.dataset.window));
    });
    syncWindowButtons();

    els.placeSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runSearch(els.placeSearch.value);
      }
      if (event.key === "Escape") hideSearchResults();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".search-wrap")) hideSearchResults();
    });

    document.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (key === "f11") {
        event.preventDefault();
        postNativeAction("toggle-fullscreen");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "q") {
        event.preventDefault();
        postNativeAction("quit");
        return;
      }
      if (event.target.matches("input, textarea")) return;
      if (key === "/") {
        event.preventDefault();
        els.placeSearch.focus();
      } else if (key === "r") reconnectFeed();
      else if (key === "p") toggleMonitoring();
      else if (key === "l") selectWindow("live");
      else if (key === "g") requestLocation();
      else if (key === "n") {
        els.notificationToggle.checked = !els.notificationToggle.checked;
        toggleNotifications();
      } else if (key === "+" || key === "=") state.map?.zoomIn();
      else if (key === "-") state.map?.zoomOut();
    });
  }

  async function refreshOmarchyTheme() {
    if (document.hidden || state.themeRefreshing) return;
    state.themeRefreshing = true;
    try {
      const response = await fetch("/api/theme", { cache: "no-store" });
      if (!response.ok) throw new Error(`Theme endpoint returned ${response.status}`);
      const payload = await response.json();
      const signature = JSON.stringify(payload);
      if (signature === state.themeSignature) return;
      state.themeSignature = signature;
      state.systemPalette = payload.available ? paletteFromOmarchy(payload) : FALLBACK_PALETTE;
      if (!state.customPalette) state.customPalette = editablePalette(state.systemPalette);
      applyActivePalette();
      syncThemeDialog();
    } catch {
      state.systemPalette = FALLBACK_PALETTE;
      if (!state.customPalette) state.customPalette = editablePalette(FALLBACK_PALETTE);
      applyActivePalette();
    } finally {
      state.themeRefreshing = false;
    }
  }

  function paletteFromOmarchy(payload) {
    const colors = payload.colors || {};
    return {
      name: payload.name || "Omarchy",
      mode: payload.mode === "light" ? "light" : "dark",
      bg: validCssColor(colors.darker_background, FALLBACK_PALETTE.bg),
      surface: validCssColor(colors.dark_background, colors.background || FALLBACK_PALETTE.surface),
      surface2: validCssColor(colors.background, FALLBACK_PALETTE.surface2),
      surface3: validCssColor(colors.lighter_background, colors.selection || FALLBACK_PALETTE.surface3),
      text: validCssColor(colors.foreground, FALLBACK_PALETTE.text),
      brightText: validCssColor(colors.bright_foreground, colors.foreground || FALLBACK_PALETTE.brightText),
      muted: validCssColor(colors.muted, colors.dark_foreground || FALLBACK_PALETTE.muted),
      muted2: validCssColor(colors.dark_foreground, colors.muted || FALLBACK_PALETTE.muted2),
      violet: validCssColor(colors.accent, colors.magenta || FALLBACK_PALETTE.violet),
      violetBright: validCssColor(colors.bright_magenta, colors.accent || FALLBACK_PALETTE.violetBright),
      magenta: validCssColor(colors.magenta, colors.accent || FALLBACK_PALETTE.magenta),
      cyan: validCssColor(colors.cyan, FALLBACK_PALETTE.cyan),
      blue: validCssColor(colors.blue, FALLBACK_PALETTE.blue),
      yellow: validCssColor(colors.yellow, FALLBACK_PALETTE.yellow),
      danger: validCssColor(colors.red, FALLBACK_PALETTE.danger),
      line: validCssColor(colors.selection, FALLBACK_PALETTE.line),
      lineBright: validCssColor(colors.accent, FALLBACK_PALETTE.lineBright),
    };
  }

  function editablePalette(palette) {
    return Object.fromEntries(["bg", "surface", "surface2", "surface3", "text", "muted", "violet", "magenta", "cyan", "yellow"]
      .map((key) => [key, toHexColor(palette[key], FALLBACK_PALETTE[key])])) ;
  }

  function derivedCustomPalette(editable) {
    const base = { ...editablePalette(FALLBACK_PALETTE), ...(editable || {}) };
    return {
      ...base,
      name: "Custom",
      mode: colorLuminance(base.bg) > 0.58 ? "light" : "dark",
      brightText: mixHex(base.text, base.bg, 0.05),
      muted2: mixHex(base.muted, base.bg, 0.34),
      violetBright: mixHex(base.violet, base.text, 0.24),
      blue: mixHex(base.violet, base.cyan, 0.5),
      danger: mixHex(base.magenta, "#ff453a", 0.42),
      line: mixHex(base.surface3, base.text, 0.18),
      lineBright: mixHex(base.violet, base.text, 0.34),
    };
  }

  function applyActivePalette() {
    const palette = state.themeSource === "custom" ? derivedCustomPalette(state.customPalette) : state.systemPalette;
    state.activePalette = palette;
    state.paletteVersion += 1;
    const root = document.documentElement;
    const variables = {
      "--bg": palette.bg, "--surface": palette.surface, "--surface-2": palette.surface2,
      "--surface-3": palette.surface3, "--text": palette.text, "--bright-text": palette.brightText,
      "--muted": palette.muted, "--muted-2": palette.muted2, "--violet": palette.violet,
      "--violet-bright": palette.violetBright, "--magenta": palette.magenta, "--cyan": palette.cyan,
      "--blue": palette.blue, "--yellow": palette.yellow, "--danger": palette.danger,
      "--line": palette.line, "--line-bright": palette.lineBright,
    };
    Object.entries(variables).forEach(([key, value]) => root.style.setProperty(key, value));
    document.body.dataset.systemMode = palette.mode;
    els.themeButton.title = state.themeSource === "system" ? `Following Omarchy · ${state.systemPalette.name}` : "Custom Stormtrace palette";
    updateLocationLayers();
    scheduleRender();
  }

  function applyMapAppearance() {
    document.documentElement.style.setProperty("--map-brightness", String(state.mapBrightness / 100));
    document.documentElement.style.setProperty("--map-shade-opacity", String(state.mapShade / 100));
    state.tileLayer?.setOpacity(state.mapOpacity / 100);
    updateMapAppearanceUI();
  }

  function updateMapAppearanceUI() {
    const controls = [
      [els.mapBrightness, els.mapBrightnessValue, state.mapBrightness, 70, 140],
      [els.mapOpacity, els.mapOpacityValue, state.mapOpacity, 55, 100],
      [els.mapShade, els.mapShadeValue, state.mapShade, 0, 60],
    ];
    controls.forEach(([input, output, value, min, max]) => {
      if (!input || !output) return;
      input.value = String(value);
      output.textContent = `${value}%`;
      input.style.setProperty("--range-fill", `${((value - min) / (max - min)) * 100}%`);
    });
  }

  function selectThemeSource(source) {
    state.themeSource = source === "custom" ? "custom" : "system";
    if (!state.customPalette) state.customPalette = editablePalette(state.systemPalette);
    applyActivePalette();
    saveSettings();
    syncThemeDialog();
    if (state.themeSource === "system") toast("Following Omarchy", `${state.systemPalette.name} is now driving Stormtrace.`);
  }

  function syncThemeDialog() {
    if (!els.paletteGrid) return;
    els.currentThemeName.textContent = state.systemPalette.name || "Current system theme";
    $$(".theme-source-button").forEach((button) => button.classList.toggle("active", button.dataset.themeSource === state.themeSource));
    const sourcePalette = state.themeSource === "custom" ? (state.customPalette || editablePalette(state.systemPalette)) : editablePalette(state.systemPalette);
    els.paletteGrid.classList.toggle("system-locked", state.themeSource === "system");
    els.applyCustomTheme.disabled = state.themeSource === "system";
    els.paletteGrid.querySelectorAll('input[type="color"]').forEach((input) => {
      const value = toHexColor(sourcePalette[input.dataset.paletteKey], FALLBACK_PALETTE[input.dataset.paletteKey]);
      input.value = value;
      input.nextElementSibling.textContent = value;
    });
  }

  function validCssColor(value, fallback) {
    const candidate = String(value || "").trim();
    return /^#[0-9a-f]{3,8}$/i.test(candidate) || /^(rgb|hsl)a?\([0-9.,% +\/-]+\)$/i.test(candidate) ? candidate : fallback;
  }

  function toHexColor(value, fallback = "#000000") {
    const candidate = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(candidate)) return `#${candidate.slice(1).split("").map((char) => char + char).join("")}`.toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(fallback) ? fallback.toLowerCase() : "#000000";
  }

  function mixHex(first, second, amount) {
    const a = toHexColor(first).slice(1);
    const b = toHexColor(second).slice(1);
    const parts = [0, 2, 4].map((offset) => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(b.slice(offset, offset + 2), 16) * amount));
    return `#${parts.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function colorLuminance(hex) {
    const value = toHexColor(hex).slice(1);
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function setStatus(kind, label, detail) {
    els.statusDot.className = `pulse-dot ${kind === "live" ? "live" : kind === "error" ? "error" : kind === "paused" ? "paused" : ""}`;
    els.statusLabel.textContent = label;
    els.statusDetail.textContent = detail;
  }

  function connectFeed() {
    if (state.monitoringPaused) return;
    clearTimeout(state.socketRetry);
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
    }

    setStatus("connecting", "CONNECTING", state.retryCount ? `Retry ${state.retryCount}…` : "Opening global stream…");
    const socket = new WebSocket(FEED_URL);
    state.socket = socket;

    socket.onopen = () => {
      state.connectedAt = Date.now();
      state.retryCount = 0;
      const subscription = {
        v: 24, i: {}, s: false, x: 0, w: 0, tx: 0, tw: 1,
        a: 4, z: 2, b: true, h: "", l: 1, t: 1,
        p: [85, 180, -85, -180], r: "A",
      };
      socket.send(JSON.stringify(subscription));
      setStatus("live", "LIVE", "Global receiver connected");
      toast("Live receiver ready", "Listening for worldwide strikes.");
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (Array.isArray(payload.strokes) && payload.strokes.length) {
          ingestStrikes(payload.strokes, true);
        } else if (payload.cid) {
          setStatus("live", "LIVE", `${Number(payload.con || 0).toLocaleString()} viewers · receiver ${payload.port || "ready"}`);
        }
      } catch (error) {
        console.warn("Ignored an unreadable feed message", error);
      }
    };

    socket.onerror = () => setStatus("error", "DEGRADED", "Live receiver interrupted");
    socket.onclose = () => {
      if (state.socket !== socket || state.monitoringPaused) return;
      state.retryCount += 1;
      const delay = Math.min(30000, 1200 * 2 ** Math.min(5, state.retryCount));
      setStatus("error", "RECONNECTING", `Next attempt in ${Math.ceil(delay / 1000)}s`);
      state.socketRetry = setTimeout(connectFeed, delay);
    };
  }

  function reconnectFeed() {
    if (state.monitoringPaused) {
      toast("Monitoring paused", "Use the play control or press P to resume the live feed.");
      return;
    }
    if (isDemo) {
      stopDemo();
      startDemo();
      toast("Demo reset", "Generated a fresh deterministic activity field.");
      return;
    }
    state.retryCount = 0;
    connectFeed();
  }

  function toggleMonitoring() {
    if (state.monitoringPaused) resumeMonitoring();
    else pauseMonitoring();
  }

  function pauseMonitoring() {
    state.monitoringPaused = true;
    clearTimeout(state.socketRetry);
    state.socketRetry = null;
    if (state.socket) {
      state.socket.onclose = null;
      state.socket.close();
      state.socket = null;
    }
    stopDemo();
    setStatus("paused", "PAUSED", "Monitoring stopped · history remains available");
    updateMonitoringButton();
    toast("Monitoring paused", "Stormtrace is no longer listening for new strikes.");
  }

  function resumeMonitoring() {
    state.monitoringPaused = false;
    state.retryCount = 0;
    updateMonitoringButton();
    if (isDemo) resumeDemo();
    else connectFeed();
    toast("Monitoring resumed", "Stormtrace is listening for new strikes again.");
  }

  function updateMonitoringButton() {
    const paused = state.monitoringPaused;
    els.monitorButton.classList.toggle("is-paused", paused);
    els.monitorButton.setAttribute("aria-pressed", String(!paused));
    els.monitorButton.setAttribute("aria-label", paused ? "Resume monitoring" : "Pause monitoring");
    els.monitorButton.title = paused ? "Resume monitoring (P)" : "Pause monitoring (P)";
    els.monitorButton.querySelector(".monitor-pause-icon").toggleAttribute("hidden", paused);
    els.monitorButton.querySelector(".monitor-play-icon").toggleAttribute("hidden", !paused);
  }

  function postNativeAction(action) {
    if (!nativeBridge) return false;
    nativeBridge.postMessage(action);
    return true;
  }

  function updateWindowModeButton(fullscreen) {
    els.windowModeButton.setAttribute("aria-label", fullscreen ? "Restore window" : "Enter fullscreen");
    els.windowModeButton.title = fullscreen ? "Restore window (F11)" : "Enter fullscreen (F11)";
    els.windowModeButton.querySelector(".window-expand-icon").toggleAttribute("hidden", fullscreen);
    els.windowModeButton.querySelector(".window-restore-icon").toggleAttribute("hidden", !fullscreen);
  }

  async function checkForUpdates() {
    if (els.checkUpdateButton.disabled) return;
    els.checkUpdateButton.disabled = true;
    els.checkUpdateButton.textContent = "Checking…";
    els.updatePanel.dataset.state = "checking";
    els.updateStatus.textContent = "Checking the published version";
    els.updateDetail.textContent = "Contacting the Stormtrace repository…";
    els.updateCommand.hidden = true;

    try {
      const response = await fetch("/api/update", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || `Update check returned ${response.status}`);

      const current = `v${result.currentVersion}`;
      const latest = `v${result.latestVersion}`;
      if (result.updateAvailable) {
        setUpdateState("available", `${latest} is available`, `This installation is ${current}. Close Stormtrace, then run the command below.`);
        els.updateCommand.hidden = false;
      } else if (result.developmentBuild) {
        setUpdateState("ahead", "Development build", `${current} is newer than the published ${latest}.`);
      } else {
        setUpdateState("current", "Stormtrace is up to date", `${current} is the latest published version.`);
      }
    } catch (error) {
      setUpdateState("error", "Could not check for updates", error.message || "Check your network connection and try again.");
    } finally {
      els.checkUpdateButton.disabled = false;
      els.checkUpdateButton.textContent = "Check again";
    }
  }

  function setUpdateState(stateName, title, detail) {
    els.updatePanel.dataset.state = stateName;
    els.updateStatus.textContent = title;
    els.updateDetail.textContent = detail;
  }

  function normalizeStrike(raw) {
    const timeValue = raw.time || Date.now();
    const rawTime = typeof timeValue === "string" && !/^\d+(\.\d+)?$/.test(timeValue)
      ? Date.parse(timeValue.endsWith("Z") || /[+-]\d\d:\d\d$/.test(timeValue) ? timeValue : `${timeValue}Z`)
      : Number(timeValue);
    const time = rawTime > 1e15 ? Math.floor(rawTime / 1e6) : rawTime > 1e12 ? rawTime : rawTime * 1000;
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(time)) return null;
    const id = String(raw.id ?? `${time}:${lat.toFixed(5)}:${lon.toFixed(5)}`);
    return {
      id,
      time,
      lat,
      lon,
      region: describeRegion(lat, lon),
      deviation: Number(raw.dev || raw.mds || 0),
      polarity: Number(raw.pol || 0),
    };
  }

  function ingestStrikes(rawStrikes, isNew = false, persist = true) {
    const cutoff = Date.now() - HISTORY_HOURS * 60 * 60 * 1000;
    const additions = [];

    for (const raw of rawStrikes) {
      const strike = normalizeStrike(raw);
      if (!strike || strike.time < cutoff || state.strikes.has(strike.id)) continue;
      state.strikes.set(strike.id, strike);
      additions.push(strike);
    }

    if (!additions.length) return;
    additions.sort((a, b) => a.time - b.time);
    appendStrikeTimeline(additions);
    if (!state.lastStrike || additions.at(-1).time >= state.lastStrike.time) {
      state.lastStrike = additions.at(-1);
      state.latestStrikeDirty = true;
    }
    if (isNew) additions.forEach(checkProximityAlert);
    if (persist && state.db) storeStrikes(additions);
    trimMemory();
    scheduleRender();
    scheduleStats();
  }

  function appendStrikeTimeline(additions) {
    const timeline = state.strikeTimeline;
    if (!timeline.length || timeline.at(-1).time <= additions[0].time) {
      for (const strike of additions) timeline.push(strike);
      return;
    }

    // Late live packets usually belong near the tail. Move just that suffix
    // instead of copying the entire archive for each small packet.
    if (additions.length <= 64) {
      for (const strike of additions) {
        let low = state.strikeTimelineStart;
        let high = timeline.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (timeline[middle].time <= strike.time) low = middle + 1;
          else high = middle;
        }
        timeline.splice(low, 0, strike);
      }
      return;
    }

    const merged = [];
    let existingIndex = state.strikeTimelineStart;
    let additionIndex = 0;
    while (existingIndex < timeline.length && additionIndex < additions.length) {
      if (timeline[existingIndex].time <= additions[additionIndex].time) merged.push(timeline[existingIndex++]);
      else merged.push(additions[additionIndex++]);
    }
    while (existingIndex < timeline.length) merged.push(timeline[existingIndex++]);
    while (additionIndex < additions.length) merged.push(additions[additionIndex++]);
    state.strikeTimeline = merged;
    state.strikeTimelineStart = 0;
  }

  function trimMemory() {
    const cutoff = Date.now() - HISTORY_HOURS * 60 * 60 * 1000;
    const timeline = state.strikeTimeline;
    let index = state.strikeTimelineStart;
    while (index < timeline.length && (timeline[index].time < cutoff || state.strikes.size > MAX_STORED_STRIKES)) {
      state.strikes.delete(timeline[index].id);
      index += 1;
    }
    state.strikeTimelineStart = index;
    if (index >= 4096) {
      state.strikeTimeline = timeline.slice(index);
      state.strikeTimelineStart = 0;
    }
  }

  function timelineIndexAtOrAfter(time) {
    const timeline = state.strikeTimeline;
    let low = state.strikeTimelineStart;
    let high = timeline.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (timeline[middle].time < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function displayLongitude(longitude, bounds) {
    const center = (bounds.west + bounds.east) / 2;
    return longitude + 360 * Math.round((center - longitude) / 360);
  }

  function strikeIsInBounds(strike, bounds) {
    if (strike.lat < bounds.south || strike.lat > bounds.north) return false;
    const longitude = displayLongitude(strike.lon, bounds);
    return longitude >= bounds.west && longitude <= bounds.east;
  }

  function selectedCutoff() {
    const minutes = state.selectedWindow === "live" ? LIVE_WINDOW_MINUTES : Number(state.selectedWindow);
    return Date.now() - minutes * 60 * 1000;
  }

  function scheduleRender() {
    if (document.hidden || state.renderTimer !== null) return;
    state.renderTimer = setTimeout(() => {
      state.renderTimer = null;
      render();
    }, 500);
  }

  function scheduleStats(immediate = false) {
    if (document.hidden) return;
    if (immediate) {
      clearTimeout(state.statsTimer);
      state.statsTimer = null;
    }
    if (state.statsTimer !== null) return;
    const delay = immediate ? 0 : Math.max(0, 5000 - (Date.now() - state.lastStatsUpdate));
    state.statsTimer = setTimeout(() => {
      state.statsTimer = null;
      if (document.hidden) return;
      state.lastStatsUpdate = Date.now();
      const windowStart = timelineIndexAtOrAfter(selectedCutoff());
      updateRate(windowStart);
      updateHotspots(state.strikeTimeline, windowStart);
      updateProximityStats();
    }, delay);
  }

  function render() {
    if (document.hidden || !state.map || !state.strikeLayer) return;
    const cutoff = selectedCutoff();
    const mapBounds = state.map.getBounds();
    const bounds = {
      south: mapBounds.getSouth(),
      north: mapBounds.getNorth(),
      west: mapBounds.getWest(),
      east: mapBounds.getEast(),
    };
    const windowStart = timelineIndexAtOrAfter(cutoff);
    const timeline = state.strikeTimeline;
    const toRender = [];
    let visibleCount = 0;
    for (let index = timeline.length - 1; index >= windowStart; index -= 1) {
      const strike = timeline[index];
      if (!strikeIsInBounds(strike, bounds)) continue;
      visibleCount += 1;
      if (toRender.length < MAX_RENDERED_STRIKES) toRender.push(strike);
    }
    toRender.reverse();
    const renderIds = new Set();
    for (const strike of toRender) renderIds.add(strike.id);
    const now = Date.now();

    for (const [id, marker] of state.strikeMarkers) {
      if (renderIds.has(id)) continue;
      if (state.hoveredStrikeId === id) state.hoveredStrikeId = null;
      if (state.selectedStrikeId === id) {
        state.selectedStrikeId = null;
        marker.closePopup();
      }
      state.strikeLayer.removeLayer(marker);
      state.strikeMarkers.delete(id);
    }

    for (const strike of toRender) {
      let marker = state.strikeMarkers.get(strike.id);
      const longitude = displayLongitude(strike.lon, bounds);
      if (!marker) {
        marker = createStrikeMarker(strike, now, longitude);
        state.strikeMarkers.set(strike.id, marker);
      } else if (marker.getLatLng().lng !== longitude) {
        marker.setLatLng([strike.lat, longitude]);
      }
      updateStrikeMarkerVisual(marker, strike, now);
    }

    const selectedMarker = state.strikeMarkers.get(state.selectedStrikeId);
    if (selectedMarker?.isPopupOpen()) {
      selectedMarker.bringToFront();
    } else if (state.selectedStrikeId) {
      state.selectedStrikeId = null;
    }

    els.visibleCount.textContent = String(visibleCount).padStart(3, "0");
    const labels = { live: "Live · 15 min", 60: "Past hour", 360: "Past 6 hours", 1440: "Rolling 24 hours" };
    els.visibleWindow.textContent = `${labels[state.selectedWindow]} · map bounds`;
    if (state.latestStrikeDirty) {
      updateLatestStrike();
      state.latestStrikeDirty = false;
    }
  }

  function createStrikeMarker(strike, now, longitude = strike.lon) {
    const ageBand = strikeAgeBand(strike, now);
    const { radius, ...style } = strikePresentationForBand(ageBand);
    const marker = L.circleMarker([strike.lat, longitude], {
      ...style,
      radius,
      weight: 1,
      className: "strike-marker",
      bubblingMouseEvents: false,
    })
      .bindTooltip(() => strikeTooltip(strike), {
        className: "strike-tooltip",
        direction: "auto",
        sticky: false,
        offset: [0, -9],
        opacity: 1,
      })
      .bindPopup(() => strikePopup(strike), {
        className: "storm-popup",
        closeButton: true,
        closeOnClick: false,
        autoClose: true,
        autoPan: true,
        autoPanPadding: [24, 84],
        maxWidth: 280,
      })
      .on("mouseover", () => {
        if (state.selectedStrikeId === strike.id) {
          marker.closeTooltip();
          return;
        }
        state.hoveredStrikeId = strike.id;
        updateStrikeMarkerVisual(marker, strike);
        marker.bringToFront();
      })
      .on("mouseout", () => {
        if (state.hoveredStrikeId === strike.id) state.hoveredStrikeId = null;
        updateStrikeMarkerVisual(marker, strike);
        state.strikeMarkers.get(state.selectedStrikeId)?.bringToFront();
      })
      .on("popupopen", () => {
        const previousId = state.selectedStrikeId;
        state.selectedStrikeId = strike.id;
        if (state.hoveredStrikeId === strike.id) state.hoveredStrikeId = null;
        marker.closeTooltip();
        if (previousId && previousId !== strike.id) {
          const previousMarker = state.strikeMarkers.get(previousId);
          if (previousMarker) updateStrikeMarkerVisual(previousMarker, state.strikes.get(previousId));
        }
        updateStrikeMarkerVisual(marker, strike);
        marker.bringToFront();
      })
      .on("popupclose", () => {
        if (state.selectedStrikeId === strike.id) state.selectedStrikeId = null;
        updateStrikeMarkerVisual(marker, strike);
      })
      .addTo(state.strikeLayer);

    marker.stormtraceVisual = `${state.paletteVersion}:${ageBand}:false:false`;
    return marker;
  }

  function strikeAgeBand(strike, now) {
    const ageMinutes = (now - strike.time) / 60000;
    return ageMinutes < 5 ? 0 : ageMinutes < 60 ? 1 : 2;
  }

  function strikePresentationForBand(ageBand) {
    const palette = state.activePalette;
    if (ageBand === 0) {
      return { color: palette.magenta, fillColor: palette.magenta, radius: 4.8, opacity: 0.95, fillOpacity: 0.76 };
    }
    if (ageBand === 1) {
      return { color: palette.violet, fillColor: palette.violet, radius: 4.1, opacity: 0.84, fillOpacity: 0.62 };
    }
    return { color: palette.blue, fillColor: palette.blue, radius: 3.6, opacity: 0.64, fillOpacity: 0.44 };
  }

  function updateStrikeMarkerVisual(marker, strike, now = Date.now()) {
    if (!marker || !strike) return;
    const selected = state.selectedStrikeId === strike.id;
    const hovered = state.hoveredStrikeId === strike.id;
    const ageBand = strikeAgeBand(strike, now);
    const signature = `${state.paletteVersion}:${ageBand}:${selected}:${hovered}`;
    if (marker.stormtraceVisual === signature) return;
    marker.stormtraceVisual = signature;
    const { radius, ...style } = strikePresentationForBand(ageBand);
    marker.setStyle({
      ...style,
      opacity: selected ? 1 : style.opacity,
      fillOpacity: Math.min(1, style.fillOpacity + (selected ? 0.18 : hovered ? 0.1 : 0)),
      weight: selected ? 2.4 : hovered ? 1.8 : 1,
    });
    marker.setRadius(radius + (selected ? 2.2 : hovered ? 1.4 : 0));
  }

  function strikePopup(strike) {
    const age = relativeAge(strike.time);
    const deviation = strike.deviation > 0 ? `${Math.round(strike.deviation).toLocaleString()} m` : "Not reported";
    const polarity = strike.polarity > 0 ? "Positive" : strike.polarity < 0 ? "Negative" : "Unknown";
    const distance = state.userLocation
      ? `<div class="strike-detail"><span>Distance</span><strong>${formatMiles(strikeDistance(strike))}</strong></div>`
      : "";
    return `<div class="strike-popup-content">
      <div class="strike-popup-heading"><span class="strike-popup-icon">ϟ</span><div><strong>LIGHTNING STRIKE</strong><span>${escapeHtml(strike.region)}</span></div></div>
      <div class="strike-detail"><span>Detected</span><strong>${age}</strong></div>
      <div class="strike-detail"><span>Time (UTC)</span><strong>${formatStrikeTime(strike.time)}</strong></div>
      <div class="strike-detail"><span>Coordinates</span><strong>${formatCoordinates(strike.lat, strike.lon)}</strong></div>
      <div class="strike-detail"><span>Location uncertainty</span><strong>${deviation}</strong></div>
      <div class="strike-detail"><span>Polarity</span><strong>${polarity}</strong></div>
      ${distance}
    </div>`;
  }

  function strikeTooltip(strike) {
    return `<div class="strike-tooltip-content"><strong>ϟ ${escapeHtml(strike.region)}</strong><span>${relativeAge(strike.time)} · ${formatCoordinates(strike.lat, strike.lon)}</span></div>`;
  }

  function formatStrikeTime(time) {
    return new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");
  }

  function updateRate(start) {
    const now = Date.now();
    const recentCutoff = now - 5 * 60 * 1000;
    const previousCutoff = now - 10 * 60 * 1000;
    const recentStart = Math.max(start, timelineIndexAtOrAfter(recentCutoff));
    const previousStart = Math.max(start, timelineIndexAtOrAfter(previousCutoff));
    const recent = state.strikeTimeline.length - recentStart;
    const previous = recentStart - previousStart;
    const rate = Math.round(recent / 5);
    els.globalRate.textContent = rate.toLocaleString();
    if (!previous) {
      els.rateTrend.textContent = recent ? "Establishing trend" : "Collecting baseline";
    } else {
      const trend = Math.round(((recent - previous) / previous) * 100);
      els.rateTrend.textContent = `${trend >= 0 ? "↑" : "↓"} ${Math.abs(trend)}% vs previous 5m`;
      els.rateTrend.style.color = trend >= 0 ? "var(--cyan)" : "var(--muted)";
    }
  }

  function updateHotspots(strikes, start) {
    const now = Date.now();
    const cutoff = now - 60 * 60 * 1000;
    const recentCutoff = now - 10 * 60 * 1000;
    const groups = new Map();
    for (let index = strikes.length - 1; index >= start; index -= 1) {
      const strike = strikes[index];
      if (strike.time < cutoff) break;
      const name = strike.region;
      const current = groups.get(name) || { name, count: 0, recent: 0, latTotal: 0, lonTotal: 0 };
      current.count += 1;
      if (strike.time > recentCutoff) current.recent += 1;
      current.latTotal += strike.lat;
      current.lonTotal += strike.lon;
      groups.set(name, current);
    }

    state.hotspots = [...groups.values()]
      .map((item) => ({ ...item, lat: item.latTotal / item.count, lon: item.lonTotal / item.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const signature = state.hotspots
      .map((hotspot) => `${hotspot.name}:${hotspot.count}:${hotspot.recent}:${hotspot.lat.toFixed(3)}:${hotspot.lon.toFixed(3)}`)
      .join("|");
    if (signature === state.hotspotSignature) return;
    state.hotspotSignature = signature;

    if (!state.hotspots.length) {
      els.hotspotList.innerHTML = '<div class="empty-state">Waiting for enough strikes to identify active cells…</div>';
      els.hotspotFocus.disabled = true;
      return;
    }

    els.hotspotFocus.disabled = false;
    const max = state.hotspots[0].count;
    els.hotspotList.innerHTML = state.hotspots.map((hotspot, index) => `
      <div class="hotspot-row" data-index="${index}" role="button" tabindex="0">
        <span class="hotspot-rank">${String(index + 1).padStart(2, "0")}</span>
        <div class="hotspot-main">
          <div class="hotspot-name-row"><span class="hotspot-name">${escapeHtml(hotspot.name)}</span><span class="hotspot-count">${hotspot.count.toLocaleString()} strikes</span></div>
          <div class="hotspot-bar"><i style="width:${Math.max(8, (hotspot.count / max) * 100)}%"></i></div>
        </div>
        <span class="hotspot-trend">+${hotspot.recent}</span>
      </div>
    `).join("");
  }

  function focusHotspot(index) {
    const hotspot = state.hotspots[index];
    if (hotspot) state.map?.flyTo([hotspot.lat, hotspot.lon], 5, { duration: 1.1 });
  }

  function activateHotspotRow(target) {
    const row = target.closest?.(".hotspot-row");
    if (row) focusHotspot(Number(row.dataset.index));
  }

  function describeRegion(lat, lon) {
    const match = REGIONS.find(([, minLat, maxLat, minLon, maxLon]) => lat >= minLat && lat < maxLat && lon >= minLon && lon < maxLon);
    return match?.[0] || `${Math.abs(Math.round(lat))}°${lat >= 0 ? "N" : "S"} / ${Math.abs(Math.round(lon))}°${lon >= 0 ? "E" : "W"}`;
  }

  function updateLatestStrike() {
    if (document.hidden || !state.lastStrike) return;
    els.latestLocation.textContent = `${state.lastStrike.region} · ${formatCoordinates(state.lastStrike.lat, state.lastStrike.lon)}`;
    els.latestAge.dataset.time = String(state.lastStrike.time);
    els.latestAge.textContent = relativeAge(state.lastStrike.time);
    if (state.userLocation) {
      const distance = strikeDistance(state.lastStrike);
      els.latestDistance.textContent = `${formatMiles(distance)} from your location`;
    } else {
      els.latestDistance.textContent = state.lastStrike.deviation > 0
        ? `Location uncertainty ${Math.round(state.lastStrike.deviation).toLocaleString()} m`
        : "Location uncertainty not reported";
    }
  }

  function updateRelativeTimes() {
    if (document.hidden) return;
    updateOpenStrikeDetails(state.selectedStrikeId);
    if (state.hoveredStrikeId !== state.selectedStrikeId) updateOpenStrikeDetails(state.hoveredStrikeId);
    if (state.lastStrike) els.latestAge.textContent = relativeAge(state.lastStrike.time);
  }

  function updateOpenStrikeDetails(id) {
    if (id === null) return;
    const marker = state.strikeMarkers.get(id);
    const strike = state.strikes.get(id);
    if (!marker || !strike) return;
    if (marker.isTooltipOpen()) marker.setTooltipContent(() => strikeTooltip(strike));
    if (marker.isPopupOpen()) marker.setPopupContent(() => strikePopup(strike));
  }

  function updateMapReadout() {
    if (!state.map) return;
    const center = state.map.getCenter();
    els.coordinates.textContent = formatCoordinates(center.lat, center.lng);
    els.mapRegion.textContent = state.map.getZoom() <= 2 ? "WORLD VIEW" : describeRegion(center.lat, center.lng).toUpperCase();
  }

  function selectWindow(windowValue) {
    state.selectedWindow = String(windowValue);
    syncWindowButtons();
    saveSettings();
    scheduleRender();
    scheduleStats(true);
  }

  function syncWindowButtons() {
    $$(".segment").forEach((button) => button.classList.toggle("active", button.dataset.window === state.selectedWindow));
  }

  async function requestLocation() {
    if (!navigator.geolocation) {
      toast("Location unavailable", "This app does not provide geolocation.");
      return false;
    }
    els.enableLocationButton.disabled = true;
    els.enableLocationButton.textContent = "Locating…";
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          state.userLocation = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy };
          updateLocationLayers();
          updateLocationUI();
          updateLatestStrike();
          updateProximityStats();
          saveSettings();
          state.map?.flyTo([state.userLocation.lat, state.userLocation.lon], 6, { duration: 1.1 });
          toast("Location set", `${formatCoordinates(state.userLocation.lat, state.userLocation.lon)} · stored on this device.`);
          resolve(true);
        },
        (error) => {
          els.enableLocationButton.disabled = false;
          els.enableLocationButton.textContent = "Try location again";
          els.permissionNote.textContent = error.code === 1 ? "Location permission was declined. Check your system privacy settings." : "Your position could not be determined. Try again in a moment.";
          toast("Location not set", els.permissionNote.textContent);
          resolve(false);
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 15 * 60 * 1000 },
      );
    });
  }

  function updateLocationUI() {
    if (!state.userLocation) return;
    els.locationState.innerHTML = `
      <span class="target-icon">⌾</span>
      <div><strong>${formatCoordinates(state.userLocation.lat, state.userLocation.lon)}</strong><span>Monitoring a ${state.radiusMiles}-mile safety radius.</span></div>`;
    els.enableLocationButton.disabled = false;
    els.enableLocationButton.textContent = "Update current location";
  }

  function updateLocationLayers() {
    if (!state.map || !state.rangeLayer || !state.homeLayer) return;
    state.rangeLayer.clearLayers();
    state.homeLayer.clearLayers();
    if (!state.userLocation) return;
    L.circle([state.userLocation.lat, state.userLocation.lon], {
      radius: state.radiusMiles * 1609.344,
      color: state.activePalette.violet,
      weight: 1,
      opacity: 0.8,
      fillColor: state.activePalette.violet,
      fillOpacity: 0.07,
      dashArray: "5 6",
    }).addTo(state.rangeLayer);
    L.marker([state.userLocation.lat, state.userLocation.lon], {
      icon: L.divIcon({ className: "", html: '<div class="home-marker"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      zIndexOffset: 1000,
    }).addTo(state.homeLayer);
    updateLocationUI();
  }

  async function toggleNotifications() {
    if (!els.notificationToggle.checked) {
      state.notificationsEnabled = false;
      updateNotificationUI();
      saveSettings();
      toast("Proximity alerts paused", "The 20-mile monitor remains visible on the map.");
      return;
    }

    if (!state.userLocation && !(await requestLocation())) {
      els.notificationToggle.checked = false;
      return;
    }
    if (!("Notification" in window)) {
      els.notificationToggle.checked = false;
      toast("Notifications unavailable", "This app does not support desktop notifications.");
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    state.notificationsEnabled = permission === "granted";
    updateNotificationUI();
    saveSettings();
    if (state.notificationsEnabled) toast("Proximity alerts armed", `You’ll be notified about strikes within ${state.radiusMiles} miles.`);
    else toast("Permission needed", "Enable desktop notifications for Stormtrace.");
  }

  function updateNotificationUI() {
    els.notificationToggle.checked = state.notificationsEnabled;
    const permission = "Notification" in window ? Notification.permission : "unsupported";
    if (permission === "denied") {
      els.permissionNote.textContent = "Desktop notifications are blocked. Location stays on this device.";
    } else if (state.notificationsEnabled) {
      els.permissionNote.textContent = `Armed with a 2-minute cooldown. Location and alerts remain on this device.`;
    } else {
      els.permissionNote.textContent = "Notifications remain on this device. Location is never uploaded.";
    }
  }

  function updateRadiusUI() {
    els.radiusRange.value = String(state.radiusMiles);
    els.radiusValue.textContent = String(state.radiusMiles);
    const fill = ((state.radiusMiles - 5) / 45) * 100;
    els.radiusRange.style.setProperty("--range-fill", `${fill}%`);
    updateLocationUI();
  }

  function updateProximityStats() {
    if (!state.userLocation) {
      els.nearbyCount.textContent = "—";
      els.closestStrike.textContent = "—";
      return;
    }
    const cutoff = Date.now() - 60 * 60 * 1000;
    const timeline = state.strikeTimeline;
    const start = timelineIndexAtOrAfter(cutoff);
    let nearbyCount = 0;
    let closestDistance = Infinity;
    for (let index = start; index < timeline.length; index += 1) {
      const strike = timeline[index];
      const distance = strikeDistance(strike);
      if (distance <= state.radiusMiles) nearbyCount += 1;
      if (distance < closestDistance) closestDistance = distance;
    }
    els.nearbyCount.textContent = nearbyCount.toLocaleString();
    els.closestStrike.textContent = Number.isFinite(closestDistance) ? formatMiles(closestDistance) : "—";
  }

  function checkProximityAlert(strike) {
    if (!state.notificationsEnabled || !state.userLocation || !("Notification" in window) || Notification.permission !== "granted") return;
    if (Date.now() - state.lastAlertAt < ALERT_COOLDOWN_MS) return;
    const distance = strikeDistance(strike);
    if (distance > state.radiusMiles) return;
    state.lastAlertAt = Date.now();
    const notification = new Notification("Lightning inside your safety radius", {
      body: `${formatMiles(distance)} away · ${strike.region} · detected just now`,
      icon: "/icon.svg",
      tag: "stormtrace-nearby",
    });
    notification.onclick = () => {
      window.focus();
      state.map?.flyTo([strike.lat, strike.lon], 9);
      notification.close();
    };
    setTimeout(() => notification.close(), 12000);
    toast("Nearby lightning detected", `${formatMiles(distance)} from your location.`);
  }

  async function runSearch(query) {
    const value = query.trim();
    if (!value) return;
    const coordinateMatch = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]);
      const lon = Number(coordinateMatch[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        state.map?.flyTo([lat, lon], 7, { duration: 1 });
        els.placeSearch.value = formatCoordinates(lat, lon);
        hideSearchResults();
        return;
      }
    }

    els.searchResults.hidden = false;
    els.searchResults.innerHTML = '<div class="empty-state" style="padding:9px">Searching map index…</div>';
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(value)}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Search returned ${response.status}`);
      const results = await response.json();
      showSearchResults(results);
    } catch {
      els.searchResults.innerHTML = '<div class="empty-state" style="padding:9px">Place search is offline. Coordinates still work.</div>';
    }
  }

  function showSearchResults(results) {
    if (!results.length) {
      els.searchResults.innerHTML = '<div class="empty-state" style="padding:9px">No matching place found.</div>';
      return;
    }
    els.searchResults.innerHTML = results.map((result, index) => {
      const [primary, ...rest] = result.display_name.split(",");
      return `<button class="search-result" data-index="${index}" role="option">${escapeHtml(primary)}<small>${escapeHtml(rest.slice(0, 3).join(",").trim())}</small></button>`;
    }).join("");
    els.searchResults.querySelectorAll(".search-result").forEach((button) => {
      button.addEventListener("click", () => {
        const result = results[Number(button.dataset.index)];
        state.map?.flyTo([Number(result.lat), Number(result.lon)], 7, { duration: 1 });
        els.placeSearch.value = result.display_name.split(",").slice(0, 2).join(",");
        hideSearchResults();
      });
    });
  }

  function hideSearchResults() { els.searchResults.hidden = true; }

  function showMapMessage(title, body) {
    els.mapMessageTitle.textContent = title;
    els.mapMessageBody.textContent = body;
    els.mapMessage.hidden = false;
  }

  function toast(title, body) {
    const node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = `<i>ϟ</i><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`;
    els.toastStack.append(node);
    setTimeout(() => node.remove(), 5000);
  }

  function updateClock() {
    if (document.hidden) return;
    els.clock.textContent = `UTC ${new Date().toISOString().slice(11, 16)}`;
  }

  function relativeAge(time) {
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  }

  function formatCoordinates(lat, lon) {
    return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"} / ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
  }

  function formatMiles(miles) {
    if (!Number.isFinite(miles)) return "—";
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles).toLocaleString()} mi`;
  }

  function strikeDistance(strike) {
    if (!state.userLocation) return Infinity;
    const { lat, lon } = state.userLocation;
    if (state.distanceLatitude !== lat || state.distanceLongitude !== lon) {
      state.distanceCache = new WeakMap();
      state.distanceLatitude = lat;
      state.distanceLongitude = lon;
    }
    let distance = state.distanceCache.get(strike);
    if (distance === undefined) {
      distance = haversineMiles(lat, lon, strike.lat, strike.lon);
      state.distanceCache.set(strike, distance);
    }
    return distance;
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRadians = (value) => value * Math.PI / 180;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = String(value ?? "");
    return span.innerHTML;
  }

  function readSettings() {
    try { return JSON.parse(localStorage.getItem("stormtrace:settings") || "{}"); }
    catch { return {}; }
  }

  function readRangeSetting(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function saveSettings() {
    localStorage.setItem("stormtrace:settings", JSON.stringify({
      window: state.selectedWindow,
      radiusMiles: state.radiusMiles,
      notificationsEnabled: state.notificationsEnabled,
      userLocation: state.userLocation,
      themeSource: state.themeSource,
      customPalette: state.customPalette,
      mapBrightness: state.mapBrightness,
      mapOpacity: state.mapOpacity,
      mapShade: state.mapShade,
    }));
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("stormtrace", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("strikes", { keyPath: "id" });
        store.createIndex("time", "time");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function loadHistory() {
    if (!state.db) return Promise.resolve();
    return new Promise((resolve) => {
      const transaction = state.db.transaction("strikes", "readonly");
      const index = transaction.objectStore("strikes").index("time");
      const range = IDBKeyRange.lowerBound(Date.now() - HISTORY_HOURS * 60 * 60 * 1000);
      const finish = (records) => {
        state.loadedHistoryCount = records.length;
        ingestStrikes(records, false, false);
        els.historyState.textContent = records.length ? `${records.length.toLocaleString()} cached strikes` : "Building from this session";
        resolve();
      };
      const readFrom = (lowerBound, trim = false) => {
        const request = index.getAll(lowerBound);
        request.onsuccess = () => {
          const records = request.result || [];
          finish(trim ? records.slice(-MAX_STORED_STRIKES) : records);
        };
        request.onerror = () => resolve();
      };
      const count = index.count(range);
      count.onerror = () => resolve();
      transaction.onabort = () => resolve();
      count.onsuccess = () => {
        if (count.result <= MAX_STORED_STRIKES) {
          // Keep the usual startup path as one bulk read.
          readFrom(range);
          return;
        }
        // Skip discarded keys without materializing every retained record in a
        // cursor callback. Include the boundary timestamp's ties in the bulk
        // read, then trim their oldest primary keys to keep exactly the newest.
        const request = index.openKeyCursor(range);
        let skipped = false;
        request.onerror = () => resolve();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { finish([]); return; }
          if (!skipped) {
            skipped = true;
            cursor.advance(count.result - MAX_STORED_STRIKES);
          } else {
            readFrom(IDBKeyRange.lowerBound(cursor.key), true);
          }
        };
      };
    });
  }

  function storeStrikes(strikes) {
    strikes.forEach((strike) => state.pendingWrites.set(strike.id, strike));
    if (state.pendingWrites.size >= 1000) flushStrikes();
    else if (state.writeTimer === null) state.writeTimer = setTimeout(flushStrikes, 2000);
  }

  function flushStrikes() {
    clearTimeout(state.writeTimer);
    state.writeTimer = null;
    if (!state.db || !state.pendingWrites.size) return;
    const strikes = [...state.pendingWrites.values()];
    state.pendingWrites.clear();
    try {
      const transaction = state.db.transaction("strikes", "readwrite");
      const store = transaction.objectStore("strikes");
      strikes.forEach((strike) => store.put(strike));
      transaction.oncomplete = () => scheduleDatabaseMaintenance();
    } catch { /* private-mode quota or a closing tab */ }
  }

  function scheduleDatabaseMaintenance(delay = 60000) {
    if (state.databaseMaintenanceTimer !== null) return;
    state.databaseMaintenanceTimer = setTimeout(() => {
      state.databaseMaintenanceTimer = null;
      pruneDatabase();
    }, delay);
  }

  function pruneDatabase() {
    if (!state.db) return;
    try {
      const transaction = state.db.transaction("strikes", "readwrite");
      const store = transaction.objectStore("strikes");
      const index = store.index("time");
      const range = IDBKeyRange.upperBound(Date.now() - HISTORY_HOURS * 60 * 60 * 1000);
      index.openCursor(range).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      transaction.oncomplete = capDatabase;
    } catch { /* database may be closing */ }
  }

  function capDatabase() {
    if (!state.db) return;
    try {
      const transaction = state.db.transaction("strikes", "readwrite");
      const store = transaction.objectStore("strikes");
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        let remaining = Math.max(0, countRequest.result - MAX_STORED_STRIKES);
        if (!remaining) return;
        store.index("time").openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && remaining > 0) {
            cursor.delete();
            remaining -= 1;
            cursor.continue();
          }
        };
      };
    } catch { /* database may be closing */ }
  }

  async function loadProviderHistory() {
    try {
      const response = await fetch("/api/history?since_minutes=1440");
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.configured && Array.isArray(payload.flashes)) {
        ingestStrikes(payload.flashes, false, true);
        els.historyState.textContent = `${payload.flashes.length.toLocaleString()} provider strikes`;
      }
    } catch { /* optional backfill is deliberately silent */ }
  }

  function startDemo() {
    stopDemo();
    state.strikes.clear();
    state.strikeTimeline.length = 0;
    state.strikeTimelineStart = 0;
    state.lastStrike = null;
    const seedStrikes = generateDemoStrikes(760);
    ingestStrikes(seedStrikes, false, false);
    resumeDemo();
  }

  function resumeDemo() {
    stopDemo();
    if (state.monitoringPaused) return;
    setStatus("live", "DEMO", "Simulated global receiver");
    els.historyState.textContent = "24h demonstration archive";
    state.demoTimer = setInterval(() => {
      const strike = generateDemoStrikes(1, true);
      ingestStrikes(strike, true, false);
    }, 2300);
  }

  function stopDemo() {
    clearInterval(state.demoTimer);
    state.demoTimer = null;
  }

  function generateDemoStrikes(count, current = false) {
    const centers = [
      { lat: -2, lon: 118, spread: 8, weight: 1.4 },
      { lat: 4, lon: 24, spread: 10, weight: 1.2 },
      { lat: 17, lon: -91, spread: 7, weight: 0.9 },
      { lat: 31, lon: -96, spread: 9, weight: 1.0 },
      { lat: 23, lon: 82, spread: 9, weight: 1.15 },
      { lat: -12, lon: -59, spread: 10, weight: 0.8 },
      { lat: 46, lon: 14, spread: 7, weight: 0.6 },
    ];
    let seed = current ? Date.now() >>> 0 : 724193;
    const random = () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const weighted = centers.flatMap((center) => Array(Math.ceil(center.weight * 5)).fill(center));
    return Array.from({ length: count }, (_, index) => {
      const center = weighted[Math.floor(random() * weighted.length)];
      const age = current ? random() * 4000 : Math.pow(random(), 1.75) * HISTORY_HOURS * 60 * 60 * 1000;
      const lat = Math.max(-82, Math.min(82, center.lat + (random() - 0.5) * center.spread));
      const lon = center.lon + (random() - 0.5) * center.spread * 1.6;
      return { id: `demo:${current ? Date.now() : 1}:${index}:${Math.round(random() * 1e7)}`, time: Date.now() - age, lat, lon, dev: 250 + random() * 6000 };
    });
  }
})();
