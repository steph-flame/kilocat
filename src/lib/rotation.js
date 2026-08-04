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

// A display name for a variety pack: the flavors' shared prefix, so a rotating slot is labelled by
// the PACK rather than by whichever can happens to be open.
//
// Why derived rather than stored: a rotation is just a list of member foods — there's no pack-name
// field to read, and asking the owner to name it would be a form to fill in for something the names
// already say. "Tiki Cat After Dark Chicken & Quail Egg — 2.8 oz can" and "…Chicken & Beef — 2.8 oz
// can" share "Tiki Cat After Dark Chicken", which is exactly the label.
//
// DISPLAY ONLY. Matching, logging and the fridge all key off the real food name; this never
// substitutes for it. Falls back to "<flavor> +N more" when the names share nothing meaningful
// (an ad-hoc pack of unrelated foods), so the label is never a misleading fragment.
export function packLabel(f) {
  if (!hasRotation(f)) return f?.name || "";
  const names = f.rotation.map((m) => String(m?.name || "").trim()).filter(Boolean);
  if (names.length === 0) return f?.name || "";
  if (names.length === 1) return names[0];

  // longest common prefix, case-insensitively
  let end = names[0].length;
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < end && i < n.length && names[0][i].toLowerCase() === n[i].toLowerCase()) i++;
    end = i;
  }
  let prefix = names[0].slice(0, end);
  // Don't cut mid-word: if any name continues with a word character right where the prefix stops,
  // back up to the last space so we get "Tiki Cat After Dark Chicken", never "…Chick".
  if (names.some((n) => /[\w]/.test(n.charAt(end) || ""))) {
    prefix = prefix.slice(0, Math.max(0, prefix.lastIndexOf(" ")));
  }
  prefix = prefix.replace(/[\s\-—–&,:/|+]+$/, "").trim();

  const meaningful = prefix.length >= 3 && /[a-z0-9]/i.test(prefix);
  return meaningful ? prefix : `${names[0]} +${names.length - 1} more`;
}
