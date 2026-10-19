"""Source metadata for the Python fallback, read from providers/registry.js.

registry.js is canonical; the marked blocks there are valid JSON.
"""
import json
from pathlib import Path

_registry = (Path(__file__).parent / 'registry.js').read_text()


def _block(name, variable):
    start = f'// BEGIN {name} JSON\n  const {variable} = '
    return json.loads(_registry.split(start, 1)[1].split(f';\n  // END {name} JSON', 1)[0])


SOURCES = {s['id']: s for s in _block('HAZARD SOURCES', 'hazardSources') + _block('PROVIDER SOURCES', 'providerSources')}
