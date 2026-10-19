"""Public USGS daily feed; normalization matches providers/usgs.js."""
import json
import math
import re
import threading
import time
from urllib.parse import urlparse
from urllib.request import Request, build_opener
from urllib.error import HTTPError, URLError
from providers.metoffice_warnings import NoRedirect
from providers.source_registry import SOURCES

URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
SOURCE = SOURCES['usgs']

class EarthquakeError(Exception):
    def __init__(self, code='malformed', status=None):
        self.code, self.status = code, status
        super().__init__(code)
    def as_dict(self):
        return dict(code=self.code, provider='usgs', operation='current', status=self.status, retryAfter=None)

def timestamp(v):
    return type(v) is int and 0 <= v <= 8640000000000000

def number(v):
    return type(v) in (int, float) and math.isfinite(v)

def earthquake_link(value):
    if not isinstance(value, str): raise EarthquakeError()
    try:
        url = urlparse(value)
        if url.scheme != 'https' or url.netloc != 'earthquake.usgs.gov' or url.query or url.fragment or not re.fullmatch(r'/earthquakes/eventpage/[A-Za-z0-9_-]+/?', url.path): raise EarthquakeError()
        return value
    except ValueError:
        raise EarthquakeError() from None

def normalize_earthquakes(payload, fetched):
    if not isinstance(payload, dict) or payload.get('type') != 'FeatureCollection' or not isinstance(payload.get('features'), list) or len(payload['features']) > 10000 or not isinstance(payload.get('metadata'), dict): raise EarthquakeError()
    meta = payload['metadata']
    if not timestamp(meta.get('generated')) or type(meta.get('status')) is not int or meta['status'] != 200 or type(meta.get('count')) is not int or meta['count'] != len(payload['features']): raise EarthquakeError()
    seen, records = set(), []
    for feature in payload['features']:
        if not isinstance(feature, dict) or feature.get('type') != 'Feature' or not isinstance(feature.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', feature['id']) or feature['id'] in seen or not isinstance(feature.get('properties'), dict) or not isinstance(feature['properties'].get('type'), str): raise EarthquakeError()
        seen.add(feature['id'])
        p = feature['properties']
        if p['type'] != 'earthquake': continue
        if not timestamp(p.get('time')) or not timestamp(p.get('updated')) or p['updated'] < p['time'] or (p.get('mag') is not None and not number(p['mag'])) or not all(isinstance(p.get(k), str) for k in ('status','net','code')) or (p.get('place') is not None and not isinstance(p['place'], str)) or (p.get('magType') is not None and not isinstance(p['magType'], str)) or (p.get('alert') is not None and p['alert'] not in ('green','yellow','orange','red')): raise EarthquakeError()
        g = feature.get('geometry')
        if not isinstance(g, dict) or g.get('type') != 'Point' or not isinstance(g.get('coordinates'), list) or len(g['coordinates']) != 3 or not all(number(n) for n in g['coordinates']) or abs(g['coordinates'][0]) > 180 or abs(g['coordinates'][1]) > 90: raise EarthquakeError()
        url = earthquake_link(p.get('url'))
        records.append(dict(id=feature['id'], kind='earthquake', provider='usgs', sourceAuthority=SOURCE['authority'], observedAt=p['time'], updatedAt=p['updated'], validFrom=None, validTo=None, geometry=dict(type='Point',coordinates=g['coordinates']), sourceSeverity=dict(magnitude=p.get('mag'),magnitudeType=p.get('magType'),alert=p.get('alert'),status=p['status']), displayPriority='normal', provenance=dict(provider='usgs',sourceAuthority=SOURCE['authority'],sourceUrl=SOURCE['homepage'],upstreamId=feature['id'],fetchedAt=fetched,observedAt=p['time'],updatedAt=p['updated'],transformations=['usgs-summary-v1-normalization']),domainPayload=dict(magnitude=p.get('mag'),magnitudeType=p.get('magType'),depthKm=g['coordinates'][2],status=p['status'],place=p.get('place'),url=url,network=p['net'],sourceCode=p['code'],sourceFields=p)))
    # Current records are archived by the client; there are no separate revisions.
    return dict(records=records, observations=[], sourceDataTimestamp=meta['generated'])

class USGSEarthquakeProvider:
    def __init__(self, opener=None, clock=lambda: int(time.time()*1000)):
        self.opener, self.clock = opener or build_opener(NoRedirect()).open, clock
        self.lock, self.last_result = threading.Lock(), None
        self.health = dict(lastAttemptedFetch=None,lastSuccessfulFetch=None,sourceDataTimestamp=None,expectedUpdateInterval=60000,lastError=None,consecutiveFailures=0,available=False,freshnessBasis='source')
    def current(self):
        with self.lock:
            if self.last_result and self.clock()-self.health['lastSuccessfulFetch'] < 60000: return json.loads(json.dumps(self.last_result))
            self.health['lastAttemptedFetch'] = self.clock()
            try:
                with self.opener(Request(URL,headers={'Accept':'application/geo+json'}),timeout=15) as response:
                    body = response.read(10000001)
                    if len(body) > 10000000: raise EarthquakeError()
                result = normalize_earthquakes(json.loads(body),self.clock())
                self.health.update(lastSuccessfulFetch=self.clock(),sourceDataTimestamp=result['sourceDataTimestamp'],lastError=None,consecutiveFailures=0,available=True)
                age = self.clock()-min(self.health['lastSuccessfulFetch'],result['sourceDataTimestamp'])
                freshness = 'stale' if age > 180000 else 'delayed' if age > 90000 else 'fresh'
                self.last_result = {**result,'health':{**self.health,'freshness':freshness}}
                return json.loads(json.dumps(self.last_result))
            except (EarthquakeError,HTTPError,URLError,OSError,ValueError) as error:
                if isinstance(error,EarthquakeError): typed=error
                elif isinstance(error,HTTPError): typed=EarthquakeError('authentication' if error.code in (401,403) else 'rate_limited' if error.code==429 else 'upstream',error.code)
                elif isinstance(error,ValueError): typed=EarthquakeError('parse')
                else: typed=EarthquakeError('timeout' if isinstance(error,TimeoutError) or isinstance(getattr(error,'reason',None),TimeoutError) else 'network')
                self.health['lastError']=typed.as_dict();self.health['consecutiveFailures']+=1
                raise typed from None
