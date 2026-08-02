// Rotations ("variety packs"): one ration slot that cycles through several interchangeable flavors,
// one per day, so the plan reflects how people actually feed a multi-flavor case of cans. A slot's
// split (fixed / share / remainder) and its share/amount belong to the ROW and are shared by every
// flavor; only the food itself (name, energy, macros) changes day to day.
//
// A rotation lives on a ration row as `f.rotation`: an array of food objects (same shape as any
// other food — name + mode + energy + guaranteed-analysis). Until the open-can fridge drives which
// flavor is up (tier B), the active flavor advances by CALENDAR DAY, derived deterministically from
// the date string so every render and every device agree without storing a cursor.

// A row HAS rotation data if it holds a flavor list. It's actively ROTATING only with ≥2 flavors and
// not paused (`rotateOff`) — a paused pack, or one down to a single flavor, just feeds its first
// flavor. Pausing (rather than deleting) is what lets the ↻ button be non-destructive.
export const hasRotation = (f) => Array.isArray(f?.rotation) && f.rotation.length > 0;
export const isRotating = (f) => hasRotation(f) && f.rotation.length >= 2 && !f.rotateOff;

// Whole days since the unix epoch for a YYYY-MM-DD date. Forced to UTC midnight so the counter is
// timezone-independent and stable for a given calendar date (the same discipline series.js uses).
const dayIndex = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);

// Index of the flavor active on `date` — cycles one step per calendar day when rotating, else the
// first flavor (paused / single-flavor).
export function activeRotationIndex(f, date) {
  if (!hasRotation(f)) return -1;
  if (!isRotating(f)) return 0;
  const n = f.rotation.length;
  if (!date || !Number.isFinite(dayIndex(date))) return 0;
  return ((dayIndex(date) % n) + n) % n;
}
export function activeMember(f, date) {
  const i = activeRotationIndex(f, date);
  return i < 0 ? null : f.rotation[i];
}

// The next `n` flavor names in PACK ORDER starting at `startIdx` — a preview of the cycle so the
// row shows what it does. (Order is driven by the cans, not the calendar; see fridge.js.)
export function upcomingFlavors(f, startIdx, n = 3) {
  if (!isRotating(f)) return [];
  const len = f.rotation.length, start = ((startIdx % len) + len) % len, out = [];
  for (let k = 0; k < Math.min(n, len); k++) out.push(f.rotation[(start + k) % len]?.name || "—");
  return out;
}

// Resolve a row for `date`: a rotation row becomes a plain single food (the active flavor's fields)
// while keeping the row's identity and split — so distributeBowl and every summary treat it like
// any other food. Non-rotation rows pass through unchanged. NB: this uses the CALENDAR active member
// (paused/single); the fridge-aware "current flavor" is resolved via fridge.js's
// resolveRotationsWithFridge, which the Bowl/Log actually use.
export function resolveRotation(f, date) {
  const m = activeMember(f, date);
  if (!m) return f;
  const { id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex } = f;
  return { ...m, id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex };
}
export const resolveRotations = (items, date) => (items || []).map((f) => resolveRotation(f, date));

// The food-only fields of a row (no id / split / rotation / cursor) — used to seed a rotation from
// the single food already in a slot, and to write a picked/edited flavor back into the list.
export function foodFieldsOf(f) {
  const { id, splitMode, pct, fixedKcal, treatCount, rotation, rotateOff, rotIndex, ...food } = f || {};
  return food;
}
