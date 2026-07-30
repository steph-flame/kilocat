// Bowl split (Ration step 2): distribute the daily target across N foods, each in one of three
// modes. Pure, no I/O. One basis for everything — % of the FULL target — so "58% of 249" never
// gets mixed with "% of what's left".
//
//  - fixed:     takes a set number of kcal off the top (treats, a supplement). Its `fixedKcal`.
//  - share:     takes a chosen % of the target (its `pct`). The draggable ones.
//  - remainder: absorbs whatever is left after fixed + shares, so nothing has to sum to 100 by
//               hand and the total never drifts off the target. Exactly one row should be
//               remainder; if somehow more than one is, only the first absorbs (the rest → 0).

import { kcalPerG } from "./foods.js";
import { num } from "./util.js";

// NB: the split mode lives in `splitMode` (fixed | share | remainder), NOT `mode` — `mode` is the
// food's ENERGY mode (perKg | perUnit) that kcalPerG reads, and the two must never collide.
export function distributeBowl(rows, target) {
  const T = Math.max(0, num(target));
  const list = rows || [];
  const sm = (r) => r.splitMode || "share"; // default: a plain share food

  const fixedKcal = list.filter((r) => sm(r) === "fixed").reduce((s, r) => s + Math.max(0, num(r.fixedKcal)), 0);
  const shareKcal = list.filter((r) => sm(r) === "share").reduce((s, r) => s + (num(r.pct) / 100) * T, 0);
  const hasRemainder = list.some((r) => sm(r) === "remainder");
  const remainderKcal = Math.max(0, T - fixedKcal - shareKcal);

  let remainderGiven = false;
  const out = list.map((r) => {
    const splitMode = sm(r);
    let kcal;
    if (splitMode === "fixed") kcal = Math.max(0, num(r.fixedKcal));
    else if (splitMode === "remainder") { kcal = remainderGiven ? 0 : remainderKcal; remainderGiven = true; }
    else kcal = (num(r.pct) / 100) * T;
    const kpg = kcalPerG(r); // reads r.mode (energy) — untouched by the split mode
    return {
      id: r.id, name: r.name, splitMode, kcal,
      grams: kpg > 0 ? kcal / kpg : null,
      pct: T > 0 ? (kcal / T) * 100 : 0,
    };
  });

  const totalKcal = out.reduce((s, r) => s + r.kcal, 0);
  return {
    rows: out,
    target: T,
    fixedKcal, shareKcal, remainderKcal, hasRemainder,
    totalKcal,
    // fixed + shares already exceed the target, so the remainder has nothing to absorb.
    overAllocated: fixedKcal + shareKcal > T + 0.5,
    // with a remainder the total always lands on the target (unless over-allocated); without
    // one it only balances if the shares + fixed happen to sum to the target.
    balances: Math.abs(totalKcal - T) < 0.5,
    unallocated: hasRemainder ? 0 : Math.max(0, T - totalKcal),
  };
}
