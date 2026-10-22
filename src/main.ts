import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import * as THREE from 'three';
import { DURATION, FPS, FRAMES, H, W, clamp, easeOut, ramp, smooth, type FilmSet } from './lib';
import { Post } from './post';
import { renderSoundtrack, toWav } from './audio';
import { homeSet } from './sets/home';
import { dataCenterSet } from './sets/datacenter';
import { spaceSet } from './sets/space';
import { bedroomSet } from './sets/bedroom';

const glCanvas = document.createElement('canvas');
glCanvas.width = W;
glCanvas.height = H;
const out = document.getElementById('c') as HTMLCanvasElement;
const ctx = out.getContext('2d', { alpha: false })!;

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the grade pass converts to sRGB itself
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const post = new Post(renderer);

/** One short line per scene, big and centred low. */
export const CAPTIONS: [number, number, string][] = [
  [0.5, 2.7, 'You tap send.'],
  [5.4, 8.7, 'It hops across the city, router to router.'],
  [11.9, 15.7, '6,000 km under the ocean, in about 30 ms.'],
  [18.4, 21.3, 'A server works out who it’s for.'],
  [23.9, 26.9, 'Then back across the world.'],
];
const END: [number, string] = [31.0, 'All of that took less than a second.'];

let sets: FilmSet[] = [];

function caption(t: number) {
  const draw = (text: string, a: number, size: number, rise: number) => {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `600 ${size}px Inter, sans-serif`;
    ctx.letterSpacing = `${-size * 0.012}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 28;
    ctx.fillStyle = '#f4f7fb';
    ctx.fillText(text, W / 2, H - 120 + rise);
    ctx.restore();
  };
  for (const [a, b, text] of CAPTIONS) {
    if (t < a || t > b) continue;
    const inP = easeOut(ramp(t, a, a + 0.55));
    const outP = smooth(ramp(t, b - 0.45, b));
    draw(text, inP * (1 - outP), 60, (1 - inP) * 18);
  }
  const [a, text] = END;
  if (t > a) {
    const inP = easeOut(ramp(t, a, a + 0.9));
    const fade = 1 - smooth(ramp(t, DURATION - 0.7, DURATION - 0.05));
    draw(text, inP * fade, 72, (1 - inP) * 22);
  }
}

function renderAt(frame: number) {
  const t = clamp(frame / FPS, 0, DURATION - 1e-6);
  const set = sets.find((s) => t >= s.start && t < s.end) ?? sets[sets.length - 1];
  const shot = set.frame(t);
  post.render(shot, frame);
  ctx.drawImage(glCanvas, 0, 0);
  caption(t);
}

async function init() {
  await Promise.all([document.fonts.load('600 60px Inter'), document.fonts.load('500 60px Inter')]);
  sets = [await homeSet(), dataCenterSet(), await spaceSet(), bedroomSet()];
  // warm up every set once so shader compilation is not part of any timed frame
  for (const s of sets) post.render(s.frame((s.start + s.end) / 2), 0);
}

declare global {
  interface Window {
    ready: Promise<void>;
    renderFrame: (frame: number) => string;
    renderAudio: () => Promise<string>;
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const params = new URLSearchParams(location.search);
window.ready = init();

if (params.has('render')) {
  document.body.classList.add('render');
  window.renderFrame = (frame: number) => {
    renderAt(frame);
    return out.toDataURL('image/jpeg', 0.96).slice('data:image/jpeg;base64,'.length);
  };
  window.renderAudio = async () => toBase64(toWav(await renderSoundtrack()));
} else {
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const tc = document.getElementById('tc')!;
  scrub.max = String(FRAMES - 1);
  const show = (f: number) => {
    renderAt(f);
    scrub.value = String(f);
    tc.textContent = `${(f / FPS).toFixed(2)}s`;
  };
  window.ready.then(() => show(Math.round(Number(params.get('t') ?? 0) * FPS)));
  scrub.oninput = () => show(Number(scrub.value));
  // real-time playback is not possible with software rendering; the button plays the soundtrack
  const play = document.getElementById('play') as HTMLButtonElement;
  play.onclick = async () => {
    const ac = new AudioContext();
    const src = ac.createBufferSource();
    src.buffer = await renderSoundtrack();
    src.connect(ac.destination);
    src.start();
  };
}
