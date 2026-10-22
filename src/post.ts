// Post pipeline, drawn once per frame from the HDR scene render:
//   scene (HDR + depth) → depth of field → bloom → grade (exposure, flash, ACES, vignette,
//   chromatic aberration, grain) → canvas.
// Every pass is a pure function of the scene image and the frame index.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { H, W, type Shot } from './lib';

const quadVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Post {
  private sceneRT: THREE.WebGLRenderTarget;
  private dofRT: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private dof: FullScreenQuad;
  private grade: FullScreenQuad;

  constructor(private renderer: THREE.WebGLRenderer) {
    const opts = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace };
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, { ...opts, samples: 0 });
    this.sceneRT.depthTexture = new THREE.DepthTexture(W, H, THREE.FloatType);
    this.dofRT = new THREE.WebGLRenderTarget(W, H, opts);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.8, 0.6, 0.85);

    this.dof = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 5 }, uMax: { value: 8 },
        uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
      },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth; uniform float uNear, uFar, uFocus, uMax; uniform vec2 uTexel;
        varying vec2 vUv;
        float viewZ(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return (uNear * uFar) / (uFar - d * (uFar - uNear));
        }
        // circle of confusion in px: thin-lens shape, |1 - focus/z|
        float coc(float z) { return min(uMax, uMax * abs(1.0 - uFocus / z) * 1.6); }
        void main() {
          float zc = viewZ(vUv);
          float cc = coc(zc);
          vec3 col = texture2D(tColor, vUv).rgb;
          if (cc < 0.6) { gl_FragColor = vec4(col, 1.0); return; }
          vec3 acc = col; float wsum = 1.0;
          const int N = 28;
          const float GA = 2.39996323;
          for (int i = 1; i < N; i++) {
            float r = sqrt(float(i) / float(N)) * cc;
            float a = float(i) * GA;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
            float zs = viewZ(uv);
            float cs = coc(zs);
            // a sample contributes if its own blur reaches us; nearer samples may bleed over
            float w = clamp(cs - r + 1.0, 0.0, 1.0) * (zs < zc ? 1.0 : clamp(cc - r + 1.0, 0.0, 1.0));
            acc += texture2D(tColor, uv).rgb * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
        }`,
    }));

    this.grade = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, uExposure: { value: 1 }, uFlash: { value: 0 }, uFade: { value: 0 },
        uFrame: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
      },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform float uExposure, uFlash, uFade, uFrame; uniform vec2 uTexel;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main() {
          vec2 d = vUv - 0.5;
          float r2 = dot(d, d);
          // lateral chromatic aberration, strongest at the edges
          vec2 ca = d * r2 * 0.012;
          vec3 c;
          c.r = texture2D(tColor, vUv - ca).r;
          c.g = texture2D(tColor, vUv).g;
          c.b = texture2D(tColor, vUv + ca).b;
          c *= uExposure;
          c += vec3(1.0, 0.98, 0.95) * uFlash * uFlash * 6.0;
          c = aces(c);
          // gentle split tone: cool shadows, warm highlights
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, c * vec3(0.92, 0.98, 1.08), (1.0 - l) * 0.35);
          c *= 1.0 - smoothstep(0.18, 0.75, r2 * 1.6) * 0.55;
          c *= 1.0 - uFade;
          c = toSRGB(c);
          float g = h(vUv * vec2(1920.0, 1080.0) + uFrame * 17.13) - 0.5;
          c += g * 0.028;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
  }

  render(shot: Shot, frame: number) {
    const r = this.renderer;
    const cam = shot.camera;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(shot.scene, cam);

    const dm = this.dof.material as THREE.ShaderMaterial;
    dm.uniforms.tColor.value = this.sceneRT.texture;
    dm.uniforms.tDepth.value = this.sceneRT.depthTexture;
    dm.uniforms.uNear.value = cam.near;
    dm.uniforms.uFar.value = cam.far;
    dm.uniforms.uFocus.value = shot.focus;
    dm.uniforms.uMax.value = shot.aperture;
    r.setRenderTarget(this.dofRT);
    this.dof.render(r);

    this.bloom.strength = shot.bloom;
    this.bloom.radius = shot.bloomRadius ?? 0.65;
    this.bloom.threshold = 0.9;
    this.bloom.render(r, null as unknown as THREE.WebGLRenderTarget, this.dofRT, 0, false);

    const gm = this.grade.material as THREE.ShaderMaterial;
    gm.uniforms.tColor.value = this.dofRT.texture;
    gm.uniforms.uExposure.value = shot.exposure;
    gm.uniforms.uFlash.value = shot.flash ?? 0;
    gm.uniforms.uFade.value = shot.fade ?? 0;
    gm.uniforms.uFrame.value = frame;
    r.setRenderTarget(null);
    this.grade.render(r);
  }
}
