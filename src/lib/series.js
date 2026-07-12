// Generic time-series helpers. No domain knowledge — just dates and numbers, so
// these are reusable and trivially testable. Days are ISO "YYYY-MM-DD" strings.

export const median = (xs) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* ---------- day arithmetic (UTC, so DST never shifts a day) ---------- */
const MS = 86400000;
const parseDay = (d) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d, n) => new Date(parseDay(d) + n * MS).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((parseDay(b) - parseDay(a)) / MS); // b - a
export const enumerateDays = (a, b) => {
  const out = [];
  for (let n = 0, k = diffDays(a, b); n <= k; n++) out.push(addDays(a, n));
  return out;
};

// Collapse many dated entries into one value per day, sorted ascending.
// `reduce` turns a day's values into a single number (median for weight, sum for intake).
export function dailyReduce(entries, reduce) {
  const byDay = new Map();
  for (const e of entries) {
    if (!e || e.date == null || e.value == null || Number.isNaN(Number(e.value))) continue;
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(Number(e.value));
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, vals]) => ({ date, value: reduce(vals) }));
}

// Group dated entries by day → [{ date, items }], newest day first. Generic (the
// intake-log display and the chart's daily totals both use it).
export function groupByDay(entries) {
  const byDay = new Map();
  for (const e of entries) {
    if (!e || e.date == null) continue;
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] > b[0] ? -1 : 1)).map(([date, items]) => ({ date, items }));
}

// Expand a sparse daily series to every day in its span, filling gaps.
// method "interp": linear interpolation between known points (right for weight).
// method "hold": carry the previous value forward (right for a step-like signal).
// Returns [{ date, value, filled }] over the full [first,last] range.
export function fillDaily(daily, method = "interp") {
  if (daily.length === 0) return [];
  const days = enumerateDays(daily[0].date, daily[daily.length - 1].date);
  const known = new Map(daily.map((d) => [d.date, d.value]));
  const out = [];
  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    if (known.has(date)) { out.push({ date, value: known.get(date), filled: false }); continue; }
    if (method === "hold") {
      out.push({ date, value: out.length ? out[out.length - 1].value : daily[0].value, filled: true });
    } else {
      // linear interpolation between the nearest known points on either side
      const prev = out.length ? out[out.length - 1] : null;
      let nextIdx = i;
      while (nextIdx < days.length && !known.has(days[nextIdx])) nextIdx++;
      const next = nextIdx < days.length ? { date: days[nextIdx], value: known.get(days[nextIdx]) } : null;
      if (prev && next) {
        const frac = 1 / (diffDays(prev.date, next.date));
        out.push({ date, value: prev.value + (next.value - prev.value) * frac, filled: true });
      } else {
        out.push({ date, value: (prev || next || daily[0]).value, filled: true });
      }
    }
  }
  return out;
}

// Exponentially-weighted moving average. alpha in (0,1]; higher = more responsive.
export function ewma(values, alpha) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc = i === 0 ? values[i] : alpha * values[i] + (1 - alpha) * acc;
    out.push(acc);
  }
  return out;
}

// Ordinary least-squares fit of y against its index (x = 0,1,2,…, i.e. per-day).
// Returns slope (per step), intercept, and the standard error of the slope.
export function linreg(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0, slopeSE: Infinity };
  const xbar = (n - 1) / 2;
  const ybar = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (i - xbar) ** 2; sxy += (i - xbar) * (ys[i] - ybar); }
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let sse = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (intercept + slope * i); sse += r * r; }
  const s2 = n > 2 ? sse / (n - 2) : 0;
  return { slope, intercept, slopeSE: Math.sqrt(s2 / sxx) };
}

// OLS of y on arbitrary x (unlike linreg, x need not be 0,1,2,…). Returns slope per unit x,
// intercept, and the slope's standard error — from the ACTUAL points, so a sparse series
// doesn't get a falsely tiny SE the way fitting an interpolated grid would.
export function linregXY(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0, slopeSE: Infinity };
  const xbar = mean(xs), ybar = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - xbar) ** 2; sxy += (xs[i] - xbar) * (ys[i] - ybar); }
  if (sxx === 0) return { slope: 0, intercept: ybar, slopeSE: Infinity };
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let sse = 0;
  for (let i = 0; i < n; i++) { const r = ys[i] - (intercept + slope * xs[i]); sse += r * r; }
  const s2 = n > 2 ? sse / (n - 2) : 0;
  return { slope, intercept, slopeSE: Math.sqrt(s2 / sxx) };
}
