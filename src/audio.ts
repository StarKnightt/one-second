// The whole soundtrack is synthesized in Web Audio and rendered offline, so it is
// sample-identical on every run. No audio files anywhere.

import { DURATION } from './util';
import { buzzWindows } from './world';

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
  master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  master.connect(comp).connect(ac.destination);

  const rnd = mulberry32(20261021);
  const noise = ac.createBuffer(1, SAMPLE_RATE * 4, SAMPLE_RATE);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
  // pink-ish noise for the whoosh (softer than white)
  const pink = ac.createBuffer(1, SAMPLE_RATE * 8, SAMPLE_RATE);
  const pd = pink.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < pd.length; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    pd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }

  const noiseSrc = (buf: AudioBuffer, t: number, dur: number, offset = 0) => {
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(t, offset % buf.duration, dur);
    return s;
  };

  /** Soft UI tick: a short sine ping plus a tiny filtered click. */
  const tick = (t: number, gain: number, freq = 2400, pan = 0) => {
    const p = ac.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.08);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.12);
    const n = noiseSrc(noise, t, 0.02, t * 1.7);
    const hp = ac.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 5200;
    hp.Q.value = 1.5;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(gain * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(hp).connect(ng).connect(p);
  };

  /** Filtered-noise whoosh with a moving band and a stereo sweep. */
  const whoosh = (t: number, dur: number, gain: number, f: [number, number, number], pan: [number, number], q = 1.4) => {
    const n = noiseSrc(pink, t, dur + 0.05, t * 0.9);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f[0], t);
    bp.frequency.exponentialRampToValueAtTime(f[1], t + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(f[2], t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(gain * 0.6, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ac.createStereoPanner();
    p.pan.setValueAtTime(pan[0], t);
    p.pan.linearRampToValueAtTime(pan[1], t + dur);
    n.connect(bp).connect(g).connect(p).connect(master);
  };

  /** Shimmer: a quiet glassy glide riding on the fiber whoosh. */
  const shimmer = (t: number, dur: number, gain: number) => {
    for (const [f0, f1, det] of [[1320, 1760, -4], [1980, 2640, 5]] as const) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.detune.value = det;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  };

  /** Data-center hum: mains-like fundamental, harmonics, fan noise. */
  const hum = (t0: number, t1: number, gain: number) => {
    const bus = ac.createGain();
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(gain, t0 + 0.9);
    bus.gain.setValueAtTime(gain, t1 - 1.1);
    bus.gain.linearRampToValueAtTime(0, t1);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    bus.connect(lp).connect(master);
    for (const [f, a] of [[60, 1], [120, 0.55], [180, 0.3], [240, 0.18], [360, 0.08]] as const) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.value = a * 0.5;
      o.connect(g).connect(bus);
      o.start(t0);
      o.stop(t1 + 0.05);
    }
    // slow beating
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.7;
    const lg = ac.createGain();
    lg.gain.value = gain * 0.25;
    lfo.connect(lg).connect(bus.gain);
    lfo.start(t0);
    lfo.stop(t1);
    // fan air
    const n = noiseSrc(pink, t0, t1 - t0, 2.3);
    const nb = ac.createBiquadFilter();
    nb.type = 'lowpass';
    nb.frequency.value = 1400;
    const ng = ac.createGain();
    ng.gain.value = 0.5;
    n.connect(nb).connect(ng).connect(bus);
  };

  /** Phone vibration: ~170 Hz motor, rough harmonics, slight chassis rattle. */
  const buzz = (t: number, dur: number, gain: number) => {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(165, t);
    o.frequency.linearRampToValueAtTime(175, t + 0.08);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 2;
    const am = ac.createOscillator();
    am.frequency.value = 28;
    const amg = ac.createGain();
    amg.gain.value = 0.25;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.setValueAtTime(gain, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur);
    am.connect(amg).connect(g.gain);
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
    am.start(t);
    am.stop(t + dur + 0.02);
  };

  /** Low bed under everything so the cut between sounds is never dead air. */
  const bed = () => {
    const bus = ac.createGain();
    bus.gain.setValueAtTime(0, 0);
    bus.gain.linearRampToValueAtTime(0.05, 2.5);
    bus.gain.setValueAtTime(0.05, DURATION - 3);
    bus.gain.linearRampToValueAtTime(0, DURATION - 0.1);
    bus.connect(master);
    for (const [f, a] of [[73.42, 0.6], [110, 0.45], [164.8, 0.22]] as const) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.value = a;
      o.connect(g).connect(bus);
      o.start(0);
      o.stop(DURATION);
    }
  };

  /** Resolving tone for the end card. */
  const chime = (t: number) => {
    for (const [f, a] of [[587.33, 0.12], [880, 0.08], [1318.5, 0.04]] as const) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 2.7);
    }
  };

  bed();
  // 01 tap
  tick(1.6, 0.5, 2200);
  // message leaves the phone
  whoosh(3.85, 1.1, 0.25, [500, 1800, 900], [-0.4, 0.3], 1.0);
  // 02 split into packets
  tick(5.25, 0.22, 3100, 0.1);
  tick(5.5, 0.2, 3100, 0.2);
  tick(5.75, 0.18, 3100, 0.3);
  // 03 dns query + answer
  tick(9.5, 0.16, 1800, -0.2);
  tick(10.75, 0.26, 2600, 0.1);
  // 04 wi-fi crossing and router
  whoosh(11.5, 1.8, 0.08, [1500, 3000, 2000], [-0.3, 0.3], 2);
  tick(13.2, 0.2, 2000, 0.1);
  // 05 ISP hops
  [14.85, 15.6, 16.35, 17.05].forEach((t, i) => tick(t, 0.12, 1600 + i * 120, -0.3 + i * 0.2));
  // 06 undersea fiber: long whoosh as the light runs through glass
  whoosh(18.6, 4.0, 0.55, [180, 1400, 600], [-0.7, 0.4]);
  whoosh(21.6, 4.6, 0.5, [600, 3200, 900], [0.4, -0.2], 0.9);
  shimmer(21.8, 3.6, 0.03);
  whoosh(25.0, 1.6, 0.3, [2000, 500, 250], [-0.2, 0.6]);
  // 07 data center
  hum(26.6, 31.9, 0.22);
  [27.95, 28.5, 29.05, 29.6].forEach((t) => tick(t, 0.13, 2900, 0.2));
  // back across the world
  whoosh(31.4, 3.2, 0.32, [250, 1800, 700], [-0.6, 0.7]);
  // 08 buzz
  for (const [a, b] of buzzWindows) buzz(a, b - a, 0.55);
  chime(38.2);

  return ac.startRendering();
}

/** 32-bit float WAV, interleaved stereo. */
export function toWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new ArrayBuffer(44 + n * ch * 4);
  const v = new DataView(out);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // IEEE float
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
  return out;
}
