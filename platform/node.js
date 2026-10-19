import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

export function radarWorker(root, operation, key = '', source = 'metoffice-radar') {
  const python = readLocalSetting(root, 'STORMTRACE_RADAR_PYTHON') || 'python3';
  return new Promise((resolveResult, reject) => {
    const args = source === 'metoffice-radar' ? [resolve(root, 'providers/metoffice_radar.py'), operation] : ['-m', 'providers.public_radar', source, operation];
    execFile(python, [...args, ...(key ? [key] : [])], { cwd: root, timeout: 45000, maxBuffer: 10_000_000, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (!error) return resolveResult(stdout);
      let code = 'configuration';
      try { code = JSON.parse(stderr.toString()).code; } catch { if (error.killed) code = 'timeout'; }
      reject(new globalThis.StormtraceCore.ProviderError(code, source.startsWith('noaa-') ? 'noaa-radar' : source, operation));
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
