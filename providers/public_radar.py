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
# Environment and Climate Change Canada MSC GeoMet: North American 1 km radar
# composite (Canadian and US radars) in 6-minute frames. GeoMet serves one layer
# per request, so each frame's coverage mask is a separate image that the client
# draws beneath the precipitation layer to distinguish no coverage from no rain.
ECCC_BASE = 'https://geo.weather.gc.ca/geomet'
ECCC_BOUNDS = [-141, 41, -52, 67]
ECCC_PRODUCTS = {
    'eccc-rain': {'layer': 'RADAR_1KM_RRAI', 'style': 'Radar-Rain_14colors', 'coverage': 'RADAR_COVERAGE_RRAI.INV', 'unit': 'mm/h'},
    'eccc-snow': {'layer': 'RADAR_1KM_RSNO', 'style': 'Radar-Snow_14colors', 'coverage': 'RADAR_COVERAGE_RSNO.INV', 'unit': 'cm/h'},
    'eccc-ptype': {'layer': 'Radar_1km_SfcPrecipType', 'style': 'SfcPrecipType_Dis', 'coverage': 'Radar-Coverage_SfcPrecipType-Inverted', 'unit': 'category'},
}
ECCC_COVERAGE_STYLE = 'Radar-Coverage_Inv-CrosshatchFill'
# ECCC radar surface precipitation type: dual-polarisation particle classification
# with HRDPS model surface temperature. Colours match ECCC's published legend.
ECCC_PTYPE_CATEGORIES = [
    {'code': 'LS', 'label': 'Light snow', 'colour': '#7fdfeb'},
    {'code': 'MS', 'label': 'Moderate snow', 'colour': '#47a4f0'},
    {'code': 'HS', 'label': 'Heavy snow', 'colour': '#0000e0'},
    {'code': 'LM', 'label': 'Light mixed rain/snow', 'colour': '#e0bde6'},
    {'code': 'MM', 'label': 'Moderate mixed rain/snow', 'colour': '#c36dd2'},
    {'code': 'HM', 'label': 'Heavy mixed rain/snow', 'colour': '#9b27af'},
    {'code': 'LR', 'label': 'Light rain', 'colour': '#9afd9a'},
    {'code': 'MR', 'label': 'Moderate rain', 'colour': '#00cb00'},
    {'code': 'HR', 'label': 'Heavy rain', 'colour': '#008000'},
    {'code': 'HA', 'label': 'Hail/rain', 'colour': '#fec007'},
    {'code': 'LF', 'label': 'Light freezing rain', 'colour': '#fecbc8'},
    {'code': 'HF', 'label': 'Moderate/heavy freezing rain', 'colour': '#fe1e0d'},
]
WMS_STAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z')
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


def eccc_product(source):
    if source not in ECCC_PRODUCTS: raise RadarError('configuration')
    return ECCC_PRODUCTS[source]


def source_info(source):
    if source == 'opera-radar': return 'opera-radar', EUROPE_BOUNDS
    if isinstance(source, str) and source.startswith('eccc-'):
        eccc_product(source)
        return 'eccc-radar', ECCC_BOUNDS
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


def stamp_time(stamp):
    if not WMS_STAMP.fullmatch(stamp): raise RadarError('unsupported_schema')
    try: return int(datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError: raise RadarError('malformed') from None


def wms_times(data, layer):
    """Observation times of one WMS layer: a list of instants or a start/end/PTnM extent."""
    root = xml(data)
    if root.tag != WMS_NS + 'WMS_Capabilities': raise RadarError('unsupported_schema')
    layers = [item for item in root.iter(WMS_NS + 'Layer') if item.findtext(WMS_NS + 'Name') == layer]
    if len(layers) != 1: raise RadarError('unsupported_schema')
    dims = [d for d in layers[0].findall(WMS_NS + 'Dimension') if d.get('name') == 'time']
    if len(dims) != 1: raise RadarError('unsupported_schema')
    text = (dims[0].text or '').strip()
    extent = re.fullmatch(r'([^/,]+)/([^/,]+)/PT(\d{1,2})M', text)
    if extent:
        start, end, step = stamp_time(extent[1]), stamp_time(extent[2]), int(extent[3]) * 60000
        if not step or end < start or (end - start) // step > 240: raise RadarError('unsupported_schema')
        return [(datetime.fromtimestamp(at / 1000, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), at) for at in range(start, end + 1, step)]
    return [(stamp.strip(), stamp_time(stamp.strip())) for stamp in text.split(',') if stamp.strip()]


def noaa_times(data, source):
    return wms_times(data, noaa_layer(source))


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
    elif provider == 'eccc-radar':
        product = eccc_product(source)
        items = wms_times(get(ECCC_BASE + '?' + urllib.parse.urlencode({'service': 'WMS', 'request': 'GetCapabilities', 'version': '1.3.0', 'layer': product['layer']}), 2000000, opener), product['layer'])
        missing = []
        if product['unit'] == 'category':
            legend = {'unit': 'category', 'categories': ECCC_PTYPE_CATEGORIES}
            transformations = ['eccc-wms-mercator-display-crop', 'eccc-coverage-mask', 'eccc-surface-precipitation-type-display']
        else:
            legend = {'unit': product['unit'], 'layout': 'vertical', 'image': '/api/radar/frame?' + urllib.parse.urlencode({'source': source, 'key': 'legend'})}
            transformations = ['eccc-wms-mercator-display-crop', 'eccc-coverage-mask']
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
    if provider != 'opera-radar': items = [(source + '@' + stamp, at) for stamp, at in items]
    authority = {'opera-radar': 'EUMETNET', 'noaa-radar': 'NOAA / National Weather Service', 'eccc-radar': 'Environment and Climate Change Canada'}[provider]
    def resource(key): return {'url': '/api/radar/frame?' + urllib.parse.urlencode({'source': source, 'key': key}), 'format': 'image/png'}
    records = [{'id': key, 'observedAt': at, 'bounds': bounds, 'resource': resource(key),
                **({'coverage': resource(key + '@coverage')} if provider == 'eccc-radar' else {}),
                'provenance': {'provider': provider, 'sourceAuthority': authority,
                               'sourceUrl': OPERA_BASE + key if provider == 'opera-radar' else ECCC_BASE if provider == 'eccc-radar' else wms_base(source),
                               'upstreamId': key, 'fetchedAt': now, 'observedAt': at, 'updatedAt': None, 'transformations': transformations}}
               for key, at in items]
    return {'records': records, 'sourceDataTimestamp': items[-1][1] if items else None, 'missingDependencies': missing, 'legend': legend}


def frame_stamp(source, key, suffix=''):
    """The WMS time of a source-qualified frame key; a region-qualified identity
    prevents coincident observation times colliding."""
    if not isinstance(key, str) or not key.startswith(source + '@') or not key.endswith(suffix): raise RadarError('malformed')
    stamp = key[len(source) + 1:len(key) - len(suffix)]
    if not WMS_STAMP.fullmatch(stamp): raise RadarError('malformed')
    stamp_time(stamp)
    return stamp


def get_map(bounds, layer, style, stamp, width, height):
    from math import log, tan, pi
    def merc(lon, lat): return lon * 20037508.342789244 / 180, 6378137 * log(tan(pi/4 + lat*pi/360))
    west, south = merc(bounds[0], bounds[1]); east, north = merc(bounds[2], bounds[3])
    return {'service': 'WMS', 'request': 'GetMap', 'version': '1.3.0', 'layers': layer, 'styles': style, 'crs': 'EPSG:3857',
            'bbox': f'{west},{south},{east},{north}', 'width': width, 'height': height, 'format': 'image/png', 'transparent': 'true', 'time': stamp}


def image(source, key, opener=None):
    provider, bounds = source_info(source)
    if source == 'opera-radar':
        at = opera_time(key)
        return render(get(OPERA_BASE + key, 20000000, opener), at, width=1000, height=700, bounds=bounds, product='opera')
    if provider == 'eccc-radar':
        base, product = ECCC_BASE, eccc_product(source)
        if key == 'legend':
            query = {'service': 'WMS', 'request': 'GetLegendGraphic', 'version': '1.3.0', 'sld_version': '1.1.0', 'format': 'image/png', 'layer': product['layer'], 'style': product['style']}
        elif isinstance(key, str) and key.endswith('@coverage'):
            query = get_map(bounds, product['coverage'], ECCC_COVERAGE_STYLE, frame_stamp(source, key, '@coverage'), 1600, 840)
        else:
            query = get_map(bounds, product['layer'], product['style'], frame_stamp(source, key), 1600, 840)
    else:
        base, layer = wms_base(source), noaa_layer(source)
        if key == 'legend':
            query = {'service': 'WMS', 'request': 'GetLegendGraphic', 'version': '1.3.0', 'format': 'image/png', 'layer': layer}
        else:
            query = get_map(bounds, layer, '', frame_stamp(source, key), 960, 600)
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
