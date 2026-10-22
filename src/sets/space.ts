// Set 3 (23.0 – 28.6 s): Earth at night from orbit. The light arcs from Europe to Japan.
// The night-lights texture is painted at runtime from GeoNames cities (population) and Natural
// Earth land outlines: real geography, vector data only, no images.

import * as THREE from 'three';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import land50 from 'world-atlas/land-50m.json';
import cities from '../data/cities.json';
import {
  LIGHT, Particle, aimCamera, clamp, easeInOut, mulberry32, ramp, smooth, track,
  type FilmSet, type Shot,
} from '../lib';

export const SPACE_START = 23.0;
export const SPACE_END = 28.6;
const R = 6.371; // 1 unit = 1,000 km

const FROM = { lat: 50.11, lon: 8.68 }; // Frankfurt
const TO = { lat: 35.68, lon: 139.69 }; // Tokyo

/** Lat/lon (degrees) → unit vector, matching three's SphereGeometry UVs (+y north, lon 0 at +x). */
function dir(lat: number, lon: number) {
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}

function paintTextures() {
  const Wt = 8192, Ht = 4096;
  const base = document.createElement('canvas');
  base.width = Wt; base.height = Ht;
  const b = base.getContext('2d')!;
  b.fillStyle = '#000000';
  b.fillRect(0, 0, Wt, Ht);
  const topo = land50 as unknown as Topology;
  const landGeo = feature(topo, topo.objects.land as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
  const px = (lon: number, lat: number): [number, number] => [((lon + 180) / 360) * Wt, ((90 - lat) / 180) * Ht];
  b.fillStyle = '#ffffff';
  for (const f of landGeo.features) {
    const g = f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      b.beginPath();
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const [x, y] = px(lon, lat);
          if (i === 0) b.moveTo(x, y); else b.lineTo(x, y);
        });
        b.closePath();
      }
      b.fill('evenodd');
    }
  }

  const lights = document.createElement('canvas');
  lights.width = Wt; lights.height = Ht;
  const l = lights.getContext('2d')!;
  l.fillStyle = '#000';
  l.fillRect(0, 0, Wt, Ht);
  l.globalCompositeOperation = 'lighter';
  const rnd = mulberry32(99);
  const dot = (x: number, y: number, r: number, a: number) => {
    const g = l.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255, 214, 150, ${a})`);
    g.addColorStop(0.35, `rgba(255, 170, 90, ${a * 0.45})`);
    g.addColorStop(1, 'rgba(255, 140, 60, 0)');
    l.fillStyle = g;
    l.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [lon, lat, pop] of cities as [number, number, number][]) {
    const [x, y] = px(lon, lat);
    const stretch = 1 / Math.max(0.2, Math.cos(THREE.MathUtils.degToRad(lat)));
    const r = 0.9 + 1.7 * Math.pow(pop / 1e5, 0.4);
    const a = Math.min(0.9, 0.18 + 0.12 * Math.log10(pop / 8000 + 1) * 2);
    l.save();
    l.translate(x, y);
    l.scale(stretch, 1);
    dot(0, 0, r, a);
    // suburban sprawl around larger places
    const n = Math.min(40, Math.floor(pop / 60000));
    for (let k = 0; k < n; k++) {
      const ang = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6) * r * 4;
      dot(Math.cos(ang) * d, Math.sin(ang) * d, 1.2 + rnd() * 1.6, 0.12 + rnd() * 0.12);
    }
    l.restore();
  }
  const baseTex = new THREE.CanvasTexture(base);
  const lightTex = new THREE.CanvasTexture(lights);
  for (const t of [baseTex, lightTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { baseTex, lightTex };
}

const noiseGLSL = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }
`;

const SUN = new THREE.Vector3();

export async function spaceSet(): Promise<FilmSet> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 400);
  const { baseTex, lightTex } = paintTextures();

  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 128), new THREE.ShaderMaterial({
    uniforms: { tBase: { value: baseTex }, tLights: { value: lightTex }, uSun: { value: new THREE.Vector3() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vP;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position);
        vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tBase, tLights; uniform vec3 uSun; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vP;
      ${noiseGLSL}
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
        float land = texture2D(tBase, vUv).r;
        vec3 lights = texture2D(tLights, vUv).rgb;
        float clouds = smoothstep(0.52, 0.78, fbm3(vP * 5.0 + vec3(0.0, 0.0, uTime * 0.01)));
        float day = smoothstep(-0.12, 0.25, dot(n, uSun));
        // moonlit night surface: oceans near black, land a touch lighter, clouds faintly grey
        vec3 c = mix(vec3(0.002, 0.004, 0.01), vec3(0.006, 0.008, 0.012), land);
        c += vec3(0.012, 0.014, 0.02) * clouds;
        c += lights * 1.7 * (1.0 - clouds * 0.65) * (1.0 - day);
        // the sliver of dawn on the far side
        c += (vec3(0.06, 0.12, 0.3) + vec3(0.1, 0.09, 0.07) * land + vec3(0.35) * clouds) * day;
        // atmospheric scattering toward the limb
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        c += vec3(0.02, 0.06, 0.16) * pow(rim, 2.0) * 0.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(earth);

  const shell = (radius: number, frag: string) => new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: frag, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.BackSide,
  }));
  // atmosphere halo seen past the limb
  scene.add(shell(R * 1.022, /* glsl */ `
    uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
      float f = pow(clamp(1.0 + dot(n, v), 0.0, 1.0), 12.0);
      float sunSide = smoothstep(-0.2, 0.7, dot(-n, uSun));
      vec3 c = mix(vec3(0.05, 0.16, 0.5), vec3(0.95, 0.5, 0.25), sunSide * 0.5) * (0.5 + 2.5 * sunSide);
      gl_FragColor = vec4(c * f * 0.9, 1.0);
    }`));
  // a thin green airglow layer, as seen from the ISS
  scene.add(shell(R * 1.0145, /* glsl */ `
    varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
      float f = pow(clamp(1.0 + dot(n, v), 0.0, 1.0), 14.0);
      gl_FragColor = vec4(vec3(0.25, 0.6, 0.28) * f * 0.7, 1.0);
    }`));

  // stars, with a denser band suggesting the Milky Way
  const rnd = mulberry32(5);
  const N = 9000;
  const pos = new Float32Array(N * 3), mag = new Float32Array(N);
  const band = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
  for (let i = 0; i < N; i++) {
    let v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    if (i % 2 === 0) v.addScaledVector(band, -v.dot(band) * (0.85 + rnd() * 0.15)).normalize();
    v = v.multiplyScalar(300);
    pos.set([v.x, v.y, v.z], i * 3);
    mag[i] = Math.pow(rnd(), 6);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  scene.add(new THREE.Points(sg, new THREE.ShaderMaterial({
    vertexShader: `attribute float mag; varying float vM; void main(){ vM = mag; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 1.2 + mag * 3.5; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vM; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * a * (0.25 + vM * 2.5), 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  })));

  // the arc: great circle from Frankfurt to Tokyo, lifted above the surface
  const a = dir(FROM.lat, FROM.lon), b = dir(TO.lat, TO.lon);
  // sun almost directly behind the Earth from where we look: only a thin dawn shows at the limb
  const midDir = a.clone().add(b).normalize();
  const sun = midDir.clone().negate().add(new THREE.Vector3(0.0, -0.18, 0.0)).add(new THREE.Vector3().crossVectors(midDir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.32)).normalize();
  SUN.copy(sun);
  (earth.material as THREE.ShaderMaterial).uniforms.uSun.value = SUN;
  const omega = a.angleTo(b);
  const arc = (s: number) => {
    s = clamp(s);
    const d = a.clone().multiplyScalar(Math.sin((1 - s) * omega)).add(b.clone().multiplyScalar(Math.sin(s * omega))).divideScalar(Math.sin(omega));
    return d.multiplyScalar(R + 0.12 + 0.95 * Math.sin(Math.PI * s));
  };
  const sOf = (t: number) => easeInOut(ramp(t, SPACE_START - 0.2, 28.45));
  const path = (t: number) => arc(sOf(t));
  const light = new Particle({ size: 0.05, trail: 160, lightIntensity: 0, lightDistance: 1, trailSize: 0.05 });
  (light.trail.material as THREE.ShaderMaterial).uniforms.uSize.value = 9;
  light.addTo(scene);
  // the full route, faintly drawn ahead of and behind the light
  const routePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 400; i++) routePts.push(arc(i / 400));
  const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePts), new THREE.LineBasicMaterial({
    color: LIGHT.clone().multiplyScalar(0.5), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(route);

  // camera: low over Europe looking east along the route → pull back to see the whole arc → follow it down to Japan
  const up = (v: THREE.Vector3, h: number) => v.clone().normalize().multiplyScalar(R + h);
  const mid = arc(0.5);
  const keys = track([
    { t: SPACE_START, p: up(arc(0.0).clone().lerp(dir(44, -6), 0.4), 0.55).toArray(), l: arc(0.08).toArray(), fov: 60 },
    { t: 24.6, p: up(dir(46, 2), 1.3).toArray(), l: arc(0.22).toArray(), fov: 55 },
    { t: 26.2, p: mid.clone().normalize().multiplyScalar(R * 2.55).add(new THREE.Vector3(0, -2.5, 0)).toArray(), l: mid.clone().multiplyScalar(0.75).toArray(), fov: 46 },
    { t: 27.5, p: up(dir(30, 118), 3.2).toArray(), l: arc(0.93).toArray(), fov: 46 },
    { t: 28.6, p: up(dir(35.2, 139.0), 0.35).toArray(), l: dir(35.68, 139.69).multiplyScalar(R).toArray(), fov: 50 },
  ]);

  return {
    start: SPACE_START,
    end: SPACE_END,
    frame(t: number): Shot {
      const p = light.update(path, t, 0.008);
      light.core.scale.setScalar(0.06);
      light.halo.scale.setScalar(0.42);
      (earth.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      const k = keys(t);
      const look = k.l.clone().lerp(p, 0.35);
      aimCamera(camera, k.p, look, k.fov);
      // keep the near plane tight when we are close to the surface
      const alt = k.p.length() - R;
      camera.near = clamp(alt * 0.05, 0.002, 0.2);
      camera.updateProjectionMatrix();
      return {
        scene, camera,
        focus: k.p.distanceTo(p), aperture: 1.2, bloom: 0.7, bloomRadius: 0.35,
        exposure: 1.15,
        flash: Math.max(1 - smooth(ramp(t, SPACE_START, SPACE_START + 0.45)), smooth(ramp(t, 28.25, 28.6))),
      };
    },
  };
}

