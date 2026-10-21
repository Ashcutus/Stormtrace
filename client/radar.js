(() => {
  'use strict';
  const C = globalThis.StormtraceCore;
  function localResource(value) {
    if (typeof value !== 'string' || !value.startsWith('/api/radar/frame?')) return false;
    const url = new URL(value, 'http://localhost');
    return url.pathname === '/api/radar/frame' && url.searchParams.has('key') && !url.hash;
  }
  function validate(result) {
    if (!result || !Array.isArray(result.records) || result.records.length > 12 || !result.health || !Array.isArray(result.missingDependencies) || !result.legend) throw new Error('Invalid radar response');
    for (const f of result.records) if (!f.id || !Number.isFinite(f.observedAt) || !Array.isArray(f.bounds) || f.bounds.length !== 4 || !f.bounds.every(Number.isFinite) || !localResource(f.resource?.url) || f.resource.format !== 'image/png') throw new Error('Invalid radar frame');
    if (result.legend.image && !localResource(result.legend.image)) throw new Error('Invalid radar legend');
    if (result.legend.categories && (!Array.isArray(result.legend.categories) || result.legend.categories.length > 20 || !result.legend.categories.every((c) => typeof c?.label === 'string' && /^#[0-9a-f]{6}$/i.test(c.colour)))) throw new Error('Invalid radar legend');
    return result;
  }
  function mountRadar({ map, demo = false, fetch: fetcher = (...args) => globalThis.fetch(...args) }) {
    const $ = (id) => document.getElementById(id), button = $('radarButton'), panel = $('radarPanel'), status = $('radarStatus'), slider = $('radarTimeline');
    const selection = $('radarSource');
    let source = selection?.value || 'metoffice-radar', selectionGeneration = 0;
    const providerId = () => source.startsWith('noaa-') ? 'noaa-radar' : source;
    const interval = () => C.getSource(providerId()).expectedUpdateInterval;
    const isPtype = () => source.startsWith('noaa-ptype-');
    const context = () => isPtype() ? 'Precipitation type from NOAA MRMS: radar classification assisted by model surface analyses. Categories are rain types, snow and hail; there is no sleet or freezing-rain category, and snow can be under-detected. Frames sampled across the past 3 hours. Coverage gaps do not mean dry weather.' : source.startsWith('noaa-') ? 'Observed reflectivity (dBZ); not rainfall rate. Frames sampled across the available past 3 hours. Coverage gaps do not mean dry weather.' : source === 'opera-radar' ? 'Observed rain rate · 15-minute frames. European radar coverage varies; transparent areas include no rain and missing observations.' : 'Observed rain rate · 15-minute frames, publication can lag by 20 minutes. Transparent areas include no rain and missing observations.';
    const freshness = (frame) => ({ Observed: 'Radar is up to date.', Delayed: 'Radar is running late; showing the latest available frame.', Stale: 'Radar is out of date; showing the last available frame.' })[ageLabel(frame)];
    const ageLabel = (frame) => Date.now() - frame.observedAt > interval() * 3 ? 'Stale' : Date.now() - frame.observedAt > interval() * 1.5 ? 'Delayed' : 'Observed';
    let enabled = false, loading = false, timer = null, generation = 0, overlay = null, displayed = null, pending = null, cancelPending = null, records = [], followLatest = true;
    map.createPane('radar'); map.getPane('radar').style.zIndex = 250;
    map.getPane('radar').style.pointerEvents = 'none';
    function sourcePresentation() {
      const metadata = C.getSource(providerId());
      $('radarAttribution').textContent = metadata.attribution;
      if ($('radarSourceLink')) $('radarSourceLink').href = metadata.homepage;
      if ($('radarCoverage')) $('radarCoverage').textContent = context();
      if ($('radarLegend')) $('radarLegend').replaceChildren();
      if ($('radarUnit')) $('radarUnit').textContent = unitLabel(isPtype() ? 'category' : source.startsWith('noaa-') ? 'dBZ' : 'mm/h');
    }
    function unitLabel(unit) { return unit === 'category' ? 'Precipitation type' : unit === 'dBZ' ? 'Radar reflectivity (dBZ)' : 'Rainfall rate (mm/h)'; }
    sourcePresentation();
    function legendPresentation(legend) {
      const container = $('radarLegend');
      if (!container) return;
      container.replaceChildren();
      if ($('radarUnit')) $('radarUnit').textContent = unitLabel(legend.unit);
      if (legend.categories) {
        // Categorical legend: one labelled swatch per source category, rendered as text.
        container.classList?.add('radar-legend-categories');
        for (const category of legend.categories) {
          const item = document.createElement('span'); item.textContent = category.label;
          item.style.setProperty('--rain', category.colour); container.append(item);
        }
        return;
      }
      container.classList?.remove('radar-legend-categories');
      if (legend.image) {
        const img = document.createElement('img'); img.src = legend.image; img.alt = 'NOAA radar reflectivity scale in dBZ';
        img.addEventListener('error', () => { if (enabled) status.textContent = 'Radar legend unavailable. ' + context(); });
        container.append(img);
      } else {
        for (const [i, level] of legend.levels.entries()) {
          const span = document.createElement('span'); span.textContent = String(level) + (i === legend.levels.length - 1 ? '+' : '');
          span.style.setProperty('--rain', legend.colours[i]); container.append(span);
        }
      }
    }
    function stamp(frame) { return globalThis.StormtraceUI.date(frame.observedAt); }
    async function show(frame) {
      if (!enabled || !frame) return;
      if (displayed?.id === frame.id) { status.textContent = freshness(frame); return; }
      const request = ++generation;
      cancelPending?.();
      if (pending) { map.removeLayer(pending); pending = null; }
      status.textContent = `Loading radar observation ${stamp(frame)}…`;
      const [west, south, east, north] = frame.bounds;
      const next = L.imageOverlay(frame.resource.url, [[south, west], [north, east]], { pane: 'radar', opacity: .8, interactive: false }); pending = next;
      try {
        await new Promise((resolve, reject) => {
          const finish = (failed) => {
            clearTimeout(timeout); if (cancelPending === cancel) cancelPending = null;
            if (failed) reject(new Error('image')); else resolve();
          };
          const cancel = () => finish(true);
          const timeout = setTimeout(() => finish(true), 60000); cancelPending = cancel;
          next.once('load', () => finish(false));
          next.once('error', () => finish(true)); next.addTo(map);
        });
        if (request !== generation || !enabled) { map.removeLayer(next); return; }
        if (overlay) map.removeLayer(overlay); overlay = next; pending = null; displayed = frame;
        $('radarFrameTime').textContent = `Observation: ${stamp(frame)}`;
        status.textContent = freshness(frame);
      } catch {
        globalThis.StormtraceDiagnostics?.count("errors");
        if (request === generation) map.removeLayer(next);
        if (request === generation && enabled) status.textContent = `Radar image unavailable.${displayed ? ` Keeping observation ${stamp(displayed)}.` : ''} ${source.startsWith('noaa-') ? 'Try Latest frame.' : 'Check the radar setup or retry.'}`;
      }
    }
    async function refresh() {
      if (!enabled || document.hidden || loading || demo) return;
      const selected = source, epoch = selectionGeneration;
      const diagnosticStart = Date.now();
      globalThis.StormtraceDiagnostics?.count("radarAttempts");
      loading = true; globalThis.StormtraceUI.sourceStatus('radarNavButton',{loading:true}); const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetcher(selected === 'metoffice-radar' ? '/api/radar' : '/api/radar?source=' + encodeURIComponent(selected), { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('provider');
        const data = validate(await response.json());
        globalThis.StormtraceDiagnostics?.count("radarSuccesses");
        globalThis.StormtraceDiagnostics?.radar(Date.now() - diagnosticStart, data.records.at(-1)?.observedAt);
        if (!enabled || epoch !== selectionGeneration) return;
        if (data.missingDependencies.length) { status.textContent = 'Radar needs a one-time local setup. See Radar setup below; no key is needed.'; return; }
        legendPresentation(data.legend);
        globalThis.StormtraceUI.sourceStatus('radarNavButton',{health:data.health});
        records = data.records.slice().sort((a, b) => a.observedAt - b.observedAt);
        slider.disabled = !records.length; slider.max = Math.max(0, records.length - 1);
        if (!records.length) { if (overlay) map.removeLayer(overlay); overlay = null; displayed = null; $('radarFrameTime').textContent = 'No frames available.'; status.textContent = 'No recent radar observations available. Older archive data is not shown as live.'; return; }
        let index = followLatest ? records.length - 1 : records.findIndex((f) => f.id === displayed?.id);
        if (index < 0) { followLatest = true; index = records.length - 1; }
        slider.value = index;
        await show(records[index]);
      } catch { globalThis.StormtraceUI.sourceStatus('radarNavButton',{cached:Boolean(displayed),health:{lastError:{code:'network'}}}); globalThis.StormtraceDiagnostics?.count("radarFailures"); globalThis.StormtraceDiagnostics?.count("networkFailures"); if (enabled && epoch === selectionGeneration) status.textContent = `Radar feed unavailable.${displayed ? ` Showing last loaded observation ${stamp(displayed)}.` : ''}`; }
      finally { clearTimeout(timeout); loading = false; if (enabled && epoch !== selectionGeneration) refresh(); }
    }
    // The Layers checkbox drives radar; its checked state always mirrors whether radar is on.
    button.addEventListener('click', () => {
      enabled = !enabled; panel.hidden = !enabled; button.checked = enabled;
      if(enabled)globalThis.StormtraceUI.scrollTo(panel);
      if (!enabled) { generation++; selectionGeneration++; cancelPending?.(); clearInterval(timer); if (overlay) map.removeLayer(overlay); if (pending) map.removeLayer(pending); overlay = pending = displayed = null; return; }
      if (demo) { status.textContent = 'Live radar is disabled in demo mode.'; return; }
      refresh(); timer = setInterval(refresh, source.startsWith('noaa-') ? 60000 : 300000);
    });
    selection?.addEventListener('change', () => {
      source = selection.value; selectionGeneration++; generation++; cancelPending?.();
      if (overlay) map.removeLayer(overlay); if (pending) map.removeLayer(pending);
      overlay = pending = displayed = null; records = []; followLatest = true;
      slider.disabled = true; $('radarFrameTime').textContent = ''; sourcePresentation();
      status.textContent = demo ? 'Live radar is disabled in demo mode.' : enabled ? 'Loading selected radar source…' : 'Turn on Radar to load this source.';
      if (enabled) { clearInterval(timer); timer = setInterval(refresh, source.startsWith('noaa-') ? 60000 : 300000); refresh(); }
    });
    slider.addEventListener('input' , () => { followLatest = false; show(records[Number(slider.value)]); });
    $('radarViewRegion')?.addEventListener('click', () => {
      if (!records.length) { status.textContent = 'Load radar observations before viewing this region.'; return; }
      const [west, south, east, north] = records[0].bounds;
      map.fitBounds([[south, west], [north, east]], { maxZoom: 7 });
    });
    $('radarOff')?.addEventListener('click', () => { if (enabled) button.click(); });
    $('radarLatest').addEventListener('click', () => { followLatest = true; slider.value = records.length - 1; show(records.at(-1)); refresh(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    return { refresh };
  }
  globalThis.StormtraceRadar = { validate, mountRadar };
})();
