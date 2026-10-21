import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import C from '../core/index.js';
import '../platform/browser.js';
import '../client/presentation.js';
import '../client/warnings.js';
import '../client/floods.js';
import { EnglandFloodProvider, normalizeFloods, FLOODS_URL } from '../providers/ea-floods.js';
import { createStormtraceServer } from '../server.js';
const fixture = () => JSON.parse(readFileSync(new URL('fixtures/floods/current.json',import.meta.url)));
const python = (value) => JSON.parse(execFileSync('python3',['-c','import json,sys; from providers.ea_floods import normalize_floods; print(json.dumps(normalize_floods(json.load(sys.stdin),1234)))'],{ input:JSON.stringify(value),encoding:'utf8',stdio:['pipe','pipe','pipe'] }));
const W = globalThis.StormtraceWarnings, F = globalThis.StormtraceFloods;
const reply = (value) => ({ ok:true, text:async()=>JSON.stringify(value) });
test('flood normalization parity preserves classifications, withdrawal, raw times and provenance',()=> {
  for (const level of [1,2,3,4]) {
    const payload=fixture(); payload.items[0].severityLevel=level;
    const records=normalizeFloods(payload,1234); assert.deepEqual(records,python(payload));
    assert.equal(records[0].updatedAt,null); assert.equal(records[0].observedAt,null);
    assert.equal(records[0].domainPayload.sourceFields.futureField,'retained');
    assert.equal(records[0].domainPayload.status,level===4?'NO_LONGER_IN_FORCE':'ACTIVE');
  }
  const offset=fixture(); for (const k of ['timeRaised','timeMessageChanged','timeSeverityChanged']) offset.items[0][k]+='Z';
  assert.deepEqual(normalizeFloods(offset,1234),python(offset));
  assert.deepEqual(normalizeFloods({items:[]},1234),python({items:[]}));
});
test('malformed, duplicate and truncated feeds cannot become a healthy empty result',()=> {
  const invalid=[{...fixture(),meta:'bad'}, {...fixture(),meta:{limit:'bad'}}, {}, {items:[{}]}, {items:fixture().items.concat(fixture().items)}, {...fixture(),meta:{limit:1}}, {...fixture(),meta:{offset:1}}];
  for (const change of [{severityLevel:true},{severityLevel:5},{timeRaised:'yesterday'},{timeRaised:'2026-02-30T09:00:00'},{'@id':'https://evil.invalid/x'},{floodArea:{county:7}}]) { const p=fixture();Object.assign(p.items[0],change);invalid.push(p); }
  for (const value of invalid) { assert.throws(()=>normalizeFloods(value,1234)); assert.throws(()=>python(value)); }
});
test('provider shares bounded polling, quiet-feed health, failures and recovery',async()=> {
  let now=1234, calls=0, payload=fixture(), broken=false;
  const provider=new EnglandFloodProvider({now:()=>now,fetch:async(url,options)=> { calls++;assert.equal(url,FLOODS_URL);assert.equal(options.redirect,'error'); if(broken) throw new Error('offline');return reply(payload); }});
  const [a,b]=await Promise.all([provider.current(),provider.current()]); assert.deepEqual(a,b);assert.equal(calls,1);
  await provider.current();assert.equal(calls,1);assert.equal(C.freshness(provider.health,now),'fresh');
  now+=900000;broken=true;await assert.rejects(provider.current());assert.equal(provider.health.lastError.code,'network');
  broken=false;payload={items:[]};const empty=await provider.current();assert.equal(empty.records.length,0);assert.equal(empty.health.lastError,null);
});
test('browser transport keeps receiver, stores independent revisions, preserves cache on error',async()=> {
  const original=globalThis.fetch; let records=normalizeFloods(fixture(),1234), broken=false, now=1234;
  const history=new C.RevisionHistory(new globalThis.StormtracePlatform.MemoryStorageAdapter(),{now:()=>now});
  globalThis.fetch=async function(url) { assert.equal(this,globalThis);assert.equal(url,'/api/floods');if(broken)throw new Error('offline');return {ok:true,json:async()=>({configured:true,records,observations:records,health:{...C.health(900000),lastSuccessfulFetch:now,available:true,freshnessBasis:'fetch'}})}; };
  try {
    const controller=new W.WarningController({id:'ea-floods',endpoint:'/api/floods',validate:F.validBatch,history,now:()=>now});
    await controller.refresh();now++;records=normalizeFloods(fixture(),now);await controller.refresh();
    assert.equal((await history.revisions('ea-floods',records[0].id)).length,1);
    const p=fixture();p.items[0].severityLevel=4;records=normalizeFloods(p,now);await controller.refresh();assert.equal((await history.query({provider:'ea-floods',time:'persistedAt'})).length,2);
    broken=true;await controller.refresh();assert.equal(controller.state.cached,true);assert.equal(controller.state.records[0].domainPayload.status,'NO_LONGER_IN_FORCE');
    broken=false;records=[];await controller.refresh();assert.equal(controller.state.cached,false);assert.deepEqual(controller.state.records,[]);assert.equal((await history.query({provider:'ea-floods',time:'persistedAt'})).length,2);
  } finally {globalThis.fetch=original;}
});
test('local endpoint exposes normalized data and isolates upstream failure',async(t)=> {
  let broken=false;
  const server=createStormtraceServer({floodsProvider:{health:C.health(900000),current:async()=> {if(broken)throw new C.ProviderError('network','ea-floods','current');return {records:normalizeFloods(fixture(),1234),observations:[],health:C.health(900000)};}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const result=await fetch(url+'/api/floods');assert.equal(result.status,200);F.validBatch(await result.json());
  broken=true;assert.equal((await fetch(url+'/api/floods')).status,502);assert.equal((await fetch(url+'/api/health')).status,200);
});

test('flood dialog safely renders source messages, exposes withdrawal history and avoids demo requests',async()=> {
  const { IDBFactory } = await import('fake-indexeddb');
  class Element {
    constructor(tag='div') { this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.textContent='';this.open=false; }
    append(node) {this.children.push(node);}
    replaceChildren(...nodes) {this.children=nodes;}
    addEventListener(name,fn) {this.listeners[name]=fn;}
    showModal() {this.open=true;}
    get content() {return [this.textContent,...this.children.map(n=>n.content)].join('\n');}
  }
  const elements=Object.fromEntries(['floodsDialog','floodList','floodStatus','floodRefresh','floodAttribution','floodStorageStatus','floodsButton','floodHistory','floodArchive','floodCountry','floodCoverage','floodOfficialLink'].map(id=>[id,new Element()]));
  elements.floodCountry.value='ea-floods';
  const original={document:globalThis.document,indexedDB:globalThis.indexedDB,fetch:globalThis.fetch};
  globalThis.document={hidden:false,getElementById:id=>elements[id],createElement:tag=>new Element(tag),addEventListener(){}};
  globalThis.indexedDB=new IDBFactory();
  const payload=fixture();payload.items[0].message='<img src=x onerror=attack()> Synthetic message';
  let records=normalizeFloods(payload,1234), requests=0, controller;
  globalThis.fetch=async()=> {requests++;return {ok:true,json:async()=>({configured:true,records,observations:records,health:{...C.health(900000),available:true,lastSuccessfulFetch:1234,freshnessBasis:'fetch'}})};};
  try {
    controller=F.mountFloods();controller.now=()=>1234;elements.floodsButton.listeners.click();
    for(let n=0;n<50&&(controller.state.configured==null||controller.state.loading);n++) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(controller.state.configured,true);assert.match(elements.floodList.content,/timezone not supplied/);
    assert.equal(elements.floodList.children[0].children.find(n=>n.className==='warning-text').textContent,payload.items[0].message);
    payload.items[0].severityLevel=4;records=normalizeFloods(payload,1234);await elements.floodRefresh.listeners.click();assert.equal(elements.floodList.children.length,0);
    await elements.floodHistory.listeners.click();assert.match(elements.floodArchive.content,/Synthetic message/);assert.equal(elements.floodArchive.children.length,3);
    elements.floodsDialog.listeners.close();assert.equal(elements.floodArchive.children.length,0);
    const nationalBefore=requests;
    for (const id of ['nrw-floods','sepa-floods','ni-floods']) {
      elements.floodCountry.value=id;await elements.floodCountry.listeners.change();
      assert.equal(elements.floodList.children.length,0);assert.equal(elements.floodRefresh.disabled,true);assert.equal(elements.floodHistory.disabled,true);
      assert.match(elements.floodStatus.textContent,/does not have live warnings/);assert.equal(elements.floodOfficialLink.href,C.getSource(id).homepage);
      assert.equal(requests,nationalBefore);
    }
    elements.floodCountry.value='ea-floods';await elements.floodCountry.listeners.change();
    const before=requests;F.mountFloods({demo:true});elements.floodsButton.listeners.click();assert.equal(requests,before);assert.match(elements.floodStatus.textContent,/demo mode/);
  } finally {elements.floodsDialog.listeners.close?.();controller?.history?.storage.close();controller?.snapshotStorage?.close();Object.assign(globalThis,original);}
});
test('a null paging offset is accepted in both runtimes and source metadata comes from the registry',()=> {
  const payload=fixture();payload.meta={...(payload.meta||{}),offset:null};
  const records=normalizeFloods(payload,1234);assert.deepEqual(records,python(payload));
  assert.equal(records[0].sourceAuthority,C.getSource('ea-floods').authority);assert.equal(records[0].provenance.sourceUrl,C.getSource('ea-floods').homepage);
});
