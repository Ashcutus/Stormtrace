(() => {
  'use strict';
  const C = globalThis.StormtraceCore, P = globalThis.StormtracePlatform, W = globalThis.StormtraceWarnings;
  const UI = globalThis.StormtraceUI;
  function validBatch(payload) {
    if (payload?.configured !== true || !payload.health || !Array.isArray(payload.records) || !Array.isArray(payload.observations)) throw new C.ProviderError('malformed','usgs','local_response');
    for (const r of [...payload.records,...payload.observations]) {
      C.event(r); const p = r.domainPayload;
      if (r.kind !== 'earthquake' || r.provider !== 'usgs' || !Number.isFinite(r.observedAt) || !Number.isFinite(r.updatedAt) || r.geometry?.type !== 'Point' || !Number.isFinite(p.depthKm) || (p.magnitude != null && !Number.isFinite(p.magnitude)) || (p.magnitudeType != null && typeof p.magnitudeType !== 'string') || !['status','url','network'].every((k) => typeof p[k] === 'string') || (p.place != null && typeof p.place !== 'string') || !/^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/[A-Za-z0-9_-]+\/?$/.test(p.url)) throw new C.ProviderError('malformed','usgs','local_response');
    }
    return payload;
  }
  function visibleEarthquakes(records, { now = Date.now(), hours = 24, minimum = null, search = '' } = {}) {
    return records.filter((r) => r.observedAt <= now && r.observedAt >= now-hours*3600000 && (minimum == null || r.domainPayload.magnitude != null && r.domainPayload.magnitude >= minimum) && (r.domainPayload.place || '').toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a,b) => b.observedAt-a.observedAt || a.id.localeCompare(b.id));
  }
  function mountEarthquakes({ demo = false, map = null, mapHazards = null } = {}) {
    const $ = (id) => document.getElementById(id), dialog = $('earthquakesDialog'), list = $('earthquakeList');
    const controller = new W.WarningController({ id:'usgs', endpoint:'/api/earthquakes', validate:validBatch, interval:60000, retentionDays:30, onChange:render });
    const collection=UI.collection(dialog,list,$('earthquakeArchive'),$('earthquakeHistory'));
    dialog.addEventListener('collectionchange',render);
    let initialization = null, timer = null, selectedMarker = null;
    $('earthquakeAttribution').textContent = C.getSource('usgs').attribution;
    const text = (parent, tag, value, cls = '') => { const el = document.createElement(tag); el.textContent = value; el.className = cls; parent.append(el); return el; };
    async function initialize() {
      return initialization ||= (async () => {
        try { const [history,snapshots] = await Promise.all([P.IndexedDBStorageAdapter.open(),P.IndexedDBStorageAdapter.open(undefined,'stormtrace-earthquake-state')]);controller.history=new C.RevisionHistory(history);controller.snapshotStorage=snapshots;await controller.restore(); }
        catch {controller.storageFailure();}
      })();
    }
    document.addEventListener('clearselectedhazard',clearMarker);
    function clearMarker() { mapHazards?.clear(); if (selectedMarker) { selectedMarker.remove();selectedMarker=null; } }
    function card(parent,event,historyView=false) {
      const p=event.domainPayload;
      const showHere=map && !historyView ? () => {
        document.dispatchEvent?.(new Event('clearselectedhazard'));
        clearMarker(); const [lon,lat]=event.geometry.coordinates;
        const label=`${p.magnitude == null ? 'Earthquake' : `M ${p.magnitude}`} · ${p.place || 'location description unavailable'}`;
        // Reuse the earthquake layer's point when it is shown, so one event never has two markers.
        const move=(options)=>map.setView([lat,lon],Math.max(5,map.getZoom()),options);
        if (mapHazards?.openQuake?.(event.id,move)) { dialog.close();document.dispatchEvent?.(new CustomEvent('hazardselected',{detail:{label}}));return; }
        const content=mapHazards?.popup(event,controller.state.health,controller.state.cached);
        const fallback=document.createElement('div');fallback.textContent=`USGS earthquake · ${p.place || 'Location description unavailable'} · ${p.magnitude == null ? 'magnitude unknown' : `M ${p.magnitude}`}`;
        selectedMarker=globalThis.L.circleMarker([lat,lon],{radius:10,color:'#ffffff',weight:3,fillColor:'#67d7eb',fillOpacity:0.6,bubblingMouseEvents:false}).addTo(map).bindPopup(content?.node || fallback, UI.popupOptions());
        if(content) selectedMarker.on('click',content.load);
        dialog.close();UI.showOnMap(map,move,selectedMarker);content?.load();
        document.dispatchEvent?.(new CustomEvent('hazardselected',{detail:{label}}));
      } : null;
      const el=text(parent,'article','','warning-card flood-card');
      text(el,'span','Earthquake','warning-badge');
      text(el,'h3',`${p.magnitude == null ? 'Magnitude unknown' : `M ${p.magnitude}${p.magnitudeType ? ` ${p.magnitudeType}` : ''}`} · ${p.place || 'Location description unavailable'}`);
      UI.cardActions(el,{onShowMap:showHere,link:{label:'USGS event details',url:p.url}});
      text(el,'p',`Occurred ${UI.date(event.observedAt)} · updated ${UI.date(event.updatedAt)}`);
      text(el,'p',`Depth ${UI.depth(p.depthKm)} · ${p.status} · reporting network ${p.network || 'not supplied'}`);
      text(el,'p',`Source event ID: ${event.id}`);
    }
    function render() {
      if (!dialog.open) return;const s=controller.state;
      const minimum=$('earthquakeMagnitude').value === 'all' ? null : Number($('earthquakeMagnitude').value);
      const all=visibleEarthquakes(s.records,{now:controller.now(),hours:Number($('earthquakeWindow').value),minimum});
      const records=all.filter(r=>UI.matches(r,collection.filter()));
      if (!collection.isHistory?.()) collection.summary?.(records.length,all.length);
      $('earthquakeRefresh').disabled=s.loading||demo;$('earthquakeHistory').disabled=demo;
      $('earthquakeStatus').textContent=demo?'Live earthquakes are disabled in demo mode.':UI.healthMessage(s,controller.now(),'earthquakes match these filters',records.length);
      UI.sourceStatus('earthquakesButton',s);
      if (s.storageError) document.getElementById('earthquakeStatus').textContent += ' Saved history is unavailable.';
      $('earthquakeStorageStatus').textContent=s.storageError?'Saved history is unavailable on this device.':'This device keeps versions seen while this view was open, for up to 30 days (5,000 event limit). It is not a complete earthquake archive.';
      if (!demo) UI.keyed(list,records.slice(0,collection.limit()),card);
    }
    async function poll() {if(demo||document.hidden||!dialog.open)return;await initialize();if(dialog.open&&!document.hidden)await controller.refresh();}
    $('earthquakesButton').addEventListener('click',()=> {dialog.showModal();render();poll();clearInterval(timer);timer=setInterval(poll,60000);});
    $('earthquakeRefresh').addEventListener('click',poll);
    for(const id of ['earthquakeMagnitude','earthquakeWindow'])$(id).addEventListener('change',render);
    $('earthquakeHistory').addEventListener('click',async()=> {
      await initialize();const archive=$('earthquakeArchive');archive.replaceChildren();
      try {const rows=await controller.history?.query({provider:'usgs',time:'persistedAt'})||[];rows.sort((a,b)=>b.persistedAt-a.persistedAt);UI.archiveView(archive,rows,card,collection);}
      catch {text(archive,'p','Saved history is unavailable on this device.');}
    });
    dialog.addEventListener('close',()=> {clearInterval(timer);timer=null;$('earthquakeArchive').replaceChildren();});
    document.addEventListener('visibilitychange',()=> {if(!document.hidden&&dialog.open)poll();});
    return controller;
  }
  globalThis.StormtraceEarthquakes={validBatch,visibleEarthquakes,mountEarthquakes};
})();
