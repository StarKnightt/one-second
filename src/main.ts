import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { draw } from './film';
import { renderSoundtrack, toWav } from './audio';
import { FPS, FRAMES } from './util';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

async function loadFonts() {
  await Promise.all([
    document.fonts.load('400 32px Inter'),
    document.fonts.load('500 32px Inter'),
    document.fonts.load('600 32px Inter'),
    document.fonts.load('400 32px "JetBrains Mono"'),
    document.fonts.load('500 32px "JetBrains Mono"'),
  ]);
  await document.fonts.ready;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

declare global {
  interface Window {
    ready: Promise<void>;
    renderFrame: (frame: number) => string;
    renderAudio: () => Promise<string>;
  }
}

const params = new URLSearchParams(location.search);

if (params.has('render')) {
  document.body.classList.add('render');
  window.ready = loadFonts();
  window.renderFrame = (frame: number) => {
    draw(ctx, frame / FPS);
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  };
  window.renderAudio = async () => toBase64(toWav(await renderSoundtrack()));
} else {
  // interactive preview: scrub, or play with the soundtrack
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const tc = document.getElementById('tc')!;
  const play = document.getElementById('play') as HTMLButtonElement;
  let playing = false;
  let startAt = 0;
  let offset = Number(params.get('t') ?? 0);
  let actx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  let buffer: AudioBuffer | null = null;

  const show = (t: number) => {
    draw(ctx, t);
    scrub.value = String(Math.round(t * FPS));
    tc.textContent = `${t.toFixed(2)}s`;
  };
  loadFonts().then(() => show(offset));
  scrub.max = String(FRAMES - 1);
  scrub.oninput = () => {
    offset = Number(scrub.value) / FPS;
    if (playing) stop();
    show(offset);
  };
  const stop = () => {
    playing = false;
    src?.stop();
    play.textContent = 'play';
  };
  play.onclick = async () => {
    if (playing) {
      offset = actx!.currentTime - startAt;
      stop();
      return;
    }
    actx ??= new AudioContext();
    buffer ??= await renderSoundtrack();
    src = actx.createBufferSource();
    src.buffer = buffer;
    src.connect(actx.destination);
    startAt = actx.currentTime - offset;
    src.start(0, offset);
    playing = true;
    play.textContent = 'pause';
    const loop = () => {
      if (!playing) return;
      const t = actx!.currentTime - startAt;
      if (t >= FRAMES / FPS) { offset = 0; stop(); return; }
      show(t);
      requestAnimationFrame(loop);
    };
    loop();
  };
}
