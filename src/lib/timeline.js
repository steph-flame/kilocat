// Assemble the per-day frame the timeline chart draws: weight + intake + expenditure,
// aligned by date and clipped to a selected range. Pure — no SVG, no React.

import { dailyReduce, addDays, diffDays, ewma } from "./series.js";

export const RANGES = [
  { key: "1w", days: 7, label: "1W" },
  { key: "1m", days: 30, label: "1M" },
  { key: "3m", days: 90, label: "3M" },
  { key: "6m", days: 180, label: "6M" },
  { key: "1y", days: 365, label: "1Y" },
];

// trend: [{ date, kg, e?, sd? }] over the full history (from an estimator).
// intakeEntries: [{ date, value: kcal }] (summed per day here).
// rangeDays: clip to the last N days ending at the most recent trend date.
// intakeDayStatus: the cat's { "YYYY-MM-DD": "incomplete" } flags (see lib/expenditure.js's
// buildIntakeDayMap, the same seam the estimator reads through) — used only to mark
// `kinImputed` here, never to change what `kin` displays: a flagged day still shows its real
// logged total (the owner did log something), just flagged as excluded from the estimate, so
// the chart doesn't quietly imply that number was trusted.
// → [{ date, w, kin, kinImputed, e, sd }] one per day in range (kin/e/sd may be null).
export function buildDailyFrame(trend, intakeEntries, rangeDays, intakeDayStatus = {}) {
  if (!trend || trend.length === 0) return [];
  const intakeByDay = new Map(dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0)).map((d) => [d.date, d.value]));
  const last = trend[trend.length - 1].date;
  const cutoff = rangeDays ? addDays(last, -(rangeDays - 1)) : trend[0].date;
  return trend
    .filter((p) => p.date >= cutoff)
    .map((p) => {
      const hasEntries = intakeByDay.has(p.date);
      return {
        date: p.date,
        w: p.kg ?? null,
        e: p.e ?? null,
        sd: p.sd ?? null,
        kin: hasEntries ? intakeByDay.get(p.date) : null,
        // true when the estimator did NOT trust this day's number: either no entries at all
        // (already null, so nothing to draw hollow) or entries exist but the day is flagged
        // incomplete (a real point the chart should still show, just not as solid/trusted).
        kinImputed: !hasEntries || intakeDayStatus?.[p.date] === "incomplete",
      };
    });
}

// How many days of history exist (for enabling/disabling range buttons).
export const historySpanDays = (trend) =>
  trend && trend.length ? diffDays(trend[0].date, trend[trend.length - 1].date) + 1 : 0;

// Smoothed weight-change rate from a per-day frame ([{ w }]): the derivative of the (already
// de-noised) trend weight, EWMA-smoothed. Returns per-point { kgPerWeek, pctPerWeek } aligned
// to the frame; the first point is null (no prior day to difference against).
export function weightChangeRate(frame, alpha = 0.3) {
  const diffs = frame.map((p, i) => (i === 0 || p.w == null || frame[i - 1].w == null ? 0 : p.w - frame[i - 1].w));
  const smooth = ewma(diffs, alpha); // kg/day, smoothed
  return frame.map((p, i) => {
    if (i === 0 || p.w == null) return { kgPerWeek: null, pctPerWeek: null };
    const kgPerWeek = smooth[i] * 7;
    return { kgPerWeek, pctPerWeek: p.w > 0 ? (kgPerWeek / p.w) * 100 : 0 };
  });
}

// Direct end-of-line label placement (above vs. below the final point) for a chart panel
// where two series can end near each other. Two collision risks, checked in priority order:
// 1. Its OWN incoming line segment: if the series was rising into the last point, that segment
//    approaches from below, so the label goes above (and vice versa) — otherwise the label
//    sits right on top of the stroke that draws it.
// 2. The OTHER series' end label in the same panel: when the two final points land within
//    `minGapPx` of each other, keeping each label on its assigned default side matters more
//    than dodging one line, so that wins instead.
// Pure — takes plain numbers (values + already-scaled pixel y's), no pixel-scale math itself.
export function pickEndLabelBelow({ prevValue, lastValue, preferBelow, ownPx, otherPx, minGapPx = 16 }) {
  if (otherPx != null && ownPx != null && Math.abs(ownPx - otherPx) < minGapPx) return preferBelow;
  if (prevValue == null || lastValue == null || prevValue === lastValue) return preferBelow;
  return lastValue < prevValue; // falling into the last point → approaches from above → label below
}
