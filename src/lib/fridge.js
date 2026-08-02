// The open-can fridge (tier B of rotations + fridge). Wet food comes in cans/pouches bigger than
// one meal: you open one, feed part, and the rest keeps in the fridge for ~fridgeDays before it
// should be tossed. The fridge is a list of OPEN CANS — each a food snapshot (so it stays correct
// even if the library changes later) plus when it was opened and how many grams are left.
//
// Only wet cans/pouches are tracked: dry kibble comes from a bag (not perishable on this scale) and
// treats don't spoil in a few days. Pure functions — no I/O; the caller (AppState) owns the array
// and supplies an id factory.

import { foodFieldsOf, hasRotation, isRotating, activeMember } from "./rotation.js";
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

// A variety pack is consumed IN ORDER, driven by the cans — not by the calendar. You feed the
// currently-open flavor until its can is empty, then move to the NEXT flavor in the pack and open
// its can; a single day can finish one can and open the next. `f.rotIndex` is the cursor — the
// flavor we're currently on — advanced by consumePack when a can is finished. When a can is
// physically open it anchors position (so the cursor self-heals to reality); otherwise the cursor
// says what to open next.

const norm = (i, n) => ((i % n) + n) % n;

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

// Walk a pack's day of `grams` in order from the start flavor, finishing each open can before
// opening the next flavor's. `apply` (optional) mutates a working fridge copy — used by consumePack;
// planPackDraw passes a copy so it's non-mutating. Returns { segs, endIndex } where segs describe
// the flavors drawn (for the tonight prompt) and endIndex is the cursor to persist.
function walkPack(f, grams, fridge, today, fridgeDays, makeId) {
  const n = f.rotation.length;
  const out = fridge.map((c) => ({ ...c }));
  let cur = packStartIndex(f, out, today, fridgeDays);
  let need = num(grams), guard = 0;
  const segs = [];
  while (need > 0.01 && guard++ < 100) {
    const flavor = f.rotation[cur];
    const avail = availableCansOf(out, flavor.name, today, fridgeDays);
    if (avail.length) {
      const can = out.find((c) => c.id === avail[0].id);
      const take = Math.min(need, num(can.remainingGrams));
      can.remainingGrams = round2(num(can.remainingGrams) - take);
      segs.push({ flavor: flavor.name, kind: "open", take: round2(take), status: canStatus(can, today, fridgeDays) });
      need -= take;
      if (need <= 0.01) { if (num(can.remainingGrams) <= 0.01) cur = norm(cur + 1, n); break; }
      cur = norm(cur + 1, n); // this can done → next flavor
    } else {
      const canGrams = num(flavor.gramsPerUnit);
      if (!(canGrams > 0)) break; // can't open a can without a known size
      const take = Math.min(need, canGrams);
      out.push({ id: makeId ? makeId() : `sim_${cur}_${guard}`, ...foodFieldsOf(flavor), openedDate: today, canGrams, remainingGrams: round2(canGrams - take) });
      segs.push({ flavor: flavor.name, kind: "new", take: round2(take) });
      need -= take;
      if (need <= 0.01) { if (take >= canGrams - 0.01) cur = norm(cur + 1, n); break; }
      cur = norm(cur + 1, n);
    }
  }
  return { fridge: out.filter((c) => num(c.remainingGrams) > 0.01), segs, endIndex: cur };
}

// Non-mutating plan of tonight's pack draw (for the Log's tonight prompt / draw list).
export function planPackDraw(f, grams, fridge, today, fridgeDays) {
  if (!isRotating(f)) return { segs: [], endIndex: 0 };
  return walkPack(f, grams, fridge || [], today, fridgeDays, null);
}

// Execute a pack draw (mutation for logging): returns the new fridge AND the advanced cursor.
export function consumePack(fridge, f, grams, today, fridgeDays, makeId) {
  if (!isRotating(f) || !(num(grams) > 0)) return { fridge: fridge || [], rotIndex: num(f.rotIndex) };
  const r = walkPack(f, grams, fridge || [], today, fridgeDays, makeId);
  return { fridge: r.fridge, rotIndex: r.endIndex };
}

export function resolveRotationsWithFridge(items, date, fridge, fridgeDays) {
  return (items || []).map((f) => {
    if (!hasRotation(f)) return f;
    const chosen = activeMemberWithFridge(f, date, fridge, fridgeDays);
    if (!chosen) return f;
    const { id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex } = f;
    return { ...chosen, id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex };
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
