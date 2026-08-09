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

// Matching the two blends by FOOD NAME is wrong when a rotating slot is involved. "Currently
// feeding" is seeded by copying the ration, and that copy strips `rotation` (see foodFieldsOf) and
// keeps whichever flavor happened to be active at the time. So a variety pack shows up as
// "Chicken & Beef" on the old side and "Chicken & Quail Egg" on the new — one slot, two names,
// which blends into a phantom "fading out" row that no logged meal can ever satisfy (the owner
// feeds today's flavor, which matches neither) and that quietly eats part of the day's budget.
//
// So slots are identified by ROTATION FAMILY when there is one: every member name (and the active
// flavor) maps to the same key, and a bare flavor name on the old side lands on the new side's
// rotation. Foods without a rotation just key by name, as before.
export function makeSlotKeyer(...itemLists) {
  const memberToKey = new Map();
  const famKey = (it) => "rot:" + (it.rotation || []).map((m) => key(m.name)).filter(Boolean).sort().join("|");
  for (const list of itemLists) {
    for (const it of list || []) {
      if (!it?.rotation?.length) continue;
      const k = famKey(it);
      for (const m of it.rotation) { const mk = key(m.name); if (mk) memberToKey.set(mk, k); }
      const own = key(it.name); // the resolved active flavor, which may not be listed as a member
      if (own) memberToKey.set(own, k);
    }
  }
  const keyOfName = (n) => memberToKey.get(key(n)) || `name:${key(n)}`;
  return { keyOfName, keyOfItem: (it) => (it?.rotation?.length ? famKey(it) : keyOfName(it?.name)) };
}

// Blend two already-distributed row sets into one row per unique food (matched by name), the way
// the schedule table does: a food in both stays (moving toward its new amount), a dropped food
// fades to nothing, an added food grows in.
//
// `newRows` should already have rotations/fridge resolved by the caller — this module is pure and
// doesn't know about cans. Rows carry their source food through so callers keep kcalPerG, type,
// rotation state, etc. A dropped food's `food` comes from the old side, which is all it needs to
// be fed and logged on its way out.
// Collapse a side's rows to ONE per slot, summing energy and grams. Without this, two entries that
// resolve to the same slot — the same food listed twice in a ration, or two names belonging to one
// rotation family — each became their own row and ramped separately, so a single food appeared
// twice in the plan with one copy rising and the other flat. Identity comes from the first row so
// the slot keeps its id, split mode and rotation.
function collapseBySlot(rows, keyOfName) {
  const at = new Map();
  const out = [];
  for (const r of rows || []) {
    if (!key(r.name)) continue;
    const k = keyOfName(r.name);
    if (at.has(k)) {
      const prev = out[at.get(k)];
      prev.kcal = num(prev.kcal) + num(r.kcal);
      if (prev.grams != null || r.grams != null) prev.grams = num(prev.grams) + num(r.grams);
    } else {
      at.set(k, out.length);
      out.push({ ...r });
    }
  }
  return { rows: out, at };
}

export function blendRows(oldRows, newRows, toNew, keyOfName = (n) => key(n)) {
  const t = Math.max(0, Math.min(1, num(toNew)));
  const out = [];
  const at = new Map();
  const nu_ = collapseBySlot(newRows, keyOfName);
  const old_ = collapseBySlot(oldRows, keyOfName);
  for (const r of nu_.rows) {
    at.set(keyOfName(r.name), out.length);
    out.push({ nu: r, old: null });
  }
  for (const r of old_.rows) {
    const k = keyOfName(r.name);
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
  const { keyOfName } = makeSlotKeyer(startItems, resolvedRationItems);
  return blendRows(oldRows, newRows, shareOfNew(day, days), keyOfName);
}

// How far a day's actual feeding sits from what the ramp prescribes for candidate day `day`.
// Compared in kcal (comparable across foods) and summed as absolute error over every food on
// either side, so feeding something not in the plan counts against the match too.
// `toNew` is the share of the new ration (0 = the pre-ramp state, 1 = fully switched), and
// `fedBySlot` is keyed the same way the rows are — so a logged flavor counts toward its rotation.
export function dayMismatch({ oldRows, newRows, toNew, fedBySlot, keyOfName }) {
  const want = blendRows(oldRows, newRows, toNew, keyOfName);
  const slots = new Set([...want.map((r) => keyOfName(r.name)), ...fedBySlot.keys()]);
  let err = 0;
  for (const s of slots) {
    const planned = want.filter((r) => keyOfName(r.name) === s).reduce((a, r) => a + num(r.kcal), 0);
    err += Math.abs(planned - num(fedBySlot.get(s)));
  }
  return err;
}

// Which ramp day is TODAY, inferred from what was actually fed on the most recent logged day.
//
// DAY 0 MATTERS. Candidates run from 0, not 1: day 0 is the pre-ramp state — 100% of the old food,
// which is exactly what yesterday looked like if you START the switch today. Without it, "all old
// food" snapped to day 1 (already 1/n new) and today came out as day 2, so a brand-new transition
// began a day ahead of itself and asked for more new food than the owner had fed.
//
// `gapDays` is how many days back `priorEntries` are (default 1 = yesterday). Missing a day of
// logging shouldn't reset the ramp to the start, so the caller can hand over the most recent day
// that HAS entries and say how far back it was; the ramp advances by that many days.
//
// Returns { day, basis }:
//   "inferred" — matched a ramp day (0..n); today is that plus the gap, capped at the last day.
//   "start"    — nothing usable logged recently, so treat today as day 1.
// Ties go to the EARLIER day (strict <), erring toward advancing slowly — the safe direction for a
// gut being transitioned.
// How close yesterday has to be to the finished ration before the ramp is declared over, as a
// fraction of the day's energy. 8% is roughly one ordinary logging slip — tight enough that a cat
// genuinely mid-ramp isn't waved through, loose enough that "near enough" counts.
export const AT_TARGET_TOL = 0.08;

export function inferTransitionDay({ startItems, resolvedRationItems, target, days, priorEntries, gapDays = 1 }) {
  const n = clampDays(days);
  const { keyOfName } = makeSlotKeyer(startItems, resolvedRationItems);
  const fed = new Map();
  for (const e of priorEntries || []) {
    if (!key(e.name)) continue;
    const k = keyOfName(e.name); // a logged flavor counts toward its rotation slot
    fed.set(k, (fed.get(k) || 0) + num(e.kcal));
  }
  if (fed.size === 0 || [...fed.values()].every((v) => v <= 0)) return { day: 1, basis: "start" };

  const oldRows = distributeBowl(startItems || [], target).rows;
  const newRows = distributeBowl(resolvedRationItems || [], target).rows;
  let best = 0;
  let bestErr = Infinity;
  for (let d = 0; d <= n; d++) {
    const err = dayMismatch({ oldRows, newRows, toNew: d / n, fedBySlot: fed, keyOfName });
    if (err < bestErr) { bestErr = err; best = d; }
  }
  // ALREADY THERE? Editing the ration mid-switch is the case that needs this. If the owner changes
  // the target to something they're effectively already feeding, the ramp has nothing left to do —
  // but a pure argmin can still land mid-ramp when several candidate days fit yesterday's numbers
  // almost equally well, and then the plan asks them to walk BACK toward the old food. So check the
  // finished ration explicitly: if yesterday already matches it within a logging slip, it's done,
  // whatever the scoring prefers.
  const doneErr = dayMismatch({ oldRows, newRows, toNew: 1, fedBySlot: fed, keyOfName });
  const fedTotal = [...fed.values()].reduce((a, b) => a + num(b), 0);
  const scale = Math.max(num(target), fedTotal, 1);
  if (doneErr / scale <= AT_TARGET_TOL) {
    return { day: n, basis: "attarget", matchedPrior: n };
  }

  const step = Math.max(1, Math.round(num(gapDays)) || 1);
  return { day: Math.min(best + step, n), basis: "inferred", matchedPrior: best };
}
