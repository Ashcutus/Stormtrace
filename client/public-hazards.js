(() => {
  'use strict';
  const C = globalThis.StormtraceCore, W = globalThis.StormtraceWarnings, P = globalThis.StormtracePlatform;
  const UI = globalThis.StormtraceUI;
  const VIEWS = {
    cyclones: { title: 'Cyclones', sources: ['nhc'] },
    volcanoes: { title: 'Volcanoes', sources: ['usgs-volcano', 'gvp'] },
    tsunamis: { title: 'Tsunami bulletins', sources: ['noaa-tsunami'] },
    space: { title: 'Space weather', sources: ['swpc'] },
  };
  // Official USGS aviation colour codes, used for volcano map markers.
  const VOLCANO_COLOURS = { GREEN: '#008000', YELLOW: '#ffff00', ORANGE: '#ffa500', RED: '#ff0000' };
  function safeLink(value) {
    let u; try { u = new URL(value); } catch { return false; }
    return u.protocol === 'https:' && !u.username && !u.password && ['www.metoffice.gov.uk','weather.metoffice.gov.uk','www.nhc.noaa.gov','www.hurricanes.gov','www.weather.gov','volcanoes.usgs.gov','www.usgs.gov','volcano.si.edu','www.tsunami.gov','tsunami.gov','www.spaceweather.gov','www.swpc.noaa.gov'].includes(u.host);
  }
  function validBatch(id, result) {
    if (result?.configured !== true || !result.health || !Array.isArray(result.records) || !Array.isArray(result.observations) || result.records.length > 2000) throw new C.ProviderError('malformed', id, 'local_response');
    for (const r of [...result.records, ...result.observations]) {
      C.event(r); const p = r.domainPayload;
      if (r.provider !== id || r.kind !== C.getSource(id).categories[0] || !['title','badge','url','body','instruction','mode'].every((k) => typeof p[k] === 'string') || !safeLink(p.url) || !Array.isArray(p.details) || !p.details.every((v) => typeof v === 'string') || p.links && (!Array.isArray(p.links) || !p.links.every((l) => typeof l.label === 'string' && safeLink(l.url)))) throw new C.ProviderError('malformed', id, 'local_response');
    }
    return result;
  }
  function bulletinState(event, now) {
    const p = event.domainPayload;
    if (event.kind === 'tsunami') {
      if (p.status !== 'Actual') return `${p.status} message · not an operational alert`;
      if (p.msgType === 'Cancel') return 'Cancellation bulletin';
      if (['Ack','Error'].includes(p.msgType)) return `${p.msgType} message · not an operational alert`;
      if (event.validTo != null && event.validTo <= now) return 'Expired bulletin';
      return 'Latest bulletin · check the official source for current alerts';
    }
    if (event.kind === 'space_weather' && p.mode === 'bulletin') return 'Recent issued message · may be expired or superseded';
    return '';
  }
  class HazardController extends W.WarningController {
    async recordObserved(records) {
      // Measurement/forecast snapshots are bounded latest state, never event revisions.
      return super.recordObserved(records.filter((r) => !['measurement','forecast'].includes(r.domainPayload.mode)));
    }
  }
  function mount({ demo = false, getMap = () => null } = {}) {
    const $ = (id) => document.getElementById(id), controllers = {}, initialization = {};
    let marker = null, markerEvent=null, markerHealth=null, markerTime=null;
    const text = (parent, tag, value, cls = '') => { const node = document.createElement(tag); node.textContent = value; node.className = cls; parent.append(node); return node; };
    const link = (parent, label, url) => { const node = text(parent, 'a', label, 'text-button'); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; };
    function clearMarker() { marker?.remove(); marker = null;markerEvent=null; }
    function card(parent, r, key, archive = false) {
      const p = r.domainPayload;
      // Cyclones carry a reported centre; volcanoes carry a USGS summit location.
      // Other kinds have no map location, so they offer only the official link.
      const mappable = !archive && ['cyclone', 'volcano'].includes(r.kind) && r.geometry?.type === 'Point' && getMap();
      const showHere = mappable ? () => {
          // Other modules clear their selection first, so only one event is selected.
          document.dispatchEvent?.(new Event('clearselectedhazard'));
          clearMarker(); const map = getMap(), [lon, lat] = r.geometry.coordinates, cyclone = r.kind === 'cyclone';
          const ctrl = controllers[r.provider];
          const node = document.createElement('section'); node.className = `flood-map-card ${cyclone ? 'cyclone-map-card' : 'volcano-map-card'}`;
          if (!cyclone) node.style.setProperty('--flood-accent', VOLCANO_COLOURS[p.aviationColour] || '#ffb15c');
          text(node, 'span', cyclone ? p.badge : `${p.activity} · aviation ${p.aviationColour}`, 'flood-map-badge'); text(node, 'h3', p.title, 'flood-map-title'); text(node, 'p', r.sourceAuthority, 'flood-map-attribution');
          text(node, 'p', cyclone ? 'Reported cyclone centre only. Forecast track, cone and affected areas are available at the official source.' : 'Volcano summit location from USGS. Ash, gas and hazard areas are described in the official notice, not drawn here.');
          const timeNode = r.updatedAt != null ? text(node, 'p', `${cyclone ? 'Source updated' : 'Notice issued'} ${UI.date(r.updatedAt)}`, 'flood-map-time') : null;
          const health = UI.popupHealth(node, ctrl.state.health, ctrl.state.cached);
          if (cyclone) { markerTime = timeNode; markerHealth = health; }
          link(node, cyclone ? 'Open official advisory' : 'Open the official USGS notice', p.url).className = 'flood-map-link';
          const close = text(node, 'button', 'Close', 'mini-button'); close.type = 'button'; close.addEventListener('click', () => marker?.closePopup());
          markerEvent = r;
          marker = (cyclone && globalThis.L.marker && globalThis.L.divIcon
            ? globalThis.L.marker([lat,lon],{title:`${p.title} · reported cyclone centre`,icon:globalThis.L.divIcon({className:'cyclone-marker',html:'<span aria-hidden="true">↻</span>',iconSize:[28,28],iconAnchor:[14,14]}),bubblingMouseEvents:false})
            : globalThis.L.circleMarker([lat, lon], { radius: cyclone ? 8 : 9, color: '#ffffff', weight: 3, fillColor: cyclone ? '#dfcbff' : (VOLCANO_COLOURS[p.aviationColour] || '#ffb15c'), fillOpacity: .9, bubblingMouseEvents: false })).addTo(map).bindPopup(node, UI.popupOptions());
          UI.showOnMap(map, (options) => map.setView([lat, lon], Math.max(cyclone ? 4 : 6, map.getZoom()), options), marker); $(`${key}Dialog`).close();
          document.dispatchEvent?.(new CustomEvent('hazardselected', { detail: { label: cyclone ? `${p.title} · reported centre` : `${p.title} volcano · ${p.activity}` } }));
      } : null;
      const el = text(parent, 'article', '', 'warning-card public-hazard-card');
      const lifecycle=bulletinState(r,Date.now());if(lifecycle)text(el,'strong',lifecycle,'bulletin-state');
      el.dataset.native = r.kind === 'volcano' ? p.aviationColour || '' : r.kind === 'tsunami' ? p.badge : '';
      text(el, 'span', p.classificationLabel ? `${p.classificationLabel} (${p.badge})` : p.badge, 'warning-badge'); text(el, 'h3', p.title);
      UI.cardActions(el, { onShowMap: showHere, link: { label: 'Open official source', url: p.url } });
      text(el, 'p', r.sourceAuthority);
      if (r.observedAt != null) text(el, 'p', `${p.mode === 'forecast' ? 'Forecast source time' : p.mode === 'measurement' ? 'Observation / product time' : 'Source time'}: ${UI.date(r.observedAt)}`);
      if (r.validFrom != null) text(el, 'p', `${p.mode === 'forecast' ? 'Forecast reference time' : 'Effective / onset'}: ${UI.date(r.validFrom)}`);
      if (r.validTo != null) text(el, 'p', `Source expiry: ${UI.date(r.validTo)}`);

      for (const detail of p.details) text(el, 'p', detail);
      if (p.references?.length) text(el, 'p', `Source references: ${p.references.map((v) => v.identifier).join(', ')}`);
      if (p.body || p.instruction) {
        const disclosure = text(el, 'details', '', 'hazard-bulletin'); text(disclosure, 'summary', 'Read source bulletin');
        if (p.body) text(disclosure, 'p', p.body, 'warning-text');
        if (p.instruction) { text(disclosure, 'h4', 'Official source instructions'); text(disclosure, 'p', p.instruction, 'warning-text'); }
        link(disclosure, 'Open the official bulletin and current guidance', p.url);
      }
      for (const product of p.links || []) {
        link(el, product.label, product.url);
        if (product.issuedAt != null) text(el, 'p', `Advisory ${product.advisoryNumber || 'number not supplied'} · issued ${UI.date(product.issuedAt)}`);
      }
      const provenance=text(el,'details','','provenance-details');text(provenance,'summary','Source details');text(provenance,'p',`Source ID: ${r.id}`);
      if(r.kind==='cyclone')text(provenance,'p','Wind and movement speeds use knots (nautical miles per hour); pressure uses hectopascals. Classification is the source category.');
    }
    document.addEventListener('clearselectedhazard',clearMarker);
    for (const [key, view] of Object.entries(VIEWS)) {
      const dialog = $(`${key}Dialog`), select = $(`${key}Source`), list = $(`${key}List`), archive = $(`${key}Archive`);
      const collection=UI.collection(dialog,list,archive,$(`${key}History`));dialog.addEventListener('collectionchange',render);
      if(key==='space')$('spaceProduct')?.addEventListener('change',()=>{collection.reset();render();});
      let timer = null;
      for (const id of view.sources) {
        const source = C.getSource(id), option = document.createElement('option'); option.value = id; option.textContent = source.name; select.append(option);
        controllers[id] = new HazardController({ id, endpoint: `/api/hazards?source=${encodeURIComponent(id)}`, validate: (r) => validBatch(id, r), interval: source.expectedUpdateInterval, retentionDays: id === 'swpc' ? 30 : 90, onChange: render });
      }
      select.value = view.sources[0]; (select.closest?.('label') || select).hidden = view.sources.length === 1;
      function controller() { return controllers[select.value]; }
      function render() {
        if (!dialog.open) return;
        const ctrl = controller(), s = ctrl.state, source = C.getSource(ctrl.id), fresh = C.freshness(s.health, ctrl.now());
        $(`${key}Attribution`).textContent = source.attribution;
        $(`${key}Coverage`).textContent = source.summary || `${source.coverage}.`;
        $(`${key}OfficialLink`).href = source.homepage;$(`${key}Terms`).href = source.licence.termsUrl;
        $(`${key}Refresh`).disabled = demo || s.loading || Boolean(s.health.lastError && s.retryAt>ctrl.now());
        $(`${key}Refresh`).title = s.retryAt>ctrl.now()?`Source cached/backoff until ${UI.date(s.retryAt)}. Reopening uses the same cache.`:'Check the source';
        $(`${key}History`).disabled = demo;
        const counts={cyclones:'cyclone summaries',volcanoes:'volcanic reports/notices',tsunamis:'latest centre bulletins',space:'space-weather items'};
        $(`${key}Status`).textContent = demo ? 'Live retrieval is disabled in demo mode.' : UI.healthMessage(s,ctrl.now(),counts[key]);
        if(s.storageError)$(`${key}Status`).textContent+=' Saved history is unavailable.';
        const components=s.components||[];
        const componentNode=$(`${key}Components`);if(componentNode){componentNode.textContent=components.filter(c=>c.error).map(c=>`${c.id}: ${c.cached?'cached after retrieval failure':'unavailable'}${c.retryAt>ctrl.now()?` · retry after ${UI.date(c.retryAt)}`:''}`).join(' · ');componentNode.hidden=!componentNode.textContent;}
        $(`${key}StorageStatus`).textContent = s.storageError ? 'Saved history is unavailable on this device; live information remains viewable.' : `This device keeps versions seen while this view was open, for ${ctrl.retentionDays} days (up to 5,000 per source). Measurements and forecasts are not saved. A missing event does not mean it was cancelled.`;
        UI.sourceStatus(`${key}Button`,s);
        let records=s.records.filter(r=>UI.matches(r,collection.filter()));
        if(key==='space') {const product=$('spaceProduct')?.value||'conditions';records=records.filter(r=>product==='conditions'?r.domainPayload.mode==='measurement':product==='forecasts'?r.domainPayload.mode==='forecast':r.domainPayload.mode==='bulletin');}
        if(key==='tsunamis')records.sort((a,b)=> {
          const rank=r=>r.domainPayload.status!=='Actual'||r.domainPayload.msgType==='Cancel'||r.validTo!=null&&r.validTo<=ctrl.now()?10:({'Tsunami Warning':0,'Tsunami Advisory':1,'Tsunami Watch':2,'Tsunami Threat':3}[r.domainPayload.badge]??4);
          return rank(a)-rank(b)||(b.updatedAt||0)-(a.updatedAt||0);
        });
        if(!collection.isHistory?.())collection.summary?.(records.length,s.records.length);
        if (!demo) UI.keyed(list,records.slice(0,collection.limit()),(parent,r)=>card(parent,r,key),r=>bulletinState(r,ctrl.now()));
        if(marker&&key==='cyclones'&&!s.loading) {
          markerHealth?.(s.health,s.cached);
          const current=s.records.find(r=>r.id===markerEvent?.id);
          if(current&&current.updatedAt!==markerEvent.updatedAt){marker.setLatLng?.([...current.geometry.coordinates].reverse());markerEvent=current;if(markerTime)markerTime.textContent=`Source updated ${UI.date(current.updatedAt)} · centre refreshed.`;}
          if(!current&&!s.cached&&markerTime)markerTime.textContent="This centre is no longer in the latest summary. Its lifecycle is not inferred; check the official source.";
        }
      }
      async function initialize(id) {
        return initialization[id] ||= (async () => {
          const ctrl = controllers[id];
          try {
            const [history, snapshots] = await Promise.all([P.IndexedDBStorageAdapter.open(), P.IndexedDBStorageAdapter.open(undefined, `stormtrace-${id}-state`)]);
            ctrl.history = new C.RevisionHistory(history); ctrl.snapshotStorage = snapshots; await ctrl.restore();
          } catch { ctrl.storageFailure(); }
        })();
      }
      async function poll() {
        if (demo || document.hidden || !dialog.open) return;
        const id = select.value; await initialize(id);
        if (!document.hidden && dialog.open && select.value === id) await controllers[id].refresh();
      }
      function schedule() { clearInterval(timer); timer = setInterval(poll, 60000); }
      $(`${key}Button`).addEventListener('click', () => { dialog.showModal(); render(); poll(); schedule(); });
      $(`${key}Refresh`).addEventListener('click', poll);
      select.addEventListener('change', () => { collection.reset(); archive.renderArchive=null; archive.replaceChildren(); render(); poll(); schedule(); });
      $(`${key}History`).addEventListener('click', async () => {
        const id = select.value; archive.replaceChildren(); await initialize(id);
        try {
          const rows = await controllers[id].history?.query({ provider: id, time: 'persistedAt' }) || [];
          if (!dialog.open || select.value !== id) return;
          rows.sort((a,b) => b.persistedAt - a.persistedAt);
          UI.archiveView(archive,rows,(parent,r)=>card(parent,r,key,true),collection);
        } catch { if (dialog.open && select.value === id) text(archive, 'p', 'Saved history is unavailable on this device.'); }
      });
      dialog.addEventListener('close', () => { clearInterval(timer); timer = null; archive.replaceChildren(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) poll(); });
    }
    return { controllers, clearMarker };
  }
  globalThis.StormtracePublicHazards = { VIEWS, validBatch, bulletinState, HazardController, mount };
})();
