import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { IDBFactory } from 'fake-indexeddb';
import C from '../core/index.js';
import '../platform/browser.js';
import '../client/presentation.js';
import '../client/warnings.js';
import '../client/public-hazards.js';
import { PublicHazardProvider, validateHazards } from '../providers/public-hazards.js';
import { createStormtraceServer } from '../server.js';
const H = globalThis.StormtracePublicHazards, P = globalThis.StormtracePlatform;
const now = 1791900000000;
const file = (name) => readFileSync(new URL(`fixtures/public-hazards/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(file(`${name}.json`));
const inputs = () => ({ nhc: json('cyclones'), 'usgs-volcano': json('volcanoes'), gvp: file('gvp.xml'), 'noaa-tsunami': [file('ntwc.xml'),file('ptwc.xml')], swpc: [json('scales'),json('alerts')] });
function normalize(id, raw, fetchedAt = now) {
  return JSON.parse(execFileSync('python3',['-m','providers.public_hazards',id,'normalize'],{input:JSON.stringify({raw,fetchedAt}),encoding:'utf8',stdio:['pipe','pipe','pipe']}));
}
function python(script) { return execFileSync('python3',['-c',script],{encoding:'utf8',stdio:['pipe','pipe','pipe']}); }

test('all five source normalizations satisfy core/browser contracts and canonical provenance', () => {
  for (const [id,raw] of Object.entries(inputs())) {
    const result = normalize(id,raw); validateHazards(id,result); H.validBatch(id,{configured:true,...result,health:C.health()});
    for (const r of result.records) {
      assert.equal(r.provenance.sourceUrl,C.getSource(id).homepage);
      assert.equal(r.provenance.fetchedAt,now); assert.equal(r.displayPriority,'normal');
      assert.equal(r.sourceAuthority,r.provenance.sourceAuthority);
    }
  }
  const cyclone=normalize('nhc',inputs().nhc).records[0];assert.equal(cyclone.sourceSeverity.classification,'HU');assert.equal(cyclone.sourceSeverity.windKnots,80);assert.deepEqual(cyclone.geometry.coordinates,[-107.2,20.4]);assert.equal(cyclone.domainPayload.links.length,3);
  const volcano=normalize('usgs-volcano',inputs()['usgs-volcano']).records[0];assert.equal(volcano.sourceSeverity.aviationColour,'ORANGE');assert.equal(volcano.sourceAuthority,'Alaska Volcano Observatory');
  const weekly=normalize('gvp',inputs().gvp).records[0];assert.equal(weekly.geometry,null);assert.equal(weekly.domainPayload.body,'Activity summary & source attribution.');
});
test('space weather separates observed scales, forecast reference times and discrete issued messages', () => {
  const result=normalize('swpc',inputs().swpc);
  assert.equal(result.sourceDataTimestamp,result.records.find(r=>r.id==='scales:0').updatedAt);
  assert.equal(result.observations.length,3);assert.ok(result.observations.every(r=>r.domainPayload.mode==='bulletin'));
  const forecast=result.records.find(r=>r.id==='scales:2');assert.equal(forecast.observedAt,null);assert.equal(forecast.updatedAt,null);assert.ok(forecast.validFrom>now);assert.equal(forecast.domainPayload.badge,'Forecast');
  const current=result.records.find(r=>r.id==='scales:0');assert.equal(current.sourceSeverity[0].value,'0');
  const history=new C.RevisionHistory(new P.MemoryStorageAdapter());
  const controller=new H.HazardController({id:'swpc',history});
  return controller.recordObserved(result.records).then(async()=>{const rows=await history.query({provider:'swpc',time:'persistedAt'});assert.equal(rows.length,3);});
});
test('CAP keeps expiry, native severity, instructions, identities and update/cancel references without inventing active status', () => {
  const raw=inputs()['noaa-tsunami'];const result=normalize('noaa-tsunami',raw);const r=result.records[0];
  assert.equal(r.sourceSeverity.event,'Tsunami Information');assert.match(r.domainPayload.instruction,/no tsunami danger/);assert.match(r.domainPayload.url,/^https:\/\/www.tsunami.gov\/events\//);assert.equal(r.geometry,null);
  assert.equal(H.bulletinState(r,r.validTo+1),'Expired bulletin');
  const updated=raw[0].replace('<msgType>Alert</msgType>','<msgType>Cancel</msgType><references>ntwc@noaa.gov,previous,2026-10-13T11:00:00Z</references>');
  const cancelled=normalize('noaa-tsunami',[updated,raw[1]]).records[0];assert.equal(cancelled.domainPayload.references[0].identifier,'previous');assert.equal(H.bulletinState(cancelled,now),'Cancellation bulletin');
  const exercise=structuredClone(r);exercise.domainPayload.status='Exercise';assert.match(H.bulletinState(exercise,now),/not an operational alert/);
});
test('malformed, oversized, duplicate, non-public and unsafe source content is rejected', () => {
  const cases=[['nhc',{}],['usgs-volcano',{}],['gvp','<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'],['gvp','<rss/>'],['swpc',[{},[]]],['noaa-tsunami',['<alert/>','<alert/>']]];
  const bad=inputs();bad.nhc.activeStorms[0].latitudeNumeric=91;cases.push(['nhc',bad.nhc]);
  const dup=inputs().nhc;dup.activeStorms.push(structuredClone(dup.activeStorms[0]));cases.push(['nhc',dup]);
  const link=inputs().nhc;link.activeStorms[0].publicAdvisory.url='https://www.nhc.noaa.gov@evil.example/advisory';cases.push(['nhc',link]);
  const cap=inputs()['noaa-tsunami'];cases.push(['noaa-tsunami',[cap[0].replace('<scope>Public</scope>','<scope>Private</scope>'),cap[1]]]);
  const scale=inputs().swpc;scale[0]['0'].R.Scale='8';cases.push(['swpc',scale]);
  for (const [id,raw] of cases) assert.throws(()=>normalize(id,raw),id);
  const payload=normalize('nhc',inputs().nhc);payload.records[0].domainPayload.url='javascript:alert(1)';assert.throws(()=>H.validBatch('nhc',{configured:true,...payload,health:C.health()}));
});
test('Node cache shares requests, fetch health tolerates quiet feeds and error backoff honours Retry-After',async()=>{
  let clock=now,calls=0,fail=false;
  const raw=inputs()['usgs-volcano'];const provider=new PublicHazardProvider({id:'usgs-volcano',now:()=>clock,worker:async()=>{calls++;if(fail)throw new C.ProviderError('rate_limited','usgs-volcano','current',{status:429,retryAfter:180});return JSON.stringify(normalize('usgs-volcano',raw,clock));}});
  const [a,b]=await Promise.all([provider.current(),provider.current()]);assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(a.health.freshness,'fresh');await provider.current();assert.equal(calls,1);
  clock+=300000;fail=true;await assert.rejects(provider.current());assert.equal(calls,2);await assert.rejects(provider.current());assert.equal(calls,2);
  clock+=180000;fail=false;assert.equal((await provider.current()).health.lastError,null);assert.equal(calls,3);
});
test('Python retrieval bounds responses, rejects redirects, caches, distinguishes empty success, backs off and recovers',()=>{
  python(`
import io,json
from urllib.error import HTTPError
from providers.public_hazards import PublicHazardProvider,HazardError,MAX_BYTES
clock=[1791900000000];calls=[];status=[200];body=[b'{"activeStorms":[]}']
class Response(io.BytesIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
def opener(req,timeout):
 calls.append(req.full_url);assert timeout==15;assert 'apikey' not in str(req.headers).lower()
 if status[0]!=200:raise HTTPError(req.full_url,status[0],'blocked',{'Retry-After':'180'},None)
 return Response(body[0])
p=PublicHazardProvider('nhc',opener=opener,clock=lambda:clock[0]);assert p.current()['records']==[];p.current();assert len(calls)==1
clock[0]+=900000;status[0]=429
for _ in range(2):
 try:p.current();assert False
 except HazardError as e:assert e.code=='rate_limited'
assert len(calls)==2;clock[0]+=180000;status[0]=200;assert p.current()['health']['lastError'] is None
clock[0]+=900000;body[0]=b'x'*(MAX_BYTES+1)
try:p.current();assert False
except HazardError as e:assert e.code=='malformed'
from providers.metoffice_warnings import NoRedirect
assert NoRedirect().redirect_request(None,None,302,'redirect',{},'https://evil.example') is None
`);
});
test('both local server routes expose the same normalized contract; failures preserve other services',async(t)=>{
  const result=normalize('nhc',inputs().nhc);let broken=false;
  const provider=new PublicHazardProvider({id:'nhc',worker:async()=>{if(broken)throw new Error('offline');return JSON.stringify(result);},now:()=>now});
  const server=createStormtraceServer({hazardProviders:{nhc:provider}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;const res=await fetch(base+'/api/hazards?source=nhc');const node=await res.json();assert.equal(res.status,200);H.validBatch('nhc',node);
  const out=JSON.parse(python(`
import server,json
from providers.public_hazards import normalize
from pathlib import Path
class Provider:
 def current(self):return {**normalize('nhc',json.loads(Path('tests/fixtures/public-hazards/cyclones.json').read_text()),${now}),'health':{'lastSuccessfulFetch':${now}}}
server.HAZARD_PROVIDERS={'nhc':Provider()}
h=object.__new__(server.Handler);h.path='/api/hazards?source=nhc';h.send_json=lambda code,body:dict(code=code,body=body)
print(json.dumps(h.do_GET()))
`));assert.equal(out.code,200);assert.deepEqual(node.records,out.body.records);assert.deepEqual(node.observations,out.body.observations);
  provider.lastResult=null;broken=true;assert.equal((await fetch(base+'/api/hazards?source=nhc')).status,502);assert.equal((await fetch(base+'/api/health')).status,200);assert.equal((await fetch(base+'/api/hazards?source=__proto__')).status,400);
});
test('revisions deduplicate repeated fetches, never cancel on disappearance and reject older cyclone replay',async()=>{
  const history=new C.RevisionHistory(new P.MemoryStorageAdapter(),{now:()=>now});
  const controller=new H.HazardController({id:'nhc',history});let result=normalize('nhc',inputs().nhc);const id=result.records[0].id;
  await controller.recordObserved(result.records);await controller.recordObserved(normalize('nhc',inputs().nhc,now+1).records);assert.equal((await history.revisions('nhc',id)).length,1);
  const raw=inputs().nhc;raw.activeStorms[0].lastUpdate='2026-10-13T13:00:00Z';raw.activeStorms[0].intensity='85';await controller.recordObserved(normalize('nhc',raw).records);await controller.recordObserved(result.records);await controller.recordObserved([]);
  const rows=await history.revisions('nhc',id);assert.equal(rows.length,2);assert.equal(rows.at(-1).event.sourceSeverity.windKnots,85);
});
test('hazard dialogs safely render source text, bind global fetch, stop on close/hidden and make no demo requests',async()=>{
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.value='';this.open=false;this.textContent='';}
    append(n){this.children.push(n);}replaceChildren(...nodes){this.children=nodes;}addEventListener(n,fn){this.listeners[n]=fn;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
    get content(){return [this.textContent,...this.children.map(n=>n.content)].join('\n');}
  }
  const elements={}, get=(id)=>elements[id] ||= new Element();const old={document:globalThis.document,fetch:globalThis.fetch,indexedDB:globalThis.indexedDB,L:globalThis.L};
  const visibility=[];globalThis.document={hidden:false,getElementById:get,createElement:tag=>new Element(tag),addEventListener(name,fn){if(name==='visibilitychange')visibility.push(fn);}};globalThis.indexedDB=new IDBFactory();
  let calls=0;const raw=inputs().nhc;raw.activeStorms[0].name='<img src=x onerror=alert(1)>';
  const result=normalize('nhc',raw), results=Object.fromEntries(Object.entries(inputs()).map(([id,data])=>[id,id==='nhc'?result:normalize(id,data)]));
  let point, removed=0, popup;
  const map={getZoom:()=>2,setView(p){point=p;}};
  globalThis.L={circleMarker(){return {addTo(){return this;},bindPopup(node){popup=node;return this;},openPopup(){},closePopup(){},remove(){removed++;}};}};
  globalThis.fetch=async function(url){assert.equal(this,globalThis);calls++;const id=new URL(url,'http://localhost').searchParams.get('source');return {ok:true,json:async()=>({configured:true,...results[id],health:{...C.health(900000),freshnessBasis:'fetch',lastSuccessfulFetch:now,available:true}})};};
  let mounted;
  try {
    mounted=H.mount({getMap:()=>map});const ctrl=mounted.controllers.nhc;ctrl.now=()=>now;
    get('cyclonesButton').listeners.click();for(let i=0;i<100&&(ctrl.state.configured==null||ctrl.state.loading);i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1);assert.match(get('cyclonesList').content,/<img src=x/);assert.equal(get('cyclonesList').children[0].children.find(n=>n.tag==='h3').textContent,raw.activeStorms[0].name);
    globalThis.document.hidden=true;await get('cyclonesRefresh').listeners.click();assert.equal(calls,1);globalThis.document.hidden=false;
    get('cyclonesDialog').close();await get('cyclonesRefresh').listeners.click();assert.equal(calls,1);
    await ctrl.recordObserved(result.records);get('cyclonesDialog').showModal();await get('cyclonesHistory').listeners.click();assert.match(get('cyclonesArchive').content,/Locally observed/);get('cyclonesDialog').close();
    get('cyclonesDialog').showModal();await ctrl.refresh();
    get('cyclonesList').children[0].children.find(n=>n.tag==='button').listeners.click();assert.deepEqual(point,[20.4,-107.2]);assert.equal(get('cyclonesDialog').open,false);assert.match(popup.content,/Reported cyclone centre only/);get('cyclonesClearMarker').listeners.click();assert.equal(removed,1);
    for (const key of ['volcanoes','tsunamis','space']) {
      get(`${key}Button`).listeners.click();const current=mounted.controllers[get(`${key}Source`).value];current.now=()=>now;
      for(let i=0;i<100&&(current.state.configured==null||current.state.loading);i++)await new Promise(resolve=>setImmediate(resolve));
      assert.ok(get(`${key}List`).children.length>0,key);get(`${key}Dialog`).close();
    }
    get('volcanoesDialog').showModal();get('volcanoesSource').value='gvp';get('volcanoesSource').listeners.change();
    for(let i=0;i<100&&(mounted.controllers.gvp.state.configured==null||mounted.controllers.gvp.state.loading);i++)await new Promise(resolve=>setImmediate(resolve));
    assert.match(get('volcanoesList').content,/Activity summary & source attribution/);get('volcanoesDialog').close();
    const beforeDemo=calls;
    H.mount({demo:true});for(const key of Object.keys(H.VIEWS)){get(`${key}Button`).listeners.click();assert.match(get(`${key}Status`).textContent,/demo mode/);get(`${key}Dialog`).close();}assert.equal(calls,beforeDemo);
  } finally {
    for(const key of Object.keys(H.VIEWS))get(`${key}Dialog`).close();for(const ctrl of Object.values(mounted?.controllers||{})){ctrl.history?.storage.close();ctrl.snapshotStorage?.close();}Object.assign(globalThis,old);
  }
});

test('public Met Office RSS summaries preserve supplied content/links without inventing warning dates or geometry',()=>{
 const raw=readFileSync('tests/fixtures/public-hazards/warnings.xml','utf8');
 const result=normalize('metoffice-warnings-rss',raw),r=result.records[0];
 assert.equal(r.provider,'metoffice-warnings-rss');assert.equal(r.sourceSeverity.classification,'YELLOW');assert.equal(r.geometry,null);
 for(const k of ['observedAt','updatedAt','validFrom','validTo'])assert.equal(r[k],null);
 assert.match(r.domainPayload.body,/valid from 0900 Wed 14 Oct to 1800 Wed 14 Oct/);assert.match(r.domainPayload.url,/#\?date=2026-10-14/);
 H.validBatch('metoffice-warnings-rss',{configured:true,...result,health:C.health(300000)});
 assert.equal(normalize('metoffice-warnings-rss',raw.replace(/<item>[\s\S]*?<\/item>/,'' )).records.length,0);
 assert.throws(()=>normalize('metoffice-warnings-rss',raw.replace('Yellow warning','Unclassified warning')));
 assert.throws(()=>normalize('metoffice-warnings-rss',raw.replaceAll('https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings#','https://evil.example/warnings#')));
 // Each official host has its own warnings path; a missing item link falls back to the registry homepage.
 const item=raw.match(/<item>[\s\S]*?<\/item>/)[0];
 assert.match(normalize('metoffice-warnings-rss',raw.replace(item,item.replace(/https:\/\/www\.metoffice\.gov\.uk\/weather\/warnings-and-advice/g,'https://weather.metoffice.gov.uk/warnings-and-advice'))).records[0].domainPayload.url,/^https:\/\/weather\.metoffice\.gov\.uk\/warnings-and-advice\/uk-warnings/);
 assert.equal(normalize('metoffice-warnings-rss',raw.replace(item,item.replace(/<link>[^<]*<\/link>/,''))).records[0].domainPayload.url,C.getSource('metoffice-warnings-rss').homepage);
 assert.throws(()=>normalize('metoffice-warnings-rss',raw.replace(item,item.replace(/https:\/\/www\.metoffice\.gov\.uk\/weather\/warnings-and-advice/g,'https://weather.metoffice.gov.uk/weather/warnings-and-advice'))));
});

test('official Esri warning areas retain native severity, geometry, source issue and validity without inventing update time',()=>{
 const raw=JSON.parse(readFileSync('tests/fixtures/public-hazards/warning-areas.json','utf8'));
 const result=normalize('metoffice-warnings-esri',raw),r=result.records[0];
 assert.equal(r.geometry.type,'Polygon');assert.equal(r.sourceSeverity.classification,'YELLOW');assert.equal(r.sourceSeverity.impact,'2/Low');assert.equal(r.updatedAt,null);assert.equal(r.observedAt,raw.features[0].properties.issuedDate);
 assert.equal(r.validFrom,raw.features[0].properties.validfromdate);assert.match(r.provenance.sourceUrl,/services.arcgis.com/);
 H.validBatch('metoffice-warnings-esri',{configured:true,...result,health:C.health()});
 for(const change of [v=>v.features[0].properties.warninglevel='BLUE',v=>v.features[0].geometry.coordinates[0][0][0]=999,v=>v.exceededTransferLimit=true,v=>v.features.push(structuredClone(v.features[0]))]){const bad=structuredClone(raw);change(bad);assert.throws(()=>normalize('metoffice-warnings-esri',bad));}
 assert.equal(normalize('metoffice-warnings-esri',{type:'FeatureCollection',features:[]}).records.length,0);
});
