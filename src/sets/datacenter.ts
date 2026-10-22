// Set 2 (17.6 – 23.0 s): out of the landing tunnel into a data-center hall. The light races down a
// cold aisle, dives into one rack (which lights up as the server handles the message), then shoots
// up through the ceiling into white.

import * as THREE from 'three';
import {
  LIGHT, Particle, aimCamera, flight, mulberry32, ramp, sharedGlow, smooth, track,
  type FilmSet, type Shot,
} from '../lib';

export const DC_START = 17.6;
export const DC_END = 23.0;

const RACK = { w: 0.6, h: 2.2, d: 1.1 };
const AISLES = [-12, -6, 0, 6, 12];
const DEPTH = 80; // racks per row
const HOT = { aisle: 0, side: 1, index: 44 }; // the rack our message goes into

function rackMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uHot: { value: -1 }, uHotAmt: { value: 0 }, uPL: { value: new THREE.Vector3() }, uPLc: { value: new THREE.Color() },
      uMirror: { value: 0 },
    }]),
    fog: true,
    vertexShader: /* glsl */ `
      attribute vec3 meta; // x: rack id, y: facing (+1 / -1 along x), z: row seed
      varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vMeta;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vL = position; vMeta = meta;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHot, uHotAmt, uMirror; uniform vec3 uPL, uPLc;
      varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vMeta;
      #include <fog_pars_fragment>
      float h(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 n = normalize(vN);
        vec3 meta = vec3(floor(vMeta.x + 0.5), vMeta.y, vMeta.z);
        vec3 col = vec3(0.012, 0.014, 0.018);
        bool front = n.x * vMeta.y > 0.5;
        float hot = (abs(meta.x - uHot) < 0.5) ? uHotAmt : 0.0;
        if (front) {
          // local face coords: u across the rack (0..1), v up (0..1)
          float u = vL.z / ${RACK.w.toFixed(2)} + 0.5;
          float v = vL.y / ${RACK.h.toFixed(2)} + 0.5;
          float units = 40.0;
          float unit = floor(v * units);
          float uv = fract(v * units);
          float filled = step(0.18, h(vec3(meta.x, unit, 1.0)));
          float slab = step(0.08, uv) * step(uv, 0.92) * step(0.04, u) * step(u, 0.96) * step(0.04, v) * step(v, 0.97);
          col = mix(col, vec3(0.03, 0.034, 0.042), slab * filled);
          // perforated door pattern
          vec2 perf = fract(vec2(u * 60.0, v * 110.0));
          col *= 0.85 + 0.15 * step(0.5, length(perf - 0.5) * 2.0);
          // LEDs: a few per server, blinking on their own clocks
          for (int k = 0; k < 4; k++) {
            float fk = float(k);
            float lx = 0.08 + fk * 0.045;
            float d = length(vec2((u - lx) * 0.6 * 38.0, (uv - 0.5) * 1.6));
            float rate = 1.5 + 9.0 * h(vec3(meta.x, unit, fk + 3.0));
            float on = step(0.45, h(vec3(meta.x * 1.3, unit, floor(uTime * rate + fk * 7.0))));
            float sel = h(vec3(meta.x, unit, fk + 9.0));
            vec3 lc = sel < 0.62 ? vec3(0.15, 0.55, 1.4) : sel < 0.9 ? vec3(0.25, 1.4, 0.45) : vec3(1.6, 0.75, 0.15);
            float led = smoothstep(1.0, 0.0, d) * filled * slab;
            col += lc * led * on * 2.2 * (1.0 - hot);
            col += vec3(0.4, 1.6, 2.2) * led * hot * 4.0;
          }
          // a status strip that runs the height of the rack
          col += vec3(0.08, 0.25, 0.6) * smoothstep(0.012, 0.0, abs(u - 0.985)) * 0.8;
          col += vec3(0.25, 0.85, 1.2) * hot * 0.12;
        } else if (n.y > 0.5) {
          col = vec3(0.02, 0.022, 0.026);
        }
        vec3 L = uPL - vW; float dl = length(L);
        col += vec3(0.06) * uPLc * max(dot(n, L / dl), 0.0) / (1.0 + dl * dl * 0.4);
        col *= mix(1.0, 0.42, uMirror);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
}

export function dataCenterSet(): FilmSet {
  const rnd = mulberry32(31);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1220, 0.034);
  scene.background = new THREE.Color(0x05080e);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 300);

  // racks (and their reflection in the polished floor)
  const geo = new THREE.BoxGeometry(RACK.d, RACK.h, RACK.w);
  geo.translate(0, RACK.h / 2, 0);
  const count = AISLES.length * 2 * DEPTH;
  const mat = rackMaterial();
  const mirrorMat = rackMaterial();
  mirrorMat.uniforms.uMirror.value = 1;
  mirrorMat.side = THREE.BackSide;
  const racks = new THREE.InstancedMesh(geo, mat, count);
  const mirror = new THREE.InstancedMesh(geo, mirrorMat, count);
  const meta = new Float32Array(count * 3);
  const m4 = new THREE.Matrix4();
  const flip = new THREE.Matrix4().makeScale(1, -1, 1);
  let i = 0;
  let hotId = -1;
  const hotPos = new THREE.Vector3();
  for (const ax of AISLES) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < DEPTH; k++) {
        const x = ax + side * 1.25;
        const z = 4 - k * (RACK.w + 0.02);
        m4.makeTranslation(x, 0, z);
        racks.setMatrixAt(i, m4);
        mirror.setMatrixAt(i, flip.clone().multiply(m4));
        meta[i * 3] = i;
        meta[i * 3 + 1] = -side; // fronts face the aisle
        meta[i * 3 + 2] = rnd();
        if (ax === HOT.aisle && side === HOT.side && k === HOT.index) { hotId = i; hotPos.set(x, 0, z); }
        i++;
      }
    }
  }
  racks.geometry.setAttribute('meta', new THREE.InstancedBufferAttribute(meta, 3));
  racks.frustumCulled = mirror.frustumCulled = false;
  mat.uniforms.uHot.value = hotId;
  mirrorMat.uniforms.uHot.value = hotId;
  scene.add(racks, mirror);

  // polished floor: dark, slightly see-through so the mirrored hall reads as a reflection
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 120), new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    fog: true, transparent: true, depthWrite: true,
    vertexShader: /* glsl */ `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `varying vec3 vW;
      #include <fog_pars_fragment>
      void main(){
        vec2 g = abs(fract(vW.xz / 0.6) - 0.5);
        float seam = smoothstep(0.485, 0.5, max(g.x, g.y));
        vec2 perf = fract(vW.xz / 0.05) - 0.5;
        float hole = step(length(perf), 0.18) * step(abs(vW.x - floor(vW.x / 6.0 + 0.5) * 6.0), 0.9);
        vec3 c = vec3(0.012, 0.014, 0.018) + seam * 0.02 - hole * 0.006;
        gl_FragColor = vec4(c, 0.72 - hole * 0.1);
        #include <fog_fragment>
      }`,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.001, -20);
  scene.add(floor);

  // ceiling: light strips over each aisle, cable trays over each row, and their reflections
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.8, 3.2) });
  const stripMirror = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.55, 0.65) });
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x3a3320, roughness: 0.6, metalness: 0.4 });
  for (const ax of AISLES) {
    for (let k = 0; k < 14; k++) {
      const z = 2 - k * 3.6;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 2.6), stripMat);
      s.position.set(ax, 3.6, z);
      const r = s.clone();
      r.material = stripMirror;
      r.position.y = -3.6;
      scene.add(s, r);
    }
    for (const side of [-1, 1]) {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, DEPTH * 0.62), trayMat);
      tray.position.set(ax + side * 1.25, 2.75, 4 - DEPTH * 0.31);
      scene.add(tray);
    }
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 120), new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 3.9, -20);
  scene.add(ceiling);
  // a vertical shaft of light in the ceiling above the hot rack: where the message leaves
  const skylight = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.4, 5) }));
  skylight.position.set(0.6, 3.92, hotPos.z);
  scene.add(skylight);

  // haze: soft additive light sheets under every strip
  const sheetMat = new THREE.MeshBasicMaterial({
    map: sharedGlow(), color: new THREE.Color(0.06, 0.08, 0.12), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const ax of AISLES) {
    for (let k = 0; k < 14; k++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5), sheetMat);
      sheet.position.set(ax, 1.8, 2 - k * 3.6);
      sheet.rotation.y = Math.PI / 2;
      scene.add(sheet);
    }
  }

  // the landing tunnel the light arrives through
  const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.95, side: THREE.BackSide });
  const tunnel = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 30), tunnelMat);
  tunnel.position.set(0, 1.5, 20);
  scene.add(tunnel);
  for (let k = 0; k < 8; k++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.2) }));
    lamp.position.set(0, 2.95, 33 - k * 3.6);
    scene.add(lamp);
  }
  for (const [x, y] of [[-1.45, 0.08], [1.45, 0.08], [-1.45, 2.92], [1.45, 2.92]] as const) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.6) }));
    strip.position.set(x, y, 20);
    scene.add(strip);
  }
  // a wall with the doorway into the hall
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.9 });
  for (const [w, x] of [[28, -15.5], [28, 15.5]] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 0.3), wallMat);
    wall.position.set(x, 2, 5.2);
    scene.add(wall);
  }

  scene.add(new THREE.HemisphereLight(0x8aa6d0, 0x080a0e, 0.35));
  const fill = new THREE.PointLight(0xbfd6ff, 6, 30, 2);
  fill.position.set(0, 3.4, -10);
  scene.add(fill);

  // the light's route
  const hz = hotPos.z;
  const path = flight([
    [0, 1.5, 22], [0, 1.5, 12], [0, 1.45, 3], [0, 1.4, -8], [0.05, 1.35, hz + 5], [0.35, 1.3, hz + 1],
    [0.66, 1.25, hz], [0.66, 1.25, hz - 0.01],
    [0.6, 2.5, hz], [0.6, 3.9, hz], [0.6, 9, hz],
  ], [DC_START - 0.3, DC_START + 0.5, 18.6, 19.5, 20.05, 20.3, 20.5, 21.25, 21.6, 22.0, 22.9]);
  const light = new Particle({ size: 0.05, trail: 70, lightIntensity: 4, lightDistance: 8, trailSize: 0.05 });
  (light.trail.material as THREE.ShaderMaterial).uniforms.uSize.value = 34;
  light.addTo(scene);

  const cam = track([
    { t: DC_START, p: [0, 1.6, 14], l: [0, 1.5, 6], fov: 50 },
    { t: 18.5, p: [0, 1.65, 7], l: [0, 1.45, -2], fov: 52 },
    { t: 19.6, p: [-0.35, 1.7, -4], l: [0.1, 1.4, hz + 3], fov: 50 },
    { t: 20.4, p: [-0.5, 1.55, hz + 3.2], l: [0.66, 1.25, hz], fov: 44 },
    { t: 21.2, p: [-0.55, 1.45, hz + 2.4], l: [0.66, 1.3, hz], fov: 42 },
    { t: 21.9, p: [-0.6, 1.2, hz + 2.6], l: [0.6, 3.4, hz], fov: 52 },
    { t: 22.9, p: [-0.4, 1.4, hz + 2.2], l: [0.6, 8, hz], fov: 56 },
  ]);

  return {
    start: DC_START,
    end: DC_END,
    frame(t: number): Shot {
      const inside = ramp(t, 20.45, 20.55) * (1 - ramp(t, 21.2, 21.3));
      const p = light.update(path.at, t, 0.006, 1 - inside);
      light.light.intensity = 4 * (1 - inside) + 0.5;
      const hot = smooth(ramp(t, 20.45, 20.7)) * (1 - smooth(ramp(t, 21.2, 21.9)));
      for (const m of [mat, mirrorMat]) {
        m.uniforms.uTime.value = t;
        m.uniforms.uHotAmt.value = hot;
        m.uniforms.uPL.value.copy(p);
        m.uniforms.uPLc.value.copy(LIGHT).multiplyScalar(3 * (1 - inside));
      }
      const c = cam(t);
      // look at the light while it is visible, otherwise at the keyed target
      const look = c.l.clone().lerp(p, 0.55 * (1 - inside));
      aimCamera(camera, c.p, look, c.fov);
      const flashIn = 1 - smooth(ramp(t, DC_START, DC_START + 0.35));
      return {
        scene, camera,
        focus: Math.max(0.5, c.p.distanceTo(inside > 0.5 ? new THREE.Vector3(0.66, 1.3, hz) : p)),
        aperture: 6,
        bloom: 0.75,
        exposure: 1.2,
        flash: Math.max(flashIn, smooth(ramp(t, 22.45, 23.0))),
      };
    },
  };
}

