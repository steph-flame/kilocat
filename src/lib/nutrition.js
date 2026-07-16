// Energy model — the "how many kcal per day" semantics. Pure functions, no I/O.
//
// Sourcing (validated Feb 2026):
//   RER = 70 * kg^0.75 (ACVN-endorsed). MER = feline factor * RER:
//     neutered adult 1.2 | intact adult 1.4 | inactive/obese-prone 1.0 |
//     weight loss 0.8-1.0 (at target wt) | weight gain ~1.6 (at target wt) |
//     kitten peak 2.5, tapering to the adult factor by 12 months.
//   (AAHA Nutrition Toolkit; Pet Nutrition Alliance MER table. Beware canine
//   MER factors — 1.6/1.8 — which some calculators list and overfeed a cat.)

import { num, clamp } from "./util.js";

export const RER = (kg) => 70 * Math.pow(kg, 0.75);

// Body condition: a 1-9 BCS maps to % over/under ideal at 10 points per score, with
// 5 = ideal. Inverse clamps back into the 1-9 range. Round-trips exactly for scores
// that land on a 10% step (i.e. every integer BCS).
export const bcsToPct = (bcs) => ((Number.isFinite(bcs) ? bcs : 5) - 5) * 10; // default to 5 (ideal) if unset
export const pctToBcs = (pct) => Math.max(1, Math.min(9, Math.round(5 + num(pct) / 10)));

// Age in months from a date of birth, evaluated as of `asOf` (both ISO "YYYY-MM-DD").
// Returns null for missing/invalid/future dates so callers can fall back to a stored age.
// This is what keeps a kitten's age from silently going stale: it's derived, not typed once.
export function ageMonthsFromDob(dob, asOf) {
  if (!dob || !asOf) return null;
  const b = Date.parse(`${dob}T00:00:00Z`), a = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(b) || Number.isNaN(a) || a < b) return null;
  return (a - b) / 86400000 / 30.4375; // days → months (average month length)
}

// A comfortably-adult age to feed computeTargets when there's no dob to derive one from.
// Never 0 — age 0 reads as a newborn (kitten-peak factor, "maintain" dropped from the goal
// list), which silently doubled the recommended feed for an adult cat with an unset dob.
export const ADULT_DEFAULT_AGE_MONTHS = 24;

// Age in months to actually feed into computeTargets: the real age when dob is set, else
// the adult default above. Pair with ageMonthsFromDob(dob, asOf) == null to know whether
// the value is real or defaulted (e.g. to prompt for the birthday instead of showing it).
export const effectiveAgeMonths = (dob, asOf) => ageMonthsFromDob(dob, asOf) ?? ADULT_DEFAULT_AGE_MONTHS;

// The goal options offered depend on life stage: kittens can't "maintain", etc.
export function goalsForAge(age) {
  const custom = { id: "custom", label: "Custom target", hint: "set kcal directly" };
  if (age < 12)
    return [
      { id: "grow", label: "Support growth", hint: "feed a growing kitten to develop" },
      { id: "gentle", label: "Gentle trim / grow into", hint: "mild deficit; let frame catch up" },
      { id: "loss", label: "Active weight loss", hint: "deliberately strip fat now" },
      custom,
    ];
  return [
    { id: "maintain", label: "Maintain weight", hint: "hold steady at current weight" },
    { id: "gentle", label: "Gentle trim", hint: "gradual, gentle slim-down" },
    { id: "loss", label: "Active weight loss", hint: "deliberately strip fat now" },
    { id: "gain", label: "Weight gain", hint: "build weight in an underweight cat" },
    custom,
  ];
}

// Everything the UI needs to render the target and its derivation, from one profile.
export function computeTargets(p) {
  const f = p.factors;
  const w = num(p.weightKg), age = num(p.ageMonths);
  const pctOver = p.bcMode === "bcs" ? bcsToPct(p.bcs) : num(p.pctOver);
  // Ideal weight backs out the excess/deficit; clamp to a physiological band so a stray
  // % (e.g. a persisted −95%) can't yield an absurd ideal weight and a runaway target.
  const idealRaw = 1 + pctOver / 100 > 0 ? w / (1 + pctOver / 100) : w;
  const idealWeight = w > 0 ? clamp(idealRaw, 0.4 * w, 2.5 * w) : idealRaw;
  const rerCur = RER(w), rerIdeal = RER(idealWeight);
  const stage = age < 4 ? "young kitten" : age < 12 ? "growing kitten" : "adult";
  const adultFactor = p.neutered ? f.neutered : f.intact;
  let growthFactor;
  if (age < 4) growthFactor = f.kittenPeak;
  else if (age < 12) growthFactor = f.kittenPeak - ((age - 4) / 8) * (f.kittenPeak - adultFactor);
  else growthFactor = adultFactor;
  const gentleCurrent = rerCur * f.moderation;              // resting needs at current weight
  const gentleIdeal = rerIdeal * growthFactor;              // growth (or maint.) needs at ideal weight
  const gentleBasis = p.gentleBasis || "current";
  const refs = {
    grow: rerCur * growthFactor, maintain: rerCur * adultFactor,
    gentle: gentleBasis === "ideal" ? gentleIdeal : gentleCurrent,
    loss: rerIdeal * f.loss, gain: rerIdeal * f.gain,
  };
  const stageGoals = goalsForAge(age);
  const goalId = stageGoals.some((g) => g.id === p.goal) ? p.goal : stageGoals[0].id;
  const fallback = refs[stageGoals[0].id];
  const target = goalId === "custom" ? (num(p.customTarget) || fallback) : refs[goalId];
  return { age, w, pctOver, idealWeight, rerCur, rerIdeal, stage, statusFactor: adultFactor, growthFactor, refs, gentleCurrent, gentleIdeal, gentleBasis, stageGoals, goalId, target };
}

export const defaultFactors = { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1.0, loss: 1.0, gain: 1.6 };

export const seedProfile = {
  name: "Mithril", dob: "2025-09-13", weightKg: 4.38, ageUnit: "months",
  neutered: true, bcMode: "pct", bcs: 7, pctOver: 20, bcAsOf: null, goal: "gentle",
  customTarget: "", gentleBasis: "current", factors: { ...defaultFactors },
};
