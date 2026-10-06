(() => {
  "use strict";

  const SETTINGS_KEY = "stormtrace:settings";

  function readSettings(storage = globalThis.StormtracePlatform.settingsStorage) {
    try {
      return JSON.parse(storage.getItem(SETTINGS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function readRangeSetting(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function saveSettings(settings, storage = globalThis.StormtracePlatform.settingsStorage) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }

  globalThis.StormtraceSettings = { readSettings, readRangeSetting, saveSettings };
})();
