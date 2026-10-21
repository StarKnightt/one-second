// Every frame is a pure function of time: draw(ctx, t) has no state, so any frame
// renders identically on its own. That is what makes the frame-by-frame render deterministic.

import {
  C, H, MONO, SANS, W, clamp, easeInOut, easeOut, hash, lerp, ramp, rgba,
} from './util';
import {
  ABYSS, CLOCK_T, DC, FIBER_X, FIBER_Y, GROUND, HOPS, LANDING_1, LANDING_2, LANDING_3,
  LANDING_4, PACKET_GAP, PHONE_A, PHONE_B, PHONE_H, PHONE_W, RESOLVER, ROUTER, SEA, SERVER, TOTAL_MS,
  TOWER, buzzWindows, camera, clockMs, headX, returnX, routeY, terrain, type Cam,
} from './world';

let ctx: CanvasRenderingContext2D;
let cam: Cam;
let T = 0;

const sx = (x: number) => (x - cam.x) * cam.z + W / 2;
const sy = (y: number) => (y - cam.y) * cam.z + H / 2;
const pw = (px: number) => px / cam.z; // screen px → world units
const vx0 = () => cam.x - W / 2 / cam.z;
const vx1 = () => cam.x + W / 2 / cam.z;
const vy0 = () => cam.y - H / 2 / cam.z;
const vy1 = () => cam.y + H / 2 / cam.z;
const onScreen = (x0: number, y0: number, x1: number, y1: number) =>
  x1 >= vx0() && x0 <= vx1() && y1 >= vy0() && y0 <= vy1();

function worldSpace() {
  ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
}
function screenSpace() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
function stroke(color: string, px = 1.5, dash?: number[]) {
  ctx.strokeStyle = color;
  ctx.lineWidth = pw(px);
  ctx.setLineDash(dash ? dash.map(pw) : []);
  ctx.stroke();
}
function line(x0: number, y0: number, x1: number, y1: number, color: string, px = 1.5, dash?: number[]) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  stroke(color, px, dash);
}
function rrect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function circle(x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
/** World-space text, skipped when too small or absurdly large on screen. */
function wtext(s: string, x: number, y: number, size: number, color: string, font = SANS, weight = 400,
  align: CanvasTextAlign = 'left') {
  const screenSize = size * cam.z;
  if (screenSize < 3 || screenSize > 600) return;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
/** Stroke a world-space function y = f(x) across the visible part of [x0, x1]. */
function strokeFn(f: (x: number) => number, x0: number, x1: number) {
  const a = Math.max(x0, vx0() - 20 / cam.z);
  const b = Math.min(x1, vx1() + 20 / cam.z);
  if (b <= a) return false;
  const step = Math.max(pw(4), (b - a) / 3000);
  ctx.beginPath();
  ctx.moveTo(a, f(a));
  for (let x = a + step; x < b; x += step) ctx.lineTo(x, f(x));
  ctx.lineTo(b, f(b));
  return true;
}

// ---- backdrop ----------------------------------------------------------------

function backdrop() {
  screenSpace();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // adaptive dot grid in world space: every power-of-ten lattice that is a sensible size on screen
  for (let k = -2; k <= 4; k++) {
    const g = Math.pow(10, k);
    const sp = g * cam.z;
    const a = 0.16 * ramp(sp, 36, 140) * (1 - ramp(sp, 1500, 3800));
    if (a <= 0.001) continue;
    ctx.fillStyle = `rgba(196, 214, 240, ${a})`;
    const i0 = Math.floor(vx0() / g), i1 = Math.ceil(vx1() / g);
    const j0 = Math.floor(vy0() / g), j1 = Math.ceil(vy1() / g);
    for (let i = i0; i <= i1; i++) {
      const X = sx(i * g);
      for (let j = j0; j <= j1; j++) ctx.fillRect(X - 1, sy(j * g) - 1, 2, 2);
    }
  }
}

// ---- terrain and ocean -------------------------------------------------------

function landAndSea() {
  worldSpace();
  const x0 = 3300, x1 = 14100;
  // the ground only matters at the coasts: fade it in and out so the phones float free
  const fade = (col: string, a: number) => {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    const span = x1 - x0;
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop((4000 - x0) / span, rgba(col, a));
    g.addColorStop((13500 - x0) / span, rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    return g;
  };
  if (strokeFn(terrain, x0, x1)) {
    ctx.lineTo(Math.min(x1, vx1() + 20 / cam.z), vy1() + 2000);
    ctx.lineTo(Math.max(x0, vx0() - 20 / cam.z), vy1() + 2000);
    ctx.closePath();
    ctx.fillStyle = fade(C.bgLift, 1);
    ctx.fill();
  }
  if (strokeFn(terrain, x0, x1)) {
    ctx.strokeStyle = fade('#c4d6f0', 0.26);
    ctx.lineWidth = pw(1.5);
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // water: surface line with small travelling waves, plus dashed depth contours
  const seas: [number, number][] = [[4560, 8040], [10560, 12940]];
  for (const [a, b] of seas) {
    if (!onScreen(a, SEA - 40, b, ABYSS + 100)) continue;
    const wave = (x: number) => SEA + 3.5 * Math.sin(x / 34 - T * 2.2) + 2 * Math.sin(x / 13 + T * 1.3);
    if (strokeFn(wave, a, b)) stroke(C.line, 1.5);
    for (let d = 1; d <= 3; d++) {
      const y = SEA + d * 175;
      // contour only where the water is deeper than this line
      let inside = false;
      ctx.beginPath();
      const s0 = Math.max(a, vx0()), s1 = Math.min(b, vx1());
      const step = Math.max(pw(6), 4);
      for (let x = s0; x <= s1; x += step) {
        const wet = terrain(x) > y + 20;
        if (wet && !inside) ctx.moveTo(x, y);
        else if (wet) ctx.lineTo(x, y);
        inside = wet;
      }
      stroke(C.faint, 1, [3, 9]);
    }
  }
}

// ---- route ---------------------------------------------------------------------

function routeLine() {
  worldSpace();
  const start = PHONE_A.x + PHONE_W / 2;
  const end = PHONE_B.x - PHONE_W / 2;
  // under the racks the route runs at floor level; drawn the same everywhere for clarity
  if (strokeFn(routeY, start, end)) stroke(C.dim, 1.5);
  // travelled portion
  const out = clamp(headX(T), start, SERVER.x);
  if (T > 6 && strokeFn(routeY, start, out)) stroke(C.accentSoft, 2);
  if (T > 31.3) {
    const r = clamp(returnX(T), SERVER.x, end);
    if (strokeFn(routeY, SERVER.x, r)) stroke(C.accentSoft, 2);
  }
}

// ---- phones ----------------------------------------------------------------------

const MSG = 'on my way! there in 10';

function phoneBody(cx: number, cy: number, lit: number) {
  rrect(cx - PHONE_W / 2, cy - PHONE_H / 2, PHONE_W, PHONE_H, 58);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.line, 2);
  rrect(cx - PHONE_W / 2 + 14, cy - PHONE_H / 2 + 14, PHONE_W - 28, PHONE_H - 28, 46);
  stroke(rgba('#c4d6f0', 0.14 + 0.16 * lit), 1);
  // dynamic island
  rrect(cx - 52, cy - PHONE_H / 2 + 30, 104, 30, 15);
  stroke(C.dim, 1.2);
  // side buttons
  line(cx + PHONE_W / 2 + 4, cy - 200, cx + PHONE_W / 2 + 4, cy - 110, C.dim, 2);
  line(cx - PHONE_W / 2 - 4, cy - 230, cx - PHONE_W / 2 - 4, cy - 180, C.dim, 2);
  line(cx - PHONE_W / 2 - 4, cy - 160, cx - PHONE_W / 2 - 4, cy - 90, C.dim, 2);
  // home indicator
  line(cx - 60, cy + PHONE_H / 2 - 30, cx + 60, cy + PHONE_H / 2 - 30, rgba('#c4d6f0', 0.2 + 0.3 * lit), 3);
}

function statusBar(cx: number, cy: number, col: string) {
  const y = cy - PHONE_H / 2 + 45;
  // signal bars
  for (let i = 0; i < 4; i++) line(cx + 92 + i * 7, y + 7, cx + 92 + i * 7, y + 7 - 4 - i * 3, col, 2);
  // battery
  rrect(cx + 126, y - 6, 26, 13, 3.5);
  stroke(col, 1.2);
  ctx.fillStyle = col;
  ctx.fillRect(cx + 129, y - 3, 16, 7);
  // wifi glyph
  for (let r = 1; r <= 3; r++) {
    ctx.beginPath();
    ctx.arc(cx - 128, y + 7, r * 4.2, -Math.PI * 0.75, -Math.PI * 0.25);
    stroke(col, 1.4);
  }
}

function bubble(x: number, y: number, text: string, mine: boolean, color: string, textColor: string, size = 19) {
  ctx.font = `400 ${size}px ${SANS}`;
  const w = ctx.measureText(text).width + 30;
  const bx = mine ? x - w : x;
  rrect(bx, y - 22, w, 44, 20);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(color, mine ? 1.6 : 1.2);
  wtext(text, bx + 15, y + 1, size, textColor);
  return w;
}

function phoneA() {
  const { x: cx, y: cy } = PHONE_A;
  if (!onScreen(cx - 260, cy - 400, cx + 260, cy + 400)) return;
  worldSpace();
  phoneBody(cx, cy, 1);
  statusBar(cx, cy, C.muted);
  // conversation header
  circle(cx, cy - 268, 20);
  stroke(C.dim, 1.2);
  wtext('A', cx, cy - 267, 18, C.muted, SANS, 500, 'center');
  wtext('Alex', cx, cy - 228, 17, C.muted, SANS, 500, 'center');
  line(cx - 166, cy - 204, cx + 166, cy - 204, C.faint, 1);
  // history
  bubble(cx + 150, cy - 40, 'leaving now', true, C.dim, C.muted);
  bubble(cx - 150, cy + 40, 'landed! you close?', false, C.dim, C.muted);

  // the new message: input → sent bubble
  const sent = easeInOut(ramp(T, 1.66, 2.15));
  if (T >= 1.66) {
    const y = lerp(cy + 302, cy + 130, sent);
    ctx.globalAlpha = ramp(T, 1.66, 1.8);
    bubble(cx + 150, y, MSG, true, C.accent, C.text);
    ctx.globalAlpha = 1;
    if (T > 2.4) wtext('Delivered', cx + 150, cy + 168, 13, rgba('#d6e2f4', 0.5 * ramp(T, 2.4, 2.8)), SANS, 400, 'right');
  }
  // input field
  rrect(cx - 152, cy + 280, 246, 44, 22);
  stroke(C.dim, 1.2);
  if (T < 1.66) {
    wtext(MSG, cx - 136, cy + 303, 17, C.text);
    ctx.font = `400 17px ${SANS}`;
    const cw = ctx.measureText(MSG).width;
    if (Math.floor(T * 2.2) % 2 === 0) line(cx - 133 + cw, cy + 292, cx - 133 + cw, cy + 314, C.accent, 1.6);
  } else {
    // placeholder returns once the sent bubble has cleared the field
    wtext('Message', cx - 136, cy + 303, 17, rgba('#d6e2f4', 0.3 * ramp(T, 2.0, 2.3)));
  }
  // send button
  const press = ramp(T, 1.5, 1.62) * (1 - ramp(T, 1.75, 1.95));
  circle(cx + 125, cy + 302, 22 - 2 * press);
  ctx.fillStyle = T < 1.66 ? C.accent : rgba('#ff8a3d', 0.25);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 125, cy + 313);
  ctx.lineTo(cx + 125, cy + 291);
  ctx.moveTo(cx + 116, cy + 300);
  ctx.lineTo(cx + 125, cy + 291);
  ctx.lineTo(cx + 134, cy + 300);
  stroke(T < 1.66 ? C.bg : C.accent, 2.2);
  // touch ripple
  if (T > 1.6 && T < 2.8) {
    const p = ramp(T, 1.6, 2.8);
    circle(cx + 125, cy + 302, 22 + easeOut(p) * 90);
    stroke(rgba('#ff8a3d', 0.7 * (1 - p)), 1.5);
    circle(cx + 125, cy + 302, 22 + easeOut(ramp(T, 1.7, 2.8)) * 50);
    stroke(rgba('#ff8a3d', 0.5 * (1 - p)), 1);
  }
  thumb();
}

function thumb() {
  if (T > 3.2) return;
  const inP = easeInOut(ramp(T, 0.3, 1.6));
  const outP = easeInOut(ramp(T, 1.85, 3.1));
  const tx = lerp(lerp(420, 128, inP), 520, outP);
  const ty = lerp(lerp(760, 306, inP), 820, outP);
  const ang = (52 * Math.PI) / 180;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(ang - Math.PI / 2);
  // local frame: tip at origin, thumb extends toward +y
  const r = 62;
  ctx.beginPath();
  ctx.moveTo(-r, r);
  ctx.arc(0, r, r, Math.PI, 0);
  ctx.lineTo(r + 6, 620);
  ctx.lineTo(-r - 6, 620);
  ctx.closePath();
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.line, 1.8);
  // nail
  rrect(-38, 22, 76, 104, 34);
  stroke(C.dim, 1.2);
  // knuckle creases
  line(-r - 2, 300, -r + 28, 304, C.faint, 1.2);
  line(r + 2, 300, r - 30, 305, C.faint, 1.2);
  ctx.restore();
}

function phoneB() {
  const { x: cx, y: cy } = PHONE_B;
  if (!onScreen(cx - 300, cy - 420, cx + 300, cy + 420)) return;
  const wake = ramp(T, 34.45, 34.7);
  const buzzing = buzzAmount(T);
  const jx = (hash(Math.floor(T * 240)) - 0.5) * 9 * buzzing;
  const jy = (hash(Math.floor(T * 240) + 7) - 0.5) * 4 * buzzing;
  worldSpace();
  ctx.save();
  ctx.translate(jx, jy);
  phoneBody(cx, cy, wake);
  statusBar(cx, cy, rgba('#d6e2f4', 0.15 + 0.5 * wake));
  // lock glyph
  rrect(cx - 9, cy - 262, 18, 14, 3);
  stroke(rgba('#c4d6f0', 0.2 + 0.4 * wake), 1.2);
  ctx.beginPath();
  ctx.arc(cx, cy - 263, 6, Math.PI, 0);
  stroke(rgba('#c4d6f0', 0.2 + 0.4 * wake), 1.2);
  // notification banner
  const drop = easeOut(ramp(T, 34.55, 35.0));
  if (drop > 0) {
    const y = lerp(cy - 330, cy - 200, drop);
    ctx.globalAlpha = drop;
    rrect(cx - 150, y, 300, 84, 22);
    ctx.fillStyle = C.bg;
    ctx.fill();
    stroke(C.accent, 1.6);
    circle(cx - 118, y + 42, 17);
    stroke(C.dim, 1.2);
    wtext('S', cx - 118, y + 43, 15, C.muted, SANS, 500, 'center');
    wtext('Sam', cx - 90, y + 28, 16, C.text, SANS, 600);
    wtext('now', cx + 134, y + 28, 13, C.muted, SANS, 400, 'right');
    wtext(MSG, cx - 90, y + 55, 16, C.text);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // vibration marks either side
  if (buzzing > 0.01) {
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const off = PHONE_W / 2 + 26 + k * 22;
        const a = buzzing * (0.9 - k * 0.25);
        ctx.beginPath();
        ctx.arc(cx + s * (off - 80), cy - 120, 80, s > 0 ? -0.35 : Math.PI - 0.35, s > 0 ? 0.35 : Math.PI + 0.35);
        stroke(rgba('#ff8a3d', a), 2);
        ctx.beginPath();
        ctx.arc(cx + s * (off - 80), cy + 120, 80, s > 0 ? -0.35 : Math.PI - 0.35, s > 0 ? 0.35 : Math.PI + 0.35);
        stroke(rgba('#ff8a3d', a), 2);
      }
    }
  }
}

/** Two vibration pulses, matched to the audio buzz. */
export function buzzAmount(t: number): number {
  const pulse = (a: number, b: number) => ramp(t, a, a + 0.04) * (1 - ramp(t, b - 0.06, b));
  return Math.max(...buzzWindows.map(([a, b]) => pulse(a, b)));
}

// ---- message → bytes → packets ------------------------------------------------------

const HEX = Array.from({ length: 64 }, (_, i) => Math.floor(hash(i + 3.1) * 256).toString(16).padStart(2, '0'));

/** The message leaving the phone and turning into encrypted bytes. */
function messageFlight() {
  if (T < 3.8 || T > 6.2) return;
  worldSpace();
  const p = easeInOut(ramp(T, 3.85, 4.95));
  // start: sent bubble in phone A; end: byte strip on the route
  const w0 = 256, h0 = 44, cx0 = PHONE_A.x + 150 - w0 / 2, cy0 = PHONE_A.y + 130;
  const w1 = 3 * 100, h1 = 44, cx1 = 650, cy1 = 0;
  const cx = lerp(cx0, cx1, p);
  const cy = lerp(cy0, cy1, p) - Math.sin(p * Math.PI) * 60;
  const w = lerp(w0, w1, p), h = lerp(h0, h1, p);
  const split = easeInOut(ramp(T, 5.05, 6.0));
  if (split > 0) return; // packets() takes over
  rrect(cx - w / 2, cy - h / 2, w, h, lerp(20, 4, p));
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.accent, 1.6);
  ctx.save();
  ctx.clip();
  // encryption: each character flips to a hex digit at its own moment
  const enc = ramp(T, 4.15, 4.85);
  const digits = '0123456789abcdef';
  const scrambled = MSG.split('').map((ch, i) => {
    if (hash(i * 7.3 + 1) >= enc) return ch;
    return digits[Math.floor(hash(i * 3.7 + Math.floor(T * 24)) * 16)];
  }).join('');
  wtext(scrambled, cx - w / 2 + 15, cy + 1, 18, enc > 0.9 ? C.muted : C.text, MONO);
  ctx.restore();
}

interface PacketState { x: number; y: number; ang: number; alpha: number; light: number }

function packetState(i: number): PacketState | null {
  if (T < 5.05) return null;
  if (T < 31.3) {
    // outbound
    if (T < 6.0) {
      const split = easeInOut(ramp(T, 5.05, 6.0));
      const x = lerp(750 - i * 100, 820 - i * PACKET_GAP, split);
      return { x, y: 0, ang: 0, alpha: 1, light: 0 };
    }
    let x = headX(T) - i * PACKET_GAP;
    const up = clamp((x - SERVER.x) / 130);
    if (up >= 1) return null;
    x = Math.min(x, SERVER.x);
    return frameOnRoute(x, up, false);
  }
  let x = returnX(T) - i * PACKET_GAP;
  const down = clamp((SERVER.x - x) / 130);
  if (down >= 1) return null;
  x = Math.max(x, SERVER.x);
  const end = PHONE_B.x - PHONE_W / 2;
  if (x > end + 110) return null;
  const s = frameOnRoute(Math.min(x, end), down, true);
  s.alpha *= 1 - ramp(x, end, end + 110);
  return s;
}

function frameOnRoute(x: number, serverLift: number, ret: boolean): PacketState {
  const y = routeY(x);
  const dy = routeY(x + 4) - routeY(x - 4);
  const ang = Math.atan2(dy, 8);
  const light = ret
    ? ramp(x, LANDING_3 + 60, LANDING_3 + 220) * (1 - ramp(x, LANDING_4 - 220, LANDING_4 - 60))
    : ramp(x, LANDING_1 + 60, LANDING_1 + 220) * (1 - ramp(x, LANDING_2 - 220, LANDING_2 - 60));
  return {
    x,
    y: lerp(y, SERVER.y, easeInOut(serverLift)),
    ang: ang * (1 - serverLift),
    alpha: 1 - ramp(serverLift, 0.55, 1),
    light,
  };
}

function packets() {
  worldSpace();
  const detail = ramp(cam.z, 0.3, 0.55);
  const streakFade = 1 - ramp(cam.z, 3, 6);
  for (let i = 2; i >= 0; i--) {
    const s = packetState(i);
    if (!s) continue;
    if (!onScreen(s.x - 400, s.y - 400, s.x + 400, s.y + 400)) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.ang);
    ctx.globalAlpha = s.alpha;
    // light form (inside the fiber): a bright streak with a soft halo
    if (s.light > 0 && streakFade > 0) {
      const L = 150;
      ctx.globalAlpha = s.alpha * s.light * streakFade;
      for (const [wpx, a] of [[14, 0.08], [7, 0.18], [3, 1]] as const) {
        line(-L, 0, 0, 0, rgba('#ff8a3d', a), wpx);
      }
      circle(0, 0, pw(4));
      ctx.fillStyle = '#ffd2b3';
      ctx.fill();
    }
    const box = 1 - s.light;
    if (box > 0) {
      ctx.globalAlpha = s.alpha * box;
      if (detail > 0) {
        ctx.globalAlpha = s.alpha * box * detail;
        drawPacket(i);
      }
      if (detail < 1) {
        ctx.globalAlpha = s.alpha * box * (1 - detail);
        circle(0, 0, pw(6));
        ctx.fillStyle = C.accent;
        ctx.fill();
        line(-pw(60), 0, -pw(8), 0, C.accentSoft, 3);
      }
    }
    ctx.restore();
  }
}

/** One packet in local coords: header block + payload, centered on the origin. */
function drawPacket(i: number) {
  const split = T < 6.0 ? easeInOut(ramp(T, 5.05, 6.0)) : 1;
  const hw = 40 * split; // header grows in during the split
  const x0 = -50 - hw;
  rrect(x0, -22, 100 + hw, 44, 4);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.accent, 1.6);
  if (hw > 2) {
    ctx.fillStyle = C.accentFaint;
    ctx.fillRect(x0, -22, hw, 44);
    line(-50, -22, -50, 22, C.accent, 1.2);
    wtext(`${i + 1}/3`, x0 + hw / 2, 1, 13, rgba('#ff8a3d', split), MONO, 500, 'center');
  }
  for (let k = 0; k < 4; k++) wtext(HEX[(i * 4 + k) % 64], -40 + k * 23.5, 1, 13, C.muted, MONO);
}

// ---- packet anatomy panel (scene 02/03) ----------------------------------------------

function anatomy() {
  const a = ramp(T, 6.2, 6.9) * (1 - ramp(T, 11.2, 11.7));
  if (a <= 0) return;
  worldSpace();
  const x = 360, y = 112, w = 680, h = 214;
  const reveal = easeOut(a);
  // leader from packet 1 header
  line(820 - 70, 22, 820 - 70, y, rgba('#ff8a3d', 0.6 * reveal), 1.2, [4, 4]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 4, y - 4, w + 8, (h + 8) * reveal);
  ctx.clip();
  rrect(x, y, w, h, 6);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.dim, 1.2);
  wtext('PACKET 1 OF 3', x + 20, y + 26, 16, C.accent, MONO, 500);
  wtext('≤ 1,500 bytes', x + w - 20, y + 26, 16, C.muted, MONO, 400, 'right');
  const rows: [string, [string, number, boolean][]][] = [
    ['IP', [['src 192.168.1.23', 280, false], ['dst ' + dstText(), 280, T > 10.75]]],
    ['TCP', [['port 443', 200, false], ['seq 1 / 3', 360, false]]],
    ['data', [['encrypted message bytes', 568, false]]],
  ];
  rows.forEach(([name, cells], r) => {
    const ry = y + 58 + r * 50;
    wtext(name, x + 20, ry + 18, 15, C.muted, MONO);
    let cx = x + 92;
    for (const [label, cw, hot] of cells) {
      rrect(cx, ry, cw - 8, 36, 4);
      stroke(hot ? C.accent : C.dim, hot ? 1.6 : 1.1);
      if (name === 'data') {
        ctx.save();
        ctx.clip();
        for (let k = 0; k < 40; k++) line(cx + k * 16, ry + 36, cx + k * 16 + 36, ry, C.faint, 1);
        ctx.restore();
      }
      wtext(label, cx + 14, ry + 19, 17, hot ? C.text : C.muted, MONO);
      cx += cw;
    }
  });
  ctx.restore();
}

function dstText(): string {
  if (T < 10.75) return '?.?.?.?';
  return '203.0.113.10';
}

// ---- DNS (scene 03) -----------------------------------------------------------------------

function dns() {
  const a = ramp(T, 8.6, 9.2) * (1 - ramp(T, 13.4, 14.2));
  if (a <= 0) return;
  worldSpace();
  ctx.globalAlpha = a;
  const { x, y } = RESOLVER;
  serverBox(x, y, 1);
  wtext('DNS RESOLVER', x, y + 74, 16, C.muted, MONO, 500, 'center');
  const fx = PHONE_A.x + 150, fy = PHONE_A.y - PHONE_H / 2 + 40;
  line(fx, fy, x - 60, y + 20, C.dim, 1.2, [5, 6]);
  // query up, answer down
  const q = easeInOut(ramp(T, 9.5, 10.15));
  const r = easeInOut(ramp(T, 10.25, 10.75));
  const mid = (p: number) => [lerp(fx, x - 60, p), lerp(fy, y + 20, p)];
  if (q > 0 && q < 1) {
    const [qx, qy] = mid(q);
    circle(qx, qy, pw(5));
    ctx.fillStyle = C.accent;
    ctx.fill();
  }
  if (r > 0 && r < 1) {
    const [qx, qy] = mid(1 - r);
    circle(qx, qy, pw(5));
    ctx.fillStyle = C.accent;
    ctx.fill();
  }
  const ang = Math.atan2(y + 20 - fy, x - 60 - fx);
  const [mx, my] = mid(0.5);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  ctx.globalAlpha = a * ramp(T, 9.5, 9.8);
  wtext('A?  chat.example.com', 0, -22, 19, C.text, MONO, 400, 'center');
  ctx.globalAlpha = a * ramp(T, 10.3, 10.6);
  wtext('→  203.0.113.10', 0, 24, 19, C.accent, MONO, 500, 'center');
  ctx.restore();
  ctx.globalAlpha = 1;
}

function serverBox(x: number, y: number, lit: number, w = 120, slots = 3) {
  const h = slots * 22 + 10;
  rrect(x - w / 2, y - h / 2, w, h, 5);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.line, 1.4);
  for (let s = 0; s < slots; s++) {
    const sy0 = y - h / 2 + 5 + s * 22;
    if (s > 0) line(x - w / 2, sy0, x + w / 2, sy0, C.dim, 1);
    for (let k = 0; k < 3; k++) {
      const on = hash(s * 13 + k * 7 + Math.floor(T * 5 + s)) > 0.45;
      ctx.fillStyle = on ? rgba('#ff8a3d', 0.4 + 0.6 * lit) : C.faint;
      ctx.fillRect(x + w / 2 - 16 - k * 9, sy0 + 9, 4, 4);
    }
    line(x - w / 2 + 10, sy0 + 11, x - 10, sy0 + 11, C.faint, 1);
  }
}

// ---- home router, ISP, landing stations ------------------------------------------------

function router() {
  const { x, y } = ROUTER;
  if (!onScreen(x - 300, y - 300, x + 300, y + 300)) return;
  worldSpace();
  // antennas
  line(x - 55, y - 22, x - 75, y - 92, C.line, 1.6);
  line(x + 55, y - 22, x + 75, y - 92, C.line, 1.6);
  rrect(x - 90, y - 24, 180, 48, 10);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.line, 1.6);
  const busy = ramp(T, 13.0, 13.2) * (1 - ramp(T, 14.2, 14.6));
  for (let k = 0; k < 4; k++) {
    const on = hash(k * 3 + Math.floor(T * 9)) > 0.4;
    ctx.fillStyle = on && busy > 0 ? C.accent : C.dim;
    ctx.fillRect(x - 60 + k * 18, y + 4, 6, 6);
  }
  wtext('ROUTER', x + 64, y - 6, 12, C.muted, MONO, 500, 'right');
  // Wi-Fi radio between phone and router while packets cross
  const wifi = ramp(T, 11.4, 11.8) * (1 - ramp(T, 13.4, 13.9));
  if (wifi > 0) {
    for (let k = 0; k < 5; k++) {
      const ph = ((T * 1.4 + k / 5) % 1);
      ctx.beginPath();
      ctx.arc(PHONE_A.x + PHONE_W / 2, 0, 40 + ph * 900, -0.32, 0.32);
      stroke(rgba('#c4d6f0', 0.4 * wifi * (1 - ph)), 1.4);
    }
  }
}

function isp() {
  if (!onScreen(ROUTER.x, -600, LANDING_1, 600)) return;
  worldSpace();
  // faint mesh of other routers in the provider's network
  const mesh: [number, number][] = [
    [2050, -330], [2550, -300], [3050, -340], [3550, -290], [4000, -320],
    [2150, 330], [2650, 310], [3150, 350], [3650, 300], [4050, 330],
  ];
  const nodes: [number, number][] = [...HOPS];
  for (const [mx, my] of mesh) {
    for (const [hx, hy] of nodes) {
      if (Math.abs(mx - hx) < 520) line(mx, my, hx, hy, C.faint, 1);
    }
    circle(mx, my, 10);
    ctx.fillStyle = C.bg;
    ctx.fill();
    stroke(C.dim, 1.2);
  }
  HOPS.forEach(([hx, hy], i) => {
    const pass = headX(T) > hx ? 1 : 0;
    const near = ramp(headX(T), hx - 200, hx) * (1 - ramp(headX(T), hx + 300, hx + 700));
    circle(hx, hy, 20);
    ctx.fillStyle = C.bg;
    ctx.fill();
    stroke(pass ? C.accent : C.line, 1.6);
    circle(hx, hy, 6);
    ctx.fillStyle = pass ? C.accent : C.dim;
    ctx.fill();
    if (near > 0) {
      circle(hx, hy, 20 + near * 16);
      stroke(rgba('#ff8a3d', 0.5 * near), 1);
    }
    wtext(`hop ${i + 1}`, hx, hy + (hy < 0 ? -42 : 44), 16, C.muted, MONO, 400, 'center');
  });
}

function landingStation(x: number, label: string) {
  if (!onScreen(x - 200, -300, x + 200, 300)) return;
  worldSpace();
  rrect(x - 50, GROUND - 70, 100, 70, 4);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.line, 1.4);
  line(x - 50, GROUND - 52, x + 50, GROUND - 52, C.dim, 1);
  wtext(label, x, GROUND - 92, 15, C.muted, MONO, 400, 'center');
}

// ---- undersea cable -------------------------------------------------------------------------

function repeaters() {
  worldSpace();
  const spots = [5050, 5450, 7000, 7400, 11000, 11500, 12000, 12400];
  for (const x of spots) {
    if (!onScreen(x - 60, 0, x + 60, 1100)) continue;
    const y = routeY(x);
    const dy = routeY(x + 4) - routeY(x - 4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, 8));
    rrect(-26, -9, 52, 18, 9);
    ctx.fillStyle = C.bg;
    ctx.fill();
    stroke(C.line, 1.4);
    ctx.restore();
  }
}

/** Longitudinal cutaway of a deep-sea cable around FIBER_X. Not to scale. */
function fiberCutaway() {
  const d = ramp(cam.z, 3.5, 12);
  if (d <= 0) return;
  worldSpace();
  ctx.globalAlpha = d;
  const y0 = FIBER_Y;
  const x0 = vx0() - 1, x1 = vx1() + 1;
  // layers step back to reveal what's inside; mirror on the far side
  const layer = (r: number, cutL: number, cutR: number, color: string, px: number, fill?: string) => {
    for (const [a, b] of [[Math.max(x0, FIBER_X - 400), FIBER_X - cutL], [FIBER_X + cutR, Math.min(x1, FIBER_X + 400)]]) {
      if (b <= a) continue;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(a, y0 - r, b - a, 2 * r);
      }
      line(a, y0 - r, b, y0 - r, color, px);
      line(a, y0 + r, b, y0 + r, color, px);
      // end cap at the cut
      if (b === FIBER_X - cutL) line(b, y0 - r, b, y0 + r, color, px);
      if (a === FIBER_X + cutR) line(a, y0 - r, a, y0 + r, color, px);
    }
  };
  layer(6.5, 12, 60, C.line, 1.6, C.bg);
  // copper sheath: fine longitudinal lines
  layer(4.1, 9, 63, C.line, 1.2, C.bgLift);
  layer(3.7, 9, 63, C.dim, 1);
  // steel strength wires: helical hatching
  const steelL = FIBER_X - 6, steelR = FIBER_X + 66;
  for (const [a, b] of [[Math.max(x0, FIBER_X - 400), steelL], [steelR, Math.min(x1, FIBER_X + 400)]]) {
    if (b <= a) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, y0 - 3.7, b - a, 7.4);
    ctx.clip();
    for (let x = Math.floor(a / 0.7) * 0.7 - 3; x < b + 3; x += 0.7) {
      line(x, y0 - 3.7, x + 1.4, y0 - 1.6, C.dim, 1);
      line(x, y0 + 1.6, x + 1.4, y0 + 3.7, C.dim, 1);
    }
    ctx.restore();
  }
  layer(3.7, 6, 66, C.line, 1.2);
  layer(1.6, 3, 69, C.line, 1.2, C.bg);
  // fibers run through the gap
  const fibers = [-1.0, -0.5, 0, 0.5, 1.0];
  for (const fy of fibers) {
    const y = y0 + fy;
    line(Math.max(x0, FIBER_X - 400), y - 0.2, Math.min(x1, FIBER_X + 400), y - 0.2, fy === 0 ? C.line : C.dim, 1.2);
    line(Math.max(x0, FIBER_X - 400), y + 0.2, Math.min(x1, FIBER_X + 400), y + 0.2, fy === 0 ? C.line : C.dim, 1.2);
    line(Math.max(x0, FIBER_X - 400), y - 0.06, Math.min(x1, FIBER_X + 400), y - 0.06, C.faint, 1);
    line(Math.max(x0, FIBER_X - 400), y + 0.06, Math.min(x1, FIBER_X + 400), y + 0.06, C.faint, 1);
  }
  ctx.globalAlpha = 1;
  lightPulses(d);
}

/** Light pulses travelling along the fibers, in screen space so they read at any zoom. */
function lightPulses(d: number) {
  screenSpace();
  const fibers = [-1.0, -0.5, 0, 0.5, 1.0];
  const speed = 2100; // px / s
  fibers.forEach((fy, f) => {
    const y = sy(FIBER_Y + fy);
    if (y < -40 || y > H + 40) return;
    const core = clamp(0.1 * cam.z, 1.2, 9);
    const off = T * speed * (f === 2 ? 1 : 0.85 + 0.06 * f) + f * 377;
    const spacing = f === 2 ? 150 : 210;
    const base = Math.floor(off / spacing);
    for (let k = -2; k < W / spacing + 3; k++) {
      const id = base + k;
      const on = hash(id * 1.37 + f * 11) > (f === 2 ? 0.25 : 0.55);
      if (!on) continue;
      const len = 30 + 90 * hash(id * 3.1 + f);
      const xs = k * spacing - (off - base * spacing);
      const col = f === 2 ? '#ff8a3d' : '#c4d6f0';
      const peak = f === 2 ? 1 : 0.2;
      for (const [wm, a] of [[4, 0.07], [2.2, 0.16], [1, 1]] as const) {
        ctx.beginPath();
        ctx.moveTo(xs, y);
        ctx.lineTo(xs + len, y);
        ctx.strokeStyle = rgba(col, a * peak * d);
        ctx.lineWidth = core * wm;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  });
}

// ---- data center -------------------------------------------------------------------------------

function dataCenter() {
  const { x0, x1, top, floor } = DC;
  if (!onScreen(x0 - 100, top - 200, x1 + 100, floor + 100)) return;
  worldSpace();
  ctx.beginPath();
  ctx.rect(x0, top, x1 - x0, floor - top);
  ctx.fillStyle = C.bg;
  ctx.fill();
  stroke(C.line, 1.6);
  // cooling units on the roof
  for (let i = 0; i < 5; i++) {
    const cx = x0 + 120 + i * 190;
    rrect(cx - 60, top - 46, 120, 46, 4);
    ctx.fillStyle = C.bg;
    ctx.fill();
    stroke(C.dim, 1.2);
    circle(cx, top - 23, 16);
    stroke(C.dim, 1);
    const a = T * 9 + i;
    for (let b = 0; b < 3; b++) {
      const ang = a + (b * Math.PI * 2) / 3;
      line(cx, top - 23, cx + Math.cos(ang) * 14, top - 23 + Math.sin(ang) * 14, C.dim, 1);
    }
  }
  wtext('DATA CENTER', x0 + 24, top + 30, 16, C.muted, MONO, 500);
  // racks
  const active = ramp(T, 27.4, 27.7) * (1 - ramp(T, 31.2, 31.6));
  for (let r = 0; r < 6; r++) {
    const rx = x0 + 70 + r * 150;
    const ry0 = top + 60, ry1 = -40;
    rrect(rx, ry0, 110, ry1 - ry0, 3);
    stroke(C.line, 1.2);
    const slots = 10;
    const sh = (ry1 - ry0) / slots;
    for (let s = 0; s < slots; s++) {
      const syy = ry0 + s * sh;
      if (s > 0) line(rx, syy, rx + 110, syy, C.dim, 1);
      const hot = r === 2 && s === slots - 1;
      for (let k = 0; k < 2; k++) {
        const on = hash(r * 31 + s * 7 + k * 3 + Math.floor(T * 6 + r * 0.37 + s * 0.21)) > 0.5;
        ctx.fillStyle = hot && active > 0 ? C.accent : on ? 'rgba(196,214,240,0.5)' : C.faint;
        ctx.fillRect(rx + 88 - k * 12, syy + sh / 2 - 2.5, 5, 5);
      }
      if (hot) {
        rrect(rx + 2, syy + 2, 106, sh - 4, 2);
        stroke(rgba('#ff8a3d', 0.25 + 0.75 * active), 1.6);
        if (active > 0) {
          ctx.fillStyle = rgba('#ff8a3d', 0.1 * active + 0.05 * active * Math.sin(T * 12));
          ctx.fill();
        }
      }
    }
  }
  // connector from floor to the hot server
  line(SERVER.x, 0, SERVER.x, -40, C.dim, 1.2);
}

// ---- cell tower (destination side) ---------------------------------------------------------------

function tower() {
  const { x, y } = TOWER;
  if (!onScreen(x - 300, y - 500, x + 600, y + 100)) return;
  worldSpace();
  const top = y - 330;
  line(x - 55, y, x, top, C.line, 1.5);
  line(x + 55, y, x, top, C.line, 1.5);
  for (let k = 1; k < 6; k++) {
    const yy = lerp(y, top, k / 6);
    const hw = lerp(55, 0, k / 6);
    line(x - hw, yy, x + hw, yy, C.dim, 1);
    const yy2 = lerp(y, top, (k - 1) / 6);
    const hw2 = lerp(55, 0, (k - 1) / 6);
    line(x - hw2, yy2, x + hw, yy, C.faint, 1);
  }
  rrect(x - 8, top - 30, 16, 40, 3);
  stroke(C.line, 1.4);
  wtext('CELL TOWER', x, y + 30, 15, C.muted, MONO, 400, 'center');
  const radio = ramp(T, 33.6, 33.9) * (1 - ramp(T, 34.6, 35.0));
  if (radio > 0) {
    for (let k = 0; k < 5; k++) {
      const ph = (T * 1.6 + k / 5) % 1;
      ctx.beginPath();
      ctx.arc(x, top - 10, 30 + ph * 520, -0.5, 0.5);
      stroke(rgba('#c4d6f0', 0.4 * radio * (1 - ph)), 1.4);
    }
  }
}

// ---- callouts (screen-space labels with leader lines) -------------------------------------------

interface Callout {
  t0: number;
  t1: number;
  at: [number, number];
  dx: number;
  dy: number;
  title?: string;
  lines?: string[];
  small?: boolean;
  stagger?: number;
}

const CALLOUTS: Callout[] = [
  { t0: 1.75, t1: 4.1, at: [PHONE_A.x + 125, PHONE_A.y + 302], dx: 240, dy: -250, title: '01 · TOUCH',
    lines: ['You tap send.', 'The capacitive screen senses your thumb.'] },
  { t0: 5.4, t1: 8.7, at: [650, -24], dx: 120, dy: -170, title: '02 · PACKETS',
    lines: ['The message is encrypted and', 'cut into packets.'] },
  { t0: 9.1, t1: 12.5, at: [RESOLVER.x + 62, RESOLVER.y - 20], dx: 120, dy: -80, title: '03 · DNS LOOKUP',
    lines: ['The server\'s name is turned into', 'an IP address, so packets know', 'where to go.'] },
  { t0: 12.7, t1: 15.5, at: [ROUTER.x, ROUTER.y - 26], dx: 110, dy: -230, title: '04 · HOME ROUTER',
    lines: ['Wi-Fi carries the packets to your router.', 'NAT swaps 192.168.1.23 for your', 'public address, 198.51.100.7.'] },
  { t0: 15.5, t1: 18.0, at: [HOPS[1][0], HOPS[1][1] - 22], dx: 80, dy: -250, title: '05 · YOUR ISP',
    lines: ['Routers forward each packet,', 'hop by hop, toward the', 'destination network.'] },
  { t0: 17.5, t1: 19.4, at: [LANDING_1, GROUND - 70], dx: -60, dy: -140, small: true, title: 'CABLE LANDING STATION' },
  { t0: 18.9, t1: 20.9, at: [5600, routeY(5600)], dx: 90, dy: -250, title: '06 · UNDERSEA CABLE',
    lines: ['Packets cross the ocean as', 'pulses of light in glass fiber.'] },
  { t0: 19.1, t1: 20.8, at: [5450, routeY(5450) + 9], dx: 150, dy: 110, small: true, title: 'OPTICAL AMPLIFIER EVERY ~50–70 KM' },
  { t0: 21.3, t1: 23.4, at: [FIBER_X - 16, FIBER_Y + 6.5], dx: -80, dy: 100, small: true, title: 'POLYETHYLENE JACKET' },
  { t0: 21.45, t1: 23.4, at: [FIBER_X - 10, FIBER_Y - 4.1], dx: 40, dy: -190, small: true, title: 'COPPER · CARRIES POWER TO THE AMPLIFIERS' },
  { t0: 21.6, t1: 23.4, at: [FIBER_X - 7.5, FIBER_Y + 3.0], dx: -50, dy: 160, small: true, title: 'STEEL STRENGTH WIRES' },
  { t0: 21.75, t1: 23.4, at: [FIBER_X + 6, FIBER_Y + 1.0], dx: 90, dy: 200, small: true, title: 'GLASS OPTICAL FIBERS' },
  { t0: 23.9, t1: 26.0, at: [FIBER_X + 2.2, FIBER_Y], dx: 120, dy: -330, title: 'LIGHT IN GLASS', stagger: 0.18,
    lines: ['≈ 200,000 km/s, two-thirds of', 'light\'s speed in a vacuum.', '6,000 km of cable ≈ 30 ms.'] },
  { t0: 24.1, t1: 26.0, at: [FIBER_X + 4.5, FIBER_Y + 0.5], dx: 60, dy: 230, small: true, title: '1550 NM INFRARED · NOT TO SCALE' },
  { t0: 28.0, t1: 31.2, at: [DC.x1, -150], dx: 50, dy: -110, title: '07 · DATA CENTER', stagger: 0.5,
    lines: ['A server unwraps the TLS layer,', 'stores the message,', 'finds the recipient\'s phone,', 'and asks Apple or Google to push it.'] },
  { t0: 32.3, t1: 34.5, at: [11700, routeY(11700)], dx: -220, dy: -300, title: 'BACK ACROSS THE WORLD',
    lines: ['8,000 km under another ocean ≈ 40 ms,', 'then a mobile network to the phone.'] },
  { t0: 34.8, t1: 36.9, at: [PHONE_B.x + 150, PHONE_B.y - 160], dx: 140, dy: -170, title: '08 · SECOND PHONE',
    lines: ['A push notification arrives.', 'The vibration motor buzzes.'] },
];

function drawCallout(c: Callout) {
  if (T < c.t0 || T > c.t1) return;
  const ax = sx(c.at[0]), ay = sy(c.at[1]);
  const out = easeInOut(ramp(T, c.t1 - 0.45, c.t1));
  const pDot = easeOut(ramp(T, c.t0, c.t0 + 0.25)) * (1 - out);
  const pLine = easeOut(ramp(T, c.t0 + 0.08, c.t0 + 0.55)) * (1 - out);
  const ex = ax + c.dx, ey = ay + c.dy;
  const side = c.dx >= 0 ? 1 : -1;
  const titleFont = c.small ? `500 19px ${MONO}` : `500 21px ${MONO}`;
  ctx.font = titleFont;
  ctx.letterSpacing = '1.5px';
  let len = c.title ? ctx.measureText(c.title).width : 0;
  ctx.letterSpacing = '0px';
  const lines = c.lines ?? [];
  lines.forEach((s, i) => {
    ctx.font = i === 0 ? `500 33px ${SANS}` : `400 29px ${SANS}`;
    len = Math.max(len, ctx.measureText(s).width);
  });
  len += 12;

  // dot
  circle(ax, ay, 4 + 2 * pDot);
  ctx.fillStyle = rgba('#ff8a3d', pDot);
  ctx.fill();
  circle(ax, ay, 11 * pDot);
  ctx.strokeStyle = rgba('#ff8a3d', 0.6 * pDot);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // leader: diagonal then horizontal
  const d1 = clamp(pLine * 2), d2 = clamp(pLine * 2 - 1);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(lerp(ax, ex, d1), lerp(ay, ey, d1));
  if (d2 > 0) ctx.lineTo(ex + side * len * d2, ey);
  ctx.strokeStyle = 'rgba(214, 226, 244, 0.75)';
  ctx.lineWidth = 1.3;
  ctx.setLineDash([]);
  ctx.stroke();

  // text, wiped in from the elbow
  const tx = side > 0 ? ex : ex - len;
  const reveal = (delay: number) => easeInOut(ramp(T, c.t0 + 0.3 + delay, c.t0 + 0.75 + delay)) * (1 - out);
  const wipe = (p: number, y0: number, y1: number, fn: () => void) => {
    if (p <= 0) return;
    ctx.save();
    ctx.beginPath();
    if (side > 0) ctx.rect(ex, y0, len * p, y1 - y0);
    else ctx.rect(ex - len * p, y0, len * p, y1 - y0);
    ctx.clip();
    fn();
    ctx.restore();
  };
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (c.title) {
    wipe(reveal(0), ey - 50, ey, () => {
      ctx.font = titleFont;
      ctx.letterSpacing = '1.5px';
      ctx.fillStyle = c.small ? C.text : C.accent;
      ctx.fillText(c.title!, tx + 2, ey - 14);
      ctx.letterSpacing = '0px';
    });
  }
  lines.forEach((s, i) => {
    const y = ey + 46 + i * 41;
    wipe(reveal(0.1 + i * (c.stagger ?? 0.08)), y - 36, y + 12, () => {
      ctx.font = i === 0 ? `500 33px ${SANS}` : `400 29px ${SANS}`;
      ctx.fillStyle = i === 0 ? C.text : C.muted;
      ctx.fillText(s, tx + 2, y);
    });
  });
  // data-center checklist ticks
  if (c.title === '07 · DATA CENTER') {
    lines.forEach((_, i) => {
      const p = reveal(0.1 + i * (c.stagger ?? 0));
      if (p <= 0) return;
      const y = ey + 46 + i * 41 - 11;
      const x = tx - 30;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6 * clamp(p * 2), y + 6 * clamp(p * 2));
      if (p > 0.5) ctx.lineTo(x + 6 + 10 * clamp(p * 2 - 1), y + 6 - 13 * clamp(p * 2 - 1));
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
}

// ---- HUD clock → end-card timeline ---------------------------------------------------------------

function hud() {
  screenSpace();
  const show = ramp(T, 0.6, 1.2);
  const morph = easeInOut(ramp(T, 36.7, 38.1));
  const ms = clockMs(T);
  // label + number fade out as the bar becomes the timeline axis
  const textA = show * (1 - ramp(T, 36.6, 37.0));
  if (textA > 0) {
    ctx.save();
    ctx.globalAlpha = textA;
    ctx.font = `500 17px ${MONO}`;
    ctx.letterSpacing = '2px';
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('ELAPSED', 72, 72);
    ctx.letterSpacing = '0px';
    ctx.font = `400 44px ${MONO}`;
    ctx.fillStyle = T < CLOCK_T[0] ? C.muted : C.text;
    const n = Math.round(ms).toString().padStart(3, '0');
    ctx.fillText(n, 72, 122);
    const nw = ctx.measureText(n).width;
    ctx.font = `400 24px ${MONO}`;
    ctx.fillStyle = C.muted;
    ctx.fillText('ms', 72 + nw + 10, 122);
    ctx.font = `400 15px ${MONO}`;
    ctx.fillStyle = 'rgba(214, 226, 244, 0.45)';
    ctx.fillText('typical figures · example route', 72, 204);
    ctx.restore();
  }
  // the 0 → 1 s scale bar
  const bx = lerp(72, 160, morph), by = lerp(146, 850, morph), bw = lerp(300, 1600, morph);
  ctx.globalAlpha = show;
  ctx.strokeStyle = C.dim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + bw, by);
  ctx.stroke();
  const ticks = 10;
  for (let k = 0; k <= ticks; k++) {
    const x = bx + (bw * k) / ticks;
    const th = k === 0 || k === ticks ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(x, by - th);
    ctx.lineTo(x, by + th);
    ctx.stroke();
  }
  ctx.fillStyle = C.accent;
  const fillW = (bw * Math.min(ms, 1000)) / 1000;
  ctx.fillRect(bx, by - 3, fillW, 6);
  ctx.font = `400 ${lerp(13, 20, morph)}px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  ctx.fillText('0', bx, by + lerp(28, 40, morph));
  ctx.fillText('1 s', bx + bw, by + lerp(28, 40, morph));
  if (morph > 0) {
    for (let k = 1; k < ticks; k++) {
      ctx.fillStyle = rgba('#d6e2f4', 0.4 * morph);
      ctx.fillText(`${k * 100}`, bx + (bw * k) / ticks, by + 40);
    }
  }
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

/** Final frame: route on top, time underneath, fanned lines tying places to moments. */
function endCard() {
  const a = ramp(T, 37.4, 38.0);
  if (a <= 0) return;
  screenSpace();
  const bx = 160, by = 850, bw = 1600;
  const stops: [string, number, number, number][] = [
    ['tap', PHONE_A.x + PHONE_W / 2, 0, -PHONE_H / 2],
    ['router', ROUTER.x, 24, -100],
    ['coast', LANDING_1, 34, -100],
    ['far shore', LANDING_2, 64, -100],
    ['server', SERVER.x, 76, DC.top - 50],
    ['buzz', PHONE_B.x - PHONE_W / 2, TOTAL_MS, -PHONE_H / 2],
  ];
  stops.forEach(([name, wx, ms, top], i) => {
    const p = easeInOut(ramp(T, 37.5 + i * 0.12, 38.1 + i * 0.12));
    if (p <= 0) return;
    const x0 = sx(wx), y0 = sy(routeY(wx)) + 14;
    const x1 = bx + (bw * ms) / 1000, y1 = by - 14;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(lerp(x0, x1, p), lerp(y0, y1, p));
    ctx.strokeStyle = rgba('#d6e2f4', 0.38);
    ctx.lineWidth = 1;
    ctx.stroke();
    circle(x0, y0 - 14, 4);
    ctx.fillStyle = C.accent;
    ctx.fill();
    ctx.globalAlpha = p;
    ctx.font = `400 17px ${MONO}`;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    ctx.fillText(name, wx === SERVER.x || i === 0 || i === 5 ? sx(wx === SERVER.x ? wx : wx + (i === 0 ? -PHONE_W / 2 : PHONE_W / 2)) : x0, sy(top) - 16);
    ctx.globalAlpha = 1;
  });
  // marker on the axis
  const mx = bx + (bw * TOTAL_MS) / 1000;
  const mp = easeOut(ramp(T, 38.2, 38.7));
  if (mp > 0) {
    ctx.globalAlpha = mp;
    ctx.beginPath();
    ctx.moveTo(mx, by - 12);
    ctx.lineTo(mx, by - 70);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = `500 26px ${MONO}`;
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'left';
    ctx.fillText('≈ 150 ms', mx + 12, by - 50);
    ctx.globalAlpha = 1;
  }
  // headline, top-left, wiped in
  const hp = easeInOut(ramp(T, 38.3, 39.0));
  if (hp > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(150, 60, 1700 * hp, 200);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.font = `400 64px ${SANS}`;
    ctx.fillStyle = C.text;
    ctx.fillText('The whole trip took less than a second.', 160, 150);
    ctx.font = `400 28px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText('Tap to buzz in about 150 ms on this example route. Typical figures; real times vary.', 160, 206);
    ctx.restore();
  }
}

// ---- composition -----------------------------------------------------------------------------------

export function draw(context: CanvasRenderingContext2D, t: number) {
  ctx = context;
  T = t;
  cam = camera(t);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  backdrop();
  landAndSea();
  routeLine();
  repeaters();
  fiberCutaway();
  isp();
  router();
  landingStation(LANDING_1, 'LANDING');
  landingStation(LANDING_2, 'LANDING');
  landingStation(LANDING_3, 'LANDING');
  landingStation(LANDING_4, 'LANDING');
  dataCenter();
  tower();
  dns();
  phoneA();
  phoneB();
  anatomy();
  messageFlight();
  packets();
  screenSpace();
  for (const c of CALLOUTS) drawCallout(c);
  hud();
  endCard();
}
