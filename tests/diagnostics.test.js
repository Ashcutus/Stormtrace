import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fields, sanitizeDiagnostics } from '../platform/diagnostics.js';
import { createStormtraceServer } from '../server.js';

test('diagnostics schema rejects payloads, secrets, invalid and negative measurements', () => {
  assert.deepEqual(sanitizeDiagnostics({ received: 12, markers: -1, errors: Infinity, token: 'secret', url: 'private', lagMs: '5' }), { received: 12 });
  assert.deepEqual(fields, JSON.parse(readFileSync('platform/diagnostics-fields.json')));
});
test('disabled browser diagnostics installs no sampling timers or error listeners', async () => {
  let timers = 0, listeners = 0;
  const context = vm.createContext({ Date, document: {}, fetch: async () => ({ json: async () => ({ enabled: false }) }), setInterval: () => timers++, addEventListener: () => listeners++ });
  vm.runInContext(readFileSync('platform/diagnostics-browser.js', 'utf8'), context);
  context.StormtraceDiagnostics.start(() => { throw Error('must not sample'); });
  await new Promise(resolve => setImmediate(resolve));
  context.StormtraceDiagnostics.count('received', 100);
  assert.equal(timers, 0); assert.equal(listeners, 0);
});
test('disabled Node endpoint rejects collection', async () => {
  const server = createStormtraceServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/diagnostics`;
    assert.deepEqual(await (await fetch(url)).json(), { enabled: false, sample: null });
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('recorder rotation, retention, summary and proc metrics', () => {
  execFileSync('python3', ['-c', `
import importlib.util, tempfile, pathlib, os
spec = importlib.util.spec_from_file_location('diagnostics', 'scripts/diagnostics.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 base = pathlib.Path(directory)
 for i in range(7):
  session = m.Session(base, limit=1)
  for j in range(6): session.write({'rssBytes': 100+j, 'cpuPercent': j, 'browserReportAgeMs': 40000})
 assert len(list(base.glob('20*'))) == 5
 assert len(list(session.path.glob('*.jsonl'))) == 3
 assert session.summary['startingRssBytes'] == 100
 assert session.summary['peakRssBytes'] == 105
 assert session.summary['averageCpuPercent'] == 2.5
 assert session.summary['staleIncidents'] == 1
 assert m.resource(os.getpid())['rssBytes'] > 0
 assert os.stat(session.path / 'summary.json').st_mode & 0o777 == 0o600
`]);
});
test('enabled browser samples aggregate counters and queue size', async () => {
  const calls = []; let tick;
  const context = vm.createContext({ Date, document: { hidden: false }, setInterval: callback => { tick = callback; }, addEventListener() {} });
  context.fetch = async (url, options) => { calls.push(options?.body ? JSON.parse(options.body) : url); return { json: async () => ({ enabled: true }) }; };
  vm.runInContext(readFileSync('platform/diagnostics-browser.js', 'utf8'), context);
  context.StormtraceDiagnostics.start(() => ({ markers: 3, pendingWrites: 7 }));
  await new Promise(resolve => setImmediate(resolve));
  context.StormtraceDiagnostics.count('processed', 5);
  context.StormtraceDiagnostics.lightning(); tick();
  assert.equal(calls[1].processed, 5); assert.equal(calls[1].markerPeak, 3); assert.equal(calls[1].pendingWrites, 7);
  assert.equal(calls[1].hidden, 0);
});
test('enabled Node and Python endpoints sanitize identically and reject oversized snapshots', () => {
  const expected = { processed: 4 };
  const node = execFileSync(process.execPath, ['--input-type=module', '-e', `
import { createStormtraceServer } from './server.js';
const server = createStormtraceServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port + '/api/diagnostics';
await fetch(url, {method:'POST', body:JSON.stringify({processed:4,secret:'no',markers:-1})});
const result = await (await fetch(url)).json(); delete result.sample.receivedAt;
console.log(JSON.stringify(result.sample));
if ((await fetch(url, {method:'POST',body:'x'.repeat(4097)})).status !== 413) throw Error('size limit');
if ((await fetch(url, {method:'POST',headers:{Origin:'https://other.example'},body:'{}'})).status !== 403) throw Error('origin');
await new Promise(r => server.close(r));
`], { env: { ...process.env, STORMTRACE_DIAGNOSTICS: '1' } });
  const python = execFileSync('python3', ['-c', `
import server, threading, json
from urllib.request import Request, urlopen
http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
url = 'http://127.0.0.1:%s/api/diagnostics' % http.server_port
with urlopen(Request(url, data=json.dumps({'processed':4,'secret':'no','markers':-1}).encode())) as r: r.read()
with urlopen(url) as r: sample=json.load(r)['sample']
sample.pop('receivedAt'); print(json.dumps(sample))
http.shutdown(); http.server_close()
`], { env: { ...process.env, STORMTRACE_DIAGNOSTICS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.deepEqual(JSON.parse(node), expected); assert.deepEqual(JSON.parse(python), expected);
});
