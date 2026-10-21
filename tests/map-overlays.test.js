import '../core/index.js';
import '../client/presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { MapOverlayProvider, normalizeOverlay } from '../providers/map-overlays.js';
const polygon = { type:'Feature', geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{} };
const contours = {type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[[0,0],[1,1]]]},properties:{units:'mmi',value:3.5}}]};
const options = {provider:'usgs',sourceUrl:'https://earthquake.usgs.gov/product',fetchedAt:100,updatedAt:50,intensity:true};
test('normalized overlay geometry and provenance have Python parity', () => {
 for (const [payload,opt] of [[contours,options],[polygon,{provider:'ea-floods',sourceUrl:'https://environment.data.gov.uk/polygon',fetchedAt:100}]]) {
  const python=JSON.parse(execFileSync('python3',['-c','import json,sys; from providers.map_overlays import normalize_overlay; p,o=json.load(sys.stdin); print(json.dumps(normalize_overlay(p,o["provider"],o["sourceUrl"],o["fetchedAt"],o.get("updatedAt"),o.get("intensity",False))))'],{input:JSON.stringify([payload,opt]),encoding:'utf8'}));
  assert.deepEqual(normalizeOverlay(payload,opt),python);
 }
});
test('rejects invalid geometry, intensity units and unsupported CRS', () => {
 for (const p of [{...contours,crs:{properties:{name:'EPSG:27700'}}},{...contours,features:[{...contours.features[0],properties:{units:'pga',value:3}}]},{...polygon,geometry:{type:'Polygon',coordinates:[[[0,0],[1,1]]]}}]) assert.throws(()=>normalizeOverlay(p,p.type==='Feature'?{...options,intensity:false}:options));
});
test('on-demand products coalesce, cache, restrict URLs and report missing ShakeMap without inventing extent',async()=>{
 let calls=0;
 const provider=new MapOverlayProvider({now:()=>100,fetch:async()=>{calls++;return new Response(JSON.stringify({id:'test',properties:{products:{}}}));}});
 const [a,b]=await Promise.all([provider.earthquake('test'),provider.earthquake('test')]); assert.deepEqual(a,{features:[],available:false});assert.deepEqual(a,b);await provider.earthquake('test');assert.equal(calls,1);
 assert.throws(()=>provider.flood('../secret'));
 const unsafe=new MapOverlayProvider({fetch:async()=>new Response(JSON.stringify({id:'test',properties:{products:{shakemap:[{status:'UPDATE',updateTime:50,contents:{'download/cont_mi.json':{url:'https://evil.example/cont_mi.json'}}}]}}}))});
 await assert.rejects(unsafe.earthquake('test'));
});
test('fetch retains its global receiver and resources are byte bounded',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve(new Response(JSON.stringify(polygon)));};
 try {assert.equal((await new MapOverlayProvider().flood('test')).features.length,1);} finally {globalThis.fetch=original;}
 const provider=new MapOverlayProvider({fetch:async()=>new Response('x'.repeat(10000001))});await assert.rejects(provider.flood('test'));
});
test('map layer disabling prevents pending responses restoring points',async()=>{
 const saved={document:globalThis.document,L:globalThis.L,fetch:globalThis.fetch,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const elements=Object.fromEntries(['mapFloods','mapQuakes','mapHazardStatus','mapShakingStatus','mapHazardRefresh'].map(id=>[id,{checked:false,textContent:'',addEventListener(type,fn){this[type]=fn;}}]));
 const layers=[]; let resolve;
 globalThis.document={hidden:false,getElementById:id=>elements[id],addEventListener(){},createElement:()=>({textContent:''})};
 globalThis.L={layerGroup:()=>{const layer={items:[],addTo(){layers.push(this);return this;},clearLayers(){this.items=[];}};return layer;},circleMarker:()=>{throw new Error('late marker should not be rendered');}};
 globalThis.fetch=()=>new Promise(r=>resolve=r);globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
 try {
  await import('../client/map-hazards.js');globalThis.StormtraceMapHazards.mount({map:{}});
  elements.mapQuakes.checked=true; elements.mapQuakes.change();
  elements.mapQuakes.checked=false; elements.mapQuakes.change();
  resolve(new Response(JSON.stringify({records:[{id:'test',observedAt:Date.now(),geometry:{type:'Point',coordinates:[0,0]},domainPayload:{magnitude:3,place:'test'}}]})));
  await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  assert.ok(layers.every(l=>l.items.length===0));assert.equal(elements.mapHazardStatus.textContent,'Additional hazard layers off.');
 } finally {Object.assign(globalThis,saved);}
});
test('quake popup hides actions until availability is known, and keeps missing products distinct from errors',async()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:()=>({textContent:'',children:[],append(...nodes){this.children.push(...nodes);},addEventListener(type,fn){this[type]=fn;}})};
 try {
  await import('../client/map-hazards.js');let report;
  const popup=globalThis.StormtraceMapHazards.quakePopup({domainPayload:{magnitude:1.8,place:'Karluk'}},callback=>{report=callback;});
  const button=popup.node.children.find(n=>n.textContent==='Reload estimated shaking');assert.equal(button.hidden,true);
  const status=()=>popup.node.children[popup.node.children.indexOf(button)-1];
  popup.load();report('No USGS ShakeMap available','unavailable');assert.equal(button.hidden,true);assert.match(status().textContent,/No USGS ShakeMap/);
  popup.load();report('Estimated shaking loaded','available');assert.equal(button.hidden,false);
  button.click();report('Loading','loading');assert.equal(button.hidden,true);
  report('Retrieval failed','error');assert.equal(button.hidden,false);assert.equal(button.textContent,'Retry shaking check');
 } finally {globalThis.document=previous;}
});
test('null geometry or properties are rejected as malformed in both runtimes', () => {
 const script='import json,sys\nfrom providers.map_overlays import normalize_overlay\nfrom providers.usgs import EarthquakeError\ntry: normalize_overlay(json.load(sys.stdin),"ea-floods","https://environment.data.gov.uk/polygon",100)\nexcept EarthquakeError: print("rejected")';
 for (const p of [{...polygon,geometry:null},{...polygon,properties:5},{type:'FeatureCollection',features:[null]},{...polygon,crs:null,geometry:{}}]) {
  assert.throws(()=>normalizeOverlay(p,{provider:'ea-floods',sourceUrl:'https://environment.data.gov.uk/polygon',fetchedAt:100}));
  assert.equal(execFileSync('python3',['-c',script],{input:JSON.stringify(p),encoding:'utf8'}).trim(),'rejected');
 }
});
test('the overlay cache holds a full map refresh of flood areas', async () => {
 let calls=0;
 const provider=new MapOverlayProvider({now:()=>100,fetch:async()=>{calls++;return new Response(JSON.stringify(polygon));}});
 for (let pass=0;pass<2;pass++) for (let i=0;i<100;i++) await provider.flood(`area${i}`);
 assert.equal(calls,100);
});
