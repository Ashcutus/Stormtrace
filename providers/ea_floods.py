"""Environment Agency fallback provider, matching the normalized Node endpoint."""
import json
import re
import threading
import time
from datetime import datetime
from urllib.request import Request, build_opener
from providers.metoffice_warnings import NoRedirect
from urllib.error import HTTPError, URLError
from providers.source_registry import SOURCES

ID = 'ea-floods'
URL = 'https://environment.data.gov.uk/flood-monitoring/id/floods'
SOURCE = SOURCES[ID]

class FloodError(Exception):
    def __init__(self, code='malformed', status=None):
        self.code, self.status = code, status
        super().__init__(code)
    def as_dict(self):
        return dict(code=self.code, provider=ID, operation='current', status=self.status, retryAfter=None)

def source_time(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)?', value):
        raise FloodError()
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return int(parsed.timestamp() * 1000) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        raise FloodError() from None

def normalize_floods(payload, fetched):
    if not isinstance(payload, dict) or not isinstance(payload.get('items'), list) or len(payload['items']) > 10000:
        raise FloodError()
    meta = payload.get('meta') if payload.get('meta') is not None else {}
    if not isinstance(meta, dict) or any(meta.get(k) is not None and (type(meta[k]) is not int or meta[k] < 0) for k in ('limit', 'offset')):
        raise FloodError()
    if (meta.get('offset') or 0) > 0 or (meta.get('limit') is not None and len(payload['items']) >= meta['limit']):
        raise FloodError()
    records = []
    for p in payload['items']:
        if not isinstance(p, dict) or not isinstance(p.get('floodAreaID'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', p['floodAreaID']) or p.get('@id') not in [s + '//environment.data.gov.uk/flood-monitoring/id/floods/' + p['floodAreaID'] for s in ('http:', 'https:')] or type(p.get('severityLevel')) is not int or p['severityLevel'] not in (1,2,3,4) or not isinstance(p.get('severity'), str) or not p['severity'].strip() or not isinstance(p.get('description'), str) or not p['description'].strip() or (p.get('message') is not None and not isinstance(p['message'], str)):
            raise FloodError()
        source_times = dict(reviewed=p.get('timeRaised'), messageChanged=p.get('timeMessageChanged'), severityChanged=p.get('timeSeverityChanged'))
        times = [source_time(v) for v in source_times.values()]
        updated = max(times) if all(v is not None for v in times) else None
        area = p.get('floodArea')
        if area is not None and not isinstance(area, (str, dict)):
            raise FloodError()
        area = area if isinstance(area, dict) else {}
        if any(area.get(k) is not None and not isinstance(area[k], str) for k in ('county', 'riverOrSea')):
            raise FloodError()
        records.append(dict(id=p['@id'], kind='warning', provider=ID, sourceAuthority=SOURCE['authority'], observedAt=None, updatedAt=updated, validFrom=None, validTo=None, geometry=None, sourceSeverity=dict(level=p['severityLevel'], classification=p['severity']), displayPriority=['urgent','high','normal','low'][p['severityLevel']-1], provenance=dict(provider=ID, sourceAuthority=SOURCE['authority'], sourceUrl=SOURCE['homepage'], upstreamId=p['@id'], fetchedAt=fetched, observedAt=None, updatedAt=updated, transformations=['ea-flood-monitoring-normalization-v1']), domainPayload=dict(status='NO_LONGER_IN_FORCE' if p['severityLevel']==4 else 'ACTIVE', level=p['severityLevel'], classification=p['severity'], headline=p['description'], description=p.get('message') or '', areaId=p['floodAreaID'], county=area.get('county') or '', riverOrSea=area.get('riverOrSea') or '', sourceTimes=source_times, sourceFields=p)))
    if len({r['id'] for r in records}) != len(records):
        raise FloodError()
    return records

class EnglandFloodProvider:
    def __init__(self, opener=None, clock=lambda: int(time.time()*1000)):
        self.opener, self.clock = opener or build_opener(NoRedirect()).open, clock
        self.lock, self.last_result = threading.Lock(), None
        self.health = dict(lastAttemptedFetch=None, lastSuccessfulFetch=None, sourceDataTimestamp=None, expectedUpdateInterval=900000, lastError=None, consecutiveFailures=0, available=False, freshnessBasis='fetch')
    def current(self):
        with self.lock:
            if self.last_result and self.clock()-self.health['lastSuccessfulFetch'] < 900000:
                return json.loads(json.dumps(self.last_result))
            self.health['lastAttemptedFetch'] = self.clock()
            try:
                with self.opener(Request(URL, headers={'Accept':'application/json'}), timeout=15) as response:
                    body = response.read(10000001)
                    if len(body)>10000000: raise FloodError()
                records = normalize_floods(json.loads(body), self.clock())
                self.health.update(lastSuccessfulFetch=self.clock(), lastError=None, consecutiveFailures=0, available=True)
                self.last_result = dict(records=records, observations=[], sourceDataTimestamp=None, health={**self.health, 'freshness':'fresh'})
                return json.loads(json.dumps(self.last_result))
            except (FloodError, HTTPError, URLError, OSError, ValueError) as error:
                if isinstance(error, FloodError): typed=error
                elif isinstance(error, HTTPError): typed=FloodError('authentication' if error.code in (401,403) else 'rate_limited' if error.code==429 else 'upstream', error.code)
                elif isinstance(error, ValueError): typed=FloodError('parse')
                else: typed=FloodError('timeout' if isinstance(error, TimeoutError) or isinstance(getattr(error,'reason',None), TimeoutError) else 'network')
                self.health['lastError']=typed.as_dict()
                self.health['consecutiveFailures']+=1
                raise typed from None
