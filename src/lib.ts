import * as THREE from 'three';

export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const DURATION = 34;
export const FRAMES = FPS * DURATION;

/** The one particle of light we follow: white-hot core, cyan halo. */
export const LIGHT = new THREE.Color(0x59d8ff);

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
/** Rises over [a, a+fi], holds, falls over [b-fo, b]. */
export const window01 = (t: number, a: number, b: number, fi = 0.4, fo = 0.4) =>
  smooth(ramp(t, a, a + fi)) * (1 - smooth(ramp(t, b - fo, b)));

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Monotone cubic interpolation (no overshoot) over keyframes. */
export function monotone(ts: number[], vs: number[]): (t: number) => number {
  const n = ts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] > 0) {
      const w1 = 2 * (ts[i + 1] - ts[i]) + (ts[i] - ts[i - 1]);
      const w2 = ts[i + 1] - ts[i] + 2 * (ts[i] - ts[i - 1]);
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

export type V3 = [number, number, number];
export interface CamKey { t: number; p: V3; l: V3; fov?: number }

/** Camera track: position and look-at target interpolated per component. */
export function track(keys: CamKey[]) {
  const ts = keys.map((k) => k.t);
  const f = (sel: (k: CamKey) => number) => monotone(ts, keys.map(sel));
  const px = f((k) => k.p[0]), py = f((k) => k.p[1]), pz = f((k) => k.p[2]);
  const lx = f((k) => k.l[0]), ly = f((k) => k.l[1]), lz = f((k) => k.l[2]);
  const fov = f((k) => k.fov ?? 40);
  return (t: number) => ({
    p: new THREE.Vector3(px(t), py(t), pz(t)),
    l: new THREE.Vector3(lx(t), ly(t), lz(t)),
    fov: fov(t),
  });
}

/**
 * A path through space timed per control point: the curve passes point i at times[i], and speed
 * between points follows a monotone spline of arc length, so it never stalls or reverses.
 */
export function flight(points: V3[], times: number[]) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const K = 40;
  const lengths = curve.getLengths((points.length - 1) * K);
  const total = lengths[lengths.length - 1];
  const us = points.map((_, i) => lengths[i * K] / total);
  const u = monotone(times, us);
  const at = (t: number) => curve.getPointAt(clamp(u(t)));
  /** Point a fixed distance (metres) behind or ahead of the particle at time t. */
  const offset = (t: number, metres: number) => curve.getPointAt(clamp(u(t) + metres / total));
  return { curve, u, at, offset, total };
}

/** Radial glow sprite texture. */
export function glowTexture(size = 128, falloff = 2.2): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(clamp(1 - r), falloff);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const GLOW = { tex: null as THREE.Texture | null };
export function sharedGlow() {
  GLOW.tex ??= glowTexture(128, 2.4);
  return GLOW.tex;
}

/**
 * The message as light: a hot core, a coloured halo, a trail sampled from its own past
 * positions (so it is a pure function of time), and a point light that lights its surroundings.
 */
export class Particle {
  group = new THREE.Group();
  core: THREE.Sprite;
  halo: THREE.Sprite;
  light: THREE.PointLight;
  trail: THREE.Points;
  private trailPos: Float32Array;
  readonly n: number;

  constructor(opts: { size: number; trail: number; lightIntensity: number; lightDistance: number; trailSize?: number }) {
    const tex = sharedGlow();
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(14), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, fog: false,
    }));
    this.core.scale.setScalar(opts.size);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: LIGHT.clone().multiplyScalar(3.2), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, fog: false,
    }));
    this.halo.scale.setScalar(opts.size * 6);
    this.light = new THREE.PointLight(LIGHT, opts.lightIntensity, opts.lightDistance, 2);
    this.group.add(this.core, this.halo, this.light);

    this.n = opts.trail;
    this.trailPos = new Float32Array(this.n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const a = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) a[i] = i / (this.n - 1);
    geo.setAttribute('age', new THREE.BufferAttribute(a, 1));
    this.trail = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: (opts.trailSize ?? opts.size) * 520 },
        uColor: { value: LIGHT.clone().multiplyScalar(2.2) },
        uMap: { value: tex },
        uAlpha: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float age; varying float vAge; uniform float uSize;
        void main() {
          vAge = age;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * pow(1.0 - age, 1.4) / max(-mv.z, 0.001);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform sampler2D uMap; uniform float uAlpha; varying float vAge;
        void main() {
          float g = texture2D(uMap, gl_PointCoord).a;
          vec3 c = mix(vec3(1.0) * 3.0, uColor, smoothstep(0.0, 0.25, vAge));
          gl_FragColor = vec4(c * g * pow(1.0 - vAge, 1.2) * uAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.trail.frustumCulled = false;
  }

  /** Place the particle at path(t) and lay the trail along path(t - k·dt). */
  update(path: (t: number) => THREE.Vector3, t: number, dt: number, visible = 1) {
    const p = path(t);
    this.group.position.copy(p);
    for (let i = 0; i < this.n; i++) {
      const q = path(t - i * dt);
      this.trailPos[i * 3] = q.x;
      this.trailPos[i * 3 + 1] = q.y;
      this.trailPos[i * 3 + 2] = q.z;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.group.visible = this.trail.visible = visible > 0.001;
    (this.core.material as THREE.SpriteMaterial).opacity = visible;
    (this.halo.material as THREE.SpriteMaterial).opacity = visible;
    (this.trail.material as THREE.ShaderMaterial).uniforms.uAlpha.value = visible;
    return p;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group, this.trail);
  }
}

/** Everything a set hands to the renderer for one frame. */
export interface Shot {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  focus: number; // metres
  aperture: number; // max blur, px at 1080p
  bloom: number;
  bloomRadius?: number;
  exposure: number;
  flash?: number; // whiteout 0..1
  fade?: number; // to black 0..1
}

export interface FilmSet {
  start: number;
  end: number;
  frame(t: number): Shot;
}

export function aimCamera(cam: THREE.PerspectiveCamera, p: THREE.Vector3, l: THREE.Vector3, fov: number, roll = 0) {
  cam.position.copy(p);
  cam.up.set(Math.sin(roll), Math.cos(roll), 0);
  cam.lookAt(l);
  if (cam.fov !== fov) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
}
