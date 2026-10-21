import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import '../core/index.js';
import { RadarSetup, radarPython, defaultRadarEnv } from '../platform/node.js';
import { createStormtraceServer } from '../server.js';

const settle = async () => { for (let n = 0; n < 10; n++) await new Promise((resolve) => setImmediate(resolve)); };

test('radar decoder selection: an explicit .env choice wins, then the default environment once it exists, then python3', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'stormtrace-root-')), data = mkdtempSync(join(tmpdir(), 'stormtrace-data-'));
  context.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });
  const env = { XDG_DATA_HOME: data, HOME: '/nonexistent' };
  assert.equal(defaultRadarEnv(env), join(data, 'stormtrace', 'radar-venv'));
  assert.equal(radarPython(root, env), 'python3');
  mkdirSync(join(data, 'stormtrace', 'radar-venv', 'bin'), { recursive: true }); writeFileSync(join(data, 'stormtrace', 'radar-venv', 'bin', 'python'), '');
  assert.equal(radarPython(root, env), join(data, 'stormtrace', 'radar-venv', 'bin', 'python'));
  writeFileSync(join(root, '.env'), 'STORMTRACE_RADAR_PYTHON=/opt/custom/python\n');
  assert.equal(radarPython(root, env), '/opt/custom/python');
});

test('radar setup runs only fixed commands outside the plugin, reports progress, allows one job, and explains failures', async () => {
  const calls = []; let done = 0, fail = false;
  const env = { XDG_DATA_HOME: '/data' };
  const run = async (command, args, options) => { calls.push([command, ...args]); assert.ok(options.timeout > 0); if (fail && args.includes('pip')) { const error = new Error('exit 1'); error.stderr = 'Collecting h5py\nERROR: network unreachable\u001b[0m'; throw error; } };
  const setup = new RadarSetup({ root: '/plugin', run, onDone: () => done++, env });
  const first = setup.start();
  assert.equal(first.state, 'running'); assert.equal(setup.start().state, 'running', 'a second start joins the running job');
  await settle();
  assert.equal(setup.snapshot().state, 'done'); assert.equal(done, 1);
  assert.deepEqual(calls[0], ['python3', '-m', 'venv', '/data/stormtrace/radar-venv']);
  assert.deepEqual(calls[1].slice(0, 4), ['/data/stormtrace/radar-venv/bin/python', '-m', 'pip', 'install']);
  assert.equal(calls[1].at(-1), '/plugin/requirements-radar.txt');
  assert.ok(calls.every((call) => !call.join(' ').includes('/plugin/.venv')), 'never creates an environment inside the plugin');
  fail = true; calls.length = 0; setup.start(); await settle();
  const failed = setup.snapshot();
  assert.equal(failed.state, 'failed'); assert.match(failed.message, /^Radar setup failed: ERROR: network unreachable/); assert.doesNotMatch(failed.message, /\u001b/);
});

const request = (port, path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, data })); });
  req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
});

test('both servers expose radar setup status and start it only from the same origin with JSON', async (context) => {
  let starts = 0;
  const radarSetup = { start: () => { starts++; return { state: 'running' }; }, snapshot: () => ({ state: 'idle' }) };
  const make = (id) => ({ id, health: {}, frames: async () => ({ records: [] }), image: async () => Buffer.from('') });
  const server = createStormtraceServer({ radarProvider: make('metoffice-radar'), publicRadarProviders: {}, radarSetup });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); context.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  assert.equal(JSON.parse((await request(port, '/api/radar/setup')).data).state, 'idle');
  assert.equal((await request(port, '/api/radar/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(port, '/api/radar/setup', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(starts, 0);
  assert.equal((await request(port, '/api/radar/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status, 202);
  assert.equal(starts, 1);
  assert.equal(execFileSync('python3', ['-c', `
import json,threading,urllib.request,urllib.error,tempfile,os
from pathlib import Path
import server, stormtrace_platform as sp
calls=[]
data=tempfile.mkdtemp()
setup=sp.RadarSetup(Path('/plugin'),run=lambda command,timeout:calls.append(command),env={'XDG_DATA_HOME':data})
snap=setup.start(background=False)
assert setup.snapshot()['state']=='done',setup.snapshot()
assert calls[0][1:]==['-m','venv',os.path.join(data,'stormtrace','radar-venv')]
assert calls[1][0]==os.path.join(data,'stormtrace','radar-venv','bin','python') and calls[1][-1]=='/plugin/requirements-radar.txt'
def boom(command,timeout):
 if 'pip' in command:
  e=RuntimeError('x');e.stderr='Collecting h5py\\nERROR: network unreachable';raise e
setup=sp.RadarSetup(Path('/plugin'),run=boom,env={'XDG_DATA_HOME':data});setup.start(background=False)
assert setup.snapshot()['state']=='failed' and setup.snapshot()['message'].startswith('Radar setup failed: ERROR: network unreachable')
assert sp.radar_python(Path(tempfile.mkdtemp()),'fallback',{'XDG_DATA_HOME':tempfile.mkdtemp()})=='fallback'
server.RADAR_SETUP=type('S',(),{'start':lambda self:{'state':'running'},'snapshot':lambda self:{'state':'idle'}})()
http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=http.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(http.server_port)
with urllib.request.urlopen(base+'/api/radar/setup') as r:assert json.load(r)['state']=='idle'
def post(headers):
 try:
  with urllib.request.urlopen(urllib.request.Request(base+'/api/radar/setup',data=b'{}',headers=headers,method='POST')) as r:return r.status
 except urllib.error.HTTPError as e:return e.code
assert post({'Content-Type':'application/json','Origin':'https://evil.example'})==403
assert post({'Content-Type':'text/plain'})==415
assert post({'Content-Type':'application/json'})==202
http.shutdown();http.server_close();print('ok')
`], { encoding: 'utf8' }).trim(), 'ok');
});

test('launch refreshes a stale launcher icon only for an existing launcher install', (context) => {
  const data = mkdtempSync(join(tmpdir(), 'stormtrace-launcher-'));
  context.after(() => rmSync(data, { recursive: true, force: true }));
  const script = execFileSync('sed', ['-n', '/^refresh_launcher_icon() {/,/^}/p', new URL('../start-app.sh', import.meta.url).pathname], { encoding: 'utf8' });
  const run = () => execFileSync('bash', ['-c', `set -euo pipefail\nAPP_DIR=${JSON.stringify(new URL('..', import.meta.url).pathname.replace(/\/$/, ''))}\n${script}\nrefresh_launcher_icon`], { env: { ...process.env, XDG_DATA_HOME: data } });
  const icon = join(data, 'icons/hicolor/scalable/apps/org.omarchy.Stormtrace.svg');
  run();
  assert.throws(() => execFileSync('test', ['-e', icon]), 'no launcher install: nothing is created');
  mkdirSync(join(data, 'applications'), { recursive: true }); writeFileSync(join(data, 'applications/org.omarchy.Stormtrace.desktop'), '[Desktop Entry]\n');
  mkdirSync(join(data, 'icons/hicolor/scalable/apps'), { recursive: true }); writeFileSync(icon, '<svg>old globe</svg>');
  run();
  assert.equal(execFileSync('cat', [icon], { encoding: 'utf8' }), execFileSync('cat', [new URL('../icon.svg', import.meta.url).pathname], { encoding: 'utf8' }));
});
