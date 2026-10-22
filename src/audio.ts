// The soundtrack, synthesized in Web Audio and rendered offline: sample-identical on every run.
// No audio files. Cues follow the picture: tap, burst, router, wind over the city, the dive,
// the ocean, the data-center hum, the rise into space, the buzz.

import { DURATION } from './lib';
import { buzzWindows } from './timing';

export const SAMPLE_RATE = 48000;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function renderSoundtrack(): Promise<AudioBuffer> {
  const ac = new OfflineAudioContext(2, SAMPLE_RATE * DURATION, SAMPLE_RATE);
  const master = ac.createGain();
  master.gain.value = 0.85;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.25;
  master.connect(comp).connect(ac.destination);

  // a short synthetic room reverb so everything sits in the same space
  const verb = ac.createConvolver();
  {
    const rnd = mulberry32(3);
    const len = SAMPLE_RATE * 2.4;
    const ir = ac.createBuffer(2, len, SAMPLE_RATE);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5;
    }
    verb.buffer = ir;
  }
  const verbIn = ac.createGain();
  verbIn.gain.value = 0.22;
  verbIn.connect(verb).connect(master);
  const out = (node: AudioNode, wet = 1) => {
    node.connect(master);
    if (wet > 0) {
      const g = ac.createGain();
      g.gain.value = wet;
      node.connect(g).connect(verbIn);
    }
  };

  const rnd = mulberry32(20261022);
  const pink = ac.createBuffer(1, SAMPLE_RATE * 8, SAMPLE_RATE);
  {
    const pd = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < pd.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      pd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
  }
  const white = ac.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  {
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = rnd() * 2 - 1;
  }
  const src = (buf: AudioBuffer, t: number, dur: number, offset = 0) => {
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(t, offset % buf.duration, dur);
    return s;
  };
  const env = (g: GainNode, t: number, a: number, hold: number, r: number, peak: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + Math.max(0, hold));
    g.gain.linearRampToValueAtTime(0, t + a + Math.max(0, hold) + r);
  };

  /** Filtered noise sweep with a sub-bass sine underneath: a deep, cinematic whoosh. */
  const whoosh = (t: number, dur: number, gain: number, f: [number, number, number], pan: [number, number], sub = 0, q = 0.9) => {
    const n = src(pink, t, dur + 0.05, t * 1.3);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f[0], t);
    bp.frequency.exponentialRampToValueAtTime(f[1], t + dur * 0.6);
    bp.frequency.exponentialRampToValueAtTime(f[2], t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ac.createStereoPanner();
    p.pan.setValueAtTime(pan[0], t);
    p.pan.linearRampToValueAtTime(pan[1], t + dur);
    n.connect(bp).connect(g).connect(p);
    out(p, 0.6);
    if (sub > 0) {
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(38, t + dur);
      const sg = ac.createGain();
      env(sg, t, dur * 0.55, 0, dur * 0.45, sub);
      o.connect(sg);
      out(sg, 0);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  };

  /** Soft tick: a sine ping and a tiny click. */
  const tick = (t: number, gain: number, freq = 2400, pan = 0) => {
    const p = ac.createStereoPanner();
    p.pan.value = pan;
    out(p, 0.5);
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.75, t + 0.08);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.12);
    const n = src(white, t, 0.02, t * 1.7);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4800;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(gain * 0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(bp).connect(ng).connect(p);
  };

  /** Low impact: a pitched-down sine thump. */
  const thump = (t: number, gain: number, f0 = 110) => {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g);
    out(g, 0.3);
    o.start(t);
    o.stop(t + 1);
  };

  /** Sustained noise bed through a filter (room tone, city, ocean, fans). */
  const bed = (t0: number, t1: number, gain: number, type: BiquadFilterType, freq: number, q = 0.7, lfo = 0) => {
    const n = src(pink, t0, t1 - t0 + 0.1, t0 * 2.1);
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    const fade = Math.min(0.8, (t1 - t0) / 3);
    env(g, t0, fade, t1 - t0 - 2 * fade, fade, gain);
    n.connect(f).connect(g);
    if (lfo > 0) {
      const o = ac.createOscillator();
      o.frequency.value = lfo;
      const lg = ac.createGain();
      lg.gain.value = gain * 0.4;
      o.connect(lg).connect(g.gain);
      o.start(t0);
      o.stop(t1);
    }
    out(g, 0.2);
  };

  /** Tonal pad (sines and soft triangles), for the drones and the end chord. */
  const pad = (t0: number, t1: number, freqs: number[], gain: number, attack = 1.5, release = 1.5) => {
    const g = ac.createGain();
    env(g, t0, attack, t1 - t0 - attack - release, release, gain);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    g.connect(lp);
    out(lp, 0.5);
    freqs.forEach((f, i) => {
      for (const det of [-5, 5]) {
        const o = ac.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        const og = ac.createGain();
        og.gain.value = 1 / (freqs.length * 2) / Math.sqrt(i + 1);
        o.connect(og).connect(g);
        o.start(t0);
        o.stop(t1 + 0.1);
      }
    });
  };

  /** Data-center hum: mains harmonics and fan air. */
  const hum = (t0: number, t1: number, gain: number) => {
    const g = ac.createGain();
    env(g, t0, 0.6, t1 - t0 - 1.2, 0.6, gain);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(lp);
    out(lp, 0.4);
    for (const [f, a] of [[60, 1], [120, 0.6], [180, 0.35], [240, 0.2], [360, 0.1], [480, 0.06]] as const) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const og = ac.createGain();
      og.gain.value = a * 0.35;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t1 + 0.05);
    }
    bed(t0, t1, gain * 0.9, 'bandpass', 1100, 0.6, 0.35);
  };

  /** Phone vibration: ~170 Hz motor plus a rattle against the wooden nightstand. */
  const buzz = (t: number, dur: number, gain: number) => {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.linearRampToValueAtTime(172, t + 0.06);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 3;
    const am = ac.createOscillator();
    am.frequency.value = 33;
    const amg = ac.createGain();
    amg.gain.value = 0.3;
    const g = ac.createGain();
    env(g, t, 0.025, dur - 0.07, 0.045, gain);
    am.connect(amg).connect(g.gain);
    o.connect(lp).connect(g);
    out(g, 0.25);
    const r = src(white, t, dur, t);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 4;
    const rg = ac.createGain();
    env(rg, t, 0.02, dur - 0.06, 0.04, gain * 0.25);
    r.connect(bp).connect(rg);
    out(rg, 0.2);
    o.start(t);
    o.stop(t + dur + 0.02);
    am.start(t);
    am.stop(t + dur + 0.02);
  };

  // ---- the score, cue by cue ----
  pad(0, 17.5, [55, 82.4, 110], 0.05, 2.5, 1.5);
  bed(0, 4.4, 0.05, 'lowpass', 260); // quiet room, distant city
  tick(1.5, 0.45, 1900); // the tap
  thump(1.52, 0.18, 90);
  whoosh(1.85, 1.0, 0.22, [900, 4200, 2600], [0, 0.2]); // burst into light
  pad(1.9, 3.6, [880, 1318.5, 1760], 0.035, 0.05, 1.2);
  tick(3.05, 0.22, 2600, 0.4); // through the router
  tick(3.13, 0.16, 3400, 0.45);
  whoosh(3.5, 1.4, 0.5, [300, 1600, 500], [0.3, -0.2], 0.25); // out of the window
  bed(4.3, 10.4, 0.11, 'lowpass', 380, 0.7, 0.2); // city rumble
  bed(4.6, 10.4, 0.07, 'bandpass', 1500, 0.8); // wind of speed
  whoosh(6.75, 0.9, 0.28, [400, 2200, 600], [-0.5, 0.5]); // first turn
  whoosh(7.4, 0.9, 0.28, [500, 2400, 700], [0.5, -0.4]); // second turn
  whoosh(9.2, 1.3, 0.38, [300, 1200, 250], [0, 0], 0.3); // drop toward the harbour
  // the dive
  {
    const splash = src(white, 10.38, 0.6, 1.1);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ac.createGain();
    env(g, 10.38, 0.01, 0.05, 0.5, 0.28);
    splash.connect(hp).connect(g);
    out(g, 0.5);
  }
  thump(10.4, 0.35, 120);
  bed(10.45, 17.5, 0.2, 'lowpass', 140, 0.9, 0.12); // ocean rumble
  bed(10.45, 17.5, 0.05, 'bandpass', 600, 1.2, 0.3); // muffled water movement
  whoosh(11.4, 3.2, 0.3, [90, 420, 160], [-0.6, 0.4], 0.25); // along the cable
  whoosh(14.2, 3.0, 0.3, [110, 520, 180], [0.4, -0.5], 0.25);
  whoosh(16.6, 1.1, 0.4, [200, 3000, 6000], [0, 0]); // riser into the tunnel flash
  thump(17.6, 0.3, 140);
  // data center
  hum(17.6, 23.0, 0.12);
  whoosh(17.7, 1.6, 0.22, [700, 2400, 900], [-0.2, 0.2]);
  for (let i = 0; i < 9; i++) tick(20.5 + i * 0.08, 0.09, 2600 + (i % 3) * 400, -0.3 + (i % 5) * 0.15); // processing
  whoosh(21.4, 1.65, 0.5, [150, 2500, 8000], [0, 0], 0.2); // up and out
  thump(23.0, 0.35, 100);
  // space
  pad(23.0, 28.6, [41.2, 61.7, 82.4, 123.5], 0.13, 0.6, 0.6);
  bed(23.0, 28.6, 0.03, 'highpass', 5000); // air
  whoosh(23.4, 4.6, 0.22, [200, 900, 300], [-0.8, 0.8], 0, 0.6); // the arc
  whoosh(27.6, 1.0, 0.4, [300, 3500, 7000], [0.2, 0], 0.2); // dive home
  thump(28.6, 0.22, 90);
  // bedroom
  bed(28.6, 34, 0.035, 'lowpass', 300);
  tick(29.2, 0.25, 1600);
  for (const [a, b] of buzzWindows) buzz(a, b - a, 0.5);
  pad(31.0, 34.0, [146.8, 220, 293.7, 440], 0.09, 1.2, 1.6); // resolve

  return ac.startRendering();
}

/** 32-bit float WAV, interleaved stereo. */
export function toWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const outBuf = new ArrayBuffer(44 + n * ch * 4);
  const v = new DataView(outBuf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 4, true);
  v.setUint16(32, ch * 4, true);
  v.setUint16(34, 32, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 4, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { v.setFloat32(o, chans[c][i], true); o += 4; }
  return outBuf;
}
