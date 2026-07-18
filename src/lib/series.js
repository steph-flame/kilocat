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

// Local-calendar date (YYYY-MM-DD) for an epoch-ms timestamp — deliberately LOCAL, not UTC
// (unlike addDays/diffDays/enumerateDays above, which operate on date-ONLY strings and stay
// in UTC on purpose so DST never shifts a day). A weigh-in's `ts` is a real moment in time,
// and the day it "happened on" is whatever day it was on the clock on the wall where the cat
// lives — an 11pm Litter-Robot visit in a western timezone is UTC-tomorrow but still today,
// locally. Uses the Date object's local getters (not toISOString, which is always UTC), so
// this reads the runtime's configured timezone rather than assuming one.
export function localDateOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Self-healing normalization for weigh-in entries logged before `today` (see AppState.jsx)
// was derived in LOCAL time instead of UTC: such an entry's `date` may be off by one from
// its own `ts` near midnight in a UTC-negative timezone (the UTC-sliced `today` of the time
// briefly disagreeing with the wall-clock day). `ts` is a real moment in time — ground
// truth — so on load, re-derive `date` from it via localDateOf whenever the two disagree.
// Idempotent (a second pass is a no-op) and safe: it only ever moves `date` to match `ts`,
// never the other way. Entries with no `ts` (backfilled or future-dated manual weigh-ins —
// see manualWeighInStamp) have nothing to re-derive from and are returned unchanged; the SAME
// object reference when nothing changes, matching patchEntry's identity-preserving contract.
export function repairWeighInDate(entry) {
  if (!Number.isFinite(entry?.ts)) return entry;
  const date = localDateOf(entry.ts);
  return date === entry.date ? entry : { ...entry, date };
}

// A manual weigh-in's { date, ts } stamp: the owner-picked date, plus a real ts ONLY when
// that date is today (a live "log now") — a backfilled past (or future-dated) entry has no
// actual time-of-day behind it, so it's stamped date-only (see Log.jsx's per-entry time
// display, which shows nothing for a ts-less entry). Pure — nowTs is injectable for testing.
export function manualWeighInStamp(pickedDate, nowTs = Date.now()) {
  return pickedDate === localDateOf(nowTs) ? { date: pickedDate, ts: nowTs } : { date: pickedDate };
}

// Merge `patch` into the entry with matching id; every other entry is returned as the SAME
// object reference (not a fresh copy) so a caller memoizing on entry identity doesn't see
// spurious changes. Generic — the weight and intake logs' edit() both go through this.
export function patchEntry(items, id, patch) {
  return items.map((e) => (e.id === id ? { ...e, ...patch } : e));
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
