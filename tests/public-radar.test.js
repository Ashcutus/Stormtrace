import { readFileSync } from 'node:fs';
import '../core/index.js';
import '../client/presentation.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import C from '../core/index.js';
import '../client/radar.js';
import { MetOfficeRadarProvider } from '../providers/metoffice-radar.js';
import { createStormtraceServer } from '../server.js';

const at = Date.parse('2026-10-12T14:45:00Z');
const fixtureScript = `
import json
from providers.public_radar import *
now=${at}
key='2026/10/12/OPERA/COMP/OPERA@20261012T1445@0@RATE.h5'
listing=('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Contents><Key>'+key+'</Key><Size>1272203</Size></Contents></ListBucketResult>').encode()
times=','.join(datetime.fromtimestamp((now-i*120000)/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') for i in range(90))
def capabilities(source):return ('<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Layer><Name>'+source[5:]+'_bref_qcd</Name><Dimension name="time">'+times+'</Dimension></Layer></WMS_Capabilities>').encode()
class Reply:
 def __init__(self,data):self.data=data
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,n):return self.data[:n]
calls=[]
def opener(url,timeout):
 assert timeout==15
 calls.append(url)
 return Reply(listing if url.startswith(OPERA_BASE) else capabilities('noaa-conus'))
opera=frames('opera-radar',now,opener)
# Full-day prefixes truncate in production: use only bounded window hours.
assert len(calls)==4
assert [urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['prefix'][0][-3:] for url in calls]==['T11','T12','T13','T14']
noaa=frames('noaa-conus',now,opener)
assert len(opera['records'])==1 and len(noaa['records'])==12
assert noaa['records'][-1]['observedAt']==now and noaa['records'][0]['observedAt']<=now-2*3600000
assert opera['records'][0]['provenance']['upstreamId']==key
assert noaa['records'][-1]['id'].startswith('noaa-conus@')
assert noaa['missingDependencies']==[] and noaa['legend']['unit']=='dBZ'
assert opera['legend']['unit']=='mm/h'
for bad in [listing.replace(b'false',b'true'),b'<!DOCTYPE x>'+listing,listing.replace(b'1272203',b'20000001'),listing.replace(b'20261012T1445',b'20261013T1445')]:
 try:opera_listing(bad);raise AssertionError('bad listing accepted')
 except RadarError:pass
for bad in [capabilities('noaa-conus').replace(b'conus_bref_qcd',b'other'),capabilities('noaa-conus').replace(b'2026-10-12T14:45:00.000Z',b'not-time')]:
 try:noaa_times(bad,'noaa-conus');raise AssertionError('bad capabilities accepted')
 except RadarError:pass
for source in ['evil','noaa-../.env','noaa-conus?url=https://evil','metoffice-radar']:
 try:source_info(source);raise AssertionError('bad source accepted')
 except RadarError:pass
assert NoRedirect().redirect_request(None,None,302,'',{},'https://evil') is None
# Empty success, old/future observations and decoder absence remain distinct.
assert frames('noaa-conus',now+4*3600000,opener)['records']==[]
assert frames('noaa-conus',now-4*3600000,opener)['records']==[]
# Image retrieval is fixed-host, timestamped and Mercator; XML service errors fail.
png=b'\\x89PNG\\r\\n\\x1a\\nfixture'
def png_open(url,timeout):calls.append(url);return Reply(png)
assert image('noaa-conus',noaa['records'][-1]['id'],png_open)==png
assert 'crs=EPSG%3A3857' in calls[-1] and 'time=2026-10-12T14%3A45%3A00.000Z' in calls[-1]
assert image('noaa-conus','legend',png_open)==png and 'GetLegendGraphic' in calls[-1]
for bad in ['noaa-alaska@2026-10-12T14:45:00Z','noaa-conus@<xml>','../.env']:
 try:image('noaa-conus',bad,png_open);raise AssertionError('bad key accepted')
 except RadarError:pass
try:image('noaa-conus',noaa['records'][-1]['id'],lambda url,timeout:Reply(b'<ServiceException/>'));raise AssertionError('non-PNG accepted')
except RadarError as e:assert e.code=='parse'
from stormtrace_platform import RadarAdapter
from pathlib import Path
class Adapter(RadarAdapter):
 def worker(self,operation,key=None):return json.dumps(noaa).encode() if operation=='frames' else png
adapter=Adapter(Path('.'),'noaa-conus');python_result=adapter.frames()
assert adapter.image(noaa['records'][-1]['id'])==png
assert adapter.image('legend')==png
try:adapter.image('arbitrary');raise AssertionError('unlisted key accepted')
except RadarError:pass
print(json.dumps({'opera':opera,'noaa':noaa,'python':python_result}))
`;

test('official radar parsers bound products and resources, preserve source time, and share Node/Python normalization', async () => {
  const result = JSON.parse(execFileSync('python3', ['-c', fixtureScript], { encoding: 'utf8' }));
  for (const [source, id] of [['opera','opera-radar'],['noaa','noaa-radar']]) {
    const provider = new MetOfficeRadarProvider({id, source, now: () => at, worker: async () => Buffer.from(JSON.stringify(result[source]))});
    const node = await provider.frames();
    assert.deepEqual(node.records, result[source].records);
    assert.deepEqual(node.legend, result[source].legend);
    globalThis.StormtraceRadar.validate(node);
    if (source === 'noaa') assert.deepEqual(node.records, result.python.records);
  }
});

test('NOAA metadata refreshes within a minute and on-demand resources stay bounded and isolated', async () => {
  let now = at, calls = 0;
  const records = Array.from({length:12}, (_, i) => ({id:'frame-'+i,observedAt:at}));
  const provider = new MetOfficeRadarProvider({id:'noaa-radar',source:'noaa-conus',now:()=>now,worker:async op => {
    calls++; return op==='frames' ? Buffer.from(JSON.stringify({records,sourceDataTimestamp:at,missingDependencies:[],legend:{unit:'dBZ'}})) : Buffer.from('PNG');
  }});
  await Promise.all([provider.frames(),provider.frames()]); assert.equal(calls,1);
  now += 60001; await provider.frames(); assert.equal(calls,2);
  for (const record of records) await provider.image(record.id);
  // Shown and pending frames, each with a possible coverage mask.
  assert.equal(provider.images.size,6);
  await provider.image('legend'); assert.equal(provider.images.size,6);
  await assert.rejects(provider.image('https://evil'),{code:'unavailable'});
});

const get = (port, path) => new Promise((resolve,reject) => {
  http.get({host:'127.0.0.1',port,path}, response => {let data='';response.on('data',part=>data+=part);response.on('end',()=>resolve({status:response.statusCode,data}));}).on('error',reject);
});
test('radar source routing preserves the UK default, isolates failures and rejects unknown sources in both servers', async context => {
  const make = id => ({id,health:{},frames:async()=>({records:[],source:id}),image:async key=>Buffer.from(id+key)});
  const server=createStormtraceServer({radarProvider:make('metoffice-radar'),publicRadarProviders:{'opera-radar':make('opera-radar'),'noaa-conus':make('noaa-radar')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));context.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  assert.equal(JSON.parse((await get(port,'/api/radar')).data).source,'metoffice-radar');
  assert.equal(JSON.parse((await get(port,'/api/radar?source=opera-radar')).data).source,'opera-radar');
  assert.equal((await get(port,'/api/radar/frame?source=noaa-conus&key=legend')).data,'noaa-radarlegend');
  assert.equal((await get(port,'/api/radar?source=unknown')).status,400);
  assert.equal(execFileSync('python3',['-c',`
import server,threading,json,urllib.request,urllib.error
class Stub:
 id='opera-radar';health={}
 def frames(self):return {'records':[], 'source':self.id}
 def image(self,key):return b'PNG'+key.encode()
server.PUBLIC_RADAR_PROVIDERS={'opera-radar':Stub()}
http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
threading.Thread(target=http.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(http.server_port)
with urllib.request.urlopen(base+'/api/radar?source=opera-radar') as r:assert json.load(r)['source']=='opera-radar'
with urllib.request.urlopen(base+'/api/radar/frame?source=opera-radar&key=sample') as r:assert r.read()==b'PNGsample'
try:urllib.request.urlopen(base+'/api/radar?source=unknown');raise AssertionError('unknown source accepted')
except urllib.error.HTTPError as e:assert e.code==400
http.shutdown();http.server_close();print('ok')
`],{encoding:'utf8'}).trim(),'ok');
});

test('switching radar sources cancels a pending image, rejects old results and preserves receiver-sensitive fetch', async () => {
  const original={document:globalThis.document,L:globalThis.L,fetch:globalThis.fetch,StormtraceWarnings:globalThis.StormtraceWarnings};
  const ids=['radarButton','radarPanel','radarStatus','radarTimeline','radarAttribution','radarFrameTime','radarLatest','radarSource','radarSourceLink','radarCoverage','radarUnit','radarViewRegion'];
  const elements=Object.fromEntries(ids.map(id=>[id,{value:id==='radarSource'?'metoffice-radar':'',listeners:{},addEventListener(n,f){this.listeners[n]=f;},setAttribute(n,v){this[n]=v;}}]));
  const images=[],requests=[],removed=[]; let fitted=0;
  globalThis.document={hidden:false,getElementById:id=>elements[id],addEventListener(){}};
  globalThis.StormtraceWarnings={ukDate:at=>'UK '+at};
  globalThis.L={imageOverlay(url,bounds){const layer={url,bounds,listeners:{},once(n,f){this.listeners[n]=f;},addTo(){images.push(this);}};return layer;}};
  const pane={style:{}};
  const map={createPane(){},getPane:()=>pane,removeLayer:layer=>removed.push(layer),fitBounds(){fitted++;}};
  const result=source=>({records:[{id:source+'@frame',observedAt:at,bounds:source==='metoffice-radar'?[-13,48,4,62]:[-126,24,-66,50],resource:{url:'/api/radar/frame?source='+source+'&key=frame',format:'image/png'}}],health:C.health(),missingDependencies:[],legend:{unit:source==='metoffice-radar'?'mm/h':'dBZ'}});
  globalThis.fetch=function(url){assert.equal(this,globalThis);requests.push(url);return Promise.resolve({ok:true,json:async()=>result(url.includes('noaa-conus')?'noaa-conus':'metoffice-radar')});};
  const settle=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
  try {
    globalThis.StormtraceRadar.mountRadar({map});elements.radarButton.listeners.click();await settle();
    assert.equal(images.length,1);
    elements.radarSource.value='noaa-conus';elements.radarSource.listeners.change();await settle();
    assert.equal(images.length,2);assert.ok(removed.includes(images[0]));
    images[0].listeners.load();await settle();assert.equal(elements.radarFrameTime.textContent,'');
    images[1].listeners.load();await settle();
    assert.match(elements.radarFrameTime.textContent,/UK local/);assert.match(elements.radarCoverage.textContent,/reflectivity/);
    assert.match(elements.radarAttribution.textContent,/NOAA/);assert.equal(requests[1],'/api/radar?source=noaa-conus');
    assert.equal(fitted,0);elements.radarViewRegion.listeners.click();assert.equal(fitted,1);
    elements.radarButton.listeners.click();assert.equal(elements.radarPanel.hidden,true);
    const before=requests.length;globalThis.StormtraceRadar.mountRadar({map,demo:true});elements.radarButton.listeners.click();
    elements.radarSource.value='opera-radar';elements.radarSource.listeners.change();await settle();assert.equal(requests.length,before);
    elements.radarButton.listeners.click();
  } finally { if(elements.radarButton['aria-pressed']==='true')elements.radarButton.listeners.click();Object.assign(globalThis,original); }
});

test('OPERA decoder validates Cartesian corners, source quantity/time and missing values before Mercator rendering', context => {
  const python=process.env.STORMTRACE_RADAR_PYTHON||'python3';
  if(execFileSync(python,['-c',"import importlib.util;print(all(importlib.util.find_spec(x) for x in ['h5py','numpy','pyproj']))"],{encoding:'utf8'}).trim()!=='True') {context.skip('Optional ODIM decoder is not installed');return;}
  assert.equal(execFileSync(python,['-c',`
import io
import numpy as np,h5py
from pyproj import Transformer
from providers.metoffice_radar import render,RadarError
s=io.BytesIO();project=Transformer.from_crs('EPSG:4326','EPSG:3857',always_xy=True);unproject=Transformer.from_crs('EPSG:3857','EPSG:4326',always_xy=True)
x,y=project.transform(-13,48)
with h5py.File(s,'w') as f:
 f.create_group('what').attrs.update(date='20261012',time='144500',object='COMP')
 where=f.create_group('where');where.attrs.update(xsize=4,ysize=4,xscale=1000000.,yscale=1000000.,projdef='EPSG:3857',LL_lon=-13.,LL_lat=48.)
 for corner,xx,yy in [('UL',x,y+4000000),('LR',x+4000000,y),('UR',x+4000000,y+4000000)]:
  lon,lat=unproject.transform(xx,yy);where.attrs[corner+'_lon']=lon;where.attrs[corner+'_lat']=lat
 f.create_group('dataset1/what').attrs.update(prodname='OPERA NIMBUS instantaneous rain rate composite')
 f.create_group('dataset1/how')
 f.create_group('dataset1/data1/what').attrs.update(quantity='RATE',gain=1.,offset=0.,nodata=-9999000.,undetect=-8888000.)
 f.create_dataset('dataset1/data1/data',data=np.ones((4,4)))
original=s.getvalue();image=render(original,${at},width=8,height=8,product='opera')
assert image.startswith(b'\\x89PNG')
for group,attr,value in [('where','UL_lon',0.),('what','time','150000'),('dataset1/data1/what','quantity','DBZH'),('dataset1/how','origin','LOWER LEFT')]:
 changed=io.BytesIO(original)
 with h5py.File(changed,'r+') as f:f[group].attrs[attr]=value
 try:render(changed.getvalue(),${at},width=8,height=8,product='opera');raise AssertionError('unsupported source accepted')
 except RadarError as error:assert error.code=='unsupported_schema'
for value in [-9999000.,-8888000.,0.]:
 changed=io.BytesIO(original)
 with h5py.File(changed,'r+') as f:f['dataset1/data1/data'][:]=value
 assert render(changed.getvalue(),${at},width=8,height=8,product='opera')!=image
print('ok')
`],{encoding:'utf8'}).trim(),'ok');
});

test('sampled US frame identities stay stable as new observations arrive', () => {
  execFileSync('python3', ['-c', `
from datetime import datetime, timezone
from providers.public_radar import frames
now=${at}
def run(latest):
  times=','.join(datetime.fromtimestamp((latest-i*120000)/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') for i in range(95))
  data=('<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Layer><Name>conus_bref_qcd</Name><Dimension name="time">'+times+'</Dimension></Layer></WMS_Capabilities>').encode()
  class Reply:
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,n):return data[:n]
  return [r['id'] for r in frames('noaa-conus',latest,lambda url,timeout:Reply())['records']]
for step in range(1,8):
  before,after=run(now),run(now+step*120000)
  assert len(before)==len(after)==12 and after[-1].endswith(datetime.fromtimestamp((now+step*120000)/1000,timezone.utc).strftime('%H:%M:00.000Z'))
  # Only the newest frame and at most one slot rolling off the window may change.
  assert len(set(before[:-1])-set(after))<=1, (step,before,after)
`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
});

test('NOAA precipitation type uses the fixed MRMS layer per region, a categorical legend without sleet, and both servers route it', async context => {
  assert.equal(execFileSync('python3',['-c',`
from providers.public_radar import *
import server
now=${at}
times=','.join(datetime.fromtimestamp((now-i*120000)/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') for i in range(90))
caps=lambda layer:('<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Layer><Name>'+layer+'</Name><Dimension name="time">'+times+'</Dimension></Layer></WMS_Capabilities>').encode()
class Reply:
 def __init__(self,data):self.data=data
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,n):return self.data[:n]
calls=[]
def opener(url,timeout):calls.append(url);return Reply(caps('conus_pcpn_typ') if 'GetCapabilities' in url else b'\\x89PNG\\r\\n\\x1a\\nfixture')
for region in REGIONS:assert noaa_layer('noaa-ptype-'+region)==region+'_pcpn_typ' and noaa_layer('noaa-'+region)==region+'_bref_qcd'
result=frames('noaa-ptype-conus',now,opener)
assert '/conus/conus_pcpn_typ/ows' in calls[0] and len(result['records'])==12
assert result['records'][-1]['id'].startswith('noaa-ptype-conus@') and result['records'][-1]['provenance']['provider']=='noaa-radar'
assert 'mrms-precipflag-display' in result['records'][-1]['provenance']['transformations']
legend=result['legend'];labels=[c['label'] for c in legend['categories']]
assert legend['unit']=='category' and 'Snow' in labels and 'Hail' in labels and not any('sleet' in l.lower() or 'freezing' in l.lower() for l in labels)
assert image('noaa-ptype-conus',result['records'][-1]['id'],opener).startswith(b'\\x89PNG') and 'layers=conus_pcpn_typ' in calls[-1]
# A reflectivity key cannot be replayed against the precipitation-type source.
try:image('noaa-ptype-conus',result['records'][-1]['id'].replace('noaa-ptype-','noaa-'),opener);raise AssertionError('cross-product key accepted')
except RadarError:pass
for bad in ['noaa-ptype-','noaa-ptype-evil','noaa-ptype-conus/../x','noaa-ptypeconus','noaa-ptype-ptype-conus']:
 try:source_info(bad);raise AssertionError('bad source accepted: '+bad)
 except RadarError:pass
assert all('noaa-ptype-'+region in server.PUBLIC_RADAR_PROVIDERS for region in REGIONS)
print('ok')
`],{encoding:'utf8'}).trim(),'ok');
  // The Node server's default source list registers every precipitation-type region.
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');for(const region of ['conus','alaska','hawaii','carib','guam'])assert.match(source,new RegExp(`'noaa-ptype-${region}'`));
  const make=id=>({id,health:{},frames:async()=>({records:[],source:id}),image:async()=>Buffer.from('')});
  const server=createStormtraceServer({radarProvider:make('metoffice-radar'),publicRadarProviders:{'noaa-ptype-conus':make('noaa-radar')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));context.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal(JSON.parse((await get(server.address().port,'/api/radar?source=noaa-ptype-conus')).data).source,'noaa-radar');
  assert.equal((await get(server.address().port,'/api/radar?source=noaa-ptype-evil')).status,400);
});

test('radar panel renders precipitation type as a labelled categorical legend with model-assisted, no-sleet context', async () => {
  const original={document:globalThis.document,L:globalThis.L};
  const ids=['radarButton','radarPanel','radarStatus','radarTimeline','radarAttribution','radarFrameTime','radarLatest','radarSource','radarSourceLink','radarCoverage','radarUnit','radarViewRegion','radarLegend'];
  const make=()=>({children:[],style:{setProperty(n,v){this[n]=v;}},append(n){this.children.push(n);},replaceChildren(){this.children=[];},classList:{add(){},remove(){}},listeners:{},addEventListener(n,f){this.listeners[n]=f;},setAttribute(n,v){this[n]=v;}});
  const elements=Object.fromEntries(ids.map(id=>[id,{...make(),value:id==='radarSource'?'noaa-ptype-conus':''}]));
  globalThis.document={hidden:false,getElementById:id=>elements[id],addEventListener(){},createElement:()=>({...make(),textContent:''})};
  globalThis.L={imageOverlay(){return {listeners:{},once(n,f){this.listeners[n]=f;},addTo(){this.listeners.load();}};}};
  const categories=[{label:'Rain (warm stratiform)',colour:'#0450a4'},{label:'Snow',colour:'#c8c8c8'},{label:'Hail',colour:'#960096'}];
  const result={records:[{id:'noaa-ptype-conus@x',observedAt:at,bounds:[-126,24,-66,50],resource:{url:'/api/radar/frame?source=noaa-ptype-conus&key=x',format:'image/png'}}],health:C.health(),missingDependencies:[],legend:{unit:'category',categories}};
  const map={createPane(){},getPane:()=>({style:{}}),removeLayer(){},fitBounds(){}};
  try {
    globalThis.StormtraceRadar.mountRadar({map,fetch:async url=>{assert.equal(url,'/api/radar?source=noaa-ptype-conus');return {ok:true,json:async()=>result};}});
    assert.match(elements.radarCoverage.textContent,/no sleet/);assert.match(elements.radarCoverage.textContent,/model/);assert.equal(elements.radarUnit.textContent,'Precipitation type');
    elements.radarButton.listeners.click();for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(elements.radarLegend.children.map(n=>n.textContent),['Rain (warm stratiform)','Snow','Hail']);assert.equal(elements.radarLegend.children[1].style['--rain'],'#c8c8c8');
    assert.throws(()=>globalThis.StormtraceRadar.validate({...result,legend:{unit:'category',categories:[{label:'Snow',colour:'url(evil)'}]}}));
  } finally {if(elements.radarButton.checked)elements.radarButton.listeners.click();Object.assign(globalThis,original);}
});

test('radar playback starts from the oldest frame, waits for each frame, loops, and stops on manual controls', async () => {
  const original={document:globalThis.document,L:globalThis.L,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const ids=['radarButton','radarPanel','radarStatus','radarTimeline','radarAttribution','radarFrameTime','radarLatest','radarSource','radarSourceLink','radarCoverage','radarUnit','radarViewRegion','radarLegend','radarPlay'];
  const make=()=>({children:[],style:{setProperty(){}},append(n){this.children.push(n);},replaceChildren(){this.children=[];},classList:{add(){},remove(){}},listeners:{},addEventListener(n,f){this.listeners[n]=f;},setAttribute(n,v){this[n]=v;}});
  const elements=Object.fromEntries(ids.map(id=>[id,{...make(),value:id==='radarSource'?'noaa-conus':''}]));
  const shown=[];const timers=[];
  globalThis.document={hidden:false,getElementById:id=>elements[id],addEventListener(){},createElement:()=>({...make(),textContent:''})};
  globalThis.L={imageOverlay(url){shown.push(url);return {listeners:{},once(n,f){this.listeners[n]=f;},addTo(){this.listeners.load();}};}};
  globalThis.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};globalThis.clearTimeout=()=>{timers.length=0;};
  const frame=i=>({id:'noaa-conus@'+i,observedAt:at-(3-i)*900000,bounds:[-126,24,-66,50],resource:{url:'/api/radar/frame?source=noaa-conus&key=f'+i,format:'image/png'}});
  const result={records:[frame(0),frame(1),frame(2)],health:C.health(),missingDependencies:[],legend:{unit:'dBZ',image:'/api/radar/frame?source=noaa-conus&key=legend'}};
  const settle=async()=>{for(let n=0;n<10;n++)await new Promise(r=>setImmediate(r));};
  try {
    globalThis.StormtraceRadar.mountRadar({map:{createPane(){},getPane:()=>({style:{}}),removeLayer(){},fitBounds(){}},fetch:async()=>({ok:true,json:async()=>result})});
    elements.radarButton.listeners.click();await settle();
    assert.equal(elements.radarPlay.disabled,false,elements.radarStatus.textContent+' / '+elements.radarTimeline.max);assert.equal(Number(elements.radarTimeline.value),2);
    shown.length=0;timers.length=0;
    elements.radarPlay.listeners.click();await settle();
    assert.equal(elements.radarPlay.textContent,'Pause');assert.match(shown.at(-1),/key=f0$/,'starts from the oldest frame');
    // Each frame is scheduled only after the previous one has drawn.
    const playingStatus=elements.radarStatus.textContent;assert.match(playingStatus,/Playing the past 3 hours/);
    timers.shift().fn();await settle();assert.match(shown.at(-1),/key=f1$/);assert.equal(elements.radarStatus.textContent,playingStatus,'status does not flicker between frames');
    timers.shift().fn();await settle();assert.match(shown.at(-1),/key=f2$/);assert.equal(timers[0].ms,1600,'pauses longer on the latest frame');
    timers.shift().fn();await settle();assert.match(shown.at(-1),/key=f0$/,'loops');
    elements.radarTimeline.value=1;elements.radarTimeline.listeners.input();
    assert.equal(elements.radarPlay.textContent,'Play');assert.equal(timers.length,0,'dragging the slider stops playback');
    await settle();assert.doesNotMatch(elements.radarStatus.textContent,/Playing/);
  } finally {if(elements.radarButton.checked)elements.radarButton.listeners.click();Object.assign(globalThis,original);}
});

test('Canadian ECCC radar expands the GeoMet time extent, pairs each frame with its coverage mask and keeps keys bounded', () => {
  const script = `
import json
from providers.public_radar import *
now=${at}
# GeoMet publishes a start/end/PT6M extent, not a list of instants.
def caps(layer,extent='2026-10-12T11:42:00Z/2026-10-12T14:42:00Z/PT6M'):return ('<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Layer><Name>'+layer+'</Name><Dimension name="time">'+extent+'</Dimension></Layer></WMS_Capabilities>').encode()
class Reply:
 def __init__(self,data):self.data=data
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,n):return self.data[:n]
calls=[]
def opener(url,timeout):calls.append(url);q=urllib.parse.parse_qs(urllib.parse.urlparse(url).query);return Reply(caps(q['layer'][0]))
assert len(wms_times(caps('RADAR_1KM_RRAI'),'RADAR_1KM_RRAI'))==31
for bad in ['2026-10-12T11:42:00Z/2026-10-12T14:42:00Z/PT0M','2026-10-12T14:42:00Z/2026-10-12T11:42:00Z/PT6M','2026-10-01T00:00:00Z/2026-10-12T14:42:00Z/PT1M','x/y/PT6M']:
 try:wms_times(caps('L',bad),'L');raise AssertionError('bad extent accepted '+bad)
 except RadarError:pass
rain=frames('eccc-rain',now,opener)
assert calls[-1].startswith(ECCC_BASE+'?') and 'layer=RADAR_1KM_RRAI' in calls[-1]
r=rain['records'];assert len(r)==12 and r[-1]['id']=='eccc-rain@2026-10-12T14:42:00Z' and r[-1]['bounds']==ECCC_BOUNDS
assert r[-1]['coverage']['url']=='/api/radar/frame?source=eccc-rain&key=eccc-rain%402026-10-12T14%3A42%3A00Z%40coverage'
assert r[-1]['provenance']['provider']=='eccc-radar' and r[-1]['provenance']['sourceAuthority']=='Environment and Climate Change Canada'
assert rain['legend']=={'unit':'mm/h','layout':'vertical','image':'/api/radar/frame?source=eccc-rain&key=legend'}
assert frames('eccc-snow',now,opener)['legend']['unit']=='cm/h'
ptype=frames('eccc-ptype',now,opener)['legend']
assert ptype['unit']=='category' and any('freezing rain' in c['label'] for c in ptype['categories']) and any('mixed' in c['label'] for c in ptype['categories'])
png=b'\\x89PNG\\r\\n\\x1a\\nfixture'
def png_open(url,timeout):calls.append(url);return Reply(png)
q=lambda:urllib.parse.parse_qs(urllib.parse.urlparse(calls[-1]).query)
assert image('eccc-rain',r[-1]['id'],png_open)==png and q()['layers']==['RADAR_1KM_RRAI'] and q()['styles']==['Radar-Rain_14colors'] and q()['time']==['2026-10-12T14:42:00Z'] and q()['crs']==['EPSG:3857']
assert image('eccc-rain',r[-1]['id']+'@coverage',png_open)==png and q()['layers']==['RADAR_COVERAGE_RRAI.INV'] and q()['styles']==[ECCC_COVERAGE_STYLE]
assert image('eccc-ptype','eccc-ptype@2026-10-12T14:42:00Z@coverage',png_open)==png and q()['layers']==['Radar-Coverage_SfcPrecipType-Inverted']
assert image('eccc-snow','legend',png_open)==png and q()['request']==['GetLegendGraphic'] and q()['layer']==['RADAR_1KM_RSNO']
for bad in ['eccc-snow@2026-10-12T14:42:00Z','eccc-rain@2026-10-12T14:42:00Z@other','eccc-rain@<x>@coverage','eccc-rain@@coverage','../.env']:
 try:image('eccc-rain',bad,png_open);raise AssertionError('bad key accepted '+bad)
 except RadarError:pass
for bad in ['eccc-evil','eccc-','eccc-rain?x']:
 try:source_info(bad);raise AssertionError('bad source accepted')
 except RadarError:pass
from stormtrace_platform import RadarAdapter, radar_provider_id
from pathlib import Path
assert radar_provider_id('eccc-ptype')=='eccc-radar' and radar_provider_id('noaa-guam')=='noaa-radar'
class Adapter(RadarAdapter):
 def worker(self,operation,key=None):return json.dumps(rain).encode() if operation=='frames' else png
adapter=Adapter(Path('.'),'eccc-rain');adapter.frames()
assert adapter.id=='eccc-radar' and adapter.health['expectedUpdateInterval']==600000
assert adapter.image(r[-1]['id']+'@coverage')==png and adapter.image('legend')==png
try:adapter.image('eccc-rain@2026-10-12T00:00:00Z@coverage');raise AssertionError('coverage of unlisted frame accepted')
except RadarError:pass
print(json.dumps(rain))
`;
  const rain = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
  assert.equal(C.radarProviderId('eccc-snow'), 'eccc-radar'); assert.ok(C.radarUsesWms('eccc-radar'));
  assert.equal(C.getSource('eccc-radar').licence.termsUrl, 'https://eccc-msc.github.io/open-data/licence/readme_en/');
  assert.doesNotThrow(() => globalThis.StormtraceRadar.validate({ ...rain, health: C.health() }));
  assert.throws(() => globalThis.StormtraceRadar.validate({ ...rain, health: C.health(), records: [{ ...rain.records[0], coverage: { url: 'https://evil/x.png', format: 'image/png' } }] }), /coverage/);
  for (const file of ['server.js', 'server.py']) for (const source of ['eccc-rain', 'eccc-snow', 'eccc-ptype']) assert.match(readFileSync(file, 'utf8'), new RegExp(`'${source}'`), `${file} routes ${source}`);
});

test('Node ECCC provider caches each frame with its coverage mask and rejects coverage for unlisted frames', async () => {
  const records = [{ id: 'eccc-rain@a', observedAt: at, coverage: { url: '/api/radar/frame?key=x', format: 'image/png' } }];
  const provider = new MetOfficeRadarProvider({ id: 'eccc-radar', source: 'eccc-rain', now: () => at, worker: async (op, key) => op === 'frames' ? Buffer.from(JSON.stringify({ records, sourceDataTimestamp: at, missingDependencies: [], legend: { unit: 'mm/h' } })) : Buffer.from('PNG' + key) });
  assert.equal(provider.cacheMs, 60000);
  assert.equal((await provider.image('eccc-rain@a@coverage')).toString(), 'PNGeccc-rain@a@coverage');
  assert.equal((await provider.image('legend')).toString(), 'PNGlegend');
  await assert.rejects(provider.image('eccc-rain@b@coverage'), { code: 'unavailable' });
});

test('radar panel draws a Canadian frame only after both its coverage mask and precipitation image load, beneath and above', async () => {
  const original = { document: globalThis.document, L: globalThis.L, fetch: globalThis.fetch };
  const ids = ['radarButton', 'radarPanel', 'radarStatus', 'radarTimeline', 'radarAttribution', 'radarFrameTime', 'radarLatest', 'radarSource', 'radarSourceLink', 'radarCoverage', 'radarUnit', 'radarViewRegion', 'radarLegend'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: id === 'radarSource' ? 'eccc-rain' : '', listeners: {}, children: [], classList: { add() {}, remove() {} }, addEventListener(n, f) { this.listeners[n] = f; }, setAttribute(n, v) { this[n] = v; }, replaceChildren(...c) { this.children = c; }, append(c) { this.children.push(c); } }]));
  const overlays = [], groups = [];
  globalThis.document = { hidden: false, getElementById: id => elements[id], addEventListener() {}, createElement: () => ({ classList: { added: [], add(c) { this.added.push(c); } }, addEventListener() {}, style: { setProperty() {} } }) };
  globalThis.L = { imageOverlay(url, bounds, options) { const layer = { url, options, listeners: {}, once(n, f) { this.listeners[n] = f; } }; overlays.push(layer); return layer; }, layerGroup(layers) { const group = { layers, addTo() { groups.push(this); } }; return group; } };
  const map = { createPane() {}, getPane: () => ({ style: {} }), removeLayer() {}, fitBounds() {} };
  const frame = { id: 'eccc-rain@t', observedAt: at, bounds: [-141, 41, -52, 67], resource: { url: '/api/radar/frame?source=eccc-rain&key=eccc-rain%40t', format: 'image/png' }, coverage: { url: '/api/radar/frame?source=eccc-rain&key=eccc-rain%40t%40coverage', format: 'image/png' } };
  globalThis.fetch = function () { return Promise.resolve({ ok: true, json: async () => ({ records: [frame], health: C.health(), missingDependencies: [], legend: { unit: 'mm/h', layout: 'vertical', image: '/api/radar/frame?source=eccc-rain&key=legend' } }) }); };
  const settle = async () => { for (let n = 0; n < 5; n++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    globalThis.StormtraceRadar.mountRadar({ map }); elements.radarButton.listeners.click(); await settle();
    assert.equal(groups.length, 1); const [coverage, image] = groups[0].layers;
    assert.match(coverage.url, /coverage/); assert.ok(coverage.options.opacity < image.options.opacity, 'coverage mask sits beneath the precipitation layer');
    image.listeners.load(); await settle(); assert.ok(!/^Observation/.test(elements.radarFrameTime.textContent || ''), 'waits for the coverage mask');
    coverage.listeners.load(); await settle(); assert.match(elements.radarFrameTime.textContent, /^Observation/);
    assert.match(elements.radarCoverage.textContent, /Hatched areas are outside radar coverage/);
    assert.match(elements.radarAttribution.textContent, /Environment and Climate Change Canada/);
    assert.equal(elements.radarUnit.textContent, 'Rainfall rate (mm/h)');
    assert.deepEqual(elements.radarLegend.children[0].classList.added, ['vertical']);
  } finally { if (elements.radarPanel.hidden === false) elements.radarButton.listeners.click(); Object.assign(globalThis, original); }
});
