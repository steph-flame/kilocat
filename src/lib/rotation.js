// Rotations ("variety packs"): one ration slot that cycles through several interchangeable flavors,
// one per day, so the plan reflects how people actually feed a multi-flavor case of cans. A slot's
// split (fixed / share / remainder) and its share/amount belong to the ROW and are shared by every
// flavor; only the food itself (name, energy, macros) changes day to day.
//
// A rotation lives on a ration row as `f.rotation`: an array of food objects (same shape as any
// other food — name + mode + energy + guaranteed-analysis). Until the open-can fridge drives which
// flavor is up (tier B), the active flavor advances by CALENDAR DAY, derived deterministically from
// the date string so every render and every device agree without storing a cursor.

export const hasRotation = (f) => Array.isArray(f?.rotation) && f.rotation.length > 0;

// Whole days since the unix epoch for a YYYY-MM-DD date. Forced to UTC midnight so the counter is
// timezone-independent and stable for a given calendar date (the same discipline series.js uses).
const dayIndex = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);

// Index of the flavor active on `date` — cycles 0,1,…,n-1,0,… one step per calendar day.
export function activeRotationIndex(f, date) {
  if (!hasRotation(f)) return -1;
  const n = f.rotation.length;
  if (!date || !Number.isFinite(dayIndex(date))) return 0;
  return ((dayIndex(date) % n) + n) % n;
}
export function activeMember(f, date) {
  const i = activeRotationIndex(f, date);
  return i < 0 ? null : f.rotation[i];
}

// Resolve a row for `date`: a rotation row becomes a plain single food (the active flavor's fields)
// while keeping the row's identity and split — so distributeBowl and every summary treat it like
// any other food. Non-rotation rows pass through unchanged.
export function resolveRotation(f, date) {
  const m = activeMember(f, date);
  if (!m) return f;
  const { id, splitMode, pct, fixedKcal, treatCount, rotation } = f;
  return { ...m, id, splitMode, pct, fixedKcal, treatCount, rotation };
}
export const resolveRotations = (items, date) => (items || []).map((f) => resolveRotation(f, date));

// The food-only fields of a row (no id / split / rotation) — used to seed a rotation from the
// single food already in a slot, and to write a picked/edited flavor back into the list.
export function foodFieldsOf(f) {
  const { id, splitMode, pct, fixedKcal, treatCount, rotation, ...food } = f || {};
  return food;
}
