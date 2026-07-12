// Pure scale helpers for charts — domain math only, no SVG.

// [min, max] over numbers, ignoring null/undefined/NaN.
export function extent(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  return lo === Infinity ? [0, 1] : [lo, hi];
}

// "Nice" round tick values spanning [min, max] (the Heckbert nice-number algorithm).
export function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

function niceNum(x, round) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

// Linear map from a numeric domain to a pixel range. Guards a zero-width domain.
export function linScale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}
