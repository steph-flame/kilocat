// Energy-target prescription for a chosen direction — lose, maintain, or gain. Turns a
// maintenance number (measured or formula-derived) into a daily Calorie target.
//
// Safety (AAHA / APOP): cats change weight slowly — the conservative end for cats, which
// are prone to hepatic lipidosis if slimmed too fast. Loss/gain rate ~0.5–2% of body
// weight/week; loss target floors at ~0.8 × RER at ideal weight. Sources in README.

import { RER } from "./nutrition.js";
import { KCAL_PER_KG } from "./expenditure.js";

export const RATE = { min: 0.5, max: 2, default: 1 }; // % body weight change per week
export const DIRECTIONS = ["lose", "maintain", "gain"];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Default direction from body condition when the user hasn't picked one.
export const autoDirection = (pctOver) => (pctOver > 2 ? "lose" : pctOver < -2 ? "gain" : "maintain");

// The %/week zone that counts as "safe" for a given feeding direction — used by the timeline
// chart's rate-panel shading. Pure data (no pixels, no SVG): for lose/gain it's the
// RATE.min–RATE.max band on the side of zero the plan is actually aiming for (loss is
// negative, gain is positive — the rate axis reads "loss −"). For maintain there's no
// directional target, so it's a thin band centered on zero ("holding steady" reads as safe
// too, not just active loss/gain). MAINTAIN_BAND is a presentational tolerance for what counts
// as "basically flat" on the chart, not a measured statistic.
export const MAINTAIN_BAND = 0.25; // %/week
export function safeRateBand(direction) {
  if (direction === "gain") return { lo: RATE.min, hi: RATE.max };
  if (direction === "lose") return { lo: -RATE.max, hi: -RATE.min };
  return { lo: -MAINTAIN_BAND, hi: MAINTAIN_BAND };
}

// direction: "lose" | "maintain" | "gain". currentKg/idealKg from the profile.
export function planWeightChange({ direction, maintenanceKcal, currentKg, idealKg, pctPerWeek = RATE.default, rho = KCAL_PER_KG }) {
  const requested = pctPerWeek;

  if (direction === "maintain") {
    return { direction, applicable: true, rate: 0, requested, weeklyChangeKg: 0, dailyDelta: 0,
      targetKcal: maintenanceKcal, floorKcal: null, belowFloor: false, weeksToIdeal: null,
      resultingRatePctPerWeek: 0, resultingWeeklyChangeKg: 0, warnings: [] };
  }

  const gain = direction === "gain";
  const sign = gain ? 1 : -1;
  const rate = clamp(pctPerWeek, RATE.min, RATE.max);
  const dailyDelta = sign * ((rho * (currentKg * rate)) / 100) / 7; // + surplus / − deficit
  const floorKcal = 0.8 * RER(idealKg);
  const rawTarget = maintenanceKcal + dailyDelta;
  const belowFloor = !gain && rawTarget < floorKcal; // nutritional floor applies to loss only
  const targetKcal = belowFloor ? floorKcal : rawTarget;

  // The rate the FINAL target actually delivers (slower than requested if the floor bound).
  const resultingWeeklyChangeKg = ((targetKcal - maintenanceKcal) * 7) / rho; // signed
  const resultingRatePctPerWeek = currentKg > 0 ? (Math.abs(resultingWeeklyChangeKg) / currentKg) * 100 : 0;

  const gap = idealKg - currentKg; // gain wants +, lose wants −
  const towardIdeal = Math.sign(gap) === sign;
  const weeksToIdeal = towardIdeal && Math.abs(resultingWeeklyChangeKg) > 1e-9 ? Math.abs(gap) / Math.abs(resultingWeeklyChangeKg) : null;
  const applicable = gain ? currentKg < idealKg - 0.01 : currentKg > idealKg + 0.01;

  const warnings = [];
  if (!applicable) warnings.push(gain
    ? "At or above ideal weight — no surplus needed. This plan applies to underweight cats."
    : "At or below ideal weight — no deficit needed. This plan applies to overweight cats.");
  if (requested > RATE.max) warnings.push(gain
    ? `${requested}%/week is faster than the safe ceiling — capped at ${RATE.max}%. Rapid gain lays down fat, not condition.`
    : `${requested}%/week is faster than the safe ceiling — capped at ${RATE.max}%. Faster loss risks hepatic lipidosis.`);
  if (requested < RATE.min && requested > 0) warnings.push(`${requested}%/week is very slow — floored at ${RATE.min}%.`);
  if (belowFloor) warnings.push(`That maintenance estimate would push the target below ~0.8 × RER at ideal weight (${Math.round(floorKcal)} kcal). Held at the floor; go lower only under veterinary supervision.`);

  return { direction, applicable, rate, requested,
    weeklyChangeKg: sign * (currentKg * rate) / 100, dailyDelta,
    targetKcal, floorKcal, belowFloor, weeksToIdeal,
    resultingRatePctPerWeek, resultingWeeklyChangeKg, warnings };
}
