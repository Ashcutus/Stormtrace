(() => {
  'use strict';
  const C=globalThis.StormtraceCore,UI=globalThis.StormtraceUI;
  const ID='metoffice-warnings-esri', colours={RED:'#CC0033',AMBER:'#FF9900',YELLOW:'#FFE923'};
  function valid(result) {
    globalThis.StormtracePublicHazards.validBatch(ID,result);
    for(const r of result.records)if(!colours[r.domainPayload.badge]||!['Polygon','MultiPolygon'].includes(r.geometry?.type)||![r.observedAt,r.validFrom,r.validTo].every(Number.isFinite)||typeof r.domainPayload.whatToExpect!=='string')throw new C.ProviderError('malformed',ID,'local_response');
    return result;
  }
  // Warning summaries and map areas come from separate Met Office services with no shared ID, so a
  // warning is matched to its area by severity, weather type and the places each lists.
  const placeKey=value=>String(value||'').trim().toLowerCase();
  // Compare [regions matched, places shared, -places differing, -start time gap] in order.
  const outranks=(a,b)=>{const i=a.findIndex((v,n)=>v!==b[n]);return i>=0&&a[i]>b[i];};
  function matchArea(query,records) {
    const types=new Set((query.types||[]).map(placeKey));let best=null;
    for(const r of records){
      const p=r.domainPayload;if(p.badge!==query.level||(types.size&&!types.has(placeKey(p.title))))continue;
      const regions=new Map((p.affectedAreas||[]).map(a=>[placeKey(a.regionName),new Set(a.subRegions.map(placeKey))]));
      let regionsMatched=0,shared=0,differing=0;
      for(const area of query.areas||[]){
        const places=regions.get(placeKey(area.regionName));if(!places)continue;regionsMatched++;
        const wanted=new Set(area.subRegions.map(placeKey));
        for(const place of wanted)if(places.has(place))shared++;else differing++;
        for(const place of places)if(!wanted.has(place))differing++;
      }
      if(!regionsMatched)continue;
      const timing=Number.isFinite(query.validFrom)?Math.abs(r.validFrom-query.validFrom):0;
      const score=[regionsMatched,shared,-differing,-timing];
      if(!best||outranks(score,best.score))best={record:r,score};
    }
    return best?.record||null;
  }
  let api=null;
  function mount({demo=false}={}) {
    const $=id=>document.getElementById(id),dialog=$('warningMapDialog');if(!dialog)return;
    let map=null,layer=null,timer=null,signature='',updates=[],highlighted=null,pinned=null,pending=null;const levels=new Set(Object.keys(colours));const features=new Map();
    const source=C.getSource(ID),ctrl=new globalThis.StormtraceWarnings.WarningController({id:ID,endpoint:'/api/hazards?source='+ID,interval:source.expectedUpdateInterval,validate:valid,onChange:render});
    $('warningMapAttribution').textContent=source.attribution;
    function popup(r) {
      const p=r.domainPayload,n=document.createElement('section');n.className='flood-map-card warning-area-card';n.style.borderTopColor=colours[p.badge];
      const badge=UI.text(n,'span',p.badge+' · '+p.title,'flood-map-badge');badge.style.background=colours[p.badge];badge.style.color=p.badge==='RED'?'#fff':'#000';
      // NSWWS presentation requires UK-local times regardless of the viewer's time preference.
      UI.text(n,'h3',p.headline,'flood-map-title');UI.text(n,'p',`Issued ${UI.fixedUkDate(r.observedAt)} · ${UI.fixedUkDate(r.validFrom)} – ${UI.fixedUkDate(r.validTo)}`,'flood-map-time');
      const body=UI.text(n,'div','','flood-map-message');body.tabIndex=0;
      UI.text(body,'h4','What to expect');UI.text(body,'p',p.whatToExpect);UI.text(body,'h4','Further details');UI.text(body,'p',p.body);for(const d of p.details)UI.text(body,'p',d);
      UI.text(n,'p',`Met Office Weather Warnings · © Crown copyright ${new Date(r.observedAt).getUTCFullYear()}, Met Office`,'flood-map-attribution');updates.push(UI.popupHealth(n,ctrl.state.health,ctrl.state.cached,UI.fixedUkDate));
      const link=UI.text(n,'a','Read current Met Office warnings ↗','flood-map-link');link.href=p.url;link.target='_blank';link.rel='noopener noreferrer';
      const close=UI.text(n,'button','Close','mini-button');close.type='button';close.addEventListener('click',()=>map.closePopup());return n;
    }
    // Emphasise one area and its list entry; official colours stay unchanged, only weight and opacity vary.
    // Hovering previews an area; a focused area stays emphasised until its details close.
    function highlight(hover) {
      highlighted=hover;const id=hover??pinned;
      for(const [key,geo] of features)geo.setStyle(id==null?{weight:2,opacity:1,fillOpacity:.4}:key===id?{weight:5,opacity:1,fillOpacity:.7}:{weight:1,opacity:.45,fillOpacity:.12});
      features.get(id)?.bringToFront();
      for(const [key,geo] of features){const label=geo.getTooltip?.()?.getElement?.();if(label){label.style.setProperty('--warning-colour',geo.options?.style?.color);label.classList.toggle('active',key===id);label.classList.toggle('dimmed',id!=null&&key!==id);}}
      for(const button of $('warningMapList').querySelectorAll('[data-warning-id]'))button.classList.toggle('active',button.dataset.warningId===id);
    }
    function render() {
      if(!dialog.open)return;
      const s=ctrl.state;$('warningMapRefresh').disabled=demo||s.loading;
      $('warningMapStatus').textContent=demo?'Live warning areas are disabled in demo mode.':UI.healthMessage(s,ctrl.now(),'warning areas')+' Areas come from the Met Office public map service (beta); check the Met Office for current guidance.';
      for(const update of updates)update(s.health,s.cached);
      const current=s.records.filter(r=>r.validTo>ctrl.now()).sort((a,b)=>({RED:2,AMBER:1,YELLOW:0}[a.domainPayload.badge])-({RED:2,AMBER:1,YELLOW:0}[b.domainPayload.badge]));
      // A warning opened from the list must be visible even if its level was hidden.
      const target=pending&&!s.loading&&s.configured!=null?matchArea(pending,current):null;
      if(target)levels.add(target.domainPayload.badge);
      const records=current.filter(r=>levels.has(r.domainPayload.badge));
      for(const chip of dialog.querySelectorAll('.severity-chip')){const level=chip.dataset.level,count=current.filter(r=>r.domainPayload.badge===level).length;chip.textContent=`${level[0]+level.slice(1).toLowerCase()} ${count}`;chip.setAttribute('aria-pressed',String(levels.has(level)));}
      if(!demo)$('warningMapStatus').textContent+=records.length===current.length?` ${current.length} current or future areas shown.`:` ${records.length} of ${current.length} current or future areas shown; other severity levels are hidden.`;
      const years=[...new Set(records.map(r=>new Date(r.observedAt).getUTCFullYear()))];$('warningMapAttribution').textContent=source.attribution+(years.length?` · © Crown copyright ${years.join(', ')}, Met Office`:'');
      const next=[...levels].join()+C.canonical(records.map(r=>({id:r.id,geometry:r.geometry,p:r.domainPayload,start:r.validFrom,end:r.validTo})));
      if(!map)return;
      if(next===signature){focusPending(target,s);return;}
      signature=next;updates=[];features.clear();layer.clearLayers();
      for(const r of records){const p=r.domainPayload,geo=globalThis.L.geoJSON(r.geometry,{style:{color:colours[p.badge],fillColor:colours[p.badge],fillOpacity:.4,weight:2}});geo.bindTooltip(p.badge+' · '+p.title,{permanent:true,direction:'center',className:'warning-area-label'});geo.bindPopup(popup(r),UI.popupOptions({minWidth:260}));geo.on('mouseover',()=>highlight(r.id)).on('mouseout',()=>highlight(null)).on('popupclose',()=>{if(pinned===r.id){pinned=null;highlight(null);}});layer.addLayer(geo);features.set(r.id,geo);}
      UI.keyed($('warningMapList'),records,(parent,r)=>{
        const p=r.domainPayload,button=UI.text(parent,'button','','mini-button warning-area-button');button.type='button';button.dataset.warningId=r.id;button.style.setProperty('--warning-colour',colours[p.badge]);
        const badge=UI.text(button,'span',p.badge+' · '+p.title,'warning-area-badge');badge.style.background=colours[p.badge];badge.style.color=p.badge==='RED'?'#fff':'#000';
        UI.text(button,'span',p.details.join(' · '));
        button.addEventListener('click',()=>focusArea(r.id));
        for(const name of ['mouseenter','focus'])button.addEventListener(name,()=>highlight(r.id));
        for(const name of ['mouseleave','blur'])button.addEventListener(name,()=>{if(highlighted===r.id)highlight(null);});
      });
      highlight(null);
      focusPending(target,s);
    }
    function focusArea(id) {
      const geo=features.get(id);if(!geo)return;
      map.fitBounds(geo.getBounds(),{padding:[25,25],maxZoom:7,animate:false});pinned=id;highlight(null);geo.openPopup();
      [...$('warningMapList').querySelectorAll('[data-warning-id]')].find(b=>b.dataset.warningId===id)?.scrollIntoView?.({block:'nearest'});
    }
    // Resolve a warning opened from the list once this service has answered.
    function focusPending(target,s) {
      if(!pending||s.loading||s.configured==null)return;
      pending=null;
      if(target)focusArea(target.id);
      else $('warningMapStatus').textContent+=' The warning you selected has no matching area on this map service yet; it can lag behind the Met Office website.';
    }
    async function poll(){if(!demo&&dialog.open&&!document.hidden)await ctrl.refresh();}
    function open(query=null) {
      pending=query;
      $('warningsDialog').close();if(!dialog.open)dialog.showModal();
      if(!map){
        map=globalThis.L.map('warningAreaMap',{zoomControl:true,attributionControl:true}).setView([55,-4],5);map.attributionControl.setPrefix(false);
        // Match the main map's English-labelled basemap; fall back to raster tiles without WebGL.
        try { if(!UI.vectorMapAvailable())throw new Error('vector map unavailable'); globalThis.L.maplibreGL({style:'/client/map-style.json',attributionControl:false}).addTo(map);map.attributionControl.addAttribution('<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · © OpenMapTiles · © OpenStreetMap contributors'); }
        catch { globalThis.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'}).addTo(map); }
        layer=globalThis.L.layerGroup().addTo(map);map.fitBounds([[49.5,-11],[61.5,2.5]]);
      }
      map.invalidateSize();render();poll();clearInterval(timer);timer=setInterval(poll,60000);
    }
    $('warningMapButton').addEventListener('click',()=>open());
    $('warningMapRefresh').addEventListener('click',poll);
    for(const chip of dialog.querySelectorAll('.severity-chip'))chip.addEventListener('click',()=>{const level=chip.dataset.level;if(levels.has(level))levels.delete(level);else levels.add(level);render();});
    $('warningMapBack')?.addEventListener('click',()=>{dialog.close();$('warningsButton').click();});
    dialog.addEventListener('close',()=>{clearInterval(timer);timer=null;});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dialog.open)poll();});
    api={controller:ctrl,show:open};
    return api;
  }
  // Open the map focused on a warning: {level, types, areas:[{regionName, subRegions}], validFrom?}.
  function show(query){api?.show(query);}
  globalThis.StormtraceWarningMap={mount,valid,show,matchArea};
})();
