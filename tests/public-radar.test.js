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
  assert.equal(provider.images.size,3);
  await provider.image('legend'); assert.equal(provider.images.size,3);
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
