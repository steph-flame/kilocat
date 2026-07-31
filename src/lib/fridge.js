// The open-can fridge (tier B of rotations + fridge). Wet food comes in cans/pouches bigger than
// one meal: you open one, feed part, and the rest keeps in the fridge for ~fridgeDays before it
// should be tossed. The fridge is a list of OPEN CANS — each a food snapshot (so it stays correct
// even if the library changes later) plus when it was opened and how many grams are left.
//
// Only wet cans/pouches are tracked: dry kibble comes from a bag (not perishable on this scale) and
// treats don't spoil in a few days. Pure functions — no I/O; the caller (AppState) owns the array
// and supplies an id factory.

import { foodFieldsOf, hasRotation, activeMember } from "./rotation.js";
import { foodType } from "./foods.js";
import { addDays, diffDays } from "./series.js";
import { num } from "./util.js";

const keyOf = (name) => String(name || "").trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;

// Something the fridge tracks? A wet can/pouch with a real per-unit weight.
export function isCanned(food) {
  return foodType(food) === "wet" && food?.mode === "perUnit" && num(food?.gramsPerUnit) > 0;
}

// Open a fresh can from a food: a snapshot + the open date + a full can's grams remaining.
export function openCan(food, openedDate, makeId) {
  const canGrams = num(food.gramsPerUnit);
  return { id: makeId(), ...foodFieldsOf(food), openedDate, canGrams, remainingGrams: canGrams };
}

// An open can's status relative to `today`, given how long an open can keeps (fridgeDays).
export function canStatus(can, today, fridgeDays) {
  const useBy = addDays(can.openedDate, Math.max(1, fridgeDays));
  const daysLeft = diffDays(today, useBy); // >0 future, 0 today, <0 past-due
  return {
    daysOpen: Math.max(0, diffDays(can.openedDate, today)),
    useBy, daysLeft,
    expired: daysLeft < 0,
    expiringToday: daysLeft === 0,
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

// Fridge-aware rotation resolution: which flavor of a variety-pack slot to feed on `date`. Finish
// an open, still-good can first (the oldest one), so you don't start a new flavor while a can sits
// in the fridge; only when nothing of the slot is open does it fall back to the calendar cycle.
// This is what makes rotations + fridge feel real — the plan tracks the physical cans. Non-rotation
// rows pass through unchanged.
// The flavor a rotation slot should feed on `date`, fridge-aware: the flavor of the oldest open,
// still-good can among its members, else the calendar cycle's flavor.
export function activeMemberWithFridge(f, date, fridge, fridgeDays) {
  if (!hasRotation(f)) return null;
  let best = null;
  for (const m of f.rotation) {
    const avail = availableCansOf(fridge, m.name, date, fridgeDays);
    if (avail.length && (!best || avail[0].openedDate < best.openedDate)) best = { m, openedDate: avail[0].openedDate };
  }
  return best ? best.m : activeMember(f, date);
}

export function resolveRotationsWithFridge(items, date, fridge, fridgeDays) {
  return (items || []).map((f) => {
    if (!hasRotation(f)) return f;
    const chosen = activeMemberWithFridge(f, date, fridge, fridgeDays);
    if (!chosen) return f;
    const { id, splitMode, pct, fixedKcal, treatCount, rotation } = f;
    return { ...chosen, id, splitMode, pct, fixedKcal, treatCount, rotation };
  });
}

// Actually consume `grams` of `food` (mutation for logging): draw from good cans oldest-first,
// open new cans as needed, drop finished cans. Returns a NEW fridge array. Non-canned foods and
// zero grams are no-ops (returns the fridge unchanged in shape).
export function consumeFromFridge(fridge, food, grams, today, fridgeDays, makeId) {
  let need = num(grams);
  if (!(need > 0) || !isCanned(food)) return fridge || [];
  const out = (fridge || []).map((c) => ({ ...c }));
  const canGrams = num(food.gramsPerUnit);
  const good = out
    .filter((c) => keyOf(c.name) === keyOf(food.name) && num(c.remainingGrams) > 0.01 && !canStatus(c, today, fridgeDays).expired)
    .sort((a, b) => (a.openedDate < b.openedDate ? -1 : 1));
  for (const c of good) {
    if (need <= 0.01) break;
    const take = Math.min(need, num(c.remainingGrams));
    c.remainingGrams = round2(num(c.remainingGrams) - take);
    need -= take;
  }
  let guard = 0;
  while (need > 0.01 && canGrams > 0 && guard++ < 50) {
    const take = Math.min(need, canGrams);
    out.push({ id: makeId(), ...foodFieldsOf(food), openedDate: today, canGrams, remainingGrams: round2(canGrams - take) });
    need -= take;
  }
  return out.filter((c) => num(c.remainingGrams) > 0.01); // drop emptied cans
}
