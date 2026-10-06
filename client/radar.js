(() => {
  'use strict';
  const C = globalThis.StormtraceCore;
  function validate(result) {
    if (!result || !Array.isArray(result.records) || result.records.length > 12 || !result.health || !Array.isArray(result.missingDependencies) || !result.legend) throw new Error('Invalid radar response');
    for (const f of result.records) if (!f.id || !Number.isFinite(f.observedAt) || !Array.isArray(f.bounds) || f.bounds.length !== 4 || !f.bounds.every(Number.isFinite) || !f.resource?.url.startsWith('/api/radar/frame?key=') || f.resource.format !== 'image/png') throw new Error('Invalid radar frame');
    return result;
  }
  function mountRadar({ map, demo = false, fetch: fetcher = (...args) => globalThis.fetch(...args) }) {
    const $ = (id) => document.getElementById(id), button = $('radarButton'), panel = $('radarPanel'), status = $('radarStatus'), slider = $('radarTimeline');
    let enabled = false, loading = false, timer = null, generation = 0, overlay = null, displayed = null, pending = null, records = [], followLatest = true;
    map.createPane('radar'); map.getPane('radar').style.zIndex = 250;
    map.getPane('radar').style.pointerEvents = 'none';
    $('radarAttribution').textContent = C.getSource('metoffice-radar').attribution;
    function stamp(frame) { return globalThis.StormtraceWarnings.ukDate(frame.observedAt); }
    async function show(frame) {
      if (!enabled || !frame) return;
      if (displayed?.id === frame.id) { status.textContent = `${Date.now() - frame.observedAt > 2700000 ? 'Stale' : Date.now() - frame.observedAt > 1350000 ? 'Delayed' : 'Observed'} radar · 15-minute frames, publication can lag by 20 minutes.`; return; }
      const request = ++generation;
      if (pending) { map.removeLayer(pending); pending = null; }
      status.textContent = `Loading radar observation ${stamp(frame)}…`;
      const [west, south, east, north] = frame.bounds;
      const next = L.imageOverlay(frame.resource.url, [[south, west], [north, east]], { pane: 'radar', opacity: .8, interactive: false }); pending = next;
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { map.removeLayer(next); reject(new Error('timeout')); }, 60000);
          next.once('load', () => { clearTimeout(timeout); resolve(); });
          next.once('error', () => { clearTimeout(timeout); reject(new Error('image')); }); next.addTo(map);
        });
        if (request !== generation || !enabled) { map.removeLayer(next); return; }
        if (overlay) map.removeLayer(overlay); overlay = next; pending = null; displayed = frame;
        $('radarFrameTime').textContent = `Observation: ${stamp(frame)}`;
        status.textContent = `${Date.now() - frame.observedAt > 2700000 ? 'Stale' : Date.now() - frame.observedAt > 1350000 ? 'Delayed' : 'Observed'} radar · 15-minute frames, publication can lag by 20 minutes.`;
      } catch {
        map.removeLayer(next);
        if (request === generation && enabled) status.textContent = `Radar image unavailable.${displayed ? ` Keeping observation ${stamp(displayed)}.` : ''} Check the decoder setup.`;
      }
    }
    async function refresh() {
      if (!enabled || document.hidden || loading || demo) return;
      loading = true; const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetcher('/api/radar', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('provider');
        const data = validate(await response.json());
        if (!enabled) return;
        if (data.missingDependencies.length) { status.textContent = 'Radar decoder is not configured. Follow the radar setup guide; no API key is needed.'; return; }
        records = data.records.slice().sort((a, b) => a.observedAt - b.observedAt);
        slider.disabled = !records.length; slider.max = Math.max(0, records.length - 1);
        if (!records.length) { if (overlay) map.removeLayer(overlay); overlay = null; displayed = null; $('radarFrameTime').textContent = ''; status.textContent = 'No recent radar observations available. Older archive data is not shown as live.'; return; }
        let index = followLatest ? records.length - 1 : records.findIndex((f) => f.id === displayed?.id);
        if (index < 0) { followLatest = true; index = records.length - 1; }
        slider.value = index;
        await show(records[index]);
      } catch { if (enabled) status.textContent = `Radar feed unavailable.${displayed ? ` Showing last loaded observation ${stamp(displayed)}.` : ''}`; }
      finally { clearTimeout(timeout); loading = false; }
    }
    button.addEventListener('click', () => {
      enabled = !enabled; panel.hidden = !enabled; button.setAttribute('aria-pressed', String(enabled));
      if (!enabled) { generation++; clearInterval(timer); if (overlay) map.removeLayer(overlay); if (pending) map.removeLayer(pending); overlay = pending = displayed = null; return; }
      if (demo) { status.textContent = 'Live radar is disabled in demo mode.'; return; }
      map.fitBounds([[49, -9], [61, 3]]); refresh(); timer = setInterval(refresh, 300000);
    });
    slider.addEventListener('input', () => { followLatest = false; show(records[Number(slider.value)]); });
    $('radarLatest').addEventListener('click', () => { followLatest = true; slider.value = records.length - 1; show(records.at(-1)); refresh(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    return { refresh };
  }
  globalThis.StormtraceRadar = { validate, mountRadar };
})();
