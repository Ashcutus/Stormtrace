import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {IDBFactory} from 'fake-indexeddb';
import C from '../core/index.js';
import '../platform/browser.js';
import '../client/presentation.js';
import '../client/warnings.js';
import '../client/earthquakes.js';
import {USGSEarthquakeProvider,normalizeEarthquakes,EARTHQUAKES_URL,earthquakeLink} from '../providers/usgs.js';
import {createStormtraceServer} from '../server.js';
const Q=globalThis.StormtraceEarthquakes,W=globalThis.StormtraceWarnings,P=globalThis.StormtracePlatform;
const fixture=()=>JSON.parse(readFileSync(new URL('fixtures/earthquakes/day.json',import.meta.url)));
const now=1791740444000;
const python=(payload)=>JSON.parse(execFileSync('python3',['-c','import json,sys; from providers.usgs import normalize_earthquakes; print(json.dumps(normalize_earthquakes(json.load(sys.stdin),1791740444000)))'],{input:JSON.stringify(payload),encoding:'utf8',stdio:['pipe','pipe','pipe']}));
const reply=(payload,status=200)=>({ok:status===200,status,text:async()=>JSON.stringify(payload)});
test('USGS parity retains native fields, magnitude/depth, IDs, instants, network and unknown metadata',()=> {
  const payload=fixture(),result=normalizeEarthquakes(payload,now);assert.deepEqual(result,python(payload));
  const r=result.records[0];assert.equal(r.displayPriority,'normal');assert.equal(r.domainPayload.depthKm,12.5);assert.equal(r.domainPayload.network,'test');assert.equal(r.domainPayload.sourceFields.unknownField,'retained');assert.equal(r.sourceSeverity.magnitude,4.6);
  payload.features[0].properties.mag=null;payload.features[0].properties.magType=null;payload.features[0].geometry.coordinates[2]=-1;assert.deepEqual(normalizeEarthquakes(payload,now),python(payload));
  const nonquake=fixture();nonquake.features[0].properties.type='quarry blast';assert.deepEqual(normalizeEarthquakes(nonquake,now),python(nonquake));assert.equal(normalizeEarthquakes(nonquake,now).records.length,0);
});
test('USGS rejects malformed dates/geometry, duplicate identities, bad links and incomplete collections in both runtimes',()=> {
  const inputs=[{}, {...fixture(),metadata:{generated:now,status:200,count:2}}];
  for(const value of [{time:'yesterday'},{mag:true},{url:'https://evil.example/test'},{updated:0}]) {const p=fixture();Object.assign(p.features[0].properties,value);inputs.push(p);}
  for(const coords of [[0,91,5],[0,0],[0,0,'5']]) {const p=fixture();p.features[0].geometry.coordinates=coords;inputs.push(p);}
  const duplicate=fixture();duplicate.features.push(structuredClone(duplicate.features[0]));duplicate.metadata.count=2;inputs.push(duplicate);
  for(const p of inputs) {assert.throws(()=>normalizeEarthquakes(p,now));assert.throws(()=>python(p));}
  for(const url of ['https://earthquake.usgs.gov@evil.example/earthquakes/eventpage/test','http://earthquake.usgs.gov/earthquakes/eventpage/test','https://earthquake.usgs.gov/earthquakes/eventpage/test?x=1']) assert.throws(()=>earthquakeLink(url));
});
test('public transport coalesces, caches, detects stale source generation, isolates failures and recovers',async()=> {
  let clock=now,calls=0,payload=fixture(),fail=false;
  const provider=new USGSEarthquakeProvider({now:()=>clock,fetch:async(url,options)=> {calls++;assert.equal(url,EARTHQUAKES_URL);assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,undefined);if(fail)throw new Error('offline');return reply(payload);}});
  const [a,b]=await Promise.all([provider.current(),provider.current()]);assert.deepEqual(a,b);assert.equal(calls,1);await provider.current();assert.equal(calls,1);
  clock+=240000;const stale=await provider.current();assert.equal(stale.health.freshness,'stale');
  clock+=60000;fail=true;await assert.rejects(provider.current());assert.equal(provider.health.lastError.code,'network');
  fail=false;payload={type:'FeatureCollection',features:[],metadata:{generated:clock,count:0,status:200}};const empty=await provider.current();assert.equal(empty.records.length,0);assert.equal(empty.health.freshness,'fresh');
});
test('finite provider query filters normalized time and geographic bounds without calling the historical API',async()=> {
  const provider=new USGSEarthquakeProvider({now:()=>now,fetch:async()=>reply(fixture())});
  assert.equal((await provider.query({from:now-86400000,to:now,bounds:[-4,54,-2,56]})).records.length,1);
  assert.equal((await provider.query({from:now-86400000,to:now,bounds:[0,0,1,1]})).records.length,0);
  await assert.rejects(provider.query({from:now,to:now-1}));await assert.rejects(provider.query({from:now-1,to:now,bounds:[170,0,-170,1]}));
});
test('earthquake revisions deduplicate fetches, retain meaningful updates, reject older replay and preserve other provider history',async()=> {
  let records=normalizeEarthquakes(fixture(),now).records,clock=now;
  const history=new C.RevisionHistory(new P.MemoryStorageAdapter(),{now:()=>clock});
  const controller=new W.WarningController({id:'usgs',endpoint:'/api/earthquakes',validate:Q.validBatch,history,now:()=>clock,retentionDays:30,fetch:async()=>({ok:true,json:async()=>({configured:true,records,observations:records,health:{...C.health(60000),available:true,lastSuccessfulFetch:clock}})})});
  await controller.refresh();clock++;records=normalizeEarthquakes(fixture(),clock).records;await controller.refresh();assert.equal((await history.revisions('usgs','test001')).length,1);
  const updated=fixture();updated.features[0].properties.updated+=60000;updated.features[0].properties.mag=4.7;records=normalizeEarthquakes(updated,clock).records;await controller.refresh();
  records=normalizeEarthquakes(fixture(),clock).records;await controller.refresh();assert.equal((await history.revisions('usgs','test001')).length,2);assert.equal((await history.revisions('usgs','test001')).at(-1).event.domainPayload.magnitude,4.7);
  records=[];await controller.refresh();assert.equal((await history.revisions('usgs','test001')).length,2);
});
test('local earthquake route returns normalized records and an explicit error without disrupting health',async(t)=> {
  let broken=false;const provider=new USGSEarthquakeProvider({now:()=>now,fetch:async()=> {if(broken)throw new Error('offline');return reply(fixture());}});
  const server=createStormtraceServer({earthquakesProvider:provider});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;const res=await fetch(base+'/api/earthquakes');assert.equal(res.status,200);Q.validBatch(await res.json());
  provider.lastResult=null;broken=true;assert.equal((await fetch(base+'/api/earthquakes')).status,502);assert.equal((await fetch(base+'/api/health')).status,200);
});
test('earthquake UI filters recent data, safely renders, maps one selected location and disables demo requests',async()=> {
  class Element {
    constructor(tag='div') {this.tag=tag;this.children=[];this.listeners={};this.textContent='';this.open=false;this.value='';}
    append(n){this.children.push(n);}replaceChildren(...nodes){this.children=nodes;}addEventListener(name,fn){this.listeners[name]=fn;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
    get content(){return [this.textContent,...this.children.map(n=>n.content)].join('\n');}
  }
  const ids=['earthquakesDialog','earthquakeList','earthquakeRefresh','earthquakeHistory','earthquakeWindow','earthquakeMagnitude','earthquakeArchive','earthquakeAttribution','earthquakeStatus','earthquakeStorageStatus','earthquakesButton'];
  const el=Object.fromEntries(ids.map(id=>[id,new Element()]));el.earthquakeWindow.value='24';el.earthquakeMagnitude.value='all';
  const original={document:globalThis.document,indexedDB:globalThis.indexedDB,fetch:globalThis.fetch,L:globalThis.L};const listeners={};globalThis.document={hidden:false,getElementById:id=>el[id],createElement:tag=>new Element(tag),addEventListener(name,fn){(listeners[name]||=[]).push(fn);},dispatchEvent(event){(listeners[event.type]||[]).forEach(fn=>fn(event));}};let selection=null;globalThis.document.addEventListener('hazardselected',event=>{selection=event.detail.label;});globalThis.indexedDB=new IDBFactory();
  let calls=0,removed=0,point,impactLoads=0,impactClears=0;const data=fixture();data.features[0].properties.place='<img src=x> Synthetic place';
  const result=normalizeEarthquakes(data,now);globalThis.fetch=async function(){assert.equal(this,globalThis);calls++;return {ok:true,json:async()=>({configured:true,...result,health:{...C.health(60000),lastSuccessfulFetch:now,sourceDataTimestamp:now,available:true}})}};
  const map={setView(p){point=p;},getZoom(){return 2;}};globalThis.L={circleMarker(){return {addTo(){return this;},bindPopup(label){assert.equal(label.textContent.includes('<img src=x>'),true);return this;},on(name,fn){assert.equal(name,'click');this.click=fn;return this;},openPopup(){},remove(){removed++;}}}};
  let controller;
  try {
    controller=Q.mountEarthquakes({map,mapHazards:{popup(event){const node=new Element();node.textContent=event.domainPayload.place;return {node,load(){impactLoads++;}};},clear(){impactClears++;}}});controller.now=()=>now;el.earthquakesButton.listeners.click();for(let n=0;n<50&&(controller.state.configured==null||controller.state.loading);n++)await new Promise(resolve=>setImmediate(resolve));
    assert.match(el.earthquakeList.content,/Synthetic place/);assert.match(el.earthquakeList.content,/12.5 km/);
    el.earthquakeMagnitude.value='9';el.earthquakeMagnitude.listeners.change();assert.equal(el.earthquakeList.children.length,0);el.earthquakeMagnitude.value='all';el.earthquakeMagnitude.listeners.change();
    const button=el.earthquakeList.children[0].children.find(n=>n.tag==='button');button.listeners.click();assert.deepEqual(point,[55,-3]);assert.equal(el.earthquakesDialog.open,false);assert.match(selection,/Synthetic place/);globalThis.document.dispatchEvent(new Event('clearselectedhazard'));assert.equal(removed,1);assert.equal(impactLoads,1);assert.equal(impactClears,3);
    el.earthquakesButton.listeners.click();await el.earthquakeHistory.listeners.click();assert.match(el.earthquakeArchive.content,/Saved on this device/);el.earthquakesDialog.close();
    const before=calls;Q.mountEarthquakes({demo:true});el.earthquakesButton.listeners.click();assert.equal(calls,before);assert.match(el.earthquakeStatus.textContent,/demo mode/);
    const unknown=structuredClone(result.records[0]);unknown.domainPayload.magnitude=null;assert.equal(Q.visibleEarthquakes([unknown],{now,minimum:2.5}).length,0);assert.equal(Q.visibleEarthquakes([unknown],{now}).length,1);
  }finally{el.earthquakesDialog.close();controller?.history?.storage.close();controller?.snapshotStorage?.close();Object.assign(globalThis,original);}
});

test('Python transport cache, empty success, HTTP errors/recovery and local handler match the Node contract',()=> {
  const script=`
import json,sys,io
from urllib.error import HTTPError
from providers.usgs import USGSEarthquakeProvider,EarthquakeError
import server
payload=json.load(sys.stdin);clock=[1791740444000];calls=[];broken=[False]
class Response(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self,*args): self.close()
def opener(request,timeout):
    calls.append(request.full_url)
    assert timeout==15
    assert request.get_header('Accept')=='application/geo+json'
    if broken[0]: raise HTTPError(request.full_url,429,'rate',{},None)
    return Response(json.dumps(payload).encode())
p=USGSEarthquakeProvider(opener=opener,clock=lambda:clock[0]);a=p.current();assert p.current()==a;assert len(calls)==1
server.EARTHQUAKES_PROVIDER=p
handler=object.__new__(server.Handler);handler.path='/api/earthquakes';handler.send_json=lambda code,body: {'status':code,'body':body}
route=handler.do_GET();assert route['status']==200
clock[0]+=60000;broken[0]=True
error=handler.do_GET();assert error['status']==502;assert error['body']['providerError']['code']=='rate_limited'
broken[0]=False;payload['features']=[];payload['metadata'].update(count=0,generated=clock[0]);empty=handler.do_GET();assert empty['status']==200;assert empty['body']['records']==[];assert empty['body']['health']['lastError'] is None
print(json.dumps({'first':route,'error':error,'empty':empty}))
`;
  const r=JSON.parse(execFileSync('python3',['-c',script],{input:JSON.stringify(fixture()),encoding:'utf8',stdio:['pipe','pipe','pipe']}));Q.validBatch(r.first.body);Q.validBatch(r.empty.body);assert.equal(r.first.body.records[0].domainPayload.magnitude,4.6);
});
test('an earthquake without a place description is kept in both runtimes and current records are not duplicated as observations',()=> {
  const payload=fixture();payload.features[0].properties.place=null;
  const result=normalizeEarthquakes(payload,now);assert.deepEqual(result,python(payload));
  assert.equal(result.records[0].domainPayload.place,null);assert.deepEqual(result.observations,[]);
  Q.validBatch({configured:true,...result,health:C.health(60000)});
  const bad=fixture();bad.features[0].properties.place=5;assert.throws(()=>normalizeEarthquakes(bad,now));assert.throws(()=>python(bad));
});
test('earthquake depth is rounded for display only',()=> {
  assert.equal(globalThis.StormtraceUI.depth(30.9099998474121),'30.9 km');assert.equal(globalThis.StormtraceUI.depth(10),'10 km');assert.equal(globalThis.StormtraceUI.depth(-1.04),'-1 km');
});
