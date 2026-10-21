// World geometry shared by the film and the timeline. One continuous 2D world,
// laid out left to right in the order the message actually travels.

import { lerp, monotone, piecewise, ramp } from './util';

export const PHONE_A = { x: 0, y: 0 };
export const PHONE_B = { x: 14000, y: 0 };
export const PHONE_W = 360;
export const PHONE_H = 740;

export const RESOLVER = { x: 900, y: -640 };
export const ROUTER = { x: 1700, y: 0 };
export const HOPS: [number, number][] = [
  [2300, -110],
  [2800, 90],
  [3300, -70],
  [3800, 60],
];
export const LANDING_1 = 4300;
export const LANDING_2 = 8300;
export const DC = { x0: 8850, x1: 9850, top: -360, floor: 70 };
export const SERVER = { x: 9275, y: -52 };
export const LANDING_3 = 10300;
export const LANDING_4 = 13150;
export const TOWER = { x: 13470, y: 70 };
export const GROUND = 70;
export const SEA = 200;
export const ABYSS = 900;
export const FIBER_X = 6200;
export const PACKET_GAP = 170;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Ground profile: land, continental slope, abyssal plain, slope, land. */
export function terrain(x: number): number {
  const basin = (x0: number, x1: number) => {
    // descent over 550 units at each side
    const down = smooth(ramp(x, x0, x0 + 550));
    const up = smooth(ramp(x, x1 - 550, x1));
    return down * (1 - up);
  };
  const b1 = basin(4400, 8200);
  const b2 = basin(10400, 13100);
  const depth = Math.max(b1, b2);
  // gentle seabed relief, flattened near the fiber close-up so the cable reads level
  const relief = 34 * Math.sin(x / 410) + 18 * Math.sin(x / 173 + 1.3);
  const flat = ramp(Math.abs(x - FIBER_X), 450, 950);
  return lerp(GROUND, ABYSS + relief * flat, depth);
}

/** The route the packets take. x-monotone, so y is a function of x. */
const ISP_X = [ROUTER.x, ...HOPS.map((h) => h[0]), LANDING_1];
const ISP_Y = [0, ...HOPS.map((h) => h[1]), 0];
const isp = piecewise(ISP_X, ISP_Y);

export function routeY(x: number): number {
  if (x <= ROUTER.x) return 0;
  if (x <= LANDING_1) return isp(x);
  const sub = (a: number, b: number) => {
    // station at a → down to cable on seabed → up to station at b
    if (x < a + 100) return lerp(0, GROUND - 12, smooth(ramp(x, a, a + 100)));
    if (x > b - 100) return lerp(GROUND - 12, 0, smooth(ramp(x, b - 100, b)));
    return terrain(x) - 12;
  };
  if (x <= LANDING_2) return sub(LANDING_1, LANDING_2);
  if (x <= LANDING_3) return 0;
  if (x <= LANDING_4) return sub(LANDING_3, LANDING_4);
  return 0;
}

export const FIBER_Y = routeY(FIBER_X);

// ---- timing --------------------------------------------------------------

/** Film seconds → elapsed milliseconds of the real trip (typical figures, example route). */
export const CLOCK_T = [1.6, 6.0, 11.4, 13.9, 18.2, 26.6, 28.0, 31.4, 34.6, 35.3];
export const CLOCK_MS = [0, 1, 21, 24, 34, 64, 66, 76, 146, 150];
export const clockMs = piecewise(CLOCK_T, CLOCK_MS);
export const TOTAL_MS = 150;

/** The second phone's two vibration pulses (seconds), shared by picture and sound. */
export const buzzWindows: [number, number][] = [[35.3, 35.68], [35.86, 36.24]];

/** Outbound packet train: x of the lead packet over time. */
export const headX = monotone(
  [6.0, 11.4, 13.2, 13.8, 17.2, 18.2, 19.9, 21.0, 26.6, 28.2],
  [820, 850, 1700, 1780, 3900, 4500, 5600, 6300, 8300, SERVER.x + PACKET_GAP * 2 + 130],
);

/** Return packet train, from the server to the second phone. */
export const returnX = monotone(
  [31.3, 32.6, 34.5],
  [SERVER.x - 130, 10600, PHONE_B.x - PHONE_W / 2 + PACKET_GAP * 2 + 120],
);

// ---- camera ----------------------------------------------------------------

type Key = [t: number, x: number, y: number, z: number];
const KEYS: Key[] = [
  [0.0, 70, 200, 2.0],
  [2.6, 40, 150, 1.72],
  [4.4, 330, 0, 0.95],
  [6.6, 640, -100, 1.12],
  [8.8, 760, -250, 0.92],
  [11.2, 860, -230, 0.92],
  [13.6, 1650, 0, 1.0],
  [16.3, 3100, 0, 0.72],
  [18.1, 4500, 330, 0.72],
  [19.8, 5660, 700, 1.15],
  [21.2, FIBER_X, FIBER_Y, 30],
  [23.3, FIBER_X + 1.5, FIBER_Y, 36],
  [24.1, FIBER_X + 3, FIBER_Y, 150],
  [25.9, FIBER_X + 5, FIBER_Y, 135],
  [26.9, 7350, 640, 0.9],
  [28.1, 9530, -40, 1.0],
  [30.8, 9560, -50, 1.07],
  [32.6, 7000, 380, 0.125],
  [33.8, 7300, 380, 0.13],
  [35.2, PHONE_B.x - 10, 0, 1.0],
  [36.6, PHONE_B.x - 5, 0, 1.07],
  [38.1, 7000, 560, 0.125],
  [40.0, 7000, 560, 0.121],
];
const camX = monotone(KEYS.map((k) => k[0]), KEYS.map((k) => k[1]));
const camY = monotone(KEYS.map((k) => k[0]), KEYS.map((k) => k[2]));
const camZ = monotone(KEYS.map((k) => k[0]), KEYS.map((k) => Math.log(k[3])));

export interface Cam { x: number; y: number; z: number }
export function camera(t: number): Cam {
  return { x: camX(t), y: camY(t), z: Math.exp(camZ(t)) };
}

