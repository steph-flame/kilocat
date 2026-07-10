// Energy model — the "how many kcal per day" semantics. Pure functions, no I/O.
//
// Sourcing (validated Feb 2026):
//   RER = 70 * kg^0.75 (ACVN-endorsed). MER = feline factor * RER:
//     neutered adult 1.2 | intact adult 1.4 | inactive/obese-prone 1.0 |
//     weight loss 0.8-1.0 (at target wt) | weight gain ~1.6 (at target wt) |
//     kitten peak 2.5, tapering to the adult factor by 12 months.
//   (AAHA Nutrition Toolkit; Pet Nutrition Alliance MER table.)
//   vetcalculators.com lists neutered 1.6 / intact 1.8 — those are CANINE.

import { num } from "./util.js";

export const RER = (kg) => 70 * Math.pow(kg, 0.75);

// Body condition: a 1-9 BCS maps to % over/under ideal at 10 points per score, with
// 5 = ideal. Inverse clamps back into the 1-9 range. Round-trips exactly for scores
// that land on a 10% step (i.e. every integer BCS).
export const bcsToPct = (bcs) => (bcs - 5) * 10;
export const pctToBcs = (pct) => Math.max(1, Math.min(9, Math.round(5 + num(pct) / 10)));

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
  const idealWeight = 1 + pctOver / 100 > 0 ? w / (1 + pctOver / 100) : w;
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
  name: "Mithril", weightKg: 4.38, ageMonths: 10, ageUnit: "months",
  neutered: true, bcMode: "pct", bcs: 7, pctOver: 20, goal: "gentle",
  customTarget: "", gentleBasis: "current", factors: { ...defaultFactors },
};
