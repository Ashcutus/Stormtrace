import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export function readLocalKey(root) {
  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.startsWith('LIGHTNING_API_KEY='));
  return line ? line.slice('LIGHTNING_API_KEY='.length).trim() : '';
}

export function readOmarchyTheme() {
  try {
    const name = execFileSync('omarchy', ['theme', 'current'], { encoding: 'utf8', timeout: 2000 }).trim();
    const output = execFileSync('omarchy', ['theme', 'color', '--all'], { encoding: 'utf8', timeout: 2000 });
    const colors = Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map((line) => { const split = line.indexOf('\t'); return split > 0 ? [line.slice(0, split), line.slice(split + 1)] : [line, '']; }));
    return { available: true, name: name || 'Omarchy', mode: colors.mode || 'dark', colors };
  } catch { return { available: false, name: 'Stormtrace default', mode: 'dark', colors: {} }; }
}
