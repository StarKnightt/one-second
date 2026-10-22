// Critic helper: render individual frames to output/frames/ as PNG.
// usage: node scripts/frames.mjs 1.2 5.5 22.4 ...   (seconds)  or  --every 2
import fs from 'node:fs';
import path from 'node:path';
import { launch, openPage, serve } from './lib.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'output', 'frames');
fs.mkdirSync(outDir, { recursive: true });
// start clean so the folder only holds this run's stills
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.jpg')) fs.rmSync(path.join(outDir, f));

let times = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
const every = process.argv.indexOf('--every');
if (every > 0) {
  const step = Number(process.argv[every + 1]);
  times = [];
  for (let t = 0; t < 34; t += step) times.push(+t.toFixed(3));
}

const server = await serve(path.join(root, 'dist'));
const browser = await launch();
const page = await openPage(browser, server.address().port);
const t0 = Date.now();
for (const t of times) {
  const b64 = await page.evaluate((f) => window.renderFrame(f), Math.round(t * 60));
  const name = `t${t.toFixed(2).padStart(5, '0')}.jpg`;
  fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'));
  console.log(name, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
server.close();
