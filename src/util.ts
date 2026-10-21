export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const DURATION = 40;
export const FRAMES = FPS * DURATION;

export const C = {
  bg: '#071022',
  bgLift: '#0a1429',
  line: 'rgba(196, 214, 240, 0.62)',
  dim: 'rgba(196, 214, 240, 0.26)',
  faint: 'rgba(196, 214, 240, 0.10)',
  text: '#e9eff8',
  muted: 'rgba(214, 226, 244, 0.66)',
  accent: '#ff8a3d',
  accentSoft: 'rgba(255, 138, 61, 0.35)',
  accentFaint: 'rgba(255, 138, 61, 0.12)',
};

export const SANS = 'Inter, system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 before a, 1 after b, linear between. */
export const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
/** Eased 0..1 window. */
export const win = (t: number, a: number, b: number) => easeInOut(ramp(t, a, b));

/** Deterministic hash noise in [0, 1). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Monotone cubic (Fritsch–Carlson) interpolation over keyframes.
 * Smooth (C1) motion with no overshoot, so the camera never wobbles past a target.
 */
export function monotone(ts: number[], vs: number[]): (t: number) => number {
  const n = ts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * (ts[i + 1] - ts[i]) + (ts[i] - ts[i - 1]);
      const w2 = (ts[i + 1] - ts[i]) + 2 * (ts[i] - ts[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (t: number) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const s = (t - ts[i]) / h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m[i] +
      (-2 * s3 + 3 * s2) * vs[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

/** Piecewise-linear lookup. */
export function piecewise(ts: number[], vs: number[]): (t: number) => number {
  return (t: number) => {
    if (t <= ts[0]) return vs[0];
    for (let i = 0; i < ts.length - 1; i++) {
      if (t <= ts[i + 1]) return lerp(vs[i], vs[i + 1], (t - ts[i]) / (ts[i + 1] - ts[i]));
    }
    return vs[vs.length - 1];
  };
}
