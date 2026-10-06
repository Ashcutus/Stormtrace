"""Public ASDI radar: anonymous listing and bounded ODIM-HDF5 rendering.

CLI is composed by platform adapters. Optional scientific imports are lazy so
warnings/lightning remain dependency-free. Output PNG is reprojected to Mercator.
"""
from datetime import datetime, timezone, timedelta
import importlib.util
import json
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import zlib

BASE = 'https://met-office-radar-obs-data.s3.eu-west-2.amazonaws.com/'
ID = 'metoffice-radar'
SOURCE = 'https://registry.opendata.aws/met-office-uk-radar-observations/'
BOUNDS = [-13, 48, 4, 62]  # Explicit UK display crop, not native grid corners.
LEVELS = [0.1, 0.5, 1, 2, 4, 8, 16, 32]
COLOURS = ['#62c7ff', '#3594ed', '#3dc76e', '#a9de45', '#ffda37', '#ff9738', '#ed4c55', '#c250db']
KEY = re.compile(r'radar/(\d{4})/(\d{2})/(\d{2})/(\d{12})_ODIM_ng_radar_rainrate_composite_1km_UK\.h5')


class RadarError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def key_time(key):
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if not match:
        raise RadarError('malformed')
    try:
        stamp = datetime.strptime(match[4], '%Y%m%d%H%M').replace(tzinfo=timezone.utc)
    except ValueError:
        raise RadarError('malformed') from None
    if stamp.strftime('%Y/%m/%d') != '/'.join(match.group(1, 2, 3)) or stamp.minute % 15:
        raise RadarError('malformed')
    return int(stamp.timestamp() * 1000)


def get(url, limit, opener=urllib.request.urlopen):
    try:
        with opener(url, timeout=15) as reply:
            data = reply.read(limit + 1)
        if len(data) > limit:
            raise RadarError('malformed')
        return data
    except RadarError:
        raise
    except urllib.error.HTTPError as error:
        raise RadarError('rate_limited' if error.code == 429 else 'upstream') from None
    except TimeoutError:
        raise RadarError('timeout') from None
    except Exception:
        raise RadarError('network') from None


def parse_listing(xml):
    if len(xml) > 500000 or b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
        raise RadarError('parse')
    try:
        root = ET.fromstring(xml)
        ns = '{http://s3.amazonaws.com/doc/2006-03-01/}'
        if root.tag != ns + 'ListBucketResult' or root.findtext(ns + 'IsTruncated') != 'false':
            raise RadarError('unsupported_schema')
        result = []
        for item in root.findall(ns + 'Contents'):
            key = item.findtext(ns + 'Key')
            if key and key.endswith('.h5') and not KEY.fullmatch(key):
                raise RadarError('unsupported_schema')
            if key and KEY.fullmatch(key):
                observed = key_time(key)
                size = int(item.findtext(ns + 'Size'))
                if size < 1 or size > 10000000:
                    raise RadarError('malformed')
                result.append((key, observed))
        return result
    except RadarError:
        raise
    except Exception:
        raise RadarError('parse') from None


def frames(now=None, opener=urllib.request.urlopen):
    now = int(time.time() * 1000) if now is None else now
    day = datetime.fromtimestamp(now / 1000, timezone.utc)
    items = []
    for date in [day - timedelta(days=1), day]:
        query = urllib.parse.urlencode({'list-type': 2, 'prefix': date.strftime('radar/%Y/%m/%d/'), 'max-keys': 1000})
        items.extend(parse_listing(get(BASE + '?' + query, 500000, opener)))
    # At most three hours, twelve frames. Do not pretend old archive data is live.
    items = sorted(set(items), key=lambda item: item[1])
    items = [item for item in items if now - 3 * 3600000 <= item[1] <= now][-12:]
    missing = [name for name in ['h5py', 'numpy', 'pyproj'] if importlib.util.find_spec(name) is None]
    records = [{'id': key, 'observedAt': at, 'bounds': BOUNDS,
                'resource': {'url': '/api/radar/frame?key=' + urllib.parse.quote(key, safe=''), 'format': 'image/png'},
                'provenance': {'provider': ID, 'sourceAuthority': 'Met Office', 'sourceUrl': SOURCE,
                               'upstreamId': key, 'fetchedAt': now, 'observedAt': at, 'updatedAt': None,
                               'transformations': ['odim-rate-to-mercator-png-v1', 'uk-display-crop']}}
               for key, at in items]
    return {'records': records, 'sourceDataTimestamp': items[-1][1] if items else None,
            'missingDependencies': missing, 'legend': {'unit': 'mm/h', 'levels': LEVELS, 'colours': COLOURS}}


def png(rgba):
    height, width, channels = rgba.shape
    if channels != 4:
        raise RadarError('malformed')
    def chunk(kind, content):
        return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content) & 0xffffffff)
    rows = b''.join(b'\0' + row.tobytes() for row in rgba)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def render(data, expected_time, width=640, height=800):
    try:
        import h5py
        import numpy as np
        from pyproj import Transformer
        import io
    except ImportError:
        raise RadarError('configuration') from None
    try:
        with h5py.File(io.BytesIO(data), 'r') as f:
            def text(value):
                return value.decode('ascii') if isinstance(value, bytes) else str(value)
            what, where = f['what'].attrs, f['where'].attrs
            native = datetime.strptime(text(what['date']) + text(what['time']), '%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
            props = f['dataset1/data1/what'].attrs
            if int(native.timestamp() * 1000) != expected_time or text(props['quantity']) != 'RATE' or text(f['dataset1/how'].attrs['origin']) != 'UPPER LEFT':
                raise RadarError('unsupported_schema')
            nx, ny = int(where['xsize']), int(where['ysize'])
            sx, sy = float(where['xscale']), float(where['yscale'])
            if not (1 <= nx <= 4000 and 1 <= ny <= 4000 and sx > 0 and sy > 0):
                raise RadarError('malformed')
            dataset = f['dataset1/data1/data']
            if dataset.shape != (ny, nx) or dataset.dtype.kind not in 'fiu':
                raise RadarError('malformed')
            a = dataset[:]
            transform = Transformer.from_crs('EPSG:4326', text(where['projdef']), always_xy=True)
            left, bottom = transform.transform(float(where['LL_lon']), float(where['LL_lat']))
            # Sample at Mercator pixel centres, not linearly spaced latitude.
            west, south, east, north = BOUNDS
            lon = west + (np.arange(width) + .5) / width * (east - west)
            merc = lambda lat: np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
            y = merc(north) - (np.arange(height) + .5) / height * (merc(north) - merc(south))
            lat = np.degrees(2 * np.arctan(np.exp(y)) - np.pi / 2)
            xx, yy = transform.transform(*np.meshgrid(lon, lat))
            columns = np.floor((xx - left) / sx).astype(int)
            rows = np.floor((bottom + ny * sy - yy) / sy).astype(int)
            inside = (columns >= 0) & (columns < nx) & (rows >= 0) & (rows < ny)
            raw = a[np.clip(rows, 0, ny - 1), np.clip(columns, 0, nx - 1)]
            rates = raw * float(props['gain']) + float(props['offset'])
            valid = inside & np.isfinite(rates) & (raw != props['nodata']) & (raw != props['undetect']) & (rates >= LEVELS[0])
            palette = np.array([[int(c[i:i + 2], 16) for i in [1, 3, 5]] + [195] for c in COLOURS], dtype=np.uint8)
            rgba = palette[np.clip(np.searchsorted(LEVELS, rates, side='right') - 1, 0, len(LEVELS) - 1)]
            rgba[~valid] = 0
            return png(rgba)
    except RadarError:
        raise
    except Exception:
        raise RadarError('malformed') from None


if __name__ == '__main__':
    try:
        operation = sys.argv[1]
        if operation == 'frames':
            print(json.dumps(frames()))
        elif operation == 'render':
            key = sys.argv[2]
            observed = key_time(key)
            sys.stdout.buffer.write(render(get(BASE + key, 10000000), observed))
        else:
            raise RadarError('configuration')
    except RadarError as error:
        print(json.dumps({'code': error.code}), file=sys.stderr)
        sys.exit(1)
