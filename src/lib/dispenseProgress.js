// Pure helpers for Home's "tonight's bowl" progress bar — how much of the target has
// actually been dispensed today, as opposed to just the target number itself (see
// resolveTarget in lib/targeting.js, which this deliberately does NOT touch — today's intake
// stays excluded from the expenditure estimate; this is display-only).

import { clamp } from "./util.js";

// Today's total dispensed kcal — sum of every intake entry logged on `today` (the owner's
// local day, see AppState.jsx's `today`). An explicit 0-kcal "nothing eaten" entry (see
// Log.jsx's addNothingEaten) sums to 0 same as a day with no entries at all — both are a real
// "nothing dispensed" day, not a missing-data one, so callers should treat 0 as "empty bar",
// never as "no data yet".
export function dispensedToday(intakeItems, today) {
  let sum = 0;
  for (const e of intakeItems || []) if (e?.date === today) sum += Number(e.kcal) || 0;
  return sum;
}

// Progress-bar geometry for dispensed-vs-target, pure percentage math (no rendering):
//   fillPct  — the ok-token segment's width, 0..100
//   overPct  — the warn-token overflow segment's width, 0..100 (0 while at-or-under target)
//   overKcal — kcal dispensed past target (0 while at-or-under)
//   isEmpty  — true when nothing's been dispensed yet (dispensed <= 0) — callers show the
//              bar's own "nothing dispensed yet" empty state rather than a 0%-wide fill
//
// At or under target, the bar's domain IS the target: fillPct is simply dispensed/target.
// Over target, the domain stretches to the dispensed total itself, so fillPct always marks
// "up to target" and overPct always marks the excess past it — the two sum to exactly 100
// (a full, overflowing bar) rather than fillPct alone exceeding 100%.
export function dispenseProgress(dispensed, target) {
  const d = Math.max(0, Number(dispensed) || 0);
  const t = Math.max(0, Number(target) || 0);
  const isEmpty = d <= 0;
  if (t <= 0 || d <= t) {
    return { fillPct: t > 0 ? clamp((d / t) * 100, 0, 100) : 0, overPct: 0, overKcal: 0, isEmpty };
  }
  const overKcal = d - t;
  return { fillPct: (t / d) * 100, overPct: (overKcal / d) * 100, overKcal, isEmpty };
}
