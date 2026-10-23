import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';

export function readLocalSetting(root, name) {
  if (process.env[name]) return process.env[name];
  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}

export function readLocalKey(root) { return readLocalSetting(root, 'LIGHTNING_API_KEY'); }

export function readOmarchyTheme() {
  try {
    const name = execFileSync('omarchy', ['theme', 'current'], { encoding: 'utf8', timeout: 2000 }).trim();
    const output = execFileSync('omarchy', ['theme', 'color', '--all'], { encoding: 'utf8', timeout: 2000 });
    const colors = Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map((line) => { const split = line.indexOf('\t'); return split > 0 ? [line.slice(0, split), line.slice(split + 1)] : [line, '']; }));
    return { available: true, name: name || 'Omarchy', mode: colors.mode || 'dark', colors };
  } catch { return { available: false, name: 'Stormtrace default', mode: 'dark', colors: {} }; }
}

// The optional radar decoder lives outside the plugin folder: Omarchy rejects
// symlinks inside plugins, and Python environments contain them.
export function defaultRadarEnv(env = process.env) {
  return join(env.XDG_DATA_HOME || join(env.HOME || homedir(), '.local', 'share'), 'stormtrace', 'radar-venv');
}

// An explicit .env choice wins; otherwise use the default environment once it exists.
export function radarPython(root, env = process.env) {
  const explicit = readLocalSetting(root, 'STORMTRACE_RADAR_PYTHON');
  if (explicit) return explicit;
  const fallback = join(defaultRadarEnv(env), 'bin', 'python');
  return existsSync(fallback) ? fallback : 'python3';
}

// One-click decoder setup: create the default environment and install the
// pinned requirements. Fixed commands only; one job at a time; bounded time.
export class RadarSetup {
  constructor({ root, run = runCommand, onDone = () => {}, now = Date.now, env = process.env } = {}) {
    Object.assign(this, { root, run, onDone, now, env });
    this.status = { state: 'idle', step: null, message: '', startedAt: null, finishedAt: null };
  }
  snapshot() { return { ...this.status, explicitPython: Boolean(readLocalSetting(this.root, 'STORMTRACE_RADAR_PYTHON')), environment: defaultRadarEnv(this.env) }; }
  start() {
    if (this.status.state === 'running') return this.snapshot();
    const venv = defaultRadarEnv(this.env), python = join(venv, 'bin', 'python');
    this.status = { state: 'running', step: 'environment', message: 'Creating the radar environment…', startedAt: this.now(), finishedAt: null };
    (async () => {
      try {
        await this.run('python3', ['-m', 'venv', venv], { cwd: this.root, timeout: 120000 });
        this.status = { ...this.status, step: 'packages', message: 'Installing radar packages (about 40 MB)…' };
        await this.run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', resolve(this.root, 'requirements-radar.txt')], { cwd: this.root, timeout: 900000 });
        this.status = { ...this.status, state: 'done', step: null, message: 'Radar is set up.', finishedAt: this.now() };
        this.onDone();
      } catch (error) {
        this.status = { ...this.status, state: 'failed', message: setupFailure(error), finishedAt: this.now() };
      }
    })();
    return this.snapshot();
  }
}

function setupFailure(error) {
  const detail = String(error?.stderr || error?.message || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || '';
  return `Radar setup failed${detail ? `: ${detail.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)}` : ''}. See the radar setup guide.`;
}

function runCommand(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { ...options, maxBuffer: 20_000_000 }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr || ''); reject(error); } else resolvePromise();
    });
  });
}

export function radarWorker(root, operation, key = '', source = 'metoffice-radar') {
  const python = radarPython(root);
  return new Promise((resolveResult, reject) => {
    const args = source === 'metoffice-radar' ? [resolve(root, 'providers/metoffice_radar.py'), operation] : ['-m', 'providers.public_radar', source, operation];
    execFile(python, [...args, ...(key ? [key] : [])], { cwd: root, timeout: 45000, maxBuffer: 10_000_000, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (!error) return resolveResult(stdout);
      let code = 'configuration';
      try { code = JSON.parse(stderr.toString()).code; } catch { if (error.killed) code = 'timeout'; }
      reject(new globalThis.StormtraceCore.ProviderError(code, globalThis.StormtraceCore.radarProviderId(source), operation));
    });
  });
}

// Process selection stays in the platform adapter. Public hazard normalization
// uses only Python's standard library, independent of optional radar decoders.
export function publicHazardWorker(root, id, previous = null) {
  return new Promise((resolveResult, reject) => {
    const child=execFile('python3', ['-m', 'providers.public_hazards', id, 'current'], { cwd: root, timeout: 40000, maxBuffer: 12_000_000, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (!error) return resolveResult(stdout);
      let details;
      try { details = JSON.parse(stderr.toString()); } catch { details = { code: error.killed ? 'timeout' : 'configuration' }; }
      reject(new globalThis.StormtraceCore.ProviderError(details.code, id, 'current', { status: details.status ?? null, retryAfter: details.retryAfter ?? null }));
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(previous || {}));
  });
}
