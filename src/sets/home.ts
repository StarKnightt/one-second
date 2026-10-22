// Set 1 (0 – 17.6 s): a dark room → out of the window → across a city at night → into the harbour →
// along an undersea cable on the sea floor → into the landing tunnel. One world, one camera.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  LIGHT, Particle, aimCamera, clamp, easeInOut, flight, hash, lerp, mulberry32, ramp, sharedGlow, smooth,
  track, window01, type FilmSet, type Shot, type V3,
} from '../lib';
import { Phone, makeThumb } from '../phone';

export const HOME_START = 0;
export const HOME_END = 17.6;

const ROOM_FLOOR = 40;
const DESK_Y = 40.74;
const STREET = 72;
const QUAY_Z = -462;
const SEA_Y = -2;

// ---- noise ---------------------------------------------------------------------------------

function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => hash(a * 157.31 + b * 311.7);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
function fbm(x: number, y: number) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
}

/** Sea floor height: a shelf dropping off the quay, an undulating plain, rising to the tunnel. */
export function seabedY(x: number, z: number) {
  const shelf = lerp(-5, -34, smooth(ramp(-z, 470, 640)));
  const dunes = 2.2 * Math.sin(z / 23 + x / 31) + 3.5 * (fbm(x / 40, z / 40) - 0.5) * 2;
  const rise = lerp(0, 9, smooth(ramp(-z, -TUNNEL_Z - 60, -TUNNEL_Z)));
  // rocky outcrops, kept clear of the cable's line
  const clear = ramp(Math.abs(x - cableX(z)), 4, 14);
  const outcrop = 7 * Math.max(0, fbm(x / 18 + 3, z / 18) - 0.5) * clear;
  return shelf + (dunes + outcrop) * smooth(ramp(-z, 520, 640)) + rise;
}
const cableX = (z: number) => 72 + 1.4 * Math.sin(z / 37);
const cableY = (z: number) => seabedY(cableX(z), z) + 0.36;

// ---- shaders -------------------------------------------------------------------------------

const buildingMaterial = () => new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uPL: { value: new THREE.Vector3() }, uPLc: { value: new THREE.Color() },
  }]),
  fog: true,
  vertexShader: /* glsl */ `
    attribute float seed;
    varying vec3 vW; varying vec3 vN; varying float vSeed;
    #include <fog_pars_vertex>
    void main() {
      mat4 m = modelMatrix;
      #ifdef USE_INSTANCING
        m = modelMatrix * instanceMatrix;
      #endif
      vec4 wp = m * vec4(position, 1.0);
      vW = wp.xyz; vN = normalize(mat3(m) * normal); vSeed = seed;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uPL; uniform vec3 uPLc;
    varying vec3 vW; varying vec3 vN; varying float vSeed;
    #include <fog_pars_fragment>
    // sin-free hash: stable even for large inputs
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 n = normalize(vN);
      float seed = floor(vSeed + 0.5);
      vec3 base = vec3(0.007, 0.008, 0.012);
      vec3 col = base;
      if (n.y < 0.5) {
        vec2 f = abs(n.x) > 0.5 ? vW.zy : vW.xy;
        vec2 cell = vec2(f.x / 2.9, (vW.y - 0.6) / 3.3);
        vec2 id = floor(cell); vec2 g = fract(cell);
        // anti-aliased window mask; far away it melts into its average instead of shimmering
        vec2 fw = fwidth(cell);
        vec2 aa = clamp(fw * 1.5, 0.001, 0.5);
        vec2 wm = smoothstep(vec2(0.16, 0.22) - aa, vec2(0.16, 0.22) + aa, g) * (1.0 - smoothstep(vec2(0.84, 0.86) - aa, vec2(0.84, 0.86) + aa, g));
        float far = smoothstep(0.25, 0.6, max(fw.x, fw.y));
        float win = mix(wm.x * wm.y, 0.45, far);
        float r = h(id + seed * 13.7);
        float lit = mix(step(0.58, r), 0.42, far);
        vec3 warm = vec3(1.0, 0.66, 0.36), cool = vec3(0.62, 0.78, 1.0);
        vec3 wc = mix(warm, cool, step(0.82, h(id * 1.7 + seed)));
        float level = 0.22 + 0.85 * pow(h(id * 3.1 + seed * 2.0), 2.0);
        vec3 glass = vec3(0.006, 0.008, 0.013) * (0.6 + 0.8 * h(id * 0.7 + seed));
        col = mix(base, glass + wc * lit * level, win);
        // shop fronts glow at street level
        if (vW.y < 4.2) col = mix(base, wc * 0.9, step(0.45, h(vec2(floor(f.x / 6.0), seed))) * step(0.6, vW.y) * win);
        // facade picks up a little light from below (street glow)
        col += vec3(0.014, 0.009, 0.005) * exp(-vW.y * 0.1);
      } else {
        col = vec3(0.008, 0.009, 0.012);
      }
      vec3 L = uPL - vW; float d = length(L);
      col += vec3(0.02) * uPLc * max(dot(n, L / d), 0.0) / (1.0 + d * d * 0.05);
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    }`,
});

function skyDome() {
  return new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        float y = vD.y;
        vec3 horizon = vec3(0.16, 0.09, 0.15), mid = vec3(0.045, 0.04, 0.09), top = vec3(0.008, 0.012, 0.03);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.12, y));
        c = mix(c, top, smoothstep(0.1, 0.6, y));
        c = mix(vec3(0.05,0.035,0.06), c, smoothstep(-0.05, 0.0, y));
        vec3 q = floor(vD * 900.0);
        float s = step(0.9975, h(q)) * smoothstep(0.08, 0.4, y);
        c += vec3(0.9, 0.95, 1.0) * s * 1.2;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
}

/** Additive glow points (street lamp heads, bridge lights, far-shore lights). */
function glowPoints(positions: number[], color: THREE.Color, size: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMap: { value: sharedGlow() }, uColor: { value: color }, uSize: { value: size },
    }]),
    fog: true,
    vertexShader: /* glsl */ `
      uniform float uSize;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uSize * 1080.0 / -mvPosition.z, 1.5, 120.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <fog_fragment>
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

// ---- builders -------------------------------------------------------------------------------

function buildRoom(scene: THREE.Scene) {
  const room = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.95 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8 });
  const facade = buildingMaterial();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material | THREE.Material[]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    room.add(mesh);
    return mesh;
  };
  const seedAttr = (mesh: THREE.Mesh, s: number) => {
    const n = mesh.geometry.attributes.position.count;
    mesh.geometry.setAttribute('seed', new THREE.Float32BufferAttribute(new Array(n).fill(s), 1));
  };
  // interior shell
  box(6, 0.1, 5.4, 0, ROOM_FLOOR - 0.05, 0, floor);
  box(6, 0.1, 5.4, 0, ROOM_FLOOR + 2.85, 0, wall);
  box(0.1, 2.8, 5.4, -3, ROOM_FLOOR + 1.4, 0, wall);
  box(0.1, 2.8, 5.4, 3, ROOM_FLOOR + 1.4, 0, wall);
  box(6, 2.8, 0.1, 0, ROOM_FLOOR + 1.4, 2.7, wall);
  // window wall: interior face dark, exterior face is the tower facade
  const mats = [wall, wall, wall, wall, wall, facade];
  const wy0 = ROOM_FLOOR + 0.85, wy1 = ROOM_FLOOR + 2.55, wx = 1.7;
  for (const m of [
    box(12, ROOM_FLOOR + 0.85, 0.2, 0, (ROOM_FLOOR + 0.85) / 2, -2.5, mats),
    box(12, 6, 0.2, 0, wy1 + 3, -2.5, mats),
    box(6 - wx - 3 + 3, wy1 - wy0, 0.2, -(wx + 3) / 2 - 1.5, (wy0 + wy1) / 2, -2.5, mats),
    box(6 - wx - 3 + 3, wy1 - wy0, 0.2, (wx + 3) / 2 + 1.5, (wy0 + wy1) / 2, -2.5, mats),
  ]) seedAttr(m, 37);
  // window frame + mullion
  const frame = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5, metalness: 0.4 });
  box(0.05, wy1 - wy0, 0.12, -0.2, (wy0 + wy1) / 2, -2.42, frame);
  box(2 * wx, 0.05, 0.12, 0, wy0 + 0.02, -2.42, frame);
  box(2 * wx, 0.05, 0.12, 0, wy1 - 0.02, -2.42, frame);
  // desk
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.72, metalness: 0.0 });
  box(1.9, 0.04, 1.35, 0, DESK_Y - 0.02, -1.7, wood);
  for (const [x, z] of [[-0.9, -1.1], [0.9, -1.1], [-0.9, -2.3], [0.9, -2.3]]) box(0.04, 0.72, 0.04, x, ROOM_FLOOR + 0.36, z, frame);
  // props: mug, notebook, router
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.3 });
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.037, 0.095, 32, 1, true), ceramic);
  mug.position.set(-0.32, DESK_Y + 0.048, -1.62);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.037, 32), new THREE.MeshStandardMaterial({ color: 0x1b0f08, roughness: 0.15 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(-0.32, DESK_Y + 0.08, -1.62);
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.018, 0.29), new THREE.MeshStandardMaterial({ color: 0x3b2b45, roughness: 0.7 }));
  book.position.set(-0.24, DESK_Y + 0.009, -1.28);
  book.rotation.y = 0.25;
  room.add(mug, coffee, book);
  // a warm desk lamp at the far corner: key light on the thumb and desk, a glowing shade in the background
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.5, metalness: 0.3 });
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 32), lampMat);
  lampBase.position.set(-0.62, DESK_Y + 0.01, -2.05);
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 12), lampMat);
  lampPole.position.set(-0.62, DESK_Y + 0.22, -2.05);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.15, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.75), side: THREE.DoubleSide }));
  shade.position.set(-0.62, DESK_Y + 0.46, -2.05);
  room.add(lampBase, lampPole, shade);
  const lamp = new THREE.SpotLight(0xffb070, 2.6, 4, 0.42, 0.85, 1.4);
  lamp.position.set(-0.62, DESK_Y + 0.42, -2.05);
  lamp.target.position.set(0.1, DESK_Y + 0.04, -1.3);
  room.add(lamp, lamp.target);

  const router = new THREE.Group();
  const rbody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.15), new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.35, metalness: 0.2 }));
  router.add(rbody);
  for (const [x, z, a] of [[-0.1, -0.06, -0.2], [-0.035, -0.07, -0.05], [0.035, -0.07, 0.05], [0.1, -0.06, 0.2]]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.17, 8), rbody.material);
    ant.position.set(x, 0.09, z);
    ant.rotation.z = a;
    router.add(ant);
  }
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, 0.003), new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
    led.position.set(-0.06 + i * 0.03, 0.004, 0.0755);
    router.add(led);
    leds.push(led);
  }
  router.position.set(0.62, DESK_Y + 0.018, -2.12);
  router.rotation.y = -0.18;
  room.add(router);

  // dim cool spill from the city through the window, and the faintest fill
  const spill = new THREE.DirectionalLight(0x6a72b8, 0.12);
  spill.position.set(0.5, ROOM_FLOOR + 0.5, -10);
  spill.target.position.set(0, ROOM_FLOOR + 0.6, 0);
  room.add(spill, spill.target);
  scene.add(room);
  return { router, leds };
}

function buildCity(scene: THREE.Scene, rnd: () => number) {
  const city = new THREE.Group();
  const boxes: { x: number; z: number; w: number; d: number; h: number }[] = [];
  const lot = (x0: number, x1: number, z0: number, z1: number, downtown: number) => {
    const inset = 1 + rnd() * 2.5;
    const w = x1 - x0 - inset * 2, d = z1 - z0 - inset * 2;
    const h = 9 + rnd() * 26 + downtown * (40 + rnd() * 130) * (rnd() > 0.35 ? 1 : 0.3);
    boxes.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w, d, h });
    if (rnd() > 0.6) boxes.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: w * 0.6, d: d * 0.6, h: h * (1.2 + rnd() * 0.5) });
  };
  for (let k = -9; k < 9; k++) {
    for (let m = 0; m < 7; m++) {
      const x0 = k * STREET + 7.5, x1 = (k + 1) * STREET - 7.5;
      const z1 = -10 - m * STREET - 7.5, z0 = Math.max(-10 - (m + 1) * STREET + 7.5, QUAY_Z + 6);
      if (z1 - z0 < 10) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const downtown = Math.exp(-((cx - 300) ** 2 + (cz + 330) ** 2) / (340 * 340));
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      lot(x0, mx - 2, z0, mz - 2, downtown);
      lot(mx + 2, x1, z0, mz - 2, downtown);
      lot(x0, mx - 2, mz + 2, z1, downtown);
      lot(mx + 2, x1, mz + 2, z1, downtown);
    }
  }
  // far shore across the harbour
  for (let i = 0; i < 260; i++) {
    const x = -1500 + rnd() * 3000, z = -1350 - rnd() * 500;
    const near = Math.exp(-(x * x) / (900 * 900));
    boxes.push({ x, z, w: 14 + rnd() * 30, d: 14 + rnd() * 30, h: 10 + rnd() * 50 + near * rnd() * 160 });
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, buildingMaterial(), boxes.length);
  const seeds = new Float32Array(boxes.length);
  const m4 = new THREE.Matrix4();
  boxes.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d);
    m4.setPosition(b.x, 0, b.z);
    mesh.setMatrixAt(i, m4);
    seeds[i] = Math.floor(rnd() * 1000);
  });
  mesh.geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  city.add(mesh);

  // ground: wet asphalt, lit by street lamps and the particle
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1500, QUAY_Z * -1 + 60), new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.32, metalness: 0.1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, QUAY_Z / 2 + 20);
  city.add(ground);
  const farGround = ground.clone();
  farGround.scale.set(3, 1.2, 1);
  farGround.position.set(0, 0, -1600);
  city.add(farGround);

  // street lamps: heads + pools of light on the road
  const sodium = new THREE.Color(1.0, 0.62, 0.28);
  const heads: number[] = [];
  const pools: [number, number][] = [];
  for (let k = -9; k <= 9; k++) {
    for (let z = -16; z > QUAY_Z + 4; z -= 24) for (const s of [-6.8, 6.8]) { heads.push(k * STREET + s, 7.2, z); pools.push([k * STREET + s * 0.6, z]); }
  }
  for (let m = 0; m < 7; m++) {
    const z = -10 - m * STREET;
    for (let x = -640; x < 640; x += 24) for (const s of [-6.8, 6.8]) { heads.push(x, 7.2, z + s); pools.push([x, z + s * 0.6]); }
  }
  // quay promenade lights
  for (let x = -640; x < 640; x += 14) heads.push(x, 4.5, QUAY_Z - 1);
  city.add(glowPoints(heads, sodium.clone().multiplyScalar(5), 0.9));
  const poolGeo = new THREE.PlaneGeometry(14, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
    map: sharedGlow(), color: sodium.clone().multiplyScalar(0.22), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, alphaMap: undefined,
  }), pools.length);
  pools.forEach(([x, z], i) => {
    m4.makeTranslation(x, 0.03, z);
    poolMesh.setMatrixAt(i, m4);
  });
  poolMesh.frustumCulled = false;
  city.add(poolMesh);

  // far shore lights + a lit bridge spanning the harbour
  const far: number[] = [];
  for (let i = 0; i < 2600; i++) far.push(-1700 + rnd() * 3400, 1 + rnd() * 4, -1320 - rnd() * 520);
  city.add(glowPoints(far, sodium.clone().multiplyScalar(3), 2.2));
  const bridge: number[] = [];
  const bx0 = -900, bx1 = -120, bz = -900;
  for (let i = 0; i <= 120; i++) {
    const s = i / 120, x = lerp(bx0, bx1, s);
    bridge.push(x, 30, bz);
    const sag = 30 + 70 * Math.pow(Math.abs(Math.sin(s * Math.PI * 2)), 1.0);
    bridge.push(x, sag, bz);
  }
  city.add(glowPoints(bridge, new THREE.Color(1.2, 1.4, 1.8).multiplyScalar(2.5), 1.6));

  // traffic: head and tail lights moving along the streets
  const cars: { k: number; lane: number; off: number; speed: number; axis: 'z' | 'x' }[] = [];
  for (let k = -9; k <= 9; k++) for (let c = 0; c < 10; c++) cars.push({ k, lane: rnd() > 0.5 ? 1 : -1, off: rnd(), speed: 9 + rnd() * 8, axis: 'z' });
  for (let m = 0; m < 7; m++) for (let c = 0; c < 26; c++) cars.push({ k: m, lane: rnd() > 0.5 ? 1 : -1, off: rnd(), speed: 9 + rnd() * 8, axis: 'x' });
  const lightGeo = new THREE.BoxGeometry(0.22, 0.16, 0.5);
  const heads3 = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.2, 2.6) }), cars.length * 2);
  const tails = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.15, 0.08) }), cars.length * 2);
  heads3.frustumCulled = tails.frustumCulled = false;
  city.add(heads3, tails);
  const updateTraffic = (t: number) => {
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    cars.forEach((c, i) => {
      const len = c.axis === 'z' ? -QUAY_Z : 1280;
      let s = ((c.off * len + c.speed * t * c.lane) % len + len) % len;
      const along = c.axis === 'z' ? -s - 10 : s - 640;
      const lane = c.lane * 3;
      for (let side = 0; side < 2; side++) {
        const so = side === 0 ? -0.75 : 0.75;
        if (c.axis === 'z') {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
          pos.set(c.k * STREET + lane + so, 0.7, along);
        } else {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
          pos.set(along, 0.7, -10 - c.k * STREET + lane + so);
        }
        // head lights face the direction of travel; we see whichever end points at us
        const front = pos.clone();
        const back = pos.clone();
        const dir = c.lane;
        if (c.axis === 'z') { front.z -= dir * 2.1; back.z += dir * 2.1; } else { front.x += dir * 2.1; back.x -= dir * 2.1; }
        m4.compose(front, q, one);
        heads3.setMatrixAt(i * 2 + side, m4);
        m4.compose(back, q, one);
        tails.setMatrixAt(i * 2 + side, m4);
      }
      void s;
    });
    heads3.instanceMatrix.needsUpdate = true;
    tails.instanceMatrix.needsUpdate = true;
  };

  // quay wall
  const quay = new THREE.Mesh(new THREE.BoxGeometry(1500, 12, 4), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 }));
  quay.position.set(0, -6, QUAY_Z - 2);
  city.add(quay);
  scene.add(city);
  return { city, updateTraffic, buildings: mesh.material as THREE.ShaderMaterial };
}

function buildWater(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(5000, 3200, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vW;
      #include <fog_pars_fragment>
      float n2(vec2 p){ return sin(p.x)*sin(p.y); }
      void main(){
        vec2 p = vW.xz;
        float rip = n2(p * 0.35 + uTime * vec2(0.6, 0.4)) * 0.5 + n2(p * 0.9 - uTime * vec2(0.3, 0.8)) * 0.3;
        vec3 c;
        if (gl_FrontFacing) {
          // above: near-black water with long streaks of city light
          float xw = p.x * 0.05 + rip * 0.35;
          float col1 = 0.5 + 0.5 * sin(xw * 3.1 + sin(xw * 0.7) * 3.0);
          float streak = pow(col1, 10.0) * (0.2 + 0.8 * smoothstep(-650.0, -1300.0, p.y));
          float glint = step(0.985, fract(sin(dot(floor(p * 1.5) + floor(uTime * 5.0), vec2(12.9898, 78.233))) * 43758.5453)) * smoothstep(-500.0, -1200.0, p.y);
          c = vec3(0.004, 0.006, 0.014) + vec3(1.0, 0.62, 0.32) * (streak * 0.55 + glint * 0.8) * (0.7 + 0.3 * rip) + vec3(0.02, 0.016, 0.035);
        } else {
          // below: the bright, rippling underside of the surface
          float caust = pow(abs(sin(p.x * 0.5 + rip * 3.0) * sin(p.y * 0.5 - rip * 2.0)), 3.0);
          c = vec3(0.12, 0.42, 0.55) * (0.6 + 0.6 * rip) + vec3(0.4, 0.8, 0.9) * caust * 0.6;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(geo, mat);
  water.position.set(0, SEA_Y, QUAY_Z - 1600 - 4);
  scene.add(water);
  return mat;
}

/** Lighting shared by everything on the sea floor: depth-dimmed ambient, caustics, dappled light, the pulse. */
const SEA_GLSL = /* glsl */ `
  uniform vec3 uPL, uPLc; uniform float uTime;
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.07; a *= 0.5; } return s; }
  vec3 seaLight(vec3 albedo, vec3 n, vec3 w) {
    float depth = smoothstep(-6.0, -32.0, w.y);
    float up = max(n.y, 0.0);
    vec3 amb = mix(vec3(0.07, 0.22, 0.3), vec3(0.008, 0.03, 0.055), depth) * (0.3 + 0.7 * up);
    vec2 q = w.xz * 0.55;
    float c1 = sin(q.x + sin(q.y * 1.3 + uTime * 1.1)) * sin(q.y + sin(q.x * 1.7 - uTime * 0.9));
    float caust = pow(abs(c1), 5.0) * 1.4 * (1.0 - depth) * up;
    // deeper down, only soft drifting patches of light reach the bottom
    float dap = smoothstep(0.45, 0.9, noise3(vec3(w.xz * 0.05, uTime * 0.12))) * 0.22 * depth * up;
    vec3 L = uPL - w; float d = length(L);
    vec3 pl = uPLc * max(dot(n, L / d), 0.0) / (1.0 + d * d * 0.7);
    return albedo * (amb + vec3(0.35, 0.75, 0.85) * caust + vec3(0.06, 0.2, 0.28) * dap + pl);
  }
`;

const TUNNEL_Z = -830;

function buildSeafloor(scene: THREE.Scene, rnd: () => number) {
  const under = new THREE.Group();
  const seaUniforms = () => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uPL: { value: new THREE.Vector3() }, uPLc: { value: new THREE.Color() },
  }]);
  const W0 = 200, L = 440, z0 = QUAY_Z - 4;
  const geo = new THREE.PlaneGeometry(W0, L, 200, 440);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 72, z = pos.getZ(i) + z0 - L / 2;
    pos.setXYZ(i, x, seabedY(x, z), z);
  }
  geo.computeVertexNormals();
  const seabedMat = new THREE.ShaderMaterial({
    uniforms: seaUniforms(),
    fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      #include <fog_pars_vertex>
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      ${SEA_GLSL}
      #include <fog_pars_fragment>
      void main(){
        float rock = smoothstep(0.46, 0.7, fbm3(vW * 0.11 + 3.0));
        float n1 = fbm3(vW * 0.9), n2 = noise3(vW * 4.0);
        vec3 sand = vec3(0.34, 0.35, 0.31) * (0.85 + 0.25 * n2);
        vec3 stone = vec3(0.13, 0.15, 0.16) * (0.55 + 0.9 * n1);
        vec3 albedo = mix(sand, stone, rock);
        albedo *= 0.85 + 0.25 * smoothstep(0.55, 0.75, noise3(vW * 22.0)); // gravel
        albedo = mix(albedo, vec3(0.13, 0.15, 0.11), smoothstep(0.6, 0.8, n1) * rock * 0.35); // growth
        // bumpy normal from the gradient of a noise height field
        float e = 0.06; float h0 = fbm3(vW * 2.6);
        vec2 g = vec2(fbm3((vW + vec3(e, 0, 0)) * 2.6) - h0, fbm3((vW + vec3(0, 0, e)) * 2.6) - h0) / e;
        vec3 n = normalize(vN - vec3(g.x, 0.0, g.y) * (0.12 + 0.5 * rock));
        float ph = vW.x * 2.1 + vW.z * 0.9 + sin(vW.z * 0.35) * 2.0;
        n = normalize(n + vec3(cos(ph) * 0.15, 0.0, cos(ph) * 0.07) * (1.0 - rock));
        gl_FragColor = vec4(seaLight(albedo, n, vW), 1.0);
        #include <fog_fragment>
      }`,
  });
  under.add(new THREE.Mesh(geo, seabedMat));

  // rocks in three sizes: boulders off to the sides, stones, and pebbles along the cable
  const rockGeo = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('uv').deleteAttribute('normal'));
  const rp = rockGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(rp, i);
    const k = 0.7 + 0.45 * fbm(v.x * 1.3 + 7, v.z * 1.3 + v.y * 0.7) + 0.1 * vnoise(v.x * 6, v.y * 6 + v.z * 3);
    v.multiplyScalar(k);
    rp.setXYZ(i, v.x, v.y * 0.6, v.z);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.ShaderMaterial({
    uniforms: seaUniforms(),
    fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec3 vL;
      #include <fog_pars_vertex>
      void main(){ vL = position; vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vW = wp.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec3 vL;
      ${SEA_GLSL}
      #include <fog_pars_fragment>
      void main(){
        float n1 = fbm3(vW * 1.7);
        vec3 albedo = vec3(0.14, 0.16, 0.17) * (0.5 + 0.9 * n1);
        // encrusting growth on upward faces
        float top = smoothstep(0.3, 0.9, normalize(vN).y) * smoothstep(0.42, 0.7, fbm3(vW * 1.6 + 5.0));
        albedo = mix(albedo, vec3(0.12, 0.14, 0.1) * (0.8 + 0.4 * n1), top * 0.6);
        float e = 0.04; float h0 = fbm3(vW * 4.0);
        vec3 g = vec3(fbm3((vW + vec3(e,0,0)) * 4.0) - h0, fbm3((vW + vec3(0,e,0)) * 4.0) - h0, fbm3((vW + vec3(0,0,e)) * 4.0) - h0) / e;
        vec3 n = normalize(normalize(vN) - g * 0.35);
        gl_FragColor = vec4(seaLight(albedo, n, vW), 1.0);
        #include <fog_fragment>
      }`,
  });
  const classes: [number, number, number, number][] = [
    // count, min scale, max scale, max distance from the cable
    [520, 0.8, 4.5, 60],
    [900, 0.15, 0.7, 25],
    [1300, 0.03, 0.14, 2.6],
  ];
  const total = classes.reduce((a, c) => a + c[0], 0);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, total);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ri = 0;
  for (const [count, s0, s1, spread] of classes) {
    for (let i = 0; i < count; i++) {
      const z = z0 - 40 - rnd() * (TUNNEL_Z * -1 + z0 - 40);
      const side = rnd() < 0.5 ? -1 : 1;
      const minD = spread > 10 ? 1.4 + s1 * 0.6 : 0.22;
      const x = cableX(z) + side * (minD + rnd() * spread);
      const s = s0 + Math.pow(rnd(), 2.5) * (s1 - s0);
      q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
      m4.compose(new THREE.Vector3(x, seabedY(x, z) + s * 0.1, z), q, new THREE.Vector3(s, s * (0.7 + rnd() * 0.6), s));
      rocks.setMatrixAt(ri++, m4);
    }
  }
  rocks.frustumCulled = false;
  under.add(rocks);

  // the cable: armoured and encrusted, glowing faintly, brightly where the pulse is
  const pts: THREE.Vector3[] = [];
  pts.push(new THREE.Vector3(72, -3.5, QUAY_Z - 4.2));
  for (let z = QUAY_Z - 12; z > TUNNEL_Z - 5; z -= 4) {
    pts.push(new THREE.Vector3(cableX(z), z < TUNNEL_Z + 40 ? lerp(cableY(z), -25.6, ramp(-z, -TUNNEL_Z - 40, -TUNNEL_Z - 5)) : cableY(z), z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const cableLen = curve.getLength();
  const spaced = curve.getSpacedPoints(6000);
  const alongAt = (z: number) => {
    let lo = 0, hi = spaced.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (spaced[m].z > z) lo = m; else hi = m; }
    const f = (spaced[lo].z - z) / Math.max(1e-6, spaced[lo].z - spaced[hi].z);
    return ((lo + f) / (spaced.length - 1)) * cableLen;
  };
  const tube = new THREE.TubeGeometry(curve, 2400, 0.15, 16, false);
  const cableMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([seaUniforms(), { uHead: { value: 0 }, uLen: { value: cableLen }, uOn: { value: 0 } }]),
    fog: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHead, uLen, uOn;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      ${SEA_GLSL}
      #include <fog_pars_fragment>
      void main(){
        float along = vUv.x * uLen;
        float helix = smoothstep(0.35, 0.5, abs(fract(along / 0.06 + vUv.y * 6.0) - 0.5));
        vec3 albedo = mix(vec3(0.03, 0.034, 0.038), vec3(0.06, 0.065, 0.07), helix);
        float growth = smoothstep(0.5, 0.7, fbm3(vec3(along * 0.8, vUv.y * 3.0, 1.0)));
        albedo = mix(albedo, vec3(0.17, 0.19, 0.12), growth * 0.7);
        vec3 n = normalize(vN);
        vec3 c = seaLight(albedo, n, vW);
        // faint light leaking all along, a bright pulse where the light is, and its fading wake
        float behind = uHead - along;
        float pulse = exp(-abs(behind) / 0.6);
        float wake = behind > 0.0 ? exp(-behind / 14.0) * 0.12 : 0.0;
        float glow = (0.004 + pulse * 0.9 + wake) * uOn;
        c += vec3(0.15, 0.65, 1.0) * glow * (0.55 + 0.45 * helix) * (1.0 - growth * 0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  under.add(new THREE.Mesh(tube, cableMat));

  // landing tunnel: a concrete wall in the slope with a dark mouth
  const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.95 });
  for (const [w, h, x, y] of [[90, 30, 72 - 48, -20], [90, 30, 72 + 48, -20], [6, 20, 72, -11]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), concrete);
    m.position.set(x, y, TUNNEL_Z);
    under.add(m);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 30), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
  mouth.position.set(72, -24, TUNNEL_Z - 14);
  under.add(mouth);

  // water column: lighter toward the surface, falling away to black below; follows the camera
  const waterDome = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({
    uniforms: { uDepth: { value: 0 } },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uDepth; varying vec3 vD;
      void main(){
        float y = vD.y;
        vec3 horizon = mix(vec3(0.012, 0.06, 0.1), vec3(0.004, 0.022, 0.045), uDepth);
        vec3 above = mix(vec3(0.06, 0.24, 0.34), vec3(0.02, 0.09, 0.15), uDepth);
        vec3 c = mix(horizon, above, smoothstep(0.0, 0.85, y));
        c = mix(c, vec3(0.0005, 0.002, 0.005), smoothstep(0.0, -0.5, y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  waterDome.renderOrder = -1;
  under.add(waterDome);

  // light rays from the surface: streaky sheets that follow the camera through the water column
  const NR = 16;
  const rayGeo = new THREE.BufferGeometry();
  const rv: number[] = [], ruv: number[] = [], rseed: number[] = [], idx: number[] = [];
  for (let i = 0; i < NR; i++) {
    const b = i * 4;
    const sx = rnd(), sz = rnd(), w = 4 + rnd() * 9;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      rv.push(sx, sz, w); ruv.push(u, v); rseed.push(i);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3));
  rayGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  rayGeo.setAttribute('seed', new THREE.Float32BufferAttribute(rseed, 1));
  rayGeo.setIndex(idx);
  const rayMat = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float seed; uniform vec3 uCam; uniform float uTime;
      varying vec2 vUv; varying float vY; varying float vSeed; varying float vDist;
      void main(){
        vUv = uv; vSeed = seed;
        // anchor on a grid that wraps around the camera, ahead of it and to the sides
        vec2 box = vec2(60.0, 70.0);
        vec2 anchor = vec2(position.x * box.x, position.y * box.y) - box * 0.5;
        vec2 rel = mod(anchor - uCam.xz + box * 0.5 + uTime * vec2(0.4, 0.0), box) - box * 0.5;
        vec3 base = vec3(uCam.x + rel.x, -2.0, uCam.z + rel.y);
        // sheet faces the camera (yaw only) and leans with the sun angle
        vec3 toCam = normalize(vec3(uCam.x - base.x, 0.0, uCam.z - base.z) + vec3(1e-4));
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        float width = position.z;
        vec3 lean = normalize(vec3(0.25, -1.0, 0.18));
        vec3 p = base + right * (uv.x - 0.5) * width + lean * (1.0 - uv.y) * 46.0;
        vY = p.y; vDist = length(p - uCam);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying float vY; varying float vSeed; varying float vDist;
      float h(float n){ return fract(sin(n * 91.7) * 4375.85); }
      float n1(float x){ float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
      void main(){
        float x = vUv.x * 7.0 + vSeed * 13.0 + sin(uTime * 0.35 + vSeed) * 0.6;
        float streak = pow(n1(x) * 0.7 + n1(x * 2.3 + uTime * 0.2) * 0.3, 3.0);
        float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        float fall = exp((vY + 2.0) / 16.0);           // strongest just below the surface
        float near = smoothstep(1.5, 6.0, vDist) * (1.0 - smoothstep(30.0, 55.0, vDist));
        float flicker = 0.75 + 0.25 * sin(uTime * 1.3 + vSeed * 5.0);
        float a = streak * edge * fall * near * flicker * 0.22;
        gl_FragColor = vec4(vec3(0.45, 0.8, 0.95) * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
  const rays = new THREE.Mesh(rayGeo, rayMat);
  rays.frustumCulled = false;
  under.add(rays);

  // floating particles: marine snow around the camera, and plankton that sparks as the light passes
  const NS = 12000;
  const base = new Float32Array(NS * 3);
  const sz = new Float32Array(NS);
  for (let i = 0; i < NS; i++) {
    base[i * 3] = rnd() * 40; base[i * 3 + 1] = rnd() * 24; base[i * 3 + 2] = rnd() * 60;
    sz[i] = 0.25 + Math.pow(rnd(), 3) * 1.8;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(base, 3));
  sg.setAttribute('sz', new THREE.BufferAttribute(sz, 1));
  const snowMat = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uMap: { value: sharedGlow() }, uPL: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      attribute float sz; uniform vec3 uCam; uniform float uTime; uniform vec3 uPL;
      varying float vA; varying float vLit; varying float vSpark;
      float h(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main(){
        vec3 box = vec3(40.0, 24.0, 60.0);
        vec3 p = position + vec3(sin(uTime * 0.3 + position.z) * 0.4, -uTime * 0.18, cos(uTime * 0.2 + position.x) * 0.4);
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        float depth = smoothstep(-6.0, -32.0, p.y);
        vA = smoothstep(0.25, 1.5, d) * (1.0 - smoothstep(9.0, 24.0, d)) * mix(1.0, 0.55, depth);
        float r2 = dot(p - uPL, p - uPL);
        vLit = 1.0 / (1.0 + r2 * 1.2);
        // disturbed plankton flash briefly near the passing light
        vSpark = step(0.82, h(position + floor(uTime * 7.0))) * exp(-r2 / 6.0);
        gl_PointSize = sz * 60.0 / d;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `uniform sampler2D uMap; varying float vA; varying float vLit; varying float vSpark;
      void main(){ float g = texture2D(uMap, gl_PointCoord).a;
        vec3 c = vec3(0.3, 0.48, 0.55) * 0.5 + vec3(0.4, 1.0, 1.3) * vLit * 1.4 + vec3(0.3, 1.6, 1.2) * vSpark * 2.0;
        gl_FragColor = vec4(c * g * vA, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const snow = new THREE.Points(sg, snowMat);
  snow.frustumCulled = false;
  under.add(snow);

  scene.add(under);
  return { under, curve, cableLen, cableMat, snowMat, seabedMat, rockMat, rayMat, waterDome, alongAt };
}

// ---- the set ----------------------------------------------------------------------------------

export async function homeSet(): Promise<FilmSet> {
  const rnd = mulberry32(7);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.01, 6000);
  const cityFog = new THREE.FogExp2(0x161026, 0.0032);
  const seaFog = new THREE.FogExp2(0x000000, 0.045);
  scene.fog = cityFog;
  const sky = skyDome();
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0x2a2f55, 0x0a0806, 0.25));

  const { router, leds } = buildRoom(scene);
  const { city, updateTraffic, buildings } = buildCity(scene, rnd);
  const waterMat = buildWater(scene);
  const sea = buildSeafloor(scene, rnd);

  const phone = new Phone('chat');
  phone.group.position.set(0.0, DESK_Y + 0.0039, -1.45);
  phone.group.rotation.y = 0.14;
  scene.add(phone.group);
  phone.glow.intensity = 0.0;
  phone.group.updateMatrixWorld(true);
  const btn = phone.group.localToWorld(phone.sendButton.clone());

  const thumb = makeThumb();
  scene.add(thumb);

  // the path of the light
  const pts: V3[] = [];
  const times: number[] = [];
  const add = (p: V3, t: number) => { pts.push(p); times.push(t); };
  add([btn.x, btn.y + 0.004, btn.z], 1.9);
  add([btn.x + 0.03, btn.y + 0.14, btn.z - 0.08], 2.2);
  add([0.35, 41.0, -1.9], 2.75);
  add([0.62, DESK_Y + 0.05, -2.12], 3.1);
  add([0.78, 41.0, -2.36], 3.35);
  add([0.7, 41.6, -2.95], 3.75);
  add([0.3, 37.5, -10], 4.3);
  add([0.1, 21, -27], 4.85);
  add([0, 9, -56], 5.35);
  add([0, 7.5, -130], 6.1);
  add([0, 7.5, -205], 6.8);
  add([10, 7.5, -224], 7.05);
  add([60, 7.5, -228], 7.45);
  add([72, 7.5, -244], 7.65);
  add([72, 7.5, -330], 8.4);
  add([72, 7.5, -420], 9.15);
  add([72, 9, -468], 9.65);
  add([72, 3, -500], 10.1);
  add([72, -3, -518], 10.45);
  add([72, -16, -556], 10.95);
  const zr0 = -606, zr1 = TUNNEL_Z + 70;
  for (let i = 0; i <= 40; i++) {
    const s = i / 40;
    const z = lerp(zr0, zr1, s);
    add([cableX(z), cableY(z) + 0.24, z], 11.55 + (16.4 - 11.55) * Math.pow(s, 0.8));
  }
  add([72, -24.5, TUNNEL_Z + 22], 17.0);
  add([72, -24.2, TUNNEL_Z], 17.35);
  add([72, -24.2, TUNNEL_Z - 28], 17.7);
  const path = flight(pts, times);

  const light = new Particle({ size: 0.02, trail: 90, lightIntensity: 0.6, lightDistance: 3 });
  light.addTo(scene);

  // camera: keyframed close-up for the tap and the room, then a chase that follows the light
  const keyed = track([
    { t: 0.0, p: [0.05, 40.815, -1.22], l: [0.012, 40.775, -1.5], fov: 40 },
    { t: 1.8, p: [0.044, 40.812, -1.235], l: [0.014, 40.775, -1.5], fov: 39 },
    { t: 2.5, p: [0.1, 40.98, -1.1], l: [0.1, 40.95, -1.6], fov: 36 },
    { t: 3.2, p: [0.28, 41.08, -1.5], l: [0.62, 40.8, -2.12], fov: 40 },
    { t: 3.9, p: [0.55, 41.35, -2.05], l: [0.6, 41.3, -3.2], fov: 44 },
    { t: 4.5, p: [0.6, 41.0, -4.2], l: [0.3, 36, -12], fov: 50 },
  ]);
  const chase = (t: number) => {
    const under = t > 10.5;
    const aerial = smooth(ramp(t, 4.0, 4.6)) * (1 - smooth(ramp(t, 5.2, 6.2)));
    const aerialUp = 2.4 + aerial * 34;
    if (!under) return { p: path.offset(t, -9.5 - aerial * 30).add(new THREE.Vector3(0, aerialUp, 0)), l: path.offset(t, 7) };
    // underwater: glide low beside the cable with a slow, breathing sway
    const p = path.offset(t, -2.2).add(new THREE.Vector3(0.62 + 0.12 * Math.sin(t * 0.9), 0.3 + 0.07 * Math.sin(t * 1.3 + 1), 0));
    const l = path.offset(t, 6).add(new THREE.Vector3(0.1 * Math.sin(t * 0.6), -0.12, 0));
    l.y = Math.min(l.y, path.at(t).y + 0.4); // never tilt up toward the surface
    return { p, l };
  };

  const v = new THREE.Vector3();
  return {
    start: HOME_START,
    end: HOME_END,
    frame(t: number): Shot {
      // ---- particle
      const vis = smooth(ramp(t, 1.85, 2.05));
      const ppos = light.update(path.at, Math.max(t, 1.9), t > 10.4 ? 0.0012 : 0.0045, vis);
      const burst = Math.exp(-Math.max(0, t - 1.95) * 6) * vis;
      light.core.scale.setScalar(0.014 + burst * 0.02);
      light.halo.scale.setScalar(0.06 + burst * 0.16);
      const underwater = t > 10.4;
      const bigScale = clamp((t - 3.6) / 1.2);
      light.core.scale.multiplyScalar(lerp(1, underwater ? 3.2 : 30, bigScale));
      light.halo.scale.multiplyScalar(lerp(1, underwater ? 4.5 : 22, bigScale));
      (light.trail.material as THREE.ShaderMaterial).uniforms.uSize.value = lerp(8, underwater ? 5 : 300, bigScale);
      light.light.intensity = lerp(0.25, underwater ? 0.35 : 120, bigScale) * vis;
      light.light.distance = lerp(3, underwater ? 9 : 45, bigScale);

      // ---- phone, thumb, router
      const screenB = 0.95 + 0.4 * Math.exp(-Math.max(0, t - 1.6) * 3) * ramp(t, 1.55, 1.62);
      phone.draw(t, screenB);
      phone.glow.intensity = 0.16 * screenB;
      const inP = easeInOut(ramp(t, 0.25, 1.35));
      const press = smooth(ramp(t, 1.35, 1.52)) * (1 - smooth(ramp(t, 1.66, 1.85)));
      const outP = easeInOut(ramp(t, 1.75, 2.7));
      const dir = new THREE.Vector3(0.82, 0.34, 0.46).normalize();
      const tipOff = dir.clone().multiplyScalar(lerp(lerp(0.055, 0.0, inP), 0.2, outP)).add(new THREE.Vector3(0, -0.0035 * press, 0));
      thumb.position.copy(btn).add(tipOff).add(new THREE.Vector3(0, 0.0095, 0));
      const up = new THREE.Vector3(0, 1, 0);
      const zAxis = up.clone().sub(dir.clone().multiplyScalar(dir.dot(up))).normalize();
      const xAxis = new THREE.Vector3().crossVectors(dir, zAxis);
      thumb.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, dir, zAxis));
      thumb.visible = t < 3.0;
      const near = Math.exp(-((t - 3.1) ** 2) / 0.02);
      leds.forEach((led, i) => {
        const on = hash(i * 7 + Math.floor(t * (4 + near * 30))) > 0.35 ? 1 : 0.15;
        (led.material as THREE.MeshBasicMaterial).color.setRGB(0.1 * on, 2.2 * on + near * 6, 0.9 * on + near * 8);
      });
      void router;

      // ---- world state
      updateTraffic(t);
      buildings.uniforms.uPL.value.copy(ppos);
      buildings.uniforms.uPLc.value.copy(LIGHT).multiplyScalar(vis * lerp(0, 2.5, bigScale));
      waterMat.uniforms.uTime.value = t;
      const headU = clamp((ppos.z - (QUAY_Z - 4)) / -1);
      void headU;
      // how far along the cable the light is (metres)
      const along = clamp(sea.alongAt(ppos.z), 0, sea.cableLen);
      sea.cableMat.uniforms.uHead.value = along;
      sea.cableMat.uniforms.uOn.value = smooth(ramp(t, 11.3, 11.7));
      sea.snowMat.uniforms.uTime.value = t;
      sea.snowMat.uniforms.uPL.value.copy(ppos);
      sea.rayMat.uniforms.uTime.value = t;
      for (const m of [sea.seabedMat, sea.rockMat, sea.cableMat]) {
        m.uniforms.uTime.value = t;
        m.uniforms.uPL.value.copy(ppos);
        m.uniforms.uPLc.value.copy(LIGHT).multiplyScalar(0.7 * smooth(ramp(t, 10.6, 11.4)));
      }

      // ---- camera
      const k = keyed(t);
      const c = chase(t);
      const w = smooth(ramp(t, 3.9, 4.7));
      const lookParticle = smooth(ramp(t, 2.0, 2.4)) * (1 - w);
      const camPos = k.p.clone().lerp(c.p, w);
      const look = k.l.clone().lerp(ppos, lookParticle * 0.85).lerp(c.l, w);
      const fov = lerp(k.fov, underwater ? 58 : 54, w);
      aimCamera(camera, camPos, look, fov, w * Math.sin(t * 0.7) * (underwater ? 0.06 : 0.03));
      camera.near = t < 4 ? 0.005 : 0.1;
      camera.updateProjectionMatrix();
      sea.snowMat.uniforms.uCam.value.copy(camPos);
      sea.rayMat.uniforms.uCam.value.copy(camPos);
      sea.waterDome.position.copy(camPos);

      const below = camPos.y < SEA_Y;
      scene.fog = below ? seaFog : cityFog;
      scene.background = null;
      // fog matches the horizon of the water column, darker the deeper we are
      const depth = smooth(ramp(camPos.y, -6, -32));
      seaFog.color.setRGB(lerp(0.012, 0.004, depth), lerp(0.06, 0.022, depth), lerp(0.1, 0.045, depth), THREE.LinearSRGBColorSpace);
      (sea.waterDome.material as THREE.ShaderMaterial).uniforms.uDepth.value = depth;
      sea.waterDome.visible = below;
      sea.under.visible = camPos.y < 6 || t > 9.6;
      sky.visible = !below;
      city.visible = !below || camPos.z > QUAY_Z - 80;

      // focus: on the phone during the tap, then on the light
      const focusTarget = t < 2.1 ? btn : ppos;
      const focus = v.copy(focusTarget).distanceTo(camPos);
      const aperture = t < 2.6 ? lerp(7, 12, smooth(ramp(t, 1.9, 2.6))) : below ? 7 : 4;
      return {
        scene, camera, focus, aperture,
        bloom: below ? 0.8 : t < 3.6 ? 0.9 : 0.6,
        exposure: lerp(lerp(1.4, 1.1, smooth(ramp(t, 2.0, 3.6))), below ? 1.25 : 1.15, w),
        flash: Math.max(0.12 * burst, smooth(ramp(t, 17.38, 17.6))),
      };
    },
  };
}
