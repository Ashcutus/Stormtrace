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

export function radarWorker(root, operation, key = '') {
  const python = readLocalSetting(root, 'STORMTRACE_RADAR_PYTHON') || 'python3';
  return new Promise((resolveResult, reject) => {
    execFile(python, [resolve(root, 'providers/metoffice_radar.py'), operation, ...(key ? [key] : [])], { timeout: 45000, maxBuffer: 10_000_000, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (!error) return resolveResult(stdout);
      let code = 'configuration';
      try { code = JSON.parse(stderr.toString()).code; } catch { if (error.killed) code = 'timeout'; }
      reject(new globalThis.StormtraceCore.ProviderError(code, 'metoffice-radar', operation));
    });
  });
}
