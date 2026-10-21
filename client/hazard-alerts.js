(() => {
  'use strict';
  // Location alerts for official hazards, alongside nearby lightning.
  // Consumes the app's normalized local endpoints only and reuses each view's
  // validator. Alerts copy official information; they never replace it.
  const C = globalThis.StormtraceCore;
  const NOTIFIED_KEY = 'stormtrace:hazard-alerts-notified';
  const MAX_NOTIFIED = 300;
  const KM_PER_MILE = 1.609344;
  const DEFAULTS = { warnings: false, floods: false, quakes: false, quakeMagnitude: 5, quakeRadiusMiles: 300 };
  const WARNING_RANK = { RED: 0, AMBER: 1 };

  function readSettings(value) {
    const v = value && typeof value === 'object' ? value : {};
    const magnitude = Number(v.quakeMagnitude), radius = Number(v.quakeRadiusMiles);
    return {
      warnings: v.warnings === true, floods: v.floods === true, quakes: v.quakes === true,
      quakeMagnitude: [4, 4.5, 5, 6].includes(magnitude) ? magnitude : DEFAULTS.quakeMagnitude,
      quakeRadiusMiles: [100, 300, 500, 1000].includes(radius) ? radius : DEFAULTS.quakeRadiusMiles,
    };
  }

  // Amber and red Met Office warning areas that contain the point.
  function warningMatches(records, point, now) {
    return records.filter((r) => WARNING_RANK[r.domainPayload.badge] != null && r.validTo > now && C.pointInPolygon([point.lon, point.lat], r.geometry))
      .map((r) => ({
        kind: 'warning', id: r.id, rank: WARNING_RANK[r.domainPayload.badge],
        key: `warning:${r.id}:${r.domainPayload.badge}:${r.observedAt}`,
        title: `${r.domainPayload.badge === 'RED' ? 'Red' : 'Amber'} weather warning at your location`,
        body: `Met Office: ${r.domainPayload.title.toLowerCase()} warning until ${globalThis.StormtraceUI.fixedUkDate(r.validTo)}. Check the Met Office for full details.`,
      }));
  }

  // England flood warnings (level 1 severe, level 2 warning) whose area contains the point.
  function floodMatches(records, areas, point) {
    return records.filter((r) => r.domainPayload.status === 'ACTIVE' && r.domainPayload.level <= 2)
      .filter((r) => (areas.get(r.domainPayload.areaId) || []).some((geometry) => C.pointInPolygon([point.lon, point.lat], geometry)))
      .map((r) => ({
        kind: 'flood', id: r.id, rank: r.domainPayload.level === 1 ? 0 : 2,
        key: `flood:${r.id}:${r.domainPayload.level}:${r.domainPayload.sourceTimes.severityChanged || r.domainPayload.sourceTimes.reviewed || ''}`,
        title: `${r.domainPayload.classification} at your location`,
        body: `Environment Agency: ${r.domainPayload.headline}. Check GOV.UK for current advice.`,
      }));
  }

  // Earthquakes from the past day at or above the magnitude, within the radius.
  function quakeMatches(records, point, settings, now) {
    return records.flatMap((r) => {
      const p = r.domainPayload, km = C.distanceKm([point.lon, point.lat], r.geometry?.coordinates);
      if (p.magnitude == null || p.magnitude < settings.quakeMagnitude || r.observedAt < now - 86400000 || km == null || km > settings.quakeRadiusMiles * KM_PER_MILE) return [];
      const miles = Math.round(km / KM_PER_MILE);
      return [{ kind: 'earthquake', id: r.id, rank: 3, key: `earthquake:${r.id}`,
        title: `M ${p.magnitude} earthquake ${miles} miles away`,
        body: `USGS: ${p.place || 'location description unavailable'}. Preliminary details can change; check USGS for updates.` }];
    });
  }

  function create({ fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, getLocation, getSettings, notify, onChange = () => {}, storage = globalThis.StormtracePlatform?.settingsStorage, demo = false } = {}) {
    const areas = new Map();
    const state = { matches: [], status: {}, checking: false };
    let timer = null, generation = 0;
    const json = async (url) => { const response = await fetcher(url, { cache: 'no-store' }); if (!response.ok) throw new Error('unavailable'); return response.json(); };
    function notified() { try { const v = JSON.parse(storage?.getItem(NOTIFIED_KEY) || '[]'); return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []; } catch { return []; } }
    function remember(keys) { try { storage?.setItem(NOTIFIED_KEY, JSON.stringify(keys.slice(-MAX_NOTIFIED))); } catch { /* alerts still work for this session */ } }
    async function floodAreas(records) {
      const wanted = records.filter((r) => r.domainPayload.status === 'ACTIVE' && r.domainPayload.level <= 2).slice(0, 100).map((r) => r.domainPayload.areaId).filter((id) => !areas.has(id));
      // Small batches bound upstream requests; area outlines rarely change, so keep them.
      for (let i = 0; i < wanted.length; i += 3) {
        await Promise.all(wanted.slice(i, i + 3).map(async (id) => {
          try { const result = await json(`/api/floods/area?id=${encodeURIComponent(id)}`); areas.set(id, (result.features || []).map((f) => C.normalizeGeometry(f.geometry)).filter(Boolean)); }
          catch { /* retried on the next check */ }
        }));
      }
    }
    async function source(kind, load) {
      try { const matches = await load(); state.status[kind] = { checkedAt: now(), count: matches.length, error: false }; return matches; }
      catch { state.status[kind] = { ...(state.status[kind] || {}), error: true, failedAt: now() }; return state.matches.filter((m) => m.kind === kind); }
    }
    async function check() {
      const settings = readSettings(getSettings?.()), point = getLocation?.();
      const token = ++generation;
      if (demo || !point || !(settings.warnings || settings.floods || settings.quakes)) { state.matches = []; state.status = {}; onChange(state); return state; }
      state.checking = true; onChange(state);
      const results = await Promise.all([
        settings.warnings ? source('warning', async () => warningMatches(globalThis.StormtraceWarningMap.valid(await json('/api/hazards?source=metoffice-warnings-esri')).records, point, now())) : [],
        settings.floods ? source('flood', async () => { const batch = globalThis.StormtraceFloods.validBatch(await json('/api/floods')); await floodAreas(batch.records); return floodMatches(batch.records, areas, point); }) : [],
        settings.quakes ? source('earthquake', async () => quakeMatches(globalThis.StormtraceEarthquakes.validBatch(await json('/api/earthquakes')).records, point, settings, now())) : [],
      ]);
      if (token !== generation) return state;
      for (const kind of ['warning', 'flood', 'earthquake']) if (!settings[{ warning: 'warnings', flood: 'floods', earthquake: 'quakes' }[kind]]) delete state.status[kind];
      state.matches = results.flat().sort((a, b) => a.rank - b.rank);
      state.checking = false;
      // Notify each source revision once, across restarts; the app decides whether desktop alerts are on.
      const seen = notified(), fresh = state.matches.filter((m) => !seen.includes(m.key));
      const delivered = fresh.filter((m) => notify?.(m) === true);
      if (delivered.length) remember([...seen, ...delivered.map((m) => m.key)]);
      onChange(state);
      return state;
    }
    function start() { stop(); timer = setInterval(() => { if (!globalThis.document?.hidden) check(); }, 10 * 60 * 1000); return check(); }
    function stop() { clearInterval(timer); timer = null; }
    return { state, check, start, stop };
  }

  globalThis.StormtraceHazardAlerts = { DEFAULTS, readSettings, warningMatches, floodMatches, quakeMatches, create };
})();
