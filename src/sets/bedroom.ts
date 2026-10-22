// Set 4 (28.6 – 34.0 s): a dark bedroom on the other side of the world. Moonlight through blinds.
// The light streaks in, the phone on the nightstand wakes, shows the message and buzzes.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  Particle, aimCamera, flight, hash, mulberry32, ramp, sharedGlow, smooth, track,
  type FilmSet, type Shot,
} from '../lib';
import { Phone } from '../phone';
import { buzzWindows } from '../timing';

export const BED_START = 28.6;
export const BED_END = 34.0;
const STAND_Y = 0.58;

export function bedroomSet(): FilmSet {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020308);
  scene.fog = new THREE.FogExp2(0x05070f, 0.08);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 60);

  const wall = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.95 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // room 4.2 × 2.7 × 4.4; the window is in the -x wall
  add(new THREE.BoxGeometry(4.2, 0.05, 4.4), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.7 }), 0, -0.025, 0, false);
  add(new THREE.BoxGeometry(4.2, 0.05, 4.4), wall, 0, 2.72, 0, false);
  add(new THREE.BoxGeometry(4.2, 2.7, 0.05), wall, 0, 1.35, -2.2, false);
  add(new THREE.BoxGeometry(4.2, 2.7, 0.05), wall, 0, 1.35, 2.2, false);
  add(new THREE.BoxGeometry(0.05, 2.7, 4.4), wall, 2.1, 1.35, 0, false);
  // window wall with an opening
  for (const [h, y, d, z] of [[0.8, 0.4, 4.4, 0], [0.62, 2.39, 4.4, 0], [1.28, 1.44, 1.5, -1.45], [1.28, 1.44, 1.5, 1.45]] as const) {
    add(new THREE.BoxGeometry(0.12, h, d), wall, -2.1, y, z);
  }
  // blinds: slats in the opening, slightly open
  const slatMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.6 });
  for (let i = 0; i < 26; i++) {
    const s = add(new THREE.BoxGeometry(0.035, 0.004, 1.42), slatMat, -2.06, 0.82 + i * 0.049, 0);
    s.rotation.z = 0.5;
  }

  // bed (to the right), nightstand, lamp, book, glass
  const linen = new THREE.MeshStandardMaterial({ color: 0x5c6273, roughness: 0.95 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: 0.6 });
  add(new THREE.BoxGeometry(1.7, 0.32, 2.1), frame, 0.95, 0.16, 0.7);
  add(new RoundedBoxGeometry(1.64, 0.22, 2.0, 4, 0.08), linen, 0.95, 0.42, 0.72);
  add(new RoundedBoxGeometry(0.62, 0.14, 0.4, 4, 0.06), new THREE.MeshStandardMaterial({ color: 0x6c7282, roughness: 0.95 }), 0.55, 0.6, -0.15);
  add(new RoundedBoxGeometry(0.62, 0.14, 0.4, 4, 0.06), new THREE.MeshStandardMaterial({ color: 0x6c7282, roughness: 0.95 }), 1.3, 0.6, -0.15);
  const duvet = add(new RoundedBoxGeometry(1.72, 0.12, 1.3, 4, 0.05), new THREE.MeshStandardMaterial({ color: 0x3c4a6a, roughness: 0.9 }), 0.95, 0.56, 1.0);
  duvet.rotation.x = 0.02;
  add(new THREE.BoxGeometry(1.8, 1.0, 0.08), frame, 0.95, 0.75, -0.42);

  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.82 });
  add(new THREE.BoxGeometry(0.5, STAND_Y, 0.42), wood, -0.35, STAND_Y / 2, -0.2);
  add(new THREE.BoxGeometry(0.44, 0.005, 0.005), new THREE.MeshStandardMaterial({ color: 0x0a0705 }), -0.35, STAND_Y - 0.17, 0.011 + 0.0);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xd9cbb3, roughness: 0.8, side: THREE.DoubleSide });
  add(new THREE.CylinderGeometry(0.05, 0.07, 0.03, 32), frame, -0.5, STAND_Y + 0.015, -0.3);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 12), frame, -0.5, STAND_Y + 0.17, -0.3);
  add(new THREE.CylinderGeometry(0.09, 0.14, 0.16, 40, 1, true), lampMat, -0.5, STAND_Y + 0.36, -0.3);
  const book = add(new THREE.BoxGeometry(0.15, 0.025, 0.22), new THREE.MeshStandardMaterial({ color: 0x1d2433, roughness: 0.8 }), -0.22, STAND_Y + 0.0125, -0.32);
  book.rotation.y = -0.3;
  // moonlight through the blinds
  const moon = new THREE.DirectionalLight(0x8fb0ff, 1.25);
  moon.position.set(-6, 3.4, 1.2);
  moon.target.position.set(0.4, 0.4, 0.2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera as THREE.OrthographicCamera;
  sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 1; sc.far = 14;
  moon.shadow.bias = -0.0004;
  scene.add(moon, moon.target);
  scene.add(new THREE.HemisphereLight(0x3a4a70, 0x0a0806, 0.22));

  // volumetric shaft: stacked additive sheets along the moonlight direction, striped by the slats
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vW;
      void main(){
        // project back along the light to the window plane, test against the slat gaps
        vec3 L = normalize(vec3(-6.0, 3.4, 1.2) - vec3(0.4, 0.4, 0.2));
        float k = (-2.06 - vW.x) / L.x;
        vec3 w = vW + L * k;
        float inWin = step(abs(w.z), 0.7) * step(0.82, w.y) * step(w.y, 2.08);
        float gap = smoothstep(0.25, 0.55, fract((w.y - 0.82) / 0.049));
        float along = clamp((vW.x + 2.06) / 2.6, 0.0, 1.0);
        float a = inWin * gap * pow(1.0 - along, 1.5) * 0.012;
        gl_FragColor = vec4(vec3(0.55, 0.68, 1.0) * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 14; i++) {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), shaftMat);
    sheet.position.set(-0.6, 1.2, -0.7 + i * 0.1);
    scene.add(sheet);
  }
  // dust in the moonlight
  const rnd = mulberry32(17);
  const dust: number[] = [];
  for (let i = 0; i < 900; i++) dust.push(-2 + rnd() * 2.2, 0.2 + rnd() * 2.2, -0.9 + rnd() * 1.8);
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: sharedGlow() } },
    vertexShader: `uniform float uTime; varying float vA; void main(){ vec3 p = position + vec3(sin(uTime*0.4 + position.y*5.0)*0.03, sin(uTime*0.3 + position.x*7.0)*0.04, 0.0);
      vec4 mv = modelViewMatrix * vec4(p,1.0); vA = 0.5 + 0.5 * sin(position.x * 40.0 + uTime); gl_PointSize = 7.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55,0.65,0.9) * texture2D(uMap, gl_PointCoord).a * vA * 0.5, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const dustPts = new THREE.Points(dg, dustMat);
  scene.add(dustPts);

  // the city outside, glimpsed between the slats (and blurred into bokeh by the lens)
  const sky = document.createElement('canvas');
  sky.width = 1024; sky.height = 640;
  const g = sky.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 640);
  grad.addColorStop(0, '#05081a'); grad.addColorStop(0.6, '#1a1530'); grad.addColorStop(1, '#2a1a24');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 640);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 1024, w = 30 + rnd() * 90, h = 120 + rnd() * 380;
    g.fillStyle = '#06070c'; g.fillRect(x, 640 - h, w, h);
    for (let wy = 640 - h + 8; wy < 630; wy += 14) for (let wx = x + 5; wx < x + w - 6; wx += 11) {
      if (rnd() < 0.35) { g.fillStyle = rnd() < 0.8 ? 'rgba(255,190,120,0.9)' : 'rgba(170,200,255,0.9)'; g.fillRect(wx, wy, 5, 7); }
    }
  }
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,60,60,0.9)'; g.beginPath(); g.arc(rnd() * 1024, 200 + rnd() * 200, 2.5, 0, 7); g.fill(); }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.6), new THREE.MeshBasicMaterial({ map: skyTex, color: new THREE.Color(1.5, 1.5, 1.5), fog: false }));
  outside.position.set(-6, 1.3, 0);
  outside.rotation.y = Math.PI / 2;
  scene.add(outside);

  // the phone, screen up on the nightstand
  const phone = new Phone('lock');
  const phoneBase = new THREE.Vector3(-0.3, STAND_Y + 0.0039, -0.12);
  phone.group.position.copy(phoneBase);
  phone.group.rotation.y = 0.35;
  phone.glow.distance = 2.2;
  phone.glow.decay = 1.6;
  scene.add(phone.group);

  // the light arrives through the blinds and dives into the phone
  const target = phoneBase.clone().add(new THREE.Vector3(0, 0.01, 0));
  const path = flight([
    [-3.4, 1.9, 0.6], [-2.06, 1.6, 0.3], [-1.2, 1.1, 0.1], [-0.5, 0.75, -0.05], [target.x, target.y + 0.02, target.z], [target.x, target.y, target.z],
  ], [BED_START - 0.3, 28.85, 28.98, 29.1, 29.2, 29.25]);
  const light = new Particle({ size: 0.03, trail: 60, lightIntensity: 2.5, lightDistance: 3, trailSize: 0.03 });
  (light.trail.material as THREE.ShaderMaterial).uniforms.uSize.value = 22;
  light.addTo(scene);

  const cam = track([
    { t: BED_START, p: [-1.3, 1.2, 1.25], l: [-0.6, 0.8, 0.0], fov: 46 },
    { t: 29.3, p: [-0.7, 0.86, 0.48], l: [-0.32, STAND_Y + 0.02, -0.12], fov: 40 },
    { t: 30.6, p: [-0.4, 0.74, 0.1], l: [-0.3, STAND_Y + 0.005, -0.12], fov: 36 },
    { t: 31.4, p: [-0.62, 0.86, 0.5], l: [-0.32, STAND_Y + 0.02, -0.12], fov: 40 },
    { t: 34.0, p: [-0.1, 0.98, 0.95], l: [-0.8, 0.78, -0.3], fov: 44 },
  ]);

  return {
    start: BED_START,
    end: BED_END,
    frame(t: number): Shot {
      const arrived = t > 29.22;
      const p = light.update(path.at, t, 0.005, arrived ? 0 : 1);
      // screen wakes, notification drops, phone buzzes
      const wake = smooth(ramp(t, 29.2, 29.45));
      phone.draw(t, 0.02 + 0.62 * wake);
      phone.glow.intensity = 0.18 * wake;
      let buzz = 0;
      for (const [a, b] of buzzWindows) buzz = Math.max(buzz, ramp(t, a, a + 0.03) * (1 - ramp(t, b - 0.05, b)));
      const f = Math.floor(t * 240);
      phone.group.position.set(phoneBase.x + (hash(f) - 0.5) * 0.0024 * buzz, phoneBase.y, phoneBase.z + (hash(f + 9) - 0.5) * 0.0024 * buzz);
      phone.group.rotation.y = 0.35 + (hash(f + 3) - 0.5) * 0.02 * buzz;
      shaftMat.uniforms.uTime.value = t;
      dustMat.uniforms.uTime.value = t;
      const k = cam(t);
      const shake = buzz * 0.0012;
      aimCamera(camera, k.p.clone().add(new THREE.Vector3((hash(f + 1) - 0.5) * shake, (hash(f + 2) - 0.5) * shake, 0)),
        k.l.clone().lerp(p, arrived ? 0 : 0.4), k.fov);
      const flashIn = 1 - smooth(ramp(t, BED_START, BED_START + 0.25));
      const impact = Math.exp(-Math.max(0, t - 29.22) * 9) * (t > 29.22 ? 1 : 0);
      return {
        scene, camera,
        focus: k.p.distanceTo(t < 29.15 ? p : phoneBase),
        aperture: 10,
        bloom: 0.8,
        exposure: 1.0 + impact * 0.5,
        flash: Math.max(flashIn, impact * 0.35),
        fade: smooth(ramp(t, 33.3, 34.0)),
      };
    },
  };
}

