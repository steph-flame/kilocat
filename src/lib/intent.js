// The redesign's Intent model (Ration step 1): ONE basis + ONE signed rate → the daily target.
// Replaces the old app's two parallel systems (a goal preset that owned a direction, and a
// separate energy basis). Pure, no I/O.
//
// basis: 'measured' (the cat's own back-solved burn) | 'formula' (the vet MER). ratePctPerWeek is
// SIGNED, %/wk: negative = lose, positive = gain, 0 = hold. The sign carries the direction, so
// there's no separate direction control to fall out of sync.
//
// ρ (energy density of weight change) is the SAME KCAL_PER_KG the estimator back-solves with —
// 7800 kcal/kg, inferred from feline DEXA studies (see expenditure.js). Using one ρ in both
// directions is what keeps the target you set and the burn you measure telling the same story.
// (The design handoff annotated ~1960 here; that is a mockup slip — 4× below the defensible
// tissue-density range and never present in this codebase. Formula over numbers.)

import { RER } from "./nutrition.js";
import { KCAL_PER_KG } from "./expenditure.js";
import { num } from "./util.js";

export const RATE_MAX = 2; // %/wk magnitude cap (AAHA/APOP safe ceiling for cats)
export const RATE_STEP = 0.1; // slider snaps to 0.1
const clampMag = (n, m) => Math.max(-m, Math.min(m, n));

// Advisory recommended rate zone from body condition (% over ideal). Overweight → a loss zone,
// underweight → a gain zone, at-ideal → null (hold). Returned as SIGNED { lo, hi } %/wk. Advisory
// ONLY — it shades the slider and drives the caution copy, but never clamps the control. The
// BCS-6 case (10% over) is −1.0…−0.5, matching the handoff; severity widens/quickens it.
export function recommendedZone(pctOver) {
  const over = num(pctOver);
  if (over > 2) {
    if (over >= 30) return { lo: -2.0, hi: -1.0 };
    if (over >= 20) return { lo: -1.5, hi: -0.75 };
    return { lo: -1.0, hi: -0.5 };
  }
  if (over < -2) {
    if (over <= -20) return { lo: 1.0, hi: 2.0 };
    return { lo: 0.5, hi: 1.0 };
  }
  return null; // at ideal — hold
}

// Everything the Intent screen and everything downstream (tonight's target, the floor, Trend)
// derives from one basis + one signed rate. `measuredKcal` is the estimator's burn (null when
// there isn't enough data — then measured basis falls back to formula). `formulaKcal` is the vet
// MER maintenance. current/ideal in kg; pctOver from BCS.
export function computeIntent({ basis, ratePctPerWeek, measuredKcal, formulaKcal, currentKg, idealKg, pctOver }) {
  const usingMeasured = basis === "measured" && measuredKcal != null;
  const maintenance = usingMeasured ? measuredKcal : formulaKcal;
  const rho = KCAL_PER_KG;
  const W = num(currentKg);
  const rate = clampMag(num(ratePctPerWeek), RATE_MAX); // signed, |rate| ≤ 2

  // Signed daily energy offset from maintenance to move weight at `rate`. Negative rate → deficit
  // (target below maintenance); positive → surplus. Same ρ the estimator uses, both directions.
  const dailyDelta = (rho * (W * rate)) / 100 / 7;
  const floorKcal = 0.8 * RER(num(idealKg)); // nutritional floor — applies to LOSS only
  const rawTarget = maintenance + dailyDelta;
  const belowFloor = rate < 0 && rawTarget < floorKcal;
  const target = belowFloor ? floorKcal : rawTarget;

  // What the FINAL target (after the floor) actually delivers — slower than requested if floored.
  const resultingWeeklyChangeKg = maintenance > 0 && rho > 0 ? ((target - maintenance) * 7) / rho : 0; // signed
  const resultingRatePct = W > 0 ? (resultingWeeklyChangeKg / W) * 100 : 0; // signed
  const requestedWeeklyChangeKg = (W * rate) / 100; // signed, pre-floor

  // Weeks to reach ideal, only when the plan actually moves toward it.
  const gap = num(idealKg) - W; // <0 over (must lose), >0 under (must gain)
  const towardIdeal = Math.sign(gap) === Math.sign(resultingWeeklyChangeKg) && Math.abs(resultingWeeklyChangeKg) > 1e-9;
  const weeksToIdeal = towardIdeal ? Math.abs(gap) / Math.abs(resultingWeeklyChangeKg) : null;

  const zone = recommendedZone(pctOver);
  const inZone = zone ? rate >= zone.lo && rate <= zone.hi : Math.abs(rate) < 0.05;
  // A rate that pushes AWAY from ideal (e.g. a gain on an overweight cat) — the screen asks the
  // user to confirm these.
  const contraIndicated = zone != null && ((zone.hi < 0 && rate > 0) || (zone.lo > 0 && rate < 0));

  return {
    basis, usingMeasured, maintenance, rho, rate,
    target, floorKcal, belowFloor, dailyDelta,
    requestedWeeklyChangeKg, resultingWeeklyChangeKg, resultingRatePct, weeksToIdeal,
    zone, inZone, contraIndicated,
    aboveFloorBy: target - floorKcal,
  };
}
