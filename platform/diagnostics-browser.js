(() => {
  const counters = {}, started = Date.now();
  let enabled = false, read = () => ({}), lastLightning = null, lastRadar = null, sourceRadar = null, expected = 0;
  const count = (key, amount = 1) => { if (enabled) counters[key] = (counters[key] || 0) + amount; };
  globalThis.StormtraceDiagnostics = {
    count,
    lightning() { if (enabled) lastLightning = Date.now(); },
    radar(duration, source) { if (enabled) { counters.radarDurationMs = duration; lastRadar = Date.now(); sourceRadar = source ?? null; } },
    start(snapshot) {
      read = snapshot;
      fetch('/api/diagnostics', { cache: 'no-store' }).then(r => r.json()).then(config => {
        if (!config.enabled) return;
        enabled = true; expected = Date.now() + 10000;
        globalThis.addEventListener('error', () => count('errors'));
        globalThis.addEventListener('unhandledrejection', () => count('errors'));
        setInterval(() => {
          const now = Date.now(), state = read();
          counters.markerPeak = Math.max(counters.markerPeak || 0, state.markers || 0);
          const sample = { ...counters, ...state, uptimeMs: now - started, lagMs: Math.max(0, now - expected), hidden: Number(document.hidden),
            lightningAgeMs: lastLightning === null ? undefined : now - lastLightning,
            radarAgeMs: lastRadar === null ? undefined : now - lastRadar,
            radarSourceAgeMs: sourceRadar === null ? undefined : Math.max(0, now - sourceRadar) };
          expected = now + 10000;
          fetch('/api/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample) }).catch(() => {});
        }, 10000);
      }).catch(() => {});
    }
  };
})();
