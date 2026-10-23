import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadApp} from './helpers/app-harness.js';
import C from '../core/index.js';
import '../client/presentation.js';
import '../client/warnings.js';
const UI=globalThis.StormtraceUI;

test('nearby lightning requires a recent trustworthy source time and does not consume cooldown for stale/future/inferred packets',()=>{
 const a=loadApp({notificationPermission:'granted'});a.state.userLocation={lat:0,lon:0,accuracy:0};a.state.notificationsEnabled=true;
 const origin=time=>({provider:'lightningmaps',sourceAuthority:'test',observedAt:time,transformations:[]});
 for(const [time,provenance] of [[a.now()-3600000,origin(a.now()-3600000)],[a.now()+31000,origin(a.now()+31000)],[a.now(),null],[a.now(),{...origin(null),transformations:['time-inferred-from-fetch']}]] )a.checkProximityAlert({lat:0,lon:0,region:'Test',time,provenance});
 assert.equal(a.notifications.length,0);assert.equal(a.state.lastAlertAt,0);
 a.checkProximityAlert({lat:0,lon:0,region:'Test',time:a.now()-60000,provenance:origin(a.now()-60000)});assert.equal(a.notifications.length,1);assert.match(a.notifications[0].body,/detected 1m ago/);
 a.checkProximityAlert({lat:0,lon:0,time:a.now(),provenance:origin(a.now())});assert.equal(a.notifications.length,1);
 // A local clock slightly behind the detection network still alerts.
 const skewed=loadApp({notificationPermission:'granted'});skewed.state.userLocation={lat:0,lon:0,accuracy:0};skewed.state.notificationsEnabled=true;
 skewed.checkProximityAlert({lat:0,lon:0,region:'Test',time:skewed.now()+3000,provenance:origin(skewed.now()+3000)});assert.equal(skewed.notifications.length,1);assert.match(skewed.notifications[0].body,/just now/);
});
test('background shortcuts are suppressed by open dialogs, selectors, editable contexts and modifiers; main-view P still works',()=>{
 const a=loadApp();a.bindControls();const handler=a.document.listeners.keydown;
 const event=(target={},extra={})=>({key:'p',target:{matches:()=>false,...target},preventDefault(){},...extra});
 a.document.querySelector('#spaceDialog').open=true;handler(event());assert.equal(a.state.monitoringPaused,false);
 a.document.querySelector('#spaceDialog').open=false;handler(event({matches:()=>true}));handler(event({}, {ctrlKey:true}));handler(event({}, {isComposing:true}));assert.equal(a.state.monitoringPaused,false);
 handler(event());assert.equal(a.state.monitoringPaused,true);
});
test('late search completion cannot overwrite newer results and out-of-range coordinates do not reach place transport',async()=>{
 const pending=[];const a=loadApp({fetch:async(url)=>new Promise(resolve=>pending.push({url,resolve}))});
 const first=a.runSearch('first'),second=a.runSearch('second');
 pending[1].resolve({ok:true,json:async()=>[{lat:'51',lon:'0',display_name:'Second result, Test'}]});await second;
 pending[0].resolve({ok:true,json:async()=>[{lat:'52',lon:'1',display_name:'First result, Test'}]});await first;
 assert.match(a.els.searchResults.innerHTML,/Second result/);assert.doesNotMatch(a.els.searchResults.innerHTML,/First result/);
 await a.runSearch('100,200');assert.equal(pending.length,2);assert.match(a.elements.get('#searchStatus').textContent,/out of range/);
});
test('malformed feed messages show degraded health and save failure remains persistent until successful retry',()=>{
 let broken=true;const a=loadApp({storage:{getItem:()=>null,setItem(){if(broken)throw new Error('quota');}}});a.connectFeed();a.sockets[0].onopen();a.sockets[0].onmessage({data:'invalid JSON'});assert.equal(a.els.statusLabel.textContent,'Degraded');
 assert.equal(a.saveSettings(),false);assert.equal(a.elements.get('#settingsSaveStatus').hidden,false);broken=false;assert.equal(a.saveSettings(),true);assert.equal(a.elements.get('#settingsSaveStatus').hidden,true);
});
test('render coverage discloses capped points and hidden layers while preserving record counts',()=>{
 const a=loadApp();a.ingestStrikes(Array.from({length:4001},(_,i)=>({id:'test-'+i,lat:0,lon:0,time:a.now()})),false,false);a.render();assert.equal(a.markers.size,4000);assert.match(a.elements.get('#renderCoverage').textContent,/4,000 of 4,001/);
 a.elements.get('#mapLightning').checked=false;a.render();assert.match(a.elements.get('#renderCoverage').textContent,/hidden/);assert.equal(a.els.visibleCount.textContent,'4,001');
});
// A small DOM implementation exercises actual node moves and focus/disclosure restoration.
class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.parent=null;this.open=false;this.textContent='';}
 append(n){this.insertBefore(n,null);}insertBefore(n,before){if(n.parent)n.remove();const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,n);n.parent=this;}
 remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
 querySelectorAll(tags){const accepted=tags.split(',');return this.children.flatMap(n=>[...(accepted.includes(n.tagName)?[n]:[]),...n.querySelectorAll(tags)]);}
 focus(){globalThis.document.activeElement=this;}
}
test('keyed lists preserve node identity and open/focused content through unchanged refresh; changed content restores disclosure and focus',()=>{
 const old=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),activeElement:null};
 try {
  const container=new Node('div');const build=(parent,r)=>{const card=new Node('article'),d=new Node('details'),button=new Node('button');card.append(d);card.append(button);parent.append(card);};
  const r={id:'test',provenance:{fetchedAt:1},domainPayload:{text:'one'}};UI.keyed(container,[r],build);const first=container.children[0];first.children[0].open=true;first.children[1].focus();
  UI.keyed(container,[{...r,provenance:{fetchedAt:2}}],build);assert.equal(container.children[0],first);assert.equal(document.activeElement,first.children[1]);assert.equal(first.children[0].open,true);
  UI.keyed(container,[{...r,domainPayload:{text:'two'}}],build);const second=container.children[0];assert.notEqual(first,second);assert.equal(second.children[0].open,true);assert.equal(document.activeElement,second.children[1]);
 }finally{globalThis.document=old;}
});
test('partial upstream products preserve independent successful/cached records, back off failed products and recover without duplicate polls',()=>{
 const output=execFileSync('python3',['-c',`
import io,json
from pathlib import Path
from urllib.error import HTTPError
from providers.public_hazards import PublicHazardProvider
clock=[1791900000000];fail=[False];calls=[]
class Response(io.BytesIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
def opener(req,timeout):
 calls.append(req.full_url)
 if 'alerts.json' in req.full_url and fail[0]:raise HTTPError(req.full_url,503,'offline',{},None)
 name='alerts.json' if 'alerts.json' in req.full_url else 'scales.json'
 return Response(Path('tests/fixtures/public-hazards/'+name).read_bytes())
p=PublicHazardProvider('swpc',opener=opener,clock=lambda:clock[0]);first=p.current();assert not first['partial'];assert len(calls)==2
clock[0]+=300000;fail[0]=True;partial=p.current();assert partial['partial'];assert any(r['domainPayload']['mode']=='measurement' for r in partial['records']);assert any(r['domainPayload']['mode']=='bulletin' for r in partial['records']);assert partial['components'][1]['cached'];assert len(calls)==4
p.current();assert len(calls)==4
clock[0]+=60000;fail[0]=False;recovered=p.current();assert not recovered['partial'];assert len(calls)==5
# A fresh Node worker restores independent component caches from the previous result.
fresh=PublicHazardProvider('swpc',opener=opener,clock=lambda:clock[0]);fresh.restore_components(recovered);assert not fresh.current()['partial'];assert len(calls)==5
print('ok')
`],{encoding:'utf8'});assert.match(output,/ok/);
});
test('markup keeps one layers control, one location group, labelled dialog scopes and no duplicate controls',()=>{
 const html=readFileSync('index.html','utf8'),css=readFileSync('styles.css','utf8');
 assert.match(html,/themeDialog" aria-labelledby="themeTitle/);assert.match(html,/role="combobox"/);assert.match(html,/id="themeTitle">Appearance</);
 const layers=html.slice(html.indexOf('id="layersPanel"'),html.indexOf('</details>',html.indexOf('id="layersPanel"')));
 for(const id of ['mapLightning','radarButton','mapFloods','mapQuakes','clearSelectedHazard'])assert.match(layers,new RegExp(`id="${id}"`),id);
 assert.match(layers,/id="radarButton" type="checkbox"/);
 const controls=html.slice(html.indexOf('class="map-controls"'),html.indexOf('</div>',html.indexOf('class="map-controls"')));assert.doesNotMatch(controls,/setHere/);
 const location=html.slice(html.indexOf('id="locationGroup"'),html.indexOf('</section>',html.indexOf('id="locationGroup"')));for(const id of ['enableLocationButton','setHere','manualLocationForm'])assert.match(location,new RegExp(`id="${id}"`),id);
 assert.doesNotMatch(html,/domainChooser|ClearMarker|earthquakeSearch|Close popup|About local history/);
 assert.doesNotMatch(html,/<\/span>%<\/strong>/);
 assert.match(html,/id="shortcutsDialog"/);assert.match(html,/id="timeZoneSetting"/);assert.match(html,/id="warningMapBack"/);
 for(const key of ['cyclones','volcanoes','tsunamis','space'])assert.match(html,new RegExp(`<label class="scope-field">Source <select id="${key}Source">`),key);
 assert.match(css,/switch:focus-within/);assert.match(css,/prefers-reduced-motion/);assert.equal((css.match(/^\.domain-nav/gm)||[]).length,0);
});

test('one unavailable tsunami centre does not hide the other, and neither absence nor partial failure becomes cancellation',()=>{
 const result=execFileSync('python3',['-c',`
import io
from pathlib import Path
from urllib.error import HTTPError
from providers.public_hazards import PublicHazardProvider
class Response(io.BytesIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
def opener(req,timeout):
 if 'PAAQCAP' in req.full_url:raise HTTPError(req.full_url,503,'unavailable',{},None)
 return Response(Path('tests/fixtures/public-hazards/ptwc.xml').read_bytes())
r=PublicHazardProvider('noaa-tsunami',opener=opener,clock=lambda:1791900000000).current()
assert r['partial'];assert len(r['records'])==1;assert r['records'][0]['domainPayload']['centre']=='PTWC';assert r['records'][0]['domainPayload']['msgType']=='Alert';assert r['components'][0]['error'];assert r['components'][1]['error'] is None
print('ok')
`],{encoding:'utf8'});assert.match(result,/ok/);
});

test('CAP cancellations without info preserve root identity and references without inventing severity/area metadata',()=>{
 const script=`import json;from pathlib import Path;from providers.public_hazards import normalize_tsunamis;raw='<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>cancel-1</identifier><sender>ntwc@noaa.gov</sender><sent>2026-10-13T15:00:00Z</sent><status>Actual</status><msgType>Cancel</msgType><scope>Public</scope><references>ntwc@noaa.gov,old-1,2026-10-13T14:00:00Z</references></alert>';r=normalize_tsunamis([raw],1791904000000,('NTWC',))[0];print(json.dumps(r))`;
 const r=JSON.parse(execFileSync('python3',['-c',script],{encoding:'utf8'}));assert.equal(r.sourceSeverity,null);assert.equal(r.geometry,null);assert.equal(r.domainPayload.msgType,'Cancel');assert.equal(r.domainPayload.references[0].identifier,'old-1');assert.deepEqual(r.domainPayload.areas,[]);
});

test('reading-size preferences are additive, bounded, applied immediately and preserve the original settings key',()=>{
 let saved;const a=loadApp({storage:{getItem:()=>JSON.stringify({radiusMiles:35,userLocation:{lat:1,lon:2,accuracy:0,source:'manual'}}),setItem(key,value){assert.equal(key,'stormtrace:settings');saved=JSON.parse(value);}}});assert.equal(a.state.readingScale,1);a.bindControls();a.elements.get('#readingScale').listeners.change({target:{value:'1.4'}});assert.equal(a.state.readingScale,1.4);assert.equal(saved.radiusMiles,35);assert.equal(saved.userLocation.lat,1);assert.equal(saved.readingScale,1.4);
});

test('popup age follows its declared fetch-based policy, so a quiet old bulletin remains healthy after a recent successful fetch',()=>{
 const original=globalThis.document,clock=Date.now();const parent={children:[],append(n){this.children.push(n);}};
 globalThis.document={createElement(){return {textContent:''};},querySelectorAll(){return parent.children;}};
 try{const update=UI.popupHealth(parent,{lastSuccessfulFetch:clock,sourceDataTimestamp:clock-86400000,expectedUpdateInterval:60000,freshnessBasis:'fetch',available:true});UI.refreshPopupHealth();assert.doesNotMatch(parent.children[0].textContent,/older than expected/);update({lastSuccessfulFetch:clock-300000,sourceDataTimestamp:clock-86400000,expectedUpdateInterval:60000,freshnessBasis:'fetch',available:true});assert.match(parent.children[0].textContent,/older than expected/);update({lastSuccessfulFetch:clock,lastError:{code:'network'}},true);assert.match(parent.children[0].textContent,/Cached after retrieval failure/);}finally{globalThis.document=original;}
});

test('local source connection failure replaces an old cache deadline and recovers without dropping retained data',async()=>{
 const {WarningController}=globalThis.StormtraceWarnings;let clock=1791900000000,fail=true;
 const controller=new WarningController({now:()=>clock,validate:r=>r,fetch:async()=>{if(fail)throw new TypeError('Failed to fetch');return {ok:true,json:async()=>({configured:true,records:[],observations:[],health:{...C.health(900000),available:true,lastSuccessfulFetch:clock,freshnessBasis:'fetch'}})};}});
 controller.state.retryAt=clock+900000;controller.state.records=[{id:'retained'}];
 await controller.refresh();assert.equal(controller.state.retryAt,clock+60000);assert.equal(controller.state.cached,true);assert.equal(controller.state.records[0].id,'retained');
 clock+=60000;fail=false;await controller.refresh();assert.equal(controller.state.cached,false);assert.equal(controller.state.health.lastError,null);assert.equal(controller.state.records.length,0);
});
test('editing the query clears a highlighted search result so Enter searches the new text',()=>{
 const a=loadApp();a.bindControls();const input=a.els.placeSearch,results=a.els.searchResults;let chosen=0;
 const option=Object.assign(a.document.createElement('div'),{id:'result-0'});option.addEventListener('click',()=>chosen++);
 results.querySelectorAll=()=>[option];results.hidden=false;
 input.listeners.keydown({key:'ArrowDown',preventDefault(){}});assert.equal(option.attributes['aria-selected'],'true');
 input.listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(chosen,1);
 input.listeners.keydown({key:'ArrowDown',preventDefault(){}});
 input.value='Berlin';input.listeners.input({});assert.equal(option.attributes['aria-selected'],'false');assert.equal(input.attributes['aria-activedescendant'],undefined);
 input.listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(chosen,1);
});
test('layers summary names drawn layers and the shared selection row appears and clears through document events',()=>{
 const a=loadApp();for(const id of ['#mapLightning','#radarButton','#mapFloods','#mapQuakes'])a.document.querySelector(id).checked=false;a.document.querySelector('#selectedHazardRow').hidden=true;
 a.bindControls();a.elements.get('#mapLightning').checked=true;a.elements.get('#mapQuakes').checked=true;a.elements.get('#mapQuakes').listeners.change();
 assert.equal(a.elements.get('#layersSummary').textContent,'Lightning · Earthquakes');
 a.document.listeners.hazardselected({detail:{label:'M 5.1 · Test place'}});assert.equal(a.elements.get('#selectedHazardRow').hidden,false);assert.equal(a.elements.get('#selectedHazardLabel').textContent,'M 5.1 · Test place');assert.match(a.elements.get('#layersSummary').textContent,/1 selected/);
 a.document.listeners.clearselectedhazard();assert.equal(a.elements.get('#selectedHazardRow').hidden,true);assert.doesNotMatch(a.elements.get('#layersSummary').textContent,/selected/);
 for(const id of ['#mapLightning','#mapQuakes'])a.elements.get(id).checked=false;a.elements.get('#mapFloods').listeners.change();assert.equal(a.elements.get('#layersSummary').textContent,'None on');
});
test('question mark opens the shortcut sheet from the main view only, and toolbar Set location still requests a position in one click',()=>{
 const a=loadApp();let opened=0;a.els.shortcutsDialog.showModal=()=>opened++;a.bindControls();
 const handler=a.document.listeners.keydown,event=(extra={})=>({key:'?',target:{matches:()=>false},preventDefault(){},...extra});
 handler(event());assert.equal(opened,1);handler(event({target:{matches:()=>true}}));assert.equal(opened,1);
 a.elements.get('#locationButton').listeners.click();assert.match(a.elements.get('#locationFeedback').textContent,/Automatic location is unavailable/);assert.equal(a.document.body.dataset.pane,'details');
});
test('time display preference is additive to saved settings and switches the clock without changing other settings',()=>{
 let saved;const a=loadApp({storage:{getItem:()=>JSON.stringify({radiusMiles:35,readingScale:1.2}),setItem(key,value){assert.equal(key,'stormtrace:settings');saved=JSON.parse(value);}}});
 assert.equal(a.state.timeZone,'uk');a.bindControls();a.elements.get('#timeZoneSetting').listeners.change({target:{value:'system'}});
 assert.equal(saved.timeZone,'system');assert.equal(saved.radiusMiles,35);assert.equal(saved.readingScale,1.2);assert.match(a.els.clock.textContent,/^Local /);
 a.elements.get('#timeZoneSetting').listeners.change({target:{value:'anything else'}});assert.equal(saved.timeZone,'uk');assert.match(a.els.clock.textContent,/^UK local /);
});
test('strike-age legend lists only the ages the selected lightning window can contain',()=>{
 const a=loadApp();a.selectWindow('live');assert.equal(a.elements.get('#legendOld').hidden,true);a.selectWindow('60');assert.equal(a.elements.get('#legendOld').hidden,true);
 a.selectWindow('1440');assert.equal(a.elements.get('#legendOld').hidden,false);
});
test('hazard view buttons expose retrieval state as a visible chip and an accessible name',()=>{
 const original=globalThis.document,button={textContent:'Floods',dataset:{},attributes:{},setAttribute(n,v){this.attributes[n]=v;}};
 globalThis.document={getElementById:()=>button};
 try{
  UI.sourceStatus('floodsButton',{health:{lastError:{code:'network'}}});assert.equal(button.dataset.state,'failed');assert.equal(button.attributes['aria-label'],'Floods, Retrieval failed');
  UI.sourceStatus('floodsButton',{loading:true,health:{}});assert.equal(button.dataset.state,'checking');assert.match(button.title,/^Floods · Checking/);
 }finally{globalThis.document=original;}
});
test('primary features from the previous layout stay directly reachable without opening a collapsed panel',()=>{
 const html=readFileSync('index.html','utf8');
 const nav=html.slice(html.indexOf('<nav class="hazard-nav"'),html.indexOf('</nav>',html.indexOf('<nav class="hazard-nav"')));
 for(const [id,label] of [['radarNavButton','Radar'],['warningsButton','Weather warnings'],['floodsButton','Floods'],['cyclonesButton','Cyclones'],['volcanoesButton','Volcanoes'],['tsunamisButton','Tsunami bulletins'],['spaceButton','Space weather'],['earthquakesButton','Earthquakes']])assert.match(nav,new RegExp(`id="${id}"[^>]*>${label}<`),label);
 const toolbar=html.slice(html.indexOf('<section class="toolbar"'),html.indexOf('</section>',html.indexOf('<section class="toolbar"')));
 for(const id of ['placeSearch','locationButton'])assert.match(toolbar,new RegExp(`id="${id}"`),id);for(const w of ['live','60','360','1440'])assert.match(toolbar,new RegExp(`data-window="${w}"`));
 const header=html.slice(html.indexOf('<header class="topbar"'),html.indexOf('</header>'));for(const id of ['monitorButton','refreshButton','themeButton','infoButton','windowModeButton','exitButton'])assert.match(header,new RegExp(`id="${id}"`),id);
 const sidebar=html.slice(html.indexOf('<aside class="sidebar"'),html.indexOf('</aside>',html.indexOf('<aside class="sidebar"')));
 for(const id of ['notificationToggle','radiusRange','enableLocationButton','setHere','hotspotFocus','visibleCount','globalRate'])assert.match(sidebar,new RegExp(`id="${id}"`),id);
 assert.doesNotMatch(sidebar.slice(0,sidebar.indexOf('id="visibleCount"')),/<details class="panel lightning-details">/,'lightning activity must start open');
 assert.match(html,/<details class="panel lightning-details" open>/);
});
test('selecting a map event opens Layers so its Clear control is visible',()=>{
 const a=loadApp();a.document.querySelector('#layersPanel').open=false;a.bindControls();a.document.listeners.hazardselected({detail:{label:'Test'}});assert.equal(a.elements.get('#layersPanel').open,true);
});
test('toolbar Radar button toggles the same Layers checkbox and mirrors its state',()=>{
 const a=loadApp();let clicks=0;const box=a.document.querySelector('#radarButton');box.click=()=>{clicks++;box.checked=!box.checked;box.listeners.change?.();};a.bindControls();
 a.elements.get('#radarNavButton').listeners.click();assert.equal(clicks,1);assert.equal(a.elements.get('#radarNavButton').attributes['aria-pressed'],'true');
 a.elements.get('#radarNavButton').listeners.click();assert.equal(a.elements.get('#radarNavButton').attributes['aria-pressed'],'false');
});
test('a selection made while a map popup is open waits to open Layers so the panel cannot cover the popup',()=>{
 const a=loadApp();a.document.querySelector('#layersPanel').open=false;a.bindControls();a.state.mapPopupOpen=true;
 a.document.listeners.hazardselected({detail:{label:'Test'}});assert.equal(a.elements.get('#layersPanel').open,false);assert.equal(a.state.pendingLayersOpen,true);
});
test('the sidebar grid column cannot grow past the sidebar, so wide legends scroll in place instead of widening it',()=>{
 const css=readFileSync('styles.css','utf8');
 assert.match(css,/\.sidebar \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);assert.match(css,/\.sidebar > \* \{ min-width: 0; \}/);
 assert.match(css,/\.radar-legend:has\(img\) \{[^}]*max-width: 100%[^}]*overflow-x: auto/);
});
test('the warning map opens full window with its own scrolling side panel and bounded popups',()=>{
 const html=readFileSync('index.html','utf8'),css=readFileSync('styles.css','utf8');
 assert.match(html,/<aside class="warning-map-side"[\s\S]*id="warningMapList"[\s\S]*metoffice\.gov\.uk[\s\S]*<\/aside>/);
 assert.match(css,/#warningMapDialog \{ width: calc\(100vw - 24px\); height: calc\(100dvh - 24px\)/);
 assert.match(css,/\.hazard-popup \.leaflet-popup-content, \.storm-popup \.leaflet-popup-content \{ max-height:[^}]*overflow-y: auto/);
 assert.match(css,/#warningAreaMap \.leaflet-control-attribution a \{ color: #0b4f9e; \}/);
});
test('every map layer uses the shared popup behaviour: same options, bounded scrolling content and badge-first layout',()=>{
 const files=['app.js','client/map-hazards.js','client/earthquakes.js','client/public-hazards.js','client/warning-map.js'];
 for(const f of files){const s=readFileSync(f,'utf8');assert.doesNotMatch(s,/bindPopup\([^)]*\{\s*className:\s*'hazard-popup/,f+' must use UI.popupOptions');}
 assert.equal((readFileSync('client/map-hazards.js','utf8').match(/UI\.popupOptions\(/g)||[]).length,4);
 assert.match(readFileSync('app.js','utf8'),/UI\.popupOptions\(\{ className: "storm-popup"/);
 const o=UI.popupOptions({minWidth:260});assert.equal(o.className,'hazard-popup flood-map-popup');assert.equal(o.minWidth,260);assert.deepEqual(o.autoPanPaddingTopLeft,[24,76]);
 assert.match(readFileSync('styles.css','utf8'),/\.hazard-popup \.leaflet-popup-content, \.storm-popup \.leaflet-popup-content \{ max-height:[^}]*overflow-y: auto/);
 // Native 1200x780 window: a ~540px map must scroll popups inside the padded clear area, not under the strike strip.
 assert.equal(UI.popupMaxHeight(540),348);assert.ok(UI.popupMaxHeight(540)+76+84<=540);assert.equal(UI.popupMaxHeight(200),160);
 assert.match(readFileSync('styles.css','utf8'),/\.storm-popup \.leaflet-popup-content \{ max-height: min\(520px, var\(--map-popup-max, calc\(100dvh - 300px\)\)\)/);
 assert.match(readFileSync('app.js','utf8'),/sizeMapPopups\(\); fitWorld\(\);/);
});
test('Layers shows the selected map event and its Clear button first, and popup × stays readable over scrolled text',()=>{
 const html=readFileSync('index.html','utf8');assert.match(html,/<div class="layers-body">\s*<div class="selected-row" id="selectedHazardRow" hidden>/);
 assert.match(readFileSync('app.js','utf8'),/\$\("#layersPanel"\)\.scrollTop = 0;/);
 assert.match(readFileSync('styles.css','utf8'),/\.storm-popup a\.leaflet-popup-close-button \{[^}]*z-index: 1; background: var\(--popup-bg\)/);
});
test('the main map never shows empty space past the Mercator edge, except while a popup needs room',()=>{
 // Mercator world is 256*2^z px tall: 540px map -> 2 (floor), 1180px fullscreen map -> about 2.2.
 assert.equal(UI.worldMinZoom(540),2);assert.ok(Math.abs(256*2**UI.worldMinZoom(1180)-1180)<1e-6);assert.equal(UI.worldMinZoom(0),2);
 const app=readFileSync('app.js','utf8');
 assert.match(app,/maxBoundsViscosity: 1/);assert.match(app,/L\.latLngBounds\(\[-85\.0511, -1e6\], \[85\.0511, 1e6\]\)/);
 assert.match(app,/on\("autopanstart", \(\) => state\.map\.setMaxBounds\(null\)\)/);assert.match(app,/on\("popupclose", \(\) => state\.map\.setMaxBounds\(world\)\)/);
});
test('hazard cards share one action row under the heading, and only located cyclone and volcano records offer Show on map',()=>{
 for(const f of ['client/floods.js','client/earthquakes.js','client/public-hazards.js','client/warnings.js'])assert.match(readFileSync(f,'utf8'),/UI\.cardActions\(/,f);
 for(const f of ['client/floods.js','client/earthquakes.js','client/public-hazards.js'])assert.doesNotMatch(readFileSync(f,'utf8'),/text\([^)]*'Show on map'/,f+' builds its own Show on map button');
 assert.match(readFileSync('client/public-hazards.js','utf8'),/\['cyclone', 'volcano'\]\.includes\(r\.kind\) && r\.geometry\?\.type === 'Point'/);
 assert.match(readFileSync('styles.css','utf8'),/dialog:has\(> \.hazard-dialog-card\) \{ width: calc\(100vw - 24px\); height: calc\(100dvh - 24px\)/);
});
