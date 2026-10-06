import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import C from '../core/index.js';
import '../client/radar.js';
import { MetOfficeRadarProvider } from '../providers/metoffice-radar.js';
const at = Date.parse('2026-10-06T21:00:00Z');
const id = 'radar/2026/10/06/202610062100_ODIM_ng_radar_rainrate_composite_1km_UK.h5';
const payload = () => ({ records: [{ id, observedAt: at, bounds: [-13,48,4,62], resource: { url: '/api/radar/frame?key='+encodeURIComponent(id), format: 'image/png' }, provenance: C.provenance(C.getSource('metoffice-radar'), { fetchedAt: at, observedAt: at }) }], sourceDataTimestamp: at, missingDependencies: [], legend: { levels: [0.1], colours: ['#62c7ff'] } });

test('public radar provider coalesces metadata and images, caches bounded current frames and rejects arbitrary keys', async () => {
  let now = at, calls = []; const provider = new MetOfficeRadarProvider({ now: () => now, worker: async (operation, key) => { calls.push([operation,key]); return operation === 'frames' ? Buffer.from(JSON.stringify(payload())) : Buffer.from('PNG'); } });
  const [a,b] = await Promise.all([provider.frames(),provider.frames()]); assert.deepEqual(a,b); assert.equal(calls.length,1);
  a.records.length=0; assert.equal((await provider.frames()).records.length,1);
  await Promise.all([provider.image(id),provider.image(id)]); assert.equal(calls.length,2);
  await assert.rejects(provider.image('../.env'),{code:'unavailable'});
  now+=900000; await provider.frames(); assert.equal(calls.length,3); assert.equal(provider.health.sourceDataTimestamp,at);
  assert.equal(C.freshness(provider.health,now+1800001),'stale');
});

test('radar decoder configuration failure and render retry are isolated from provider listing', async () => {
  let fail=true; const provider=new MetOfficeRadarProvider({ worker: async(operation) => {
    if (operation==='frames')return Buffer.from(JSON.stringify(payload()));
    if(fail)throw new C.ProviderError('configuration','metoffice-radar','render');return Buffer.from('PNG');
  }});
  await assert.rejects(provider.image(id),{code:'configuration'});fail=false;assert.equal((await provider.image(id)).toString(),'PNG');
  const missing=payload();missing.missingDependencies=['h5py'];const optional=new MetOfficeRadarProvider({worker:async()=>Buffer.from(JSON.stringify(missing))});await assert.rejects(optional.image(id),{code:'configuration'});
});

test('radar presentation accepts normalized resources and rejects malformed/external frame URLs', () => {
  const value={...payload(),health:C.health()};assert.equal(globalThis.StormtraceRadar.validate(value),value);
  value.records[0].resource.url='https://evil.example/key';assert.throws(()=>globalThis.StormtraceRadar.validate(value));
});

test('Python radar parsing validates dates, sizes, namespace and bounded listing; manifest is source-timed', () => {
  const script=`
import json
from providers.metoffice_radar import key_time,parse_listing,frames,RadarError,BASE
assert key_time('${id}')==${at}
for key in ['../.env','radar/2026/10/07/202610062100_ODIM_ng_radar_rainrate_composite_1km_UK.h5','radar/2026/10/06/202610062101_ODIM_ng_radar_rainrate_composite_1km_UK.h5']:
    try:key_time(key);raise AssertionError('accepted malformed key')
    except RadarError:pass
xml=b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Contents><Key>${id}</Key><Size>100</Size></Contents></ListBucketResult>'
assert parse_listing(xml)==[('${id}',${at})]
for bad in [xml.replace(b'false',b'true'),b'<!DOCTYPE x>'+xml,xml.replace(b'100</Size>',b'10000001</Size>')]:
    try:parse_listing(bad);raise AssertionError('accepted malformed listing')
    except RadarError:pass
class Reply:
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,n):return xml
def open_stub(url,timeout):assert url.startswith(BASE) and timeout==15;return Reply()
result=frames(${at}+300000,open_stub)
assert len(result['records'])==1 and result['sourceDataTimestamp']==${at}
assert result['records'][0]['bounds']==[-13,48,4,62]
assert frames(${at}+4*3600000,open_stub)['records']==[]
print('ok')
`;
  assert.equal(execFileSync('python3',['-c',script],{encoding:'utf8'}).trim(),'ok');
});

test('optional ODIM renderer validates timestamps, gain/offset, no-data and Mercator georeferencing', (context) => {
  const python=process.env.STORMTRACE_RADAR_PYTHON||'python3';
  const deps=execFileSync(python,['-c',"import importlib.util; print(all(importlib.util.find_spec(n) for n in ['numpy','h5py','pyproj']))"],{encoding:'utf8'}).trim();
  if(deps!=='True'){context.skip('Install requirements-radar.txt and set STORMTRACE_RADAR_PYTHON to validate optional decoder');return;}
  const script=`
import io,zlib,struct
import numpy as np,h5py
from pyproj import Transformer
from providers.metoffice_radar import render,RadarError
stream=io.BytesIO()
with h5py.File(stream,'w') as f:
    w=f.create_group('what');w.attrs.update(date='20261006',time='210000')
    g=f.create_group('where');g.attrs.update(xsize=4,ysize=4,xscale=1000000.,yscale=1000000.,projdef='EPSG:3857',LL_lon=-13.,LL_lat=48.)
    p=f.create_group('dataset1/data1/what');p.attrs.update(quantity='RATE',gain=2.,offset=1.,nodata=-1.,undetect=0.)
    f.create_group('dataset1/how').attrs['origin']='UPPER LEFT'
    f.create_dataset('dataset1/data1/data',data=np.ones((4,4),dtype='float32'))
png=render(stream.getvalue(),${at},width=8,height=8)
assert png.startswith(b'\\x89PNG')
chunks=[];i=8
while i<len(png):
    n=struct.unpack('>I',png[i:i+4])[0]
    if png[i+4:i+8]==b'IDAT':chunks.append(png[i+8:i+8+n])
    i+=n+12
raw=zlib.decompress(b''.join(chunks))
assert len(raw)==8*(1+8*4) and raw[1:5]==bytes([0xa9,0xde,0x45,195])
try:render(stream.getvalue(),${at}+900000);raise AssertionError('timestamp mismatch accepted')
except RadarError as e:assert e.code=='unsupported_schema'
for value in [-1.,0.]:
    s=io.BytesIO(stream.getvalue())
    with h5py.File(s,'r+') as f:f['dataset1/data1/data'][:]=value
    image=render(s.getvalue(),${at},width=8,height=8)
    assert image!=png
print('ok')
`;
  assert.equal(execFileSync(python,['-c',script],{encoding:'utf8'}).trim(),'ok');
});

test('radar UI preserves the map view on toggles, swaps loaded frames, retains failures, and isolates demo', async () => {
  const original={document:globalThis.document,L:globalThis.L, warnings:globalThis.StormtraceWarnings};
  const elements=Object.fromEntries(['radarButton','radarPanel','radarStatus','radarTimeline','radarAttribution','radarFrameTime','radarLatest'].map(id=>[id,{listeners:{},addEventListener(n,f){this.listeners[n]=f;},setAttribute(n,v){this[n]=v;}}]));
  const pane={style:{}}, removed=[];let imageFails=false,requests=0;
  globalThis.document={hidden:false,getElementById:id=>elements[id],addEventListener(){}};
  globalThis.StormtraceWarnings={ukDate:at=>'time '+at};
  globalThis.L={imageOverlay(url,bounds,options){ assert.equal(options.pane,'radar');assert.deepEqual(bounds,[[48,-13],[62,4]]);return {listeners:{},once(n,f){this.listeners[n]=f;},addTo(){this.listeners[imageFails?'error':'load']();}};}};
  const map={createPane(){},getPane:()=>pane,fitBounds(){assert.fail('Radar toggles must preserve map centre and zoom');},removeLayer(v){removed.push(v);}};
  const value=payload();value.health={...C.health(900000),lastSuccessfulFetch:at,available:true};
  const fetch=async()=>{requests++;return {ok:true,json:async()=>value};};
  try {
    const control=globalThis.StormtraceRadar.mountRadar({map,fetch});elements.radarButton.listeners.click();
    for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));
    assert.match(elements.radarFrameTime.textContent,/Observation:/);assert.equal(pane.style.zIndex,250);
    imageFails=true;value.records=[{...value.records[0],id:'new-frame',observedAt:at+900000}];await control.refresh();assert.match(elements.radarStatus.textContent,/Keeping observation/);
    assert.equal(removed.length,1);elements.radarButton.listeners.click();assert.equal(elements.radarPanel.hidden,true);
    const before=requests;globalThis.StormtraceRadar.mountRadar({map,fetch,demo:true});elements.radarButton.listeners.click();assert.equal(requests,before);assert.match(elements.radarStatus.textContent,/demo mode/);elements.radarButton.listeners.click();
  } finally {Object.assign(globalThis,{document:original.document,L:original.L,StormtraceWarnings:original.warnings});}
});
