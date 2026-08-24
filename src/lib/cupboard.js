// The cupboard: UNOPENED cans, as counts per flavor. The fridge (lib/fridge.js) tracks what's open
// and perishing; this tracks what's still in the box, which is the thing no rule could see before.
//
// WHY IT EXISTS. A variety pack comes with uneven counts — 4 chicken, 2 duck, 2 quail, 4 salmon —
// but a rotation that walks its list in order uses one of each per cycle. The scarce flavors run
// out first and the case ends on a run of whatever there was most of. Nothing in the app could
// prevent that, because nothing knew duck was scarce: the fridge only ever sees a can once it's
// already open.
//
// THE RULE, once counts exist, is one line: open whichever flavor you have MOST of. That self-
// levels — every open knocks the tallest pile down, so the piles converge and the case finishes
// varied instead of ending on four salmon. It also survives restocking, which a precomputed
// schedule wouldn't: buy more duck and duck simply becomes the tallest pile.
//
// Counts are OPTIONAL. A pack nobody keeps stock for rotates exactly as it always did, by list
// order and the Finish-can cursor (see fridge.js's packStartIndex). This is a refinement on top of
// a working rotation, never a prerequisite for one — forget to keep it up and nothing breaks.
//
// Two shapes, because both are how people actually buy:
//   cupboard: [{ name, count }]           — a flat pool. Singles land here directly.
//   cases:    [{ id, label, items: [] }]  — a named mix ("Tiki variety, 4/2/2/4") you can add by
//                                           the box. Several can exist, each with its own mix; a
//                                           case is a SHOPPING UNIT, not a container, so adding one
//                                           pours its counts into the same pool. Which box a can
//                                           came from can't change which can you open next.

import { num, uid } from "./util.js";

const keyOf = (name) => String(name || "").trim().toLowerCase();
const cnt = (v) => Math.max(0, Math.round(num(v)));

export const normalizeCupboard = (cupboard) =>
  (Array.isArray(cupboard) ? cupboard : []).filter((r) => keyOf(r?.name)).map((r) => ({ name: String(r.name).trim(), count: cnt(r.count) }));

export const normalizeCases = (cases) =>
  (Array.isArray(cases) ? cases : []).map((c) => ({
    id: c?.id || uid(),
    label: String(c?.label || "").trim(),
    items: normalizeCupboard(c?.items),
  }));

// How many unopened cans of `name`, or null when the cupboard says NOTHING about it. Null and 0 are
// different answers — "I don't track this" must not read as "you're out of it" (see stockStartIndex).
export function stockOf(cupboard, name) {
  const k = keyOf(name);
  const row = (cupboard || []).find((r) => keyOf(r.name) === k);
  return row ? cnt(row.count) : null;
}

// Set a flavor's count, adding the row if it's new. A count of 0 is KEPT rather than deleted: "I
// have none" is a real answer, and it's what makes the UI able to say you're out.
export function setStock(cupboard, name, count) {
  if (!keyOf(name)) return normalizeCupboard(cupboard);
  const out = normalizeCupboard(cupboard);
  const i = out.findIndex((r) => keyOf(r.name) === keyOf(name));
  if (i >= 0) out[i] = { ...out[i], count: cnt(count) };
  else out.push({ name: String(name).trim(), count: cnt(count) });
  return out;
}

export const addStock = (cupboard, name, delta) => setStock(cupboard, name, Math.max(0, (stockOf(cupboard, name) || 0) + Math.round(num(delta))));

// Pour a case's mix into the pool — the "+1 case" button.
export function addItems(cupboard, items) {
  let out = normalizeCupboard(cupboard);
  for (const it of normalizeCupboard(items)) out = addStock(out, it.name, it.count);
  return out;
}

// One can leaves the cupboard, because it just got opened. Floors at zero and never creates a row:
// opening a can of something you weren't tracking shouldn't start tracking it at -1, or at 0 (which
// would then read as "out of stock" and silently drop the flavor from the rotation).
export function takeOne(cupboard, name) {
  const have = stockOf(cupboard, name);
  return have == null ? normalizeCupboard(cupboard) : setStock(cupboard, name, Math.max(0, have - 1));
}

// WHICH FLAVOR TO OPEN NEXT: the index of the member with the most cans left, ties going to list
// order so a fully-even cupboard behaves exactly like the old plain rotation. Returns -1 when the
// cupboard can't answer — no member tracked, or every tracked member at zero — and the caller falls
// back to the cursor. Untracked members are invisible to this rule by design (an unknown count is
// not a zero), so a half-filled cupboard biases toward the flavors you did count; the UI lists every
// flavor of the pack with its count for exactly that reason.
export function stockStartIndex(members, cupboard) {
  let best = -1, bestN = 0;
  (members || []).forEach((m, i) => {
    const n = stockOf(cupboard, m?.name);
    if (n != null && n > bestN) { bestN = n; best = i; }
  });
  return best;
}

// Total cans of a pack still in the box — for "12 cans left" and for noticing an empty cupboard.
export const packStock = (members, cupboard) =>
  (members || []).reduce((s, m) => s + (stockOf(cupboard, m?.name) || 0), 0);

export const blankCase = (label = "") => ({ id: uid(), label, items: [] });
