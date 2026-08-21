// Weight unit conversion. Everything is stored and modeled in kg at full precision (the RER
// formula is defined in kg); conversion is a lossless multiply, and Litter-Robot weigh-ins land in
// kg unrounded. This is a display/entry layer only — the ONLY rounding happens here, at render.

import { num } from "./util.js";

export const LB_PER_KG = 2.2046226218;
const round5 = (n) => Math.round(n / 5) * 5;
export { round5 };

// kg → the display unit's value.
export const toDisplayWeight = (kg, unit) => (unit === "lb" ? kg * LB_PER_KG : kg);
// a value the user typed in the display unit → kg for storage.
export const fromDisplayWeight = (v, unit) => (unit === "lb" ? v / LB_PER_KG : v);

export const weightLabel = (unit) => (unit === "lb" ? "lb" : "kg");

// A stored kg → the display unit's value, shown to UP TO `dp` decimals (default 2), trailing
// zeros trimmed (5.40 → "5.4", 5.44 → "5.44"). Rounds only the displayed string, never the stored
// kg — so a Litter-Robot 5.44 kg reads as 5.44, not 5.4, and lb↔kg keeps its precision on screen.
export function fmtWeight(kg, unit, dp = 2) {
  const v = toDisplayWeight(num(kg), unit);
  return String(Number(v.toFixed(dp)));
}

// Small masses — a collar, a tracker — in the unit system's small denomination: grams in metric,
// ounces in imperial. Same choice weeklyRate makes below, for the same reason: a tracker collar is
// 25-60 g, and "0.09 lb" is not a number anyone can weigh or recognize. Stored in GRAMS either way.
const OZ_PER_G = 0.0352739619;
export const smallLabel = (unit) => (unit === "lb" ? "oz" : "g");
export const toDisplaySmall = (grams, unit) => (unit === "lb" ? num(grams) * OZ_PER_G : num(grams));
export const fromDisplaySmall = (v, unit) => (unit === "lb" ? num(v) / OZ_PER_G : num(v));

// A weekly rate of change (kg/week, signed) → a friendly {value, unit} for the unit system:
// grams/week in metric, ounces/week in imperial (small changes read better than lb/week).
export function weeklyRate(kgPerWeek, unit) {
  if (unit === "lb") return { value: Math.abs(kgPerWeek) * LB_PER_KG * 16, unit: "oz/wk" };
  return { value: Math.abs(kgPerWeek) * 1000, unit: "g/wk" };
}
