// Deterministic render: every frame is drawn from its timestamp alone (three.js on SwiftShader),
// captured as a high-quality JPEG,
// and piped to ffmpeg. The soundtrack is rendered offline in the same page, then
// loudness-normalized to -14 LUFS (two-pass EBU R128) and muxed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { launch, openPage, serve } from './lib.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'output');
const seg = path.join(out, 'segments');
fs.mkdirSync(seg, { recursive: true });

const FPS = 60;
const FRAMES = Number(process.env.FRAMES ?? 34 * FPS); // FRAMES=120 renders a short test
const WORKERS = Number(process.env.WORKERS ?? Math.max(1, Math.min(3, os.cpus().length - 1)));
const CRF = process.env.CRF ?? '14';
const MAX_BYTES = 95 * 1024 * 1024;

const server = await serve(path.join(root, 'dist'));
const port = server.address().port;
const browser = await launch();

// ---- audio ----
console.log('rendering soundtrack…');
{
  const page = await openPage(browser, port);
  const b64 = await page.evaluate(() => window.renderAudio());
  fs.writeFileSync(path.join(out, 'raw.wav'), Buffer.from(b64, 'base64'));
  await page.close();
}
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
// ffmpeg prints the loudnorm measurement on stderr
const stats = (() => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', path.join(out, 'raw.wav'), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return JSON.parse(r.slice(r.lastIndexOf('{'), r.lastIndexOf('}') + 1));
})();
ff(['-i', path.join(out, 'raw.wav'), '-af',
  `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true,aresample=48000`,
  '-c:a', 'pcm_s24le', path.join(out, 'normalized.wav')]);
// loudnorm's dynamic mode lands within ~0.5 LU; measure with EBU R128 and trim the remainder
const integrated = (file) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.slice(r.lastIndexOf('Summary')))[1]);
};
const trim = -14 - integrated(path.join(out, 'normalized.wav'));
ff(['-i', path.join(out, 'normalized.wav'), '-af', `volume=${trim.toFixed(2)}dB`, '-c:a', 'pcm_s24le', path.join(out, 'master.wav')]);
fs.rmSync(path.join(out, 'normalized.wav'));
console.log(`loudness: raw ${stats.input_i} LUFS → master ${integrated(path.join(out, 'master.wav'))} LUFS`);


// ---- video ----
const t0 = Date.now();
let done = 0;
async function worker(k) {
  const a = Math.floor((FRAMES * k) / WORKERS), b = Math.floor((FRAMES * (k + 1)) / WORKERS);
  const page = await openPage(browser, port);
  const file = path.join(seg, `seg${k}.mp4`);
  const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS),
    '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-tune', 'film',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-x264-params', 'keyint=120:min-keyint=120', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    const b64 = await page.evaluate((n) => window.renderFrame(n), f);
    if (!enc.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((r) => enc.stdin.once('drain', r));
    done++;
    if (done % 120 === 0) {
      const s = (Date.now() - t0) / 1000;
      console.log(`${done}/${FRAMES} frames · ${(done / s).toFixed(1)} fps`);
    }
  }
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));
  await page.close();
  return file;
}
const files = await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k)));
await browser.close();
server.close();

fs.writeFileSync(path.join(seg, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'));
const final = path.join(out, 'send.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', path.join(seg, 'list.txt'), '-i', path.join(out, 'master.wav'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
  '-movflags', '+faststart', '-shortest', final]);
const size = fs.statSync(final).size;
console.log(`wrote ${final} · ${(size / 1048576).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (size > MAX_BYTES) {
  console.error('over 95 MB: re-run with a higher CRF, e.g. CRF=20 pnpm render');
  process.exit(1);
}
