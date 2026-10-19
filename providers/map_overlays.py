"""Bounded on-demand map resources; never written to event history."""
import json, math, re, time, threading
from urllib.request import Request, build_opener
from urllib.parse import urlparse
from providers.usgs import NoRedirect, EarthquakeError
from providers.source_registry import SOURCES

# Large enough for one map refresh of flood areas (client cap: 100) plus quakes.
CACHE_SIZE = 128

def normalize_overlay(payload, provider, source_url, fetched_at, updated_at=None, intensity=False):
    if not isinstance(payload,dict): raise EarthquakeError()
    features = payload.get('features') if payload.get('type') == 'FeatureCollection' else [payload] if payload.get('type') == 'Feature' else None
    if not isinstance(features,list) or len(features)>2000: raise EarthquakeError()
    crs=payload.get('crs')
    if crs is not None and (not isinstance(crs,dict) or not isinstance(crs.get('properties'),dict) or crs['properties'].get('name') not in ('urn:ogc:def:crs:OGC:1.3:CRS84','EPSG:4326')): raise EarthquakeError()
    result=[]
    for f in features:
        if not isinstance(f,dict): raise EarthquakeError()
        g=f.get('geometry'); props=f.get('properties') if f.get('properties') is not None else {}
        if not isinstance(g,dict) or not isinstance(props,dict): raise EarthquakeError()
        value=props.get('value') if intensity else None
        def position(p): return isinstance(p,list) and len(p)>=2 and all(type(n) in (int,float) and math.isfinite(n) for n in p) and abs(p[0])<=180 and abs(p[1])<=90
        def line(v): return isinstance(v,list) and len(v)>=2 and all(position(p) for p in v)
        def ring(v): return line(v) and len(v)>=4 and v[0]==v[-1]
        def polygon(v): return isinstance(v,list) and len(v)>0 and all(ring(r) for r in v)
        checks={'LineString':line,'MultiLineString':lambda v:isinstance(v,list) and len(v)>0 and all(line(x) for x in v),'Polygon':polygon,'MultiPolygon':lambda v:isinstance(v,list) and len(v)>0 and all(polygon(x) for x in v)}
        if g.get('type') not in (('LineString','MultiLineString') if intensity else ('Polygon','MultiPolygon')) or not checks[g['type']](g.get('coordinates')): raise EarthquakeError()
        if intensity and (type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=12 or props.get('units')!='mmi'): raise EarthquakeError()
        result.append(dict(geometry=dict(type=g['type'],coordinates=g['coordinates']),intensity=value,provenance=dict(provider=provider,sourceAuthority=SOURCES[provider]['authority'],sourceUrl=source_url,upstreamId=None,fetchedAt=fetched_at,observedAt=None,updatedAt=updated_at,transformations=['shakemap-mmi-contours' if intensity else 'ea-warning-area-geometry'])))
    return result

class MapOverlayProvider:
    def __init__(self, opener=None, clock=lambda:int(time.time()*1000)):
        self.opener=opener or build_opener(NoRedirect()).open; self.clock=clock; self.cache={}; self.lock=threading.Lock()
    def json(self,url):
        with self.opener(Request(url),timeout=15) as response:
            body=response.read(2000001)
            if len(body)>2000000: raise EarthquakeError()
            return json.loads(body)
    def resource(self,key,work):
        with self.lock:
            previous=self.cache.get(key)
            if previous and self.clock()-previous[0]<900000: return json.loads(json.dumps(previous[1]))
            value=work()
            if len(self.cache)>=CACHE_SIZE: del self.cache[next(iter(self.cache))]
            self.cache[key]=(self.clock(),value)
            return value
    def flood(self,id):
        if not isinstance(id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',id): raise EarthquakeError()
        url=f'https://environment.data.gov.uk/flood-monitoring/id/floodAreas/{id}/polygon'
        return self.resource('flood:'+id,lambda:dict(features=normalize_overlay(self.json(url),'ea-floods',url,self.clock())))
    def earthquake(self,id):
        if not isinstance(id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',id): raise EarthquakeError()
        def work():
            detail=self.json(f'https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/{id}.geojson')
            if detail.get('id')!=id: raise EarthquakeError()
            products=sorted(detail.get('properties',{}).get('products',{}).get('shakemap',[]),key=lambda p:(p.get('preferredWeight',0),p.get('updateTime',0)),reverse=True)
            product=products[0] if products else None
            if not product or product.get('status')=='DELETE': return dict(features=[],available=False)
            value=product.get('contents',{}).get('download/cont_mi.json',{}).get('url')
            if not value: return dict(features=[],available=False)
            url=urlparse(value)
            if url.scheme!='https' or url.netloc!='earthquake.usgs.gov' or url.query or url.fragment or not re.fullmatch(r'/pdl/products/[^/]+/contents/download/cont_mi.json',url.path) or type(product.get('updateTime')) is not int: raise EarthquakeError()
            return dict(available=True,features=normalize_overlay(self.json(value),'usgs',value,self.clock(),product['updateTime'],True))
        return self.resource('quake:'+id,work)
