import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp, easeInOut, easeOut, ramp } from './lib';

export const PHONE = { w: 0.0716, h: 0.0078, l: 0.1476 };
export const MSG = 'made it home. miss you already';
const CW = 600, CH = 1300;

/**
 * A phone lying screen-up on a surface. The screen is a canvas texture redrawn each frame from
 * a small state, so it stays a pure function of time.
 */
export class Phone {
  group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  screen: THREE.Mesh;
  glow: THREE.PointLight;

  constructor(readonly kind: 'chat' | 'lock') {
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    const body = new THREE.Mesh(
      new RoundedBoxGeometry(PHONE.w, PHONE.h, PHONE.l, 6, 0.0095),
      new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.32, metalness: 0.6 }),
    );
    const band = new THREE.Mesh(
      new RoundedBoxGeometry(PHONE.w + 0.0008, PHONE.h * 0.55, PHONE.l + 0.0008, 6, 0.0098),
      new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.28, metalness: 1.0 }),
    );
    const sg = new THREE.PlaneGeometry(PHONE.w - 0.0042, PHONE.l - 0.0042);
    sg.rotateX(-Math.PI / 2);
    this.screen = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, fog: false }));
    this.screen.position.y = PHONE.h / 2 + 0.0002;
    this.glow = new THREE.PointLight(0xbfd8ff, 0, 0.8, 2);
    this.glow.position.y = 0.03;
    this.group.add(band, body, this.screen, this.glow);
  }

  /** Screen-space (canvas px) position → local 3D point on the glass. */
  screenPoint(px: number, py: number): THREE.Vector3 {
    const sw = PHONE.w - 0.0042, sl = PHONE.l - 0.0042;
    return new THREE.Vector3((px / CW - 0.5) * sw, PHONE.h / 2 + 0.0005, (py / CH - 0.5) * sl);
  }

  get sendButton() {
    return this.screenPoint(540, 702);
  }

  /** Draw the chat (sender) or lock screen (receiver) for time t. */
  draw(t: number, brightness: number) {
    const g = this.g;
    g.save();
    if (this.kind === 'chat') this.drawChat(t);
    else this.drawLock(t);
    g.restore();
    this.tex.needsUpdate = true;
    (this.screen.material as THREE.MeshBasicMaterial).color.setScalar(brightness);
  }

  private bubble(x: number, y: number, text: string, mine: boolean, alpha = 1) {
    const g = this.g;
    g.font = '400 30px Inter, sans-serif';
    const w = g.measureText(text).width + 44;
    const bx = mine ? x - w : x;
    g.globalAlpha = alpha;
    g.beginPath();
    g.roundRect(bx, y, w, 62, 30);
    if (mine) {
      const gr = g.createLinearGradient(bx, y, bx, y + 62);
      gr.addColorStop(0, '#36b7ff');
      gr.addColorStop(1, '#1d8fe6');
      g.fillStyle = gr;
    } else g.fillStyle = '#262a33';
    g.fill();
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.fillText(text, bx + 22, y + 32);
    g.globalAlpha = 1;
  }

  private statusBar(light = 1) {
    const g = this.g;
    g.fillStyle = `rgba(255,255,255,${0.95 * light})`;
    g.font = '600 30px Inter, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('9:41', 64, 56);
    // dynamic island
    g.fillStyle = '#000';
    g.beginPath();
    g.roundRect(CW / 2 - 92, 26, 184, 56, 28);
    g.fill();
    g.fillStyle = `rgba(255,255,255,${0.95 * light})`;
    for (let i = 0; i < 4; i++) g.fillRect(430 + i * 11, 64 - 6 - i * 5, 7, 6 + i * 5);
    g.strokeStyle = `rgba(255,255,255,${0.6 * light})`;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(486, 44, 50, 24, 7);
    g.stroke();
    g.fillRect(490, 48, 36, 16);
  }

  private drawChat(t: number) {
    const g = this.g;
    const bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, '#0d1018');
    bg.addColorStop(1, '#090b11');
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);
    this.statusBar();
    // header
    const av = g.createLinearGradient(260, 110, 340, 190);
    av.addColorStop(0, '#ff9a7a');
    av.addColorStop(1, '#c85ad8');
    g.fillStyle = av;
    g.beginPath();
    g.arc(CW / 2, 150, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '600 34px Inter, sans-serif';
    g.textAlign = 'center';
    g.fillText('Y', CW / 2, 152);
    g.font = '500 26px Inter, sans-serif';
    g.fillText('Yuki', CW / 2, 222);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 258, CW, 2);

    const sent = easeInOut(ramp(t, 1.62, 2.05));
    const shift = sent * 82;
    this.bubble(34, 300 - shift, 'how was the flight??', false);
    this.bubble(CW - 34, 382 - shift, 'long. but good', true);
    this.bubble(34, 464 - shift, 'did you get home ok?', false);
    if (sent > 0) {
      const y = 640 - sent * (640 - 464);
      this.bubble(CW - 34, y, MSG, true, clamp(sent * 3));
      if (t > 2.3) {
        g.fillStyle = `rgba(255,255,255,${0.45 * ramp(t, 2.3, 2.6)})`;
        g.font = '400 20px Inter, sans-serif';
        g.textAlign = 'right';
        g.fillText('Delivered', CW - 40, 626);
        g.textAlign = 'left';
      }
    }

    // input bar
    g.fillStyle = '#090b11';
    g.fillRect(0, 660, CW, 90);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(30, 672, 470, 60, 30);
    g.stroke();
    g.font = '400 27px Inter, sans-serif';
    g.textBaseline = 'middle';
    if (t < 1.62) {
      g.fillStyle = '#fff';
      g.save();
      g.beginPath();
      g.rect(48, 672, 440, 60);
      g.clip();
      const tw = g.measureText(MSG).width;
      g.fillText(MSG, Math.min(52, 476 - tw), 703);
      if (Math.floor(t * 2.4) % 2 === 0) g.fillRect(Math.min(52 + tw, 476) + 3, 686, 3, 34);
      g.restore();
    } else {
      g.fillStyle = `rgba(255,255,255,${0.35 * ramp(t, 2.0, 2.3)})`;
      g.fillText('iMessage', 52, 703);
    }
    const press = ramp(t, 1.4, 1.55) * (1 - ramp(t, 1.7, 1.95));
    g.fillStyle = t < 1.62 ? '#2aa8ff' : 'rgba(42,168,255,0.35)';
    g.beginPath();
    g.arc(540, 702, 30 - press * 4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(540, 718);
    g.lineTo(540, 688);
    g.moveTo(527, 700);
    g.lineTo(540, 687);
    g.lineTo(553, 700);
    g.stroke();
    // touch flash
    if (t > 1.5 && t < 2.4) {
      const p = ramp(t, 1.5, 2.4);
      g.strokeStyle = `rgba(150,220,255,${0.9 * (1 - p)})`;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(540, 702, 30 + easeOut(p) * 120, 0, Math.PI * 2);
      g.stroke();
    }

    // keyboard
    g.fillStyle = '#16181f';
    g.fillRect(0, 760, CW, CH - 760);
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    g.font = '400 30px Inter, sans-serif';
    g.textAlign = 'center';
    rows.forEach((r, i) => {
      const kw = 52, gap = 6;
      const total = r.length * kw + (r.length - 1) * gap;
      const x0 = (CW - total) / 2;
      for (let k = 0; k < r.length; k++) {
        const x = x0 + k * (kw + gap), y = 790 + i * 96;
        g.fillStyle = '#2c2f38';
        g.beginPath();
        g.roundRect(x, y, kw, 78, 9);
        g.fill();
        g.fillStyle = '#e8ebf2';
        g.fillText(r[k], x + kw / 2, y + 40);
      }
    });
    g.fillStyle = '#2c2f38';
    g.beginPath();
    g.roundRect(150, 1080, 300, 78, 9);
    g.fill();
    g.fillStyle = '#9aa0ad';
    g.font = '400 24px Inter, sans-serif';
    g.fillText('space', 300, 1120);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(CW / 2 - 70, CH - 34, 140, 8);
  }

  private drawLock(t: number) {
    const g = this.g;
    // lock screen wallpaper: soft aurora gradient
    const bg = g.createLinearGradient(0, 0, CW, CH);
    bg.addColorStop(0, '#0f1b3d');
    bg.addColorStop(0.5, '#2a1748');
    bg.addColorStop(1, '#0b2a3a');
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);
    const glow = g.createRadialGradient(CW * 0.7, CH * 0.35, 10, CW * 0.7, CH * 0.35, 520);
    glow.addColorStop(0, 'rgba(255,140,170,0.45)');
    glow.addColorStop(1, 'rgba(255,140,170,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, CW, CH);
    this.statusBar();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = '500 26px Inter, sans-serif';
    g.fillText('Thursday 22 October', CW / 2, 168);
    g.font = '600 150px Inter, sans-serif';
    g.fillText('23:12', CW / 2, 300);
    g.textAlign = 'left';
    // notification card drops in
    const p = easeOut(ramp(t, 29.25, 29.7));
    if (p > 0) {
      const y = 380 + (1 - p) * -60;
      g.globalAlpha = p;
      g.fillStyle = 'rgba(40,44,58,0.82)';
      g.beginPath();
      g.roundRect(28, y, CW - 56, 150, 34);
      g.fill();
      const av = g.createLinearGradient(52, y + 30, 132, y + 110);
      av.addColorStop(0, '#5ad1ff');
      av.addColorStop(1, '#3a6cf0');
      g.fillStyle = av;
      g.beginPath();
      g.roundRect(52, y + 34, 82, 82, 20);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '600 30px Inter, sans-serif';
      g.textBaseline = 'middle';
      g.fillText('Alex', 156, y + 54);
      g.font = '400 28px Inter, sans-serif';
      g.fillText(MSG, 156, y + 98);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = '400 22px Inter, sans-serif';
      g.textAlign = 'right';
      g.fillText('now', CW - 56, y + 54);
      g.textAlign = 'left';
      g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(CW / 2 - 70, CH - 34, 140, 8);
  }
}

/** A stylised thumb: fleshy capsule with a nail, lit mostly by the screen beneath it. */
export function makeThumb(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x8a5a42, roughness: 0.6, sheen: 0.6, sheenColor: new THREE.Color(0xffc8a8), sheenRoughness: 0.5 });
  const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.032, 12, 28), skin);
  tip.scale.set(1, 1, 0.8);
  tip.position.y = 0.027;
  const base = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, 0.05, 12, 28), skin);
  base.position.y = 0.07;
  base.scale.set(1.05, 1, 0.85);
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 32, 20), skin);
  palm.scale.set(1, 1.3, 0.6);
  palm.position.set(-0.01, 0.13, -0.01);
  const nail = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 20, 12),
    new THREE.MeshPhysicalMaterial({ color: 0xe0b3a0, roughness: 0.25, clearcoat: 0.8 }));
  nail.scale.set(0.95, 1.5, 0.35);
  nail.position.set(0, 0.022, 0.0078);
  g.add(tip, base, palm, nail);
  return g;
}
