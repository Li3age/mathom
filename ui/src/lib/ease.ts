/**
 * Easing curves, in the same language CSS uses: a cubic Bézier with the two
 * control points pinned at (0,0) and (1,1), so `x` is time and `y` is progress.
 * Writing them as curves rather than as formulas is the point — `cubic-bezier`
 * is what every other animation in the app is described with, and a curve can
 * be read off a design reference without translating it into a function first.
 *
 * The evaluation samples the curve into a table and inverts it: the animation
 * loop asks "at this time, how far along?", which is the inverse of the
 * parameterisation, and solving that per frame costs more than it is worth.
 * 32 samples is well under a device pixel of error over a 300ms transition.
 */
const SAMPLES = 32;

function bezierAxis(a: number, b: number, t: number): number {
  // (1-t)³·0 + 3(1-t)²t·a + 3(1-t)t²·b + t³·1
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

export function bezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (t: number) => number {
  // time → parameter, monotone because a CSS curve keeps 0 ≤ x ≤ 1.
  const xs = new Float64Array(SAMPLES + 1);
  const ys = new Float64Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    xs[i] = bezierAxis(p1x, p2x, t);
    ys[i] = bezierAxis(p1y, p2y, t);
  }
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    const f = span > 0 ? (t - xs[lo]) / span : 0;
    return ys[lo] + (ys[hi] - ys[lo]) * f;
  };
}

/**
 * The three curves the map moves on. Each change gets the one that reads as
 * that change: a view zoom is a camera move and wants a real ease-in with a
 * long settle; something opening or resizing is already visible and only needs
 * to decelerate.
 */
export const EASE = {
  /** Changing the view root: slow off the mark, then a long soft landing. */
  zoom: bezier(0.2, 0, 0.15, 1),
  /** A folder opening or closing inside the view. */
  open: bezier(0.16, 0.8, 0.2, 1),
  /** The same map refitted: a resize, a filter, another scan tick. */
  move: bezier(0.25, 0.6, 0.2, 1),
} as const;
