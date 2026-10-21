(() => {
  'use strict';
  const C=globalThis.StormtraceCore,UI=globalThis.StormtraceUI;
  const ID='metoffice-warnings-esri', colours={RED:'#CC0033',AMBER:'#FF9900',YELLOW:'#FFE923'};
  function valid(result) {
    globalThis.StormtracePublicHazards.validBatch(ID,result);
    for(const r of result.records)if(!colours[r.domainPayload.badge]||!['Polygon','MultiPolygon'].includes(r.geometry?.type)||![r.observedAt,r.validFrom,r.validTo].every(Number.isFinite)||typeof r.domainPayload.whatToExpect!=='string')throw new C.ProviderError('malformed',ID,'local_response');
    return result;
  }
  function mount({demo=false}={}) {
    const $=id=>document.getElementById(id),dialog=$('warningMapDialog');if(!dialog)return;
    let map=null,layer=null,timer=null,signature='',updates=[];const features=new Map();
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
    function render() {
      if(!dialog.open)return;
      const s=ctrl.state;$('warningMapRefresh').disabled=demo||s.loading;
      $('warningMapStatus').textContent=demo?'Live warning areas are disabled in demo mode.':UI.healthMessage(s,ctrl.now(),'warning areas')+' Areas come from the Met Office public map service (beta); check the Met Office for current guidance.';
      for(const update of updates)update(s.health,s.cached);
      const records=s.records.filter(r=>r.validTo>ctrl.now()).sort((a,b)=>({RED:2,AMBER:1,YELLOW:0}[a.domainPayload.badge])-({RED:2,AMBER:1,YELLOW:0}[b.domainPayload.badge]));
      if(!demo)$('warningMapStatus').textContent+=` ${records.length} current or future areas shown.`;
      const years=[...new Set(records.map(r=>new Date(r.observedAt).getUTCFullYear()))];$('warningMapAttribution').textContent=source.attribution+(years.length?` · © Crown copyright ${years.join(', ')}, Met Office`:'');
      const next=C.canonical(records.map(r=>({id:r.id,geometry:r.geometry,p:r.domainPayload,start:r.validFrom,end:r.validTo})));
      if(!map||next===signature)return;signature=next;updates=[];features.clear();layer.clearLayers();
      for(const r of records){const p=r.domainPayload,geo=globalThis.L.geoJSON(r.geometry,{style:{color:colours[p.badge],fillColor:colours[p.badge],fillOpacity:.4,weight:2}});geo.bindTooltip(p.badge+' · '+p.title,{permanent:true,direction:'center',className:'warning-area-label'});geo.bindPopup(popup(r),{className:'hazard-popup flood-map-popup',minWidth:260,maxWidth:380});layer.addLayer(geo);features.set(r.id,geo);}
      UI.keyed($('warningMapList'),records,(parent,r)=>{const button=UI.text(parent,'button',r.domainPayload.badge+' · '+r.domainPayload.title+' · '+r.domainPayload.details.join(' · '),'mini-button');button.type='button';button.addEventListener('click',()=>{const geo=features.get(r.id);if(geo){map.fitBounds(geo.getBounds(),{padding:[25,25],maxZoom:7,animate:false});geo.openPopup();}});});
    }
    async function poll(){if(!demo&&dialog.open&&!document.hidden)await ctrl.refresh();}
    $('warningMapButton').addEventListener('click',()=>{
      $('warningsDialog').close();dialog.showModal();
      if(!map){
        map=globalThis.L.map('warningAreaMap',{zoomControl:true,attributionControl:true}).setView([55,-4],5);map.attributionControl.setPrefix(false);
        // Match the main map's English-labelled basemap; fall back to raster tiles without WebGL.
        try { globalThis.L.maplibreGL({style:'/client/map-style.json',attributionControl:false}).addTo(map);map.attributionControl.addAttribution('<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> · © OpenMapTiles · © OpenStreetMap contributors'); }
        catch { globalThis.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'}).addTo(map); }
        layer=globalThis.L.layerGroup().addTo(map);map.fitBounds([[49.5,-11],[61.5,2.5]]);
      }
      map.invalidateSize();render();poll();clearInterval(timer);timer=setInterval(poll,60000);
    });
    $('warningMapRefresh').addEventListener('click',poll);
    $('warningMapBack')?.addEventListener('click',()=>{dialog.close();$('warningsButton').click();});
    dialog.addEventListener('close',()=>{clearInterval(timer);timer=null;});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dialog.open)poll();});
    return {controller:ctrl};
  }
  globalThis.StormtraceWarningMap={mount,valid};
})();
