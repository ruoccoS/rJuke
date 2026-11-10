// Prepares the www folder for Capacitor: copies the UI and bundles the native bridge.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) {
  if (f === 'platform.js') continue;
  cpSync(join(src, f), join(out, f), { recursive: true });
}
await build({
  entryPoints: [join(src, 'platform.js')],
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['chrome100'],
  outfile: join(out, 'platform.js'), legalComments: 'none',
});
console.log('www ready');
