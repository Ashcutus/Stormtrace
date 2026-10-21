"""Bounded anonymous hazard retrieval and shared Node/Python normalization.

Metadata is read from the JSON blocks in registry.js, its canonical source.
No third-party/scientific packages are required.
"""
import datetime as dt
import email.utils
import json
import math
import re
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener
import xml.etree.ElementTree as ET
from providers.metoffice_warnings import NoRedirect

from providers.source_registry import SOURCES
URLS = {
    'metoffice-warnings-esri': ['https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/Met_Office_National_Severe_Weather_Warning_Service_Live/FeatureServer/0/query?where=1%3D1&outFields=%2A&outSR=4326&f=geojson'],
    'metoffice-warnings-rss': ['https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK'],
    'nhc': ['https://www.nhc.noaa.gov/CurrentStorms.json'],
    # Elevated notices, then USGS's own volcano list for summit locations (joined by vnum).
    'usgs-volcano': ['https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes', 'https://volcanoes.usgs.gov/hans-public/api/volcano/getUSVolcanoes'],
    'gvp': ['https://volcano.si.edu/news/WeeklyVolcanoRSS.xml'],
    'noaa-tsunami': ['https://www.tsunami.gov/events/xml/PAAQCAP.xml', 'https://www.tsunami.gov/events/xml/PHEBCAP.xml'],
    'swpc': ['https://services.swpc.noaa.gov/products/noaa-scales.json', 'https://services.swpc.noaa.gov/products/alerts.json'],
}
MAX_BYTES = 2_000_000

class HazardError(Exception):
    def __init__(self, code='malformed', provider='', status=None, retry_after=None):
        self.code, self.provider, self.status, self.retry_after = code, provider, status, retry_after
        super().__init__(code)
    def as_dict(self):
        return dict(code=self.code, provider=self.provider, operation='current', status=self.status, retryAfter=self.retry_after)

def require(ok):
    if not ok: raise HazardError()

def string(v, required=False):
    require(isinstance(v, str) and len(v) <= 100000 and (not required or bool(v.strip())))
    return v.strip()

def instant(v, utc=False):
    if v in (None, ''): return None
    require(isinstance(v, str))
    if utc and not re.search(r'(Z|[+-]\d\d:\d\d)$', v): v = v.replace(' ', 'T') + 'Z'
    try:
        parsed = dt.datetime.fromisoformat(v.replace('Z', '+00:00'))
        require(parsed.tzinfo is not None)
        value = int(parsed.timestamp() * 1000)
        require(0 <= value <= 8640000000000000)
        return value
    except (ValueError, OverflowError): raise HazardError() from None

def rss_time(v):
    if not v: return None
    try:
        parsed = email.utils.parsedate_to_datetime(v)
        require(parsed.tzinfo is not None)
        return int(parsed.timestamp() * 1000)
    except (ValueError, TypeError): return instant(v)

def number(v):
    if v in (None, ''): return None
    require(not isinstance(v, bool) and isinstance(v, (int, float, str)))
    try: n = float(v)
    except ValueError: raise HazardError() from None
    require(math.isfinite(n))
    return n

def official_link(v, hosts, fallback):
    if not v: return fallback
    v = string(v)
    try: p = urlparse(v)
    except ValueError: raise HazardError() from None
    require(p.scheme in ('http', 'https') and p.netloc in hosts and not p.username and not p.password)
    # Explicit HTTPS transformation for official legacy HTTP links; no arbitrary retrieval.
    return p._replace(scheme='https').geturl()

def event(provider, id, payload, fetched, issued=None, updated=None, valid_from=None, valid_to=None, geometry=None, severity=None, authority=None):
    s = SOURCES[provider]
    authority = authority or s['authority']
    return dict(id=string(str(id), True), kind=s['categories'][0], provider=provider, sourceAuthority=authority,
                observedAt=issued, updatedAt=updated, validFrom=valid_from, validTo=valid_to, geometry=geometry,
                sourceSeverity=severity, displayPriority='normal',
                provenance=dict(provider=provider, sourceAuthority=authority, sourceUrl=s['homepage'], upstreamId=str(id), fetchedAt=fetched, observedAt=issued, updatedAt=updated, transformations=['public-hazards-v1-normalization']), domainPayload=payload)

def payload(title, badge, url, details=None, body='', instruction='', **extra):
    return dict(title=title, badge=badge, url=url, details=details or [], body=body, instruction=instruction, **extra)

def unique(records):
    require(len(records) <= 2000 and len({r['id'] for r in records}) == len(records))
    return records

def normalize_cyclones(raw, fetched):
    require(isinstance(raw, dict) and isinstance(raw.get('activeStorms'), list) and len(raw['activeStorms']) <= 100)
    records = []
    for r in raw['activeStorms']:
        require(isinstance(r, dict))
        id, name, classification = (string(r.get(k), True) for k in ('id', 'name', 'classification'))
        require(re.fullmatch(r'(al|ep|cp)\d{6}', id.lower()) is not None)
        issued = instant(r.get('lastUpdate')); require(issued is not None)
        lon, lat = number(r.get('longitudeNumeric')), number(r.get('latitudeNumeric'))
        require(lon is not None and lat is not None and abs(lon) <= 180 and abs(lat) <= 90)
        wind, pressure, direction, speed = (number(r.get(k)) for k in ('intensity', 'pressure', 'movementDir', 'movementSpeed'))
        require(wind is None or wind >= 0); require(speed is None or speed >= 0)
        require(direction is None or 0 <= direction <= 360)
        details = []
        for label, value, unit in [('Maximum sustained wind', wind, 'kt'), ('Central pressure', pressure, 'hPa'), ('Movement direction', direction, '°'), ('Movement speed', speed, 'kt')]:
            if value is not None: details.append(f'{label}: {value:g} {unit}')
        details.append(f'Centre: {lat:g}°, {lon:g}°')
        links=[]
        for key, label in [('publicAdvisory', 'Official public advisory'), ('forecastAdvisory', 'Official forecast advisory'), ('forecastGraphics', 'Official forecast graphics and cone')]:
            product=r.get(key)
            if product is None: continue
            require(isinstance(product,dict))
            if product.get('url'):
                links.append(dict(label=label,url=official_link(product['url'],['www.nhc.noaa.gov','www.hurricanes.gov','www.weather.gov'],SOURCES['nhc']['homepage']),issuedAt=instant(product.get('issuance')),advisoryNumber=product.get('advNum')))
        p=payload(name, classification, links[0]['url'] if links else SOURCES['nhc']['homepage'], details,
                  classification=classification, classificationLabel={'HU':'Hurricane','TS':'Tropical storm','TD':'Tropical depression','SS':'Subtropical storm','SD':'Subtropical depression','PTC':'Potential tropical cyclone','EX':'Extratropical cyclone','LO':'Low-pressure system'}.get(classification,classification), status='CURRENT_SUMMARY', links=links, sourceFields=r,
                  tracks=[], forecast=[], cones=[], mode='current')
        records.append(event('nhc', id, p, fetched, issued, issued, geometry=dict(type='Point',coordinates=[lon,lat]),severity=dict(classification=classification,windKnots=wind)))
    return unique(records)

def volcano_locations(raw):
    """Summit coordinates by USGS volcano number; entries without valid coordinates are skipped."""
    require(isinstance(raw,list) and len(raw)<=5000)
    locations={}
    for v in raw:
        if not isinstance(v,dict): continue
        vnum=v.get('vnum'); lat=number(v.get('latitude')); lon=number(v.get('longitude'))
        if isinstance(vnum,str) and re.fullmatch(r'\d+',vnum) and lat is not None and lon is not None and -90<=lat<=90 and -180<=lon<=180:
            locations[vnum]=[lon,lat]
    return locations

def normalize_volcanoes(raw, fetched):
    # Accept notices alone, or [notices, USGS volcano list] to add summit locations.
    locations={}
    if isinstance(raw,list) and len(raw)==2 and all(isinstance(part,list) for part in raw):
        raw,locations=raw[0],volcano_locations(raw[1])
    require(isinstance(raw,list) and len(raw)<=1000)
    records=[]
    for r in raw:
        require(isinstance(r,dict))
        vnum=string(r.get('vnum'),True); require(re.fullmatch(r'\d+',vnum) is not None)
        id=string(r.get('notice_identifier'),True)
        name=string(r.get('volcano_name'),True); colour=string(r.get('color_code'),True); level=string(r.get('alert_level'),True)
        require(colour in ('GREEN','YELLOW','ORANGE','RED','UNASSIGNED') and level in ('NORMAL','ADVISORY','WATCH','WARNING','UNASSIGNED'))
        sent=number(r.get('sent_unixtime')); require(sent is not None and 0<sent<=8640000000000)
        issued=int(sent*1000)
        p=payload(name,level,official_link(r.get('notice_url'),['volcanoes.usgs.gov'],SOURCES['usgs-volcano']['homepage']),
                  [f'Ground alert: {level}',f'Aviation colour: {colour}',f'Observatory: {string(r.get("obs_fullname"),True)}'],
                  volcanoId=vnum,activity=level,aviationColour=colour,bulletin='',status='ELEVATED',mode='notice',sourceFields=r)
        location=locations.get(vnum)
        record=event('usgs-volcano',vnum+':'+id,p,fetched,issued,issued,geometry=dict(type='Point',coordinates=location) if location else None,severity=dict(alertLevel=level,aviationColour=colour),authority=r['obs_fullname'])
        if location: record['provenance']['transformations'].append('usgs-volcano-location-join-by-vnum')
        records.append(record)
    return unique(records)

def xml(raw):
    require(isinstance(raw,str) and len(raw.encode())<=MAX_BYTES and not re.search(r'<!DOCTYPE|<!ENTITY',raw,re.I))
    try: root=ET.fromstring(raw)
    except ET.ParseError: raise HazardError('parse') from None
    require(sum(1 for _ in root.iter())<=20000)
    pending=[(root,1)]
    while pending:
        node,depth=pending.pop();require(depth<=64)
        pending.extend((child,depth+1) for child in node)
    return root

def text(node, tag, namespace=''):
    return ''.join(node.find(namespace+tag).itertext()).strip() if node.find(namespace+tag) is not None else ''

def normalize_gvp(raw, fetched):
    root=xml(raw); require(root.tag=='rss')
    channel=root.find('channel');require(channel is not None)
    records=[]
    for item in channel.findall('item'):
        title=string(text(item,'title'),True)
        link=official_link(text(item,'link'),['volcano.si.edu'],SOURCES['gvp']['homepage'])
        id=text(item,'guid') or text(item,'link');require(bool(id))
        issued=rss_time(text(item,'pubDate'))
        description=text(item,'description')
        # Provider HTML is converted to text before presentation, never injected.
        from html.parser import HTMLParser
        class Plain(HTMLParser):
            def __init__(self): super().__init__();self.parts=[]
            def handle_data(self,value): self.parts.append(value)
        parser=Plain();parser.feed(description)
        body=' '.join(parser.parts)
        p=payload(title,'Weekly report',link,body=body,volcanoId='',activity='Weekly report',bulletin=body,mode='report',status='REPORT',sourceFields=dict(guid=id,pubDate=text(item,'pubDate'),description=description))
        records.append(event('gvp',id,p,fetched,issued,issued))
    return unique(records)

def normalize_tsunamis(raws, fetched, centres=('NTWC','PTWC')):
    require(isinstance(raws,list) and len(raws)==len(centres))
    records=[]
    ns='{urn:oasis:names:tc:emergency:cap:1.2}'
    for centre,raw in zip(centres,raws):
        root=xml(raw);require(root.tag==ns+'alert')
        id=string(text(root,'identifier',ns),True);sender=string(text(root,'sender',ns),True)
        sent=instant(text(root,'sent',ns));require(sent is not None)
        status=string(text(root,'status',ns),True);msg_type=string(text(root,'msgType',ns),True)
        require(text(root,'scope',ns)=='Public')
        require(status in ('Actual','Exercise','System','Test','Draft') and msg_type in ('Alert','Update','Cancel','Ack','Error'))
        references=[]
        for ref in text(root,'references',ns).split():
            parts=ref.split(',');require(len(parts)==3 and bool(parts[0]) and bool(parts[1]))
            references.append(dict(sender=parts[0],identifier=parts[1],sent=instant(parts[2])))
        infos=root.findall(ns+'info')
        if not infos:
            require(msg_type in ('Cancel','Ack','Error'))
            p=payload(f'{centre} {msg_type} bulletin',msg_type,SOURCES['noaa-tsunami']['homepage'],[f'Centre: {centre}',f'Message: {msg_type} · {status}'],bulletin='',areas=[],status=status,msgType=msg_type,references=references,centre=centre,mode='bulletin',sourceFields=dict(sender=sender,source=text(root,'source',ns),incidents=text(root,'incidents',ns)))
            records.append(event('noaa-tsunami',centre+':'+id+':0',p,fetched,sent,sent,authority=SOURCES['noaa-tsunami']['authority']))
            continue
        for index,info in enumerate(infos):
            language=text(info,'language',ns)
            if language and not language.lower().startswith('en'): continue
            event_name=string(text(info,'event',ns),True)
            issued=sent;expires=instant(text(info,'expires',ns))
            effective=instant(text(info,'effective',ns));onset=instant(text(info,'onset',ns))
            require(expires is None or expires>=sent)
            severity={k:text(info,k,ns) for k in ('event','urgency','severity','certainty')}
            areas=[text(a,'areaDesc',ns) for a in info.findall(ns+'area')]
            parameters=[dict(valueName=text(p,'valueName',ns),value=text(p,'value',ns)) for p in info.findall(ns+'parameter')]
            title=text(info,'headline',ns) or event_name
            instruction=text(info,'instruction',ns)
            url=official_link(text(info,'web',ns),['www.tsunami.gov','tsunami.gov'],SOURCES['noaa-tsunami']['homepage'])
            p=payload(title,event_name,url,[f'Centre: {centre}',f'Message: {msg_type} · {status}']+[f'Area: {a}' for a in areas],body=text(info,'description',ns),instruction=instruction,
                      bulletin=text(info,'description',ns),areas=areas,status=status,msgType=msg_type,references=references,centre=centre,mode='bulletin',sourceFields=dict(sender=sender,source=text(root,'source',ns),incidents=text(root,'incidents',ns),language=language,parameters=parameters,capInfoXml=ET.tostring(info,encoding='unicode')))
            records.append(event('noaa-tsunami',centre+':'+id+':'+str(index),p,fetched,issued,sent,effective or onset,expires,severity=severity,authority=text(info,'senderName',ns) or SOURCES['noaa-tsunami']['authority']))
    return unique(records)

def normalize_space(raws, fetched, capability='all'):
    require(isinstance(raws,list) and len(raws)==2)
    scales,alerts=raws;require(isinstance(scales,dict) and (capability=='messages' or '0' in scales) and isinstance(alerts,list) and len(alerts)<=1000)
    records=[]
    for key,label in [('0','Current conditions'),('-1','Previous 24-hour maximum'),('1','Forecast day 1'),('2','Forecast day 2'),('3','Forecast day 3')]:
        if key not in scales: continue
        row=scales[key];require(isinstance(row,dict))
        issued=instant(string(row.get('DateStamp'),True)+'T'+string(row.get('TimeStamp'),True)+'Z')
        details=[];native=[]
        for scale,name in [('R','Radio blackouts'),('S','Solar radiation storms'),('G','Geomagnetic storms')]:
            value=row.get(scale);require(isinstance(value,dict))
            n=number(value.get('Scale'));require(n is None or n in range(6))
            native.append(dict(scale=scale,value=value.get('Scale')))
            details.append(f'{name}: {scale+str(int(n)) if n is not None else "scale not supplied"} · {value.get("Text") or "description not supplied"}')
            for field in ('MinorProb','MajorProb','Prob'):
                probability=number(value.get(field))
                if probability is not None:
                    require(0<=probability<=100)
                    meaning={'MinorProb':'R1–R2 radio blackouts','MajorProb':'R3–R5 radio blackouts','Prob':'S1 or greater solar radiation storm'}[field]
                    details.append(f'Probability of {meaning} for this forecast period: {probability:g}%')
        p=payload(label,'Forecast' if key in ('1','2','3') else 'Observed',SOURCES['swpc']['homepage'],details,mode='forecast' if key in ('1','2','3') else 'measurement',eventType='scale_snapshot',nativeScales=native,linkedEvents=[],status='SNAPSHOT',referenceTime=issued,sourceFields=row)
        records.append(event('swpc','scales:'+key,p,fetched,None if p['mode']=='forecast' else issued,None if p['mode']=='forecast' else issued,valid_from=issued if p['mode']=='forecast' else None,severity=native))
    for r in alerts:
        require(isinstance(r,dict))
        product=string(r.get('product_id'),True);raw_time=string(r.get('issue_datetime'),True);issued=instant(raw_time,utc=True)
        message=string(r.get('message'),True)
        code=re.search(r'Space Weather Message Code:\s*(\S+)',message)
        heading=next((line.strip() for line in message.splitlines() if re.match(r'^(?:CANCEL|WARNING:|WATCH:|ALERT:|SUMMARY:)',line.strip())),product)
        p=payload(heading,'Issued message',SOURCES['swpc']['homepage'],[f'Product: {product}'],body=message,mode='bulletin',eventType=code.group(1) if code else product,linkedEvents=[],nativeScales=[],status='ISSUED_MESSAGE',sourceFields=r)
        records.append(event('swpc',product+':'+raw_time,p,fetched,issued,issued))
    return unique(records)

def normalize_warning_summaries(raw, fetched):
    root=xml(raw)
    require(root.tag=='rss' and root.find('channel') is not None)
    channel=root.find('channel');require(channel.findtext('title')=='Met Office warnings for UK')
    records=[]
    for item in channel.findall('item'):
        title=string(item.findtext('title'),True);body=string(item.findtext('description'),True)
        match=re.fullmatch(r'(Yellow|Amber|Red) warning of (.+) affecting (.+)',title)
        require(match is not None)
        link=official_link(item.findtext('link'),['www.metoffice.gov.uk','weather.metoffice.gov.uk'],SOURCES['metoffice-warnings-rss']['homepage'])
        # Each official host publishes the warnings page under its own path.
        parsed=urlparse(link)
        require(parsed.path=={'www.metoffice.gov.uk':'/weather/warnings-and-advice/uk-warnings','weather.metoffice.gov.uk':'/warnings-and-advice/uk-warnings'}.get(parsed.netloc))
        identity=string(item.findtext('guid'),True)
        native=match[1].upper()
        p=payload(title,native,link,body=body,mode='summary',status='LISTED',weatherTypes=[match[2]],region=match[3],sourceFields=dict(title=title,description=body,link=link,guid=identity,feedPubDate=channel.findtext('pubDate')))
        record=event('metoffice-warnings-rss',identity,p,fetched,severity=dict(classification=native))
        record['displayPriority']={'RED':'urgent','AMBER':'high','YELLOW':'normal'}[native]
        records.append(record)
    return unique(records)

def normalize_warning_areas(raw, fetched):
    from providers.map_overlays import normalize_overlay
    require(isinstance(raw,dict) and raw.get('type')=='FeatureCollection' and isinstance(raw.get('features'),list) and len(raw['features'])<=500)
    require(not raw.get('exceededTransferLimit') and not raw.get('properties',{}).get('exceededTransferLimit'))
    records=[]
    for feature in raw['features']:
        p=feature.get('properties',{});require(isinstance(p,dict))
        native=string(p.get('warninglevel'),True);require(native in ('RED','AMBER','YELLOW'))
        identity=string(p.get('GlobalID'),True)
        issued=number(p.get('issuedDate'));start=number(p.get('validfromdate'));end=number(p.get('validtodate'))
        require(all(t is not None and 0<t<8640000000000 for t in (issued,start,end)) and start<=end)
        try:geometry=normalize_overlay(feature,'metoffice-warnings-esri',URLS['metoffice-warnings-esri'][0],fetched)[0]['geometry']
        except Exception:raise HazardError('malformed','metoffice-warnings-esri') from None
        headline=string(p.get('warningheadline'),True);weather=string(p.get('weathertype'),True)
        value=payload(weather,native,SOURCES['metoffice-warnings-esri']['homepage'],[string(p.get('affectedAreas'),True)],body=string(p.get('warningFurtherDetails') or ''),mode='bulletin',status='LISTED',headline=headline,whatToExpect=string(p.get('whatToExpect'),True),version=string(p.get('warningVersion'),True),sourceFields=p)
        record=event('metoffice-warnings-esri',identity,value,fetched,issued,None,start,end,geometry,severity=dict(classification=native,impact=p.get('warningImpact'),likelihood=p.get('warningLikelihood')))
        record['displayPriority']={'RED':'urgent','AMBER':'high','YELLOW':'normal'}[native]
        record['provenance']['sourceUrl']=URLS['metoffice-warnings-esri'][0]
        record['provenance']['transformations']=['metoffice-esri-geojson-normalization-v1','epsg4326-requested']
        records.append(record)
    return unique(records)

NORMALIZERS={'nhc':normalize_cyclones,'usgs-volcano':normalize_volcanoes,'gvp':normalize_gvp,'noaa-tsunami':normalize_tsunamis,'swpc':normalize_space,'metoffice-warnings-rss':normalize_warning_summaries,'metoffice-warnings-esri':normalize_warning_areas}

def normalize(provider, raw, fetched):
    try:
        records=NORMALIZERS[provider](raw,fetched)
        timestamps=[r['updatedAt'] for r in records if r['updatedAt'] is not None]
        return dict(records=records,observations=[r for r in records if r['domainPayload']['mode'] not in ('measurement','forecast')],sourceDataTimestamp=next((r['updatedAt'] for r in records if r['id']=='scales:0'),None) if provider=='swpc' else max(timestamps) if timestamps else None)
    except HazardError as error:
        error.provider=provider;raise
    except (KeyError,TypeError,ValueError,AttributeError,OverflowError): raise HazardError('malformed',provider) from None

class PublicHazardProvider:
    def __init__(self, provider, opener=None, clock=lambda:int(time.time()*1000)):
        require(provider in SOURCES)
        self.id,self.source,self.clock=provider,SOURCES[provider],clock
        self.opener=opener or build_opener(NoRedirect()).open
        self.components={};self.lock=threading.Lock();self.last_result=None;self.retry_at=0;self.last_error=None
        self.health=dict(lastAttemptedFetch=None,lastSuccessfulFetch=None,sourceDataTimestamp=None,expectedUpdateInterval=self.source['expectedUpdateInterval'],lastError=None,consecutiveFailures=0,available=False,freshnessBasis='source' if provider=='swpc' else 'fetch')
    def freshness(self):
        h=self.health
        if h['lastError']: return 'malformed' if h['lastError']['code'] in ('parse','malformed') else 'provider_error'
        if h['lastSuccessfulFetch'] is None:return 'never_loaded'
        basis=h['lastSuccessfulFetch'] if h['freshnessBasis']=='fetch' else min(h['lastSuccessfulFetch'],h['sourceDataTimestamp'] or h['lastSuccessfulFetch'])
        age=self.clock()-basis;interval=h['expectedUpdateInterval']
        return 'stale' if age>interval*3 else 'delayed' if age>interval*1.5 else 'fresh'
    def restore_components(self, previous):
        for c in previous.get('components',[]):
            self.components[c['id']]={**c,'records':[r for r in previous.get('records',[]) if r['domainPayload'].get('capability')==c['id']]}
    def parts(self):
        definitions=[('NTWC',URLS[self.id][0]),('PTWC',URLS[self.id][1])] if self.id=='noaa-tsunami' else [('conditions',URLS[self.id][0]),('messages',URLS[self.id][1])]
        result=[];components=[]
        for key,url in definitions:
            prior=self.components.get(key,{})
            checked=prior.get('lastSuccessfulFetch')
            retry=prior.get('retryAt',0)
            if (not prior.get('error') and checked is not None and self.clock()-checked<self.source['expectedUpdateInterval']) or self.clock()<retry:
                component=prior
            else:
                try:
                    with self.opener(Request(url,headers={'Accept':'application/json, application/xml, text/xml','User-Agent':'Stormtrace private non-commercial hazard viewer'}),timeout=15) as response:
                        body=response.read(MAX_BYTES+1);require(len(body)<=MAX_BYTES)
                    raw=body.decode('utf-8-sig')
                    records=normalize_tsunamis([raw],self.clock(),(key,)) if self.id=='noaa-tsunami' else normalize_space([json.loads(raw),[]] if key=='conditions' else [{},json.loads(raw)],self.clock(),key)
                    for r in records:r['domainPayload']['capability']=key
                    component=dict(id=key,records=records,lastSuccessfulFetch=self.clock(),error=None,retryAt=0,cached=False)
                except (HazardError,HTTPError,URLError,OSError,ValueError) as error:
                    code=error.code if isinstance(error,HazardError) else 'rate_limited' if isinstance(error,HTTPError) and error.code==429 else 'upstream' if isinstance(error,HTTPError) else 'parse' if isinstance(error,ValueError) else 'network'
                    retry_after=error.headers.get('Retry-After','0') if isinstance(error,HTTPError) and error.headers else '0'
                    try:delay=max(60000,min(86400000,int(retry_after)*1000))
                    except ValueError:delay=60000
                    component={**prior,'id':key,'records':prior.get('records',[]),'error':dict(code=code,status=error.code if isinstance(error,HTTPError) else None),'retryAt':self.clock()+delay,'cached':bool(prior.get('records'))}
                self.components[key]=component
            result.extend(component.get('records',[]));components.append({k:v for k,v in component.items() if k!='records'})
        partial=any(c.get('error') for c in components)
        timestamp=next((r['updatedAt'] for r in result if r['id']=='scales:0'),None) if self.id=='swpc' else max((r['updatedAt'] for r in result if r['updatedAt'] is not None),default=None)
        self.health.update(lastAttemptedFetch=self.clock(),lastSuccessfulFetch=max((c.get('lastSuccessfulFetch',0) for c in components),default=0) or None,sourceDataTimestamp=timestamp,available=any(c.get('lastSuccessfulFetch') for c in components),lastError=None)
        return dict(records=unique(result),observations=[r for r in result if not r['domainPayload']['mode'] in ('measurement','forecast') and not next(c for c in components if c['id']==r['domainPayload']['capability']).get('error')],components=components,partial=partial,sourceDataTimestamp=timestamp,health={**self.health,'freshness':self.freshness()})
    def current(self):
        with self.lock:
            if self.id in ('swpc','noaa-tsunami'):return self.parts()

            if self.clock()<self.retry_at:raise self.last_error
            if self.last_result and self.clock()-self.health['lastSuccessfulFetch']<self.source['expectedUpdateInterval']:
                return json.loads(json.dumps({**self.last_result,'health':{**self.health,'freshness':self.freshness()}}))
            self.health['lastAttemptedFetch']=self.clock()
            try:
                values=[]
                for url in URLS[self.id]:
                    with self.opener(Request(url,headers={'Accept':'application/json, application/xml, text/xml, application/rss+xml','User-Agent':'Stormtrace private non-commercial hazard viewer'}),timeout=15) as response:
                        body=response.read(MAX_BYTES+1);require(len(body)<=MAX_BYTES)
                    decoded=body.decode('utf-8-sig')
                    values.append(decoded if self.id in ('gvp','noaa-tsunami','metoffice-warnings-rss') else json.loads(decoded))
                result=normalize(self.id,values if self.id in ('swpc','noaa-tsunami','usgs-volcano') else values[0],self.clock())
                self.health.update(lastSuccessfulFetch=self.clock(),sourceDataTimestamp=result['sourceDataTimestamp'],lastError=None,consecutiveFailures=0,available=True)
                self.last_result=result;self.last_error=None
                return json.loads(json.dumps({**result,'health':{**self.health,'freshness':self.freshness()}}))
            except (HazardError,HTTPError,URLError,OSError,ValueError) as error:
                if isinstance(error,HazardError): typed=error;typed.provider=self.id
                elif isinstance(error,HTTPError):
                    retry=error.headers.get('Retry-After') if error.headers else None
                    try:retry=int(retry)
                    except (ValueError,TypeError):retry=None
                    typed=HazardError('authentication' if error.code in (401,403) else 'rate_limited' if error.code==429 else 'upstream',self.id,error.code,retry)
                elif isinstance(error,ValueError):typed=HazardError('parse',self.id)
                else:typed=HazardError('timeout' if isinstance(error,TimeoutError) or isinstance(getattr(error,'reason',None),TimeoutError) else 'network',self.id)
                self.health['lastError']=typed.as_dict();self.health['consecutiveFailures']+=1
                self.retry_at=self.clock()+max(60000,min(86400000,(typed.retry_after or 0)*1000),min(3600000,60000*2**min(self.health['consecutiveFailures']-1,6)))
                self.last_error=typed;raise typed from None

if __name__=='__main__':
    try:
        provider=sys.argv[1]
        # Deterministic normalization mode is also used by parity/fixture tests.
        if len(sys.argv)>2 and sys.argv[2]=='normalize':
            value=json.load(sys.stdin);result=normalize(provider,value['raw'],value['fetchedAt'])
        else:
            instance=PublicHazardProvider(provider)
            if len(sys.argv)>2 and sys.argv[2]=='current':instance.restore_components(json.load(sys.stdin))
            result=instance.current()
        print(json.dumps(result,allow_nan=False))
    except HazardError as error:
        print(json.dumps(error.as_dict()),file=sys.stderr);sys.exit(1)
