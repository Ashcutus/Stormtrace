import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const js = ['server.js', 'app.js', ...['client', 'core', 'providers', 'platform', 'scripts'].flatMap((directory) => readdirSync(directory).filter((file) => /\.(?:js|mjs)$/.test(file)).map((file) => `${directory}/${file}`))];
for (const file of js) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
execFileSync('python3', ['-c', "import ast, pathlib; [ast.parse(p.read_text()) for p in [*pathlib.Path('.').glob('*.py'), *pathlib.Path('providers').glob('*.py')]]"], { stdio: 'inherit' });
const version = JSON.parse(readFileSync('manifest.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid manifest version');
console.log(`Checked ${js.length} JavaScript modules, Python modules, and manifest.`);
