"""Free official radar observations. Shared worker for both local servers.

Only fixed upstream hosts/products are queried. No forecasts or event archives.
"""
from datetime import datetime, timezone, timedelta
import importlib.util
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from providers.metoffice_radar import RadarError, render, LEVELS, COLOURS

OPERA_BASE = 'https://s3.waw3-1.cloudferro.com/openradar-24h/'
OPERA_KEY = re.compile(r'(\d{4})/(\d{2})/(\d{2})/OPERA/COMP/OPERA@(\d{8}T\d{4})@0@RATE\.h5')
REGIONS = {
    'conus': [-126, 24, -66, 50], 'alaska': [-180, 48, -129, 72],
    'hawaii': [-161, 18, -154, 23], 'carib': [-69, 16, -63, 21],
    'guam': [143, 12, 147, 16],
}
EUROPE_BOUNDS = [-40, 30, 60, 72]
# NOAA products per region. Precipitation type is the MRMS PrecipFlag display:
# a radar classification assisted by model surface analyses, with no sleet or
# freezing-rain category. Colours match NOAA's published legend.
NOAA_LAYERS = {'reflectivity': '_bref_qcd', 'ptype': '_pcpn_typ'}
PTYPE_CATEGORIES = [
    {'code': 'WS', 'label': 'Rain (warm stratiform)', 'colour': '#0450a4'},
    {'code': 'CS', 'label': 'Rain (cool stratiform)', 'colour': '#6effff'},
    {'code': 'C', 'label': 'Rain (convective)', 'colour': '#ff3232'},
    {'code': 'ST', 'label': 'Rain (tropical stratiform)', 'colour': '#00f900'},
    {'code': 'CT', 'label': 'Rain (tropical convective)', 'colour': '#009700'},
    {'code': 'S', 'label': 'Snow', 'colour': '#c8c8c8'},
    {'code': 'H', 'label': 'Hail', 'colour': '#960096'},
]
WMS_NS = '{http://www.opengis.net/wms}'
S3_NS = '{http://s3.amazonaws.com/doc/2006-03-01/}'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get(url, limit, opener=None):
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    try:
        with opener(url, timeout=15) as response:
            data = response.read(limit + 1)
        if len(data) > limit: raise RadarError('malformed')
        return data
    except RadarError: raise
    except urllib.error.HTTPError as error:
        raise RadarError('rate_limited' if error.code == 429 else 'upstream') from None
    except TimeoutError: raise RadarError('timeout') from None
    except Exception: raise RadarError('network') from None


def xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise RadarError('parse')
    try: return ET.fromstring(data)
    except ET.ParseError: raise RadarError('parse') from None


def noaa_parts(source):
    """Split a fixed NOAA source id into (region, product); reject anything else."""
    if not isinstance(source, str) or not source.startswith('noaa-'): raise RadarError('configuration')
    rest = source[5:]
    product = 'reflectivity'
    if rest.startswith('ptype-'): product, rest = 'ptype', rest[6:]
    if rest not in REGIONS: raise RadarError('configuration')
    return rest, product


def noaa_layer(source):
    region, product = noaa_parts(source)
    return region + NOAA_LAYERS[product]


def source_info(source):
    if source == 'opera-radar': return 'opera-radar', EUROPE_BOUNDS
    region, _ = noaa_parts(source)
    return 'noaa-radar', REGIONS[region]


def opera_time(key):
    match = OPERA_KEY.fullmatch(key) if isinstance(key, str) else None
    if not match: raise RadarError('malformed')
    try: at = datetime.strptime(match[4], '%Y%m%dT%H%M').replace(tzinfo=timezone.utc)
    except ValueError: raise RadarError('malformed') from None
    if at.strftime('%Y/%m/%d') != '/'.join(match.group(1, 2, 3)) or at.minute % 15: raise RadarError('malformed')
    return int(at.timestamp() * 1000)


def opera_listing(data):
    root = xml(data)
    if root.tag != S3_NS + 'ListBucketResult' or root.findtext(S3_NS + 'IsTruncated') != 'false': raise RadarError('unsupported_schema')
    result = []
    for item in root.findall(S3_NS + 'Contents'):
        key = item.findtext(S3_NS + 'Key', '')
        if key.endswith('@RATE.h5'):
            at = opera_time(key)
            try: size = int(item.findtext(S3_NS + 'Size', '0'))
            except ValueError: raise RadarError('malformed') from None
            if not 0 < size <= 20000000: raise RadarError('malformed')
            result.append((key, at))
    return result


def wms_base(source):
    region, _ = noaa_parts(source)
    return f'https://opengeo.ncep.noaa.gov/geoserver/{region}/{noaa_layer(source)}/ows'


def noaa_times(data, source):
    root = xml(data)
    if root.tag != WMS_NS + 'WMS_Capabilities': raise RadarError('unsupported_schema')
    layers = [layer for layer in root.iter(WMS_NS + 'Layer') if layer.findtext(WMS_NS + 'Name') == noaa_layer(source)]
    if len(layers) != 1: raise RadarError('unsupported_schema')
    dims = [d for d in layers[0].findall(WMS_NS + 'Dimension') if d.get('name') == 'time']
    if len(dims) != 1: raise RadarError('unsupported_schema')
    result = []
    for stamp in (dims[0].text or '').split(','):
        stamp = stamp.strip()
        if not stamp: continue
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z', stamp): raise RadarError('unsupported_schema')
        try: at = int(datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)
        except ValueError: raise RadarError('malformed') from None
        result.append((stamp, at))
    return result


def frames(source, now=None, opener=None):
    provider, bounds = source_info(source)
    now = int(time.time() * 1000) if now is None else now
    items = []
    if source == 'opera-radar':
        # A full day includes several products/versions and can exceed S3's
        # 1,000-object page. Query only the four hours intersecting our window;
        # never mistake an incomplete listing for missing observations.
        end = datetime.fromtimestamp(now / 1000, timezone.utc).replace(minute=0, second=0, microsecond=0)
        for hour in range(3, -1, -1):
            date = end - timedelta(hours=hour)
            prefix = date.strftime('%Y/%m/%d/OPERA/COMP/OPERA@%Y%m%dT%H')
            query = urllib.parse.urlencode({'list-type': 2, 'prefix': prefix, 'max-keys': 1000})
            items.extend(opera_listing(get(OPERA_BASE + '?' + query, 1000000, opener)))
        missing = [name for name in ['h5py', 'numpy', 'pyproj'] if importlib.util.find_spec(name) is None]
        legend = {'unit': 'mm/h', 'levels': LEVELS, 'colours': COLOURS}
        transformations = ['odim-rate-to-mercator-png-v1', 'europe-display-crop']
    else:
        items = noaa_times(get(wms_base(source) + '?service=WMS&request=GetCapabilities&version=1.3.0', 2000000, opener), source)
        missing = []
        if noaa_parts(source)[1] == 'ptype':
            legend = {'unit': 'category', 'categories': PTYPE_CATEGORIES}
            transformations = ['noaa-wms-mercator-display-crop', 'mrms-precipflag-display']
        else:
            legend = {'unit': 'dBZ', 'image': '/api/radar/frame?' + urllib.parse.urlencode({'source': source, 'key': 'legend'})}
            transformations = ['noaa-wms-mercator-display-crop']
    items = sorted(set(items), key=lambda x: x[1])
    items = [item for item in items if now - 3 * 3600000 <= item[1] <= now]
    # Sample US observations across the window rather than showing only 24 minutes.
    # Use the first observation in each wall-clock 15-minute slot (plus the
    # latest) so frame identities stay stable between refreshes while scrubbing.
    if len(items) > 12:
        slots = {}
        for item in items: slots.setdefault(item[1] // 900000, item)
        sampled = list(slots.values())[-12:]
        if sampled[-1] != items[-1]: sampled = sampled[-11:] + [items[-1]]
        items = sampled
    if source.startswith('noaa-'): items = [(source + '@' + stamp, at) for stamp, at in items]
    records = [{'id': key, 'observedAt': at, 'bounds': bounds,
                'resource': {'url': '/api/radar/frame?' + urllib.parse.urlencode({'source': source, 'key': key}), 'format': 'image/png'},
                'provenance': {'provider': provider, 'sourceAuthority': 'EUMETNET' if provider == 'opera-radar' else 'NOAA / National Weather Service',
                               'sourceUrl': OPERA_BASE + key if provider == 'opera-radar' else wms_base(source),
                               'upstreamId': key, 'fetchedAt': now, 'observedAt': at, 'updatedAt': None, 'transformations': transformations}}
               for key, at in items]
    return {'records': records, 'sourceDataTimestamp': items[-1][1] if items else None, 'missingDependencies': missing, 'legend': legend}


def image(source, key, opener=None):
    _, bounds = source_info(source)
    if source == 'opera-radar':
        at = opera_time(key)
        return render(get(OPERA_BASE + key, 20000000, opener), at, width=1000, height=700, bounds=bounds, product='opera')
    base = wms_base(source)
    layer = noaa_layer(source)
    if key == 'legend':
        query = {'service': 'WMS', 'request': 'GetLegendGraphic', 'version': '1.3.0', 'format': 'image/png', 'layer': layer}
    else:
        # A region-qualified identity prevents coincident observation times colliding.
        if not isinstance(key, str) or not key.startswith(source + '@'): raise RadarError('malformed')
        key = key[len(source) + 1:]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z', key): raise RadarError('malformed')
        noaa_times(('<WMS_Capabilities xmlns="http://www.opengis.net/wms"><Layer><Name>' + layer + '</Name><Dimension name="time">' + str(key) + '</Dimension></Layer></WMS_Capabilities>').encode(), source)
        from math import log, tan, pi
        def merc(lon, lat): return lon * 20037508.342789244 / 180, 6378137 * log(tan(pi/4 + lat*pi/360))
        west, south = merc(bounds[0], bounds[1]); east, north = merc(bounds[2], bounds[3])
        query = {'service': 'WMS', 'request': 'GetMap', 'version': '1.3.0', 'layers': layer, 'styles': '', 'crs': 'EPSG:3857',
                 'bbox': f'{west},{south},{east},{north}', 'width': 960, 'height': 600, 'format': 'image/png', 'transparent': 'true', 'time': key}
    data = get(base + '?' + urllib.parse.urlencode(query), 6000000, opener)
    if not data.startswith(b'\x89PNG\r\n\x1a\n'): raise RadarError('parse')
    return data


if __name__ == '__main__':
    try:
        source, operation = sys.argv[1:3]
        if operation == 'frames': print(json.dumps(frames(source)))
        elif operation == 'render': sys.stdout.buffer.write(image(source, sys.argv[3]))
        else: raise RadarError('configuration')
    except RadarError as error:
        print(json.dumps({'code': error.code}), file=sys.stderr); sys.exit(1)
