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
    for (const f of result.records) if (f.coverage && (!localResource(f.coverage.url) || f.coverage.format !== 'image/png')) throw new Error('Invalid radar coverage');
    if (result.legend.image && !localResource(result.legend.image)) throw new Error('Invalid radar legend');
    if (result.legend.categories && (!Array.isArray(result.legend.categories) || result.legend.categories.length > 20 || !result.legend.categories.every((c) => typeof c?.label === 'string' && /^#[0-9a-f]{6}$/i.test(c.colour)))) throw new Error('Invalid radar legend');
    return result;
  }
  function mountRadar({ map, demo = false, fetch: fetcher = (...args) => globalThis.fetch(...args) }) {
    const $ = (id) => document.getElementById(id), button = $('radarButton'), panel = $('radarPanel'), status = $('radarStatus'), slider = $('radarTimeline');
    const selection = $('radarSource');
    let source = selection?.value || 'metoffice-radar', selectionGeneration = 0;
    const providerId = () => C.radarProviderId(source);
    const interval = () => C.getSource(providerId()).expectedUpdateInterval;
    const isWms = () => C.radarUsesWms(providerId());
    const isPtype = () => source.startsWith('noaa-ptype-') || source === 'eccc-ptype';
    const unit = () => isPtype() ? 'category' : source === 'eccc-snow' ? 'cm/h' : source.startsWith('noaa-') ? 'dBZ' : 'mm/h';
    const canada = { 'eccc-rain': 'Radar rain-rate estimate (mm/h) from the North American composite of Canadian and US radars.', 'eccc-snow': 'Radar snowfall-rate estimate (cm/h) from the North American composite. It is a rate, not a precipitation-type classification; choose Canada · ECCC precipitation type for that.', 'eccc-ptype': 'Surface precipitation type from Environment and Climate Change Canada: radar particle classification with model surface temperature, including freezing rain and mixed rain/snow.' };
    const context = () => canada[source] ? `${canada[source]} 6-minute frames sampled across the past 3 hours. Hatched areas are outside radar coverage; inside it, clear areas had no precipitation detected.` : isPtype() ? 'Precipitation type from NOAA MRMS: radar classification assisted by model surface analyses. Categories are rain types, snow and hail; there is no sleet or freezing-rain category, and snow can be under-detected. Frames sampled across the past 3 hours. Coverage gaps do not mean dry weather.' : source.startsWith('noaa-') ? 'Observed reflectivity (dBZ); not rainfall rate. Frames sampled across the available past 3 hours. Coverage gaps do not mean dry weather.' : source === 'opera-radar' ? 'Observed rain rate · 15-minute frames. European radar coverage varies; transparent areas include no rain and missing observations.' : 'Observed rain rate · 15-minute frames, publication can lag by 20 minutes. Transparent areas include no rain and missing observations.';
    // Source freshness comes from the newest available frame, not the one on screen,
    // so stepping through older frames (or playback) never changes the message.
    const freshness = () => { const latest = records.at(-1); if (!latest) return ''; const base = ({ Observed: 'Radar is up to date.', Delayed: 'Radar is running late.', Stale: 'Radar is out of date.' })[ageLabel(latest)]; return playing ? `${base} Playing the past 3 hours.` : base; };
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
      if ($('radarUnit')) $('radarUnit').textContent = unitLabel(unit());
    }
    function unitLabel(value) { return value === 'category' ? 'Precipitation type' : value === 'dBZ' ? 'Radar reflectivity (dBZ)' : value === 'cm/h' ? 'Snowfall rate (cm/h)' : 'Rainfall rate (mm/h)'; }
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
        const img = document.createElement('img'); img.src = legend.image; img.alt = `${C.getSource(providerId()).authority} radar scale: ${unitLabel(legend.unit)}`;
        // Source legends come as a horizontal strip (NOAA) or a vertical bar (ECCC).
        if (legend.layout === 'vertical') img.classList?.add('vertical');
        img.addEventListener('error', () => { if (enabled) status.textContent = 'Radar legend unavailable. ' + context(); });
        container.append(img);
      } else {
        for (const [i, level] of legend.levels.entries()) {
          const span = document.createElement('span'); span.textContent = String(level) + (i === legend.levels.length - 1 ? '+' : '');
          span.style.setProperty('--rain', legend.colours[i]); container.append(span);
        }
      }
    }
    // Playback steps through loaded frames only after each one has drawn, so a
    // slow frame never gets skipped or stacked; any manual control stops it.
    let playing = false, playTimer = null;
    function setPlayButton() { const play = $('radarPlay'); if (!play) return; play.textContent = playing ? 'Pause' : 'Play'; play.setAttribute?.('aria-pressed', String(playing)); play.disabled = records.length < 2; }
    function stopPlayback() { const was = playing; playing = false; clearTimeout(playTimer); playTimer = null; setPlayButton(); if (was && displayed) status.textContent = freshness(); }
    async function stepPlayback(current = Number(slider.value)) {
      if (!playing || !enabled || records.length < 2) return stopPlayback();
      const index = (current + 1) % records.length;
      slider.value = index; followLatest = index === records.length - 1;
      await show(records[index]);
      if (playing) playTimer = setTimeout(() => stepPlayback(index), index === records.length - 1 ? 1600 : 700);
    }
    // One-click decoder setup through the local server; progress is polled.
    let setupTimer = null;
    function showSetup(visible) { const setup = $('radarSetup'); if (setup) setup.hidden = !visible || demo; }
    function renderSetup(snapshot) {
      const setup = $('radarSetup');
      if (snapshot.state === 'running') { status.textContent = `${snapshot.message} This can take a few minutes; you can keep using Stormtrace.`; if (setup) { setup.disabled = true; setup.textContent = 'Setting up…'; } return; }
      clearInterval(setupTimer); setupTimer = null;
      if (setup) { setup.disabled = false; setup.textContent = snapshot.state === 'failed' ? 'Try radar setup again' : 'Set up UK and Europe radar'; }
      if (snapshot.state === 'failed') { status.textContent = snapshot.message; showSetup(true); }
      if (snapshot.state === 'done') { status.textContent = snapshot.explicitPython ? 'Radar is set up, but your .env still selects another Python with STORMTRACE_RADAR_PYTHON. Remove that line to use the new setup.' : 'Radar is set up. Loading frames…'; showSetup(false); refresh(); }
    }
    async function pollSetup() {
      try { const response = await fetcher('/api/radar/setup', { cache: 'no-store' }); if (response.ok) renderSetup(await response.json()); } catch { /* the next poll retries */ }
    }
    $('radarSetup')?.addEventListener('click', async () => {
      try {
        const response = await fetcher('/api/radar/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok) throw new Error('setup');
        renderSetup(await response.json());
        clearInterval(setupTimer); setupTimer = setInterval(pollSetup, 3000);
      } catch { status.textContent = 'Radar setup could not start. See Radar setup below for the manual steps.'; }
    });
    function stamp(frame) { return globalThis.StormtraceUI.date(frame.observedAt); }
    async function show(frame) {
      if (!enabled || !frame) return;
      if (displayed?.id === frame.id) { status.textContent = freshness(); return; }
      const request = ++generation;
      cancelPending?.();
      if (pending) { map.removeLayer(pending); pending = null; }
      // During playback the status line stays steady; loading shows on the frame line.
      if (playing) $('radarFrameTime').textContent = `Loading ${stamp(frame)}…`; else status.textContent = `Loading radar observation ${stamp(frame)}…`;
      const [west, south, east, north] = frame.bounds, area = [[south, west], [north, east]];
      // A source coverage mask, where offered, is drawn beneath the precipitation layer.
      const image = L.imageOverlay(frame.resource.url, area, { pane: 'radar', opacity: .8, interactive: false });
      const coverage = frame.coverage && L.imageOverlay(frame.coverage.url, area, { pane: 'radar', opacity: .45, interactive: false });
      const images = coverage ? [coverage, image] : [image];
      const next = coverage ? L.layerGroup(images) : image; pending = next;
      try {
        await new Promise((resolve, reject) => {
          let remaining = images.length, done = false;
          const finish = (failed) => {
            if (done || (!failed && --remaining > 0)) return;
            done = true; clearTimeout(timeout); if (cancelPending === cancel) cancelPending = null;
            if (failed) reject(new Error('image')); else resolve();
          };
          const cancel = () => finish(true);
          const timeout = setTimeout(() => finish(true), 60000); cancelPending = cancel;
          for (const layer of images) { layer.once('load', () => finish(false)); layer.once('error', () => finish(true)); }
          next.addTo(map);
        });
        if (request !== generation || !enabled) { map.removeLayer(next); return; }
        if (overlay) map.removeLayer(overlay); overlay = next; pending = null; displayed = frame;
        $('radarFrameTime').textContent = `Observation: ${stamp(frame)}`;
        status.textContent = freshness();
      } catch {
        globalThis.StormtraceDiagnostics?.count("errors");
        if (request === generation) map.removeLayer(next);
        if (request === generation && enabled) status.textContent = `Radar image unavailable.${displayed ? ` Keeping observation ${stamp(displayed)}.` : ''} ${isWms() ? 'Try Latest frame.' : 'Check the radar setup or retry.'}`;
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
        if (data.missingDependencies.length) { status.textContent = 'UK and European radar need a one-time setup on this computer. No key or account is needed.'; showSetup(true); return; }
        showSetup(false);
        legendPresentation(data.legend);
        globalThis.StormtraceUI.sourceStatus('radarNavButton',{health:data.health});
        records = data.records.slice().sort((a, b) => a.observedAt - b.observedAt);
        slider.disabled = !records.length; slider.max = Math.max(0, records.length - 1); setPlayButton();
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
      enabled = !enabled; panel.hidden = !enabled; button.checked = enabled; stopPlayback();
      if(enabled)globalThis.StormtraceUI.scrollTo(panel);
      if (!enabled) { generation++; selectionGeneration++; cancelPending?.(); clearInterval(timer); if (overlay) map.removeLayer(overlay); if (pending) map.removeLayer(pending); overlay = pending = displayed = null; return; }
      if (demo) { status.textContent = 'Live radar is disabled in demo mode.'; return; }
      refresh(); timer = setInterval(refresh, isWms() ? 60000 : 300000);
    });
    selection?.addEventListener('change', () => {
      source = selection.value; selectionGeneration++; generation++; cancelPending?.(); stopPlayback();
      if (overlay) map.removeLayer(overlay); if (pending) map.removeLayer(pending);
      overlay = pending = displayed = null; records = []; followLatest = true;
      slider.disabled = true; $('radarFrameTime').textContent = ''; sourcePresentation();
      status.textContent = demo ? 'Live radar is disabled in demo mode.' : enabled ? 'Loading selected radar source…' : 'Turn on Radar to load this source.';
      if (enabled) { clearInterval(timer); timer = setInterval(refresh, isWms() ? 60000 : 300000); refresh(); }
    });
    slider.addEventListener('input' , () => { stopPlayback(); followLatest = false; show(records[Number(slider.value)]); });
    $('radarPlay')?.addEventListener('click', () => {
      if (playing) return stopPlayback();
      if (records.length < 2) return;
      playing = true; setPlayButton();
      // From the latest frame, start the loop at the oldest one.
      const current = Number(slider.value);
      stepPlayback(current >= records.length - 1 ? -1 : current);
    });
    $('radarViewRegion')?.addEventListener('click', () => {
      if (!records.length) { status.textContent = 'Load radar observations before viewing this region.'; return; }
      const [west, south, east, north] = records[0].bounds;
      map.fitBounds([[south, west], [north, east]], { maxZoom: 7 });
    });
    $('radarOff')?.addEventListener('click', () => { if (enabled) button.click(); });
    $('radarLatest').addEventListener('click', () => { stopPlayback(); followLatest = true; slider.value = records.length - 1; show(records.at(-1)); refresh(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    return { refresh };
  }
  globalThis.StormtraceRadar = { validate, mountRadar };
})();
