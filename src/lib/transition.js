// The food-switch ramp, as something the whole app can act on — not just a table to look at.
//
// The bug this fixes: `tr` is only { on, days, timelineUnit }. It records that you're switching and
// over how long, but NOT where you are in the ramp — so Bowl could draw the schedule while Log,
// having no day pointer, planned the FINAL ration from day one. The owner was told to feed the
// end-state mix on day 1, which is exactly the stomach upset the ramp exists to avoid.
//
// WHY INFER THE DAY INSTEAD OF COUNTING FROM A START DATE. A start date would be simpler, but the
// app's own advice is "if stool loosens, repeat a day before advancing" — so calendar day N and
// ramp day N come apart precisely when the owner follows the instructions. Inferring from what was
// actually fed tracks the real ramp: repeat a day and it stays put, skip ahead and it follows.
//
// The inference is deliberately dumb and legible: score every candidate day against yesterday's
// logged kcal per food, take the closest, and assume today advances one. Deterministic, no state
// to drift, and self-correcting — a wrong guess is fixed by the next day's real data rather than
// being baked into storage.

import { num } from "./util.js";
import { distributeBowl } from "./bowl.js";

export const clampDays = (days) => Math.max(1, Math.min(30, num(days) || 7));
export const clampDay = (day, days) => Math.max(1, Math.min(clampDays(days), Math.round(num(day)) || 1));

// Day d of `days` mixes the old blend and the new one; both are distributed at the FULL target
// first, so the ramp changes the composition without changing the day's energy. Day `days` is
// 100% new. Mirrors Bowl.jsx's schedule table exactly — same formula, one implementation.
export const shareOfNew = (day, days) => clampDay(day, days) / clampDays(days);

const key = (n) => (n || "").trim().toLowerCase();

// Blend two already-distributed row sets into one row per unique food (matched by name), the way
// the schedule table does: a food in both stays (moving toward its new amount), a dropped food
// fades to nothing, an added food grows in.
//
// `newRows` should already have rotations/fridge resolved by the caller — this module is pure and
// doesn't know about cans. Rows carry their source food through so callers keep kcalPerG, type,
// rotation state, etc. A dropped food's `food` comes from the old side, which is all it needs to
// be fed and logged on its way out.
export function blendRows(oldRows, newRows, toNew) {
  const t = Math.max(0, Math.min(1, num(toNew)));
  const out = [];
  const at = new Map();
  for (const r of newRows || []) {
    const k = key(r.name);
    if (!k) continue;
    at.set(k, out.length);
    out.push({ nu: r, old: null });
  }
  for (const r of oldRows || []) {
    const k = key(r.name);
    if (!k) continue;
    if (at.has(k)) out[at.get(k)].old = r;
    else { at.set(k, out.length); out.push({ nu: null, old: r }); }
  }
  return out.map(({ nu, old }) => {
    const mix = (f) => (1 - t) * num(old?.[f]) + t * num(nu?.[f]);
    const base = nu || old; // prefer the new side for identity/split semantics
    return {
      ...base,
      grams: mix("grams"),
      kcal: mix("kcal"),
      // what this row is doing in the ramp — lets the UI say "fading out" / "phasing in"
      phase: nu && old ? "both" : nu ? "in" : "out",
    };
  });
}

// The plan for a given ramp day: what to actually put in the bowl today.
// `resolvedRationItems` = ration items with rotations/fridge already resolved (Log does this).
export function transitionSteps({ startItems, resolvedRationItems, target, day, days }) {
  const oldRows = distributeBowl(startItems || [], target).rows;
  const newRows = distributeBowl(resolvedRationItems || [], target).rows;
  return blendRows(oldRows, newRows, shareOfNew(day, days));
}

// How far a day's actual feeding sits from what the ramp prescribes for candidate day `day`.
// Compared in kcal (comparable across foods) and summed as absolute error over every food on
// either side, so feeding something not in the plan counts against the match too.
export function dayMismatch({ oldRows, newRows, day, days, fedKcalByName }) {
  const want = blendRows(oldRows, newRows, shareOfNew(day, days));
  const names = new Set([...want.map((r) => key(r.name)), ...fedKcalByName.keys()]);
  let err = 0;
  for (const n of names) {
    const planned = want.filter((r) => key(r.name) === n).reduce((a, r) => a + num(r.kcal), 0);
    err += Math.abs(planned - num(fedKcalByName.get(n)));
  }
  return err;
}

// Which ramp day is TODAY, inferred from what was actually fed on `priorEntries` (yesterday).
//
// Returns { day, basis }:
//   basis "inferred" — yesterday matched a ramp day; today is the next one (capped at the last).
//   basis "start"    — nothing usable logged yesterday, so treat today as day 1.
// Ties go to the EARLIER day (Math.min via strict >), which errs toward advancing more slowly —
// the safe direction for a gut being transitioned.
export function inferTransitionDay({ startItems, resolvedRationItems, target, days, priorEntries }) {
  const n = clampDays(days);
  const fed = new Map();
  for (const e of priorEntries || []) {
    const k = key(e.name);
    if (!k) continue;
    fed.set(k, (fed.get(k) || 0) + num(e.kcal));
  }
  if (fed.size === 0 || [...fed.values()].every((v) => v <= 0)) return { day: 1, basis: "start" };

  const oldRows = distributeBowl(startItems || [], target).rows;
  const newRows = distributeBowl(resolvedRationItems || [], target).rows;
  let best = 1;
  let bestErr = Infinity;
  for (let d = 1; d <= n; d++) {
    const err = dayMismatch({ oldRows, newRows, day: d, days: n, fedKcalByName: fed });
    if (err < bestErr) { bestErr = err; best = d; }
  }
  return { day: Math.min(best + 1, n), basis: "inferred", matchedYesterday: best };
}
