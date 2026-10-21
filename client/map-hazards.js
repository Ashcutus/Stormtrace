(() => {
  'use strict';
  const UI=globalThis.StormtraceUI;
  function quakePopup(event, onLoad, health = {}, cached = false) {
    const node = document.createElement('div'), heading = document.createElement('h3'), button = document.createElement('button'), status = document.createElement('p');
    node.className = 'flood-map-card quake-map-card'; heading.className = 'flood-map-title';
    heading.textContent = `M ${event.domainPayload.magnitude ?? '?'} · ${event.domainPayload.place || 'Location description unavailable'}`;
    button.type = 'button'; button.textContent = 'Reload estimated shaking'; button.hidden = true;
    const load = () => onLoad((message, state = 'loading') => {
      status.textContent = message; button.hidden = !['available', 'error'].includes(state);
      button.textContent = state === 'error' ? 'Retry shaking check' : 'Reload estimated shaking';
    });
    button.addEventListener('click', load);
    node.append(heading, button, status);
    UI.text(node,'span','Earthquake','flood-map-badge');
    if(event.observedAt!=null)UI.text(node,'p',`Occurred ${UI.date(event.observedAt)}`,'flood-map-time');
    if(event.updatedAt!=null)UI.text(node,'p',`Source updated ${UI.date(event.updatedAt)}`,'flood-map-time');
    if(Number.isFinite(event.domainPayload.depthKm))UI.text(node,'p',`Depth ${UI.depth(event.domainPayload.depthKm)} · ${event.domainPayload.status || 'Review status not supplied'}`);
    UI.text(node,'p','Estimated shaking is a model product; missing contours do not establish no shaking.','flood-map-note');
    node.updateHealth=UI.popupHealth(node,health,cached);
    const close=UI.text(node,'button','Close','mini-button');close.type='button';close.addEventListener('click',()=>document.dispatchEvent?.(new Event('closehazardpopup')));
    const provider = document.createElement('strong'); provider.className = 'flood-map-provider'; provider.textContent = StormtraceCore.getSource('usgs').authority;
    const attribution = document.createElement('p'); attribution.className = 'flood-map-attribution'; attribution.textContent = StormtraceCore.getSource('usgs').attribution;
    node.append(provider, attribution);
    if (event.domainPayload.url) {
      const link = document.createElement('a'); link.className = 'flood-map-link'; link.textContent = 'View official USGS event ↗'; link.href = event.domainPayload.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(link);
    }
    return { node, load };
  }
  function floodPopup(event, health = {}, cached = false) {
    const p = event.domainPayload, source = StormtraceCore.getSource(event.provider);
    const node = document.createElement('article'); node.className = `flood-map-card flood-map-level-${p.level}`;
    const add = (tag, value, cls) => { const el = document.createElement(tag); el.textContent = value; el.className = cls; node.append(el); return el; };
    add('span', p.classification, 'flood-map-badge');
    add('h3', p.headline, 'flood-map-title');
    add('p', [p.county, p.riverOrSea].filter(Boolean).join(' · '), 'flood-map-location');
    const message = add('div', p.description || 'No additional message supplied.', 'flood-map-message');
    message.tabIndex = 0; message.setAttribute('aria-label', 'Full flood warning message');
    add('p', 'Warning-area coverage · not observed floodwater', 'flood-map-note');
    add('strong', source.authority, 'flood-map-provider');
    const reviewed = p.sourceTimes?.reviewed;
    if (reviewed) add('p', `Source reviewed: ${reviewed}${/(?:Z|[+-]\d\d:\d\d)$/.test(reviewed) ? '' : ' (timezone not supplied)'}`, 'flood-map-time');
    add('p', source.attribution, 'flood-map-attribution');
    const link = add('a', 'View official warning on GOV.UK ↗', 'flood-map-link');
    link.href = `https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(p.areaId)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    node.updateHealth=UI.popupHealth(node,health,cached);
    const close=add('button','Close','mini-button');close.type='button';close.addEventListener('click',()=>document.dispatchEvent?.(new Event('closehazardpopup')));
    return node;
  }
  function mount({ map, demo = false }) {
    const $ = id => document.getElementById(id), floodToggle = $('mapFloods'), quakeToggle = $('mapQuakes');
    if (!map || !floodToggle || !quakeToggle) return;
    const floods = L.layerGroup().addTo(map), quakes = L.layerGroup().addTo(map), shaking = L.layerGroup().addTo(map), selected = L.layerGroup().addTo(map);
    const quakeMarkers = new Map();
    let selectionGeneration = 0;
    document.addEventListener('clearselectedhazard', () => { selectionGeneration++; selected.clearLayers(); });
    let generation = 0, impactGeneration = 0, timer = null;
    let floodHealth={},quakeHealth={};const floodPopups=[],quakePopups=[];
    document.addEventListener('closehazardpopup',()=>map.closePopup?.());
    const popup = text => { const node = document.createElement('div'); node.textContent = text; return node; };
    const json = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('unavailable'); return r.json(); };
    async function impact(event, report = () => {}) {
      const token = ++impactGeneration; shaking.clearLayers();
      const status = (message, state = 'loading') => { $('mapShakingStatus').textContent = message; report(message, state); };
      status('Loading estimated shaking…');
      try {
        const result = await json(`/api/earthquakes/impact?id=${encodeURIComponent(event.id)}`);
        if (token !== impactGeneration) return;
        for (const f of result.features) {
          if (!StormtraceCore.normalizeGeometry(f.geometry) || !Number.isFinite(f.intensity)) throw new Error('invalid');
          L.geoJSON(StormtraceCore.geometryFeature(f.geometry), { bubblingMouseEvents: false, style: { color: f.intensity >= 6 ? '#ff715b' : f.intensity >= 4 ? '#ffe36b' : '#67d7eb', weight: 2, opacity: .9 } }).bindPopup((()=>{const card=document.createElement('article');card.className='flood-map-card quake-map-card';UI.text(card,'span','Estimated shaking','flood-map-badge');UI.text(card,'h3',`USGS shaking · MMI ${f.intensity}`,'flood-map-title');UI.text(card,'p',`Source updated ${UI.date(f.provenance.updatedAt)}`,'flood-map-time');UI.text(card,'p','Modelled intensity contour, not an observed boundary or a felt radius.','flood-map-note');UI.text(card,'p',StormtraceCore.getSource('usgs').attribution,'flood-map-attribution');UI.popupHealth(card,{lastSuccessfulFetch:f.provenance.fetchedAt});const link=UI.text(card,'a','Open official USGS event ↗','flood-map-link');link.href=event.domainPayload.url;link.target='_blank';link.rel='noopener noreferrer';const close=UI.text(card,'button','Close','mini-button');close.type='button';close.addEventListener('click',()=>map.closePopup?.());return card;})(),{className:'hazard-popup flood-map-popup',maxWidth:380,minWidth:280}).addTo(shaking);
        }
        status(result.available ? 'USGS estimated shaking contours · MMI (not a felt radius).' : 'No USGS ShakeMap available for this event; felt extent unknown.', result.available ? 'available' : 'unavailable');
      } catch { if (token === impactGeneration) { shaking.clearLayers(); status('Shaking retrieval failed; availability unknown.', 'error'); } }
    }
    async function refresh() {
      const token = ++generation;
      if (!floodToggle.checked && !quakeToggle.checked) { $('mapHazardStatus').textContent = 'Additional hazard layers off.'; return; }
      if (demo) { $('mapHazardStatus').textContent = 'Live hazard layers unavailable in demo.'; return; }
      if (document.hidden) return;
      $('mapHazardStatus').textContent = 'Checking enabled map layers…';
      const messages = [];
      if (floodToggle.checked) {
        try {
          const batch = await json('/api/floods');floodHealth=batch.health||{};if (token !== generation) return;
          const active = batch.records.filter(r => r.domainPayload.status === 'ACTIVE').sort((a,b) => a.domainPayload.level - b.domainPayload.level);
          const prepared = [], selected = active.slice(0,100); let missing = 0;
          // Small batches bound upstream requests and avoid a large burst.
          for (let start=0; start<selected.length; start+=3) {
            if (token !== generation) return;
            await Promise.all(selected.slice(start,start+3).map(async event => {
              try { const result = await json(`/api/floods/area?id=${encodeURIComponent(event.domainPayload.areaId)}`); for (const feature of result.features) { if (!StormtraceCore.normalizeGeometry(feature.geometry)) throw new Error('invalid'); prepared.push({ event, feature }); } if (!result.features.length) missing++; }
              catch { missing++; }
            }));
          }
          if (token !== generation) return;
          floods.clearLayers();floodPopups.length=0;
          for (const { event, feature } of prepared) L.geoJSON(StormtraceCore.geometryFeature(feature.geometry), { bubblingMouseEvents: false, style: { color: event.domainPayload.level <= 2 ? '#ff715b' : '#ad79ff', weight: 2, fillOpacity: .13 } }).bindPopup((()=>{const node=floodPopup(event,floodHealth);floodPopups.push(node);return node;})(), { className: 'hazard-popup flood-map-popup', maxWidth: 380, minWidth: 280 }).addTo(floods);
          messages.push(`Floods: ${selected.length-missing} of ${active.length} England warning areas shown${missing || active.length>100 ? ' (incomplete)' : ''}.`);
        } catch { floodHealth={...floodHealth,lastError:{code:'network'}};for(const node of floodPopups)node.updateHealth?.(floodHealth,true);messages.push('Flood areas could not be retrieved; previous areas kept (cached).'); }
      }
      if (quakeToggle.checked) {
        try {
          const batch = await json('/api/earthquakes');quakeHealth=batch.health||{};if (token !== generation) return;
          const records = batch.records.filter(r => r.observedAt >= Date.now()-86400000).slice(0,500);
          quakes.clearLayers();quakePopups.length=0;quakeMarkers.clear();
          for (const event of records) {
            const geometry = StormtraceCore.normalizeGeometry(event.geometry); if (geometry?.type !== 'Point') continue;
            const [lon,lat] = geometry.coordinates;
            const content = quakePopup(event, (report) => impact(event, report),quakeHealth);quakePopups.push(content.node);
            const marker = L.circleMarker([lat,lon], { bubblingMouseEvents: false, radius: Math.max(4, Math.min(14, 3+(event.domainPayload.magnitude || 0))), color: '#67d7eb', weight: 1, fillOpacity: .6 }).bindPopup(content.node, { className: 'hazard-popup flood-map-popup', maxWidth: 380, minWidth: 280 }).on('click', content.load).addTo(quakes);
            quakeMarkers.set(event.id, { marker, load: content.load });
          }
          messages.push(`Earthquakes: ${records.length} of ${batch.records.length} in the past 24 hours. Select a point for estimated shaking.`);
        } catch { quakeHealth={...quakeHealth,lastError:{code:'network'}};for(const node of quakePopups)node.updateHealth?.(quakeHealth,true);messages.push('Earthquakes could not be retrieved; previous points kept (cached).'); }
      }
      if (token === generation) $('mapHazardStatus').textContent = messages.join(' ') || 'Additional hazard layers off.';
    }
    function changed() {
      generation++; if (!floodToggle.checked) floods.clearLayers();
      if (!quakeToggle.checked) { quakes.clearLayers(); shaking.clearLayers(); impactGeneration++; $('mapShakingStatus').textContent = ''; }
      clearInterval(timer); if (floodToggle.checked || quakeToggle.checked) timer = setInterval(refresh, 900000); refresh();
    }
    floodToggle.addEventListener('change', changed); quakeToggle.addEventListener('change', changed);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && (floodToggle.checked || quakeToggle.checked)) refresh(); });
    $('mapHazardRefresh').addEventListener('click', refresh);
    // Show one flood warning area from the list as the selected map event.
    async function showFlood(event, health = floodHealth, cached = false) {
      document.dispatchEvent?.(new Event('clearselectedhazard'));
      const token = ++selectionGeneration;
      $('mapHazardStatus').textContent = 'Loading the selected flood warning area…';
      try {
        const result = await json(`/api/floods/area?id=${encodeURIComponent(event.domainPayload.areaId)}`);
        if (token !== selectionGeneration) return;
        const valid = result.features.filter((feature) => StormtraceCore.normalizeGeometry(feature.geometry));
        if (!valid.length) { $('mapHazardStatus').textContent = 'No published area outline for this warning; use the GOV.UK link.'; return; }
        const popupNode = floodPopup(event, health, cached);
        const shapes = valid.map((feature) => L.geoJSON(StormtraceCore.geometryFeature(feature.geometry), { bubblingMouseEvents: false, style: { color: '#ffffff', weight: 3, fillColor: event.domainPayload.level <= 2 ? '#ff715b' : '#ad79ff', fillOpacity: .25 } }).bindPopup(popupNode, { className: 'hazard-popup flood-map-popup', maxWidth: 380, minWidth: 280 }).addTo(selected));
        const bounds = shapes.reduce((all, shape) => all ? all.extend(shape.getBounds()) : shape.getBounds(), null);
        if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11, ...UI.flyOptions(0.8) });
        shapes[0].openPopup();
        $('mapHazardStatus').textContent = 'Selected flood warning area shown. Clear it from Layers.';
        document.dispatchEvent?.(new CustomEvent('hazardselected', { detail: { label: event.domainPayload.headline } }));
      } catch { if (token === selectionGeneration) $('mapHazardStatus').textContent = 'The selected flood area could not be retrieved; use the GOV.UK link.'; }
    }
    return {
      showFlood,
      openQuake: (id) => { const entry = quakeToggle.checked ? quakeMarkers.get(id) : null; if (!entry) return false; entry.marker.openPopup(); entry.load(); return true; },
      popup: (event,health,cached) => quakePopup(event, report => impact(event, report),health,cached),
      clear: () => { impactGeneration++; shaking.clearLayers(); $('mapShakingStatus').textContent = ''; }
    };
  }
  globalThis.StormtraceMapHazards = { mount, quakePopup, floodPopup };
})();
