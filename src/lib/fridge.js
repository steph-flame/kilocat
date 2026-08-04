// The open-can fridge (tier B of rotations + fridge). Wet food comes in cans/pouches bigger than
// one meal: you open one, feed part, and the rest keeps in the fridge for ~fridgeDays before it
// should be tossed. The fridge is a list of OPEN CANS — each a food snapshot (so it stays correct
// even if the library changes later) plus when it was opened and how many grams are left.
//
// Only wet cans/pouches are tracked: dry kibble comes from a bag (not perishable on this scale) and
// treats don't spoil in a few days. Pure functions — no I/O; the caller (AppState) owns the array
// and supplies an id factory.

import { foodFieldsOf, hasRotation, isRotating, activeMember } from "./rotation.js";
import { foodType, kcalPerG } from "./foods.js";
import { addDays, diffDays } from "./series.js";
import { num } from "./util.js";

const keyOf = (name) => String(name || "").trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;
const norm = (i, n) => ((i % n) + n) % n;

// Something the fridge tracks? A wet can/pouch with a real per-unit weight.
export function isCanned(food) {
  return foodType(food) === "wet" && food?.mode === "perUnit" && num(food?.gramsPerUnit) > 0;
}

// Open a fresh can from a food: a snapshot + the open date + a full can's grams remaining.
export function openCan(food, openedDate, makeId) {
  const canGrams = num(food.gramsPerUnit);
  return { id: makeId(), ...foodFieldsOf(food), openedDate, canGrams, remainingGrams: canGrams };
}

// An open can's status relative to `today`. fridgeDays is how many days it keeps COUNTING THE DAY
// IT WAS OPENED — so a 3-day can opened the 31st is good the 31st, 1st, 2nd (goodThru = the 2nd)
// and should be tossed the 3rd. `daysLeft` counts down to that last good day (0 = today is the last
// day, <0 = past it).
export function canStatus(can, today, fridgeDays) {
  const goodThru = addDays(can.openedDate, Math.max(1, fridgeDays) - 1);
  const daysLeft = diffDays(today, goodThru);
  return {
    daysOpen: Math.max(0, diffDays(can.openedDate, today)),
    goodThru, daysLeft,
    expired: daysLeft < 0,             // past the last good day — toss it
    expiringToday: daysLeft === 0,     // today IS the last good day — use it up
    expiringSoon: daysLeft >= 0 && daysLeft <= 1,
  };
}

// Cans of a given food, oldest-opened first (FIFO — finish what's been open longest).
export function cansOf(fridge, name) {
  const k = keyOf(name);
  return (fridge || []).filter((c) => keyOf(c.name) === k)
    .sort((a, b) => (a.openedDate < b.openedDate ? -1 : a.openedDate > b.openedDate ? 1 : 0));
}

// Cans still good to feed (not past use-by), oldest first — what a draw should pull from before
// opening anything new. Expired cans are left in the fridge, flagged for tossing, never auto-fed.
export function availableCansOf(fridge, name, today, fridgeDays) {
  return cansOf(fridge, name).filter((c) => num(c.remainingGrams) > 0.01 && !canStatus(c, today, fridgeDays).expired);
}

// Plan (NO mutation) how `grams` of `food` would be drawn tonight: from good open cans oldest-first,
// then opening new cans as needed. Returns { grams, segs } where each seg is either an existing can
// being drawn down or a new can to open.
export function planDraw(fridge, food, grams, today, fridgeDays) {
  const need0 = num(grams);
  let need = need0;
  const canGrams = num(food.gramsPerUnit) || need0;
  const segs = [];
  for (const c of availableCansOf(fridge, food.name, today, fridgeDays)) {
    if (need <= 0.01) break;
    const take = Math.min(need, num(c.remainingGrams));
    segs.push({ kind: "open", can: c, take: round2(take), after: round2(num(c.remainingGrams) - take), status: canStatus(c, today, fridgeDays) });
    need -= take;
  }
  let guard = 0;
  while (need > 0.01 && canGrams > 0 && guard++ < 50) {
    const take = Math.min(need, canGrams);
    segs.push({ kind: "new", take: round2(take), after: round2(canGrams - take) });
    need -= take;
  }
  return { grams: need0, segs };
}

// Plan a whole SLOT's worth of energy across cans AND, for a variety pack, across flavors — which
// is what planDraw above can't do on its own, because it only ever looks at cans of one food.
//
// The case that makes this necessary: the slot needs (say) 64 kcal, the open can has 3.4 g left,
// and the next flavor is a different food with its own kcal/g. Showing "53.3 g" — the whole slot
// priced at the open can's density — is wrong twice over: there isn't 53.3 g in that can, and the
// remainder won't be that flavor. What the owner needs to see is "finish the 3.4 g that's open,
// then ~49.9 g of the next one".
//
// Fills by ENERGY, not grams, so each segment converts at its own flavor's density and the slot
// still lands on its kcal. Order: every good open can of the current flavor (oldest first), then
// the next flavor in the pack as a new can, and so on around the rotation. Plans only — opening and
// finishing cans stay explicit user actions (see consumeFromFridge).
//
// Returns { segs, shortfall } where each seg is { food, name, grams, kcal, kind: "open"|"new",
// can?, status? }. `shortfall` is kcal that couldn't be placed (no density to convert with).
export function planSlotDraw(food, kcal, date, fridge, fridgeDays, maxSegs = 12) {
  const need0 = num(kcal);
  if (!(need0 > 0) || !food) return { segs: [], shortfall: 0 };
  // The flavors to walk, starting at whichever the pack is actually on today.
  const members = isRotating(food)
    ? (() => {
        const start = packStartIndex(food, fridge, date, fridgeDays);
        return food.rotation.map((_, i) => food.rotation[norm(start + i, food.rotation.length)]);
      })()
    : [food];

  let need = need0;
  const segs = [];
  const usedCans = new Set();
  for (let pass = 0; pass < members.length && need > 0.01 && segs.length < maxSegs; pass++) {
    const m = members[pass];
    const kpg = kcalPerG(m);
    if (!(kpg > 0)) continue; // can't convert energy to grams for this flavor; try the next
    // 1) whatever is already open of this flavor
    let drainedOpen = false;
    for (const c of availableCansOf(fridge, m.name, date, fridgeDays)) {
      if (need <= 0.01 || segs.length >= maxSegs) break;
      if (usedCans.has(c.id)) continue;
      usedCans.add(c.id);
      const grams = Math.min(num(c.remainingGrams), need / kpg);
      if (!(grams > 0.01)) continue;
      drainedOpen = true;
      segs.push({ food: m, name: m.name, grams: round2(grams), kcal: round2(grams * kpg), kind: "open", can: c, status: canStatus(c, date, fridgeDays) });
      need -= grams * kpg;
    }
    // 2) Still short. For a VARIETY PACK, emptying the open can is precisely when you move to the
    //    next flavor — so don't open a second can of the one just finished; fall through to the
    //    next member instead. A pack with nothing open still opens its current flavor, and a plain
    //    canned food (no rotation) just opens another of itself.
    const rotateOnward = isRotating(food) && drainedOpen;
    if (need > 0.01 && segs.length < maxSegs && !rotateOnward) {
      const canGrams = num(m.gramsPerUnit);
      if (canGrams > 0) {
        const grams = Math.min(canGrams, need / kpg);
        segs.push({ food: m, name: m.name, grams: round2(grams), kcal: round2(grams * kpg), kind: "new" });
        need -= grams * kpg;
      }
    }
  }
  return { segs, shortfall: round2(Math.max(0, need)) };
}

// Put `grams` of `food` back into the fridge — the reverse of consume, used when a logged wet meal
// is edited DOWN (you fed less than first recorded). Refills matching open cans newest-first up to a
// full can each; any remainder re-opens a can holding it. No provenance is tracked, so this restores
// stock rather than the exact physical can, which is the best that's possible — and symmetric with
// consume so an edit up-then-back-down nets out. No-op for non-canned foods.
export function returnToFridge(fridge, food, grams, today, makeId) {
  let give = num(grams);
  if (!(give > 0) || !isCanned(food)) return fridge || [];
  const canGrams = num(food.gramsPerUnit);
  const out = (fridge || []).map((c) => ({ ...c }));
  const mine = out.filter((c) => keyOf(c.name) === keyOf(food.name)).sort((a, b) => (a.openedDate < b.openedDate ? 1 : -1)); // newest first
  for (const c of mine) {
    if (give <= 0.01) break;
    const room = Math.max(0, canGrams - num(c.remainingGrams));
    const put = Math.min(give, room);
    c.remainingGrams = round2(num(c.remainingGrams) + put);
    give -= put;
  }
  let guard = 0;
  while (give > 0.01 && canGrams > 0 && guard++ < 50) {
    const put = Math.min(give, canGrams);
    out.push({ id: makeId(), ...foodFieldsOf(food), openedDate: today, canGrams, remainingGrams: round2(put) });
    give -= put;
  }
  return out;
}

// A variety pack is fed IN ORDER: you feed the open can until it's finished, then open the next
// flavor. `f.rotIndex` is the cursor — the flavor currently in use — advanced when you tap "Finish
// can". A physically-open can anchors position (the cursor self-heals to reality); otherwise the
// cursor says which flavor to open next. Opening and finishing are explicit user actions, never
// inferred from gram math.

// Index of the pack flavor with the oldest still-good open can, or -1 if nothing's open.
function openPackStart(f, fridge, today, fridgeDays) {
  let best = -1, bestDate = null;
  f.rotation.forEach((m, i) => {
    const avail = availableCansOf(fridge, m.name, today, fridgeDays);
    if (avail.length && (bestDate == null || avail[0].openedDate < bestDate)) { best = i; bestDate = avail[0].openedDate; }
  });
  return best;
}

// Where a pack's draw begins today: finish whatever's physically open, else the stored cursor.
export function packStartIndex(f, fridge, today, fridgeDays) {
  if (!isRotating(f)) return 0;
  const open = openPackStart(f, fridge, today, fridgeDays);
  return open >= 0 ? open : norm(num(f.rotIndex), f.rotation.length);
}

// The flavor a rotation slot feeds first on `date` (what the Bowl/Log show as "today's" flavor).
export function activeMemberWithFridge(f, date, fridge, fridgeDays) {
  if (!hasRotation(f)) return null;
  if (!isRotating(f)) return activeMember(f, date); // paused / single flavor → fixed, ignore the fridge
  return f.rotation[packStartIndex(f, fridge, date, fridgeDays)];
}

// Advance a pack's cursor to the next flavor — used when you tap "Finish can" on a variety pack so
// the next flavor becomes current.
export const nextPackIndex = (f) => (isRotating(f) ? norm(num(f.rotIndex) + 1, f.rotation.length) : 0);

export function resolveRotationsWithFridge(items, date, fridge, fridgeDays) {
  return (items || []).map((f) => {
    if (!hasRotation(f)) return f;
    const chosen = activeMemberWithFridge(f, date, fridge, fridgeDays);
    if (!chosen) return f;
    const { id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex } = f;
    return { ...chosen, id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex };
  });
}

// Draw `grams` of `food` DOWN from its open can(s) when a meal is logged — oldest good can first,
// floored at zero, dropping any can that empties. It NEVER opens a new can and never removes a
// still-full one on its own: opening and finishing cans are explicit user actions (see the Open /
// Finish buttons), because gram math drifts from the real can and auto-opening spawned phantom
// second cans. If a meal exceeds what's tracked as open, the open can just empties (the extra is
// untracked) — you finish/open cans yourself. No-op for non-canned foods or when nothing's open.
export function consumeFromFridge(fridge, food, grams, today, fridgeDays) {
  let need = num(grams);
  if (!(need > 0) || !isCanned(food)) return fridge || [];
  const out = (fridge || []).map((c) => ({ ...c }));
  const good = out
    .filter((c) => keyOf(c.name) === keyOf(food.name) && num(c.remainingGrams) > 0.01 && !canStatus(c, today, fridgeDays).expired)
    .sort((a, b) => (a.openedDate < b.openedDate ? -1 : 1));
  for (const c of good) {
    if (need <= 0.01) break;
    const take = Math.min(need, num(c.remainingGrams));
    c.remainingGrams = round2(num(c.remainingGrams) - take);
    need -= take;
  }
  return out.filter((c) => num(c.remainingGrams) > 0.01); // drop emptied cans; never opens a new one
}

// Explicitly finish the current open can of `food` (the "Finish can" button): remove the oldest
// good open can regardless of its tracked remaining — you say it's done, drift and all.
export function finishOpenCan(fridge, food, today, fridgeDays) {
  const good = (fridge || [])
    .filter((c) => keyOf(c.name) === keyOf(food?.name) && num(c.remainingGrams) > 0.01 && !canStatus(c, today, fridgeDays).expired)
    .sort((a, b) => (a.openedDate < b.openedDate ? -1 : 1));
  const victim = good[0];
  return victim ? (fridge || []).filter((c) => c.id !== victim.id) : (fridge || []);
}
