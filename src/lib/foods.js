// Food semantics: the math of a food list (energy density, % splits, transitions)
// and the food library (built-in starters + the shape of a saved food). Pure — no I/O.

import { num, r0, r1, uid } from "./util.js";

/* ---------- energy density & % helpers (shared by every list) ---------- */
export const sumPct = (rows) => rows.reduce((s, f) => s + num(f.pct), 0);

export const kcalPerG = (f) =>
  f.mode === "perKg" ? num(f.kcalPerKg) / 1000
    : (num(f.gramsPerUnit) > 0 ? num(f.kcalPerUnit) / num(f.gramsPerUnit) : 0);

// Re-derive an intake-log entry's kcal from an edited grams value, using the SAME per-gram
// density recorded on the entry at creation time (entry.kcalPerG — see Log.jsx's addEntry,
// which stores it whenever a food was picked). Returns null when the entry can't support a
// grams-based edit at all — no density was recorded (an entry logged before this field
// existed, or one where kcal was typed by hand with no food picked) — callers fall back to
// editing kcal directly in that case.
export function kcalFromGrams(entry, grams) {
  if (!(num(entry?.kcalPerG) > 0)) return null;
  return r0(grams * entry.kcalPerG);
}

// Guard for an edited intake-log quantity (grams or kcal): must be a genuine positive number.
// Same bar entry creation already holds itself to (Log.jsx only ever adds an entry when its
// kcal is > 0) — deliberately NOT relaxed to allow 0 here, since 0 is reserved for the
// explicit "nothing eaten" marker, not an ordinary entry edited down to nothing.
export const isValidQty = (n) => Number.isFinite(n) && n > 0;

// Integer split of target sum S across rows, proportional to current values (even if all zero).
export function distribute(vals, S) {
  const n = vals.length; if (n === 0) return [];
  S = Math.max(0, Math.round(S));
  const sum = vals.reduce((a, b) => a + b, 0);
  const raw = sum > 0 ? vals.map((v) => (v / sum) * S) : vals.map(() => S / n);
  const floored = raw.map(Math.floor);
  const rem = S - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
  for (let k = 0; k < rem; k++) floored[order[k % n].i] += 1;
  return floored;
}

export const normalizePct = (rows) => {
  const s = sumPct(rows);
  return s > 0 ? rows.map((f) => ({ ...f, pct: r1((num(f.pct) / s) * 100) })) : rows;
};

// Drag row `id` to `raw`%: hold rows above fixed, flex rows below to keep the total 100%.
// If it's the last row (nothing below), flex the rows above instead.
export function waterfall(rows, id, raw) {
  const idx = rows.findIndex((x) => x.id === id);
  if (idx < 0) return rows;
  const out = rows.map((f) => ({ ...f, pct: num(f.pct) }));
  let v = Math.max(0, Math.min(100, Math.round(raw)));
  const above = out.slice(0, idx), below = out.slice(idx + 1);
  const sumAbove = above.reduce((sm, f) => sm + f.pct, 0);
  if (below.length > 0) {
    v = Math.min(v, Math.max(0, 100 - sumAbove)); out[idx].pct = v;
    const d = distribute(below.map((f) => f.pct), 100 - sumAbove - v);
    below.forEach((_, k) => { out[idx + 1 + k].pct = d[k]; });
  } else if (above.length > 0) {
    out[idx].pct = v;
    const d = distribute(above.map((f) => f.pct), 100 - v);
    above.forEach((_, k) => { out[k].pct = d[k]; });
  } else out[idx].pct = 100;
  return out;
}

export const blankFood = () => ({ id: uid(), name: "", mode: "perKg", kcalPerKg: "", gramsPerCup: "", kcalPerUnit: "", gramsPerUnit: "", pct: 0 });

// One transition-table cell: how much of food `f` to feed on a day when this blend
// covers `blendFrac` of the ration (old blend = 1 - toNew, new ration = toNew).
// `listSum` is that blend's total pct (its rows may not sum to exactly 100). Returns
// kcal when unit === "kcal", else grams. Summed across every food in both blends on a
// given day this equals `target` exactly (in kcal) — total energy is held constant.
export function transitionAmount(f, blendFrac, listSum, target, unit) {
  const share = listSum > 0 ? num(f.pct) / listSum : 0;
  const kc = target * blendFrac * share;
  if (unit === "kcal") return kc;
  const kpg = kcalPerG(f);
  return kpg > 0 ? kc / kpg : 0;
}

/* ---------- seeds ---------- */
// Names/macros match a BUILTIN_FOODS entry exactly, so auto-save merges them into the same
// library entry rather than creating a near-duplicate.
export const makeRationSeed = () => [
  { ...blankFood(), name: "Tiki Cat After Dark Chicken & Quail Egg — 2.8 oz can", mode: "perUnit", kcalPerUnit: 66, gramsPerUnit: 79, pct: 17 },
  { ...blankFood(), name: "Instinct Ultimate Protein Chicken", mode: "perKg", kcalPerKg: 4470, gramsPerCup: 110, pct: 83 },
];
export const makeStartSeed = () => [{ ...blankFood(), name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941, gramsPerCup: 111, pct: 100 }];

/* ---------- food library ---------- */
// Curated starter foods — verified kcal/kg (or kcal/can) and grams/cup from labels. No
// "(dry)"/"(wet)" in names: the mode already carries that, and it only bred duplicates.
// Own the list rather than depend on a sparse external DB; the user's saved foods extend it.
// Tiki Cat After Dark — whole-food ("in broth") line, all 6 flavors × both can sizes.
// kcal/can are the official tikipets.com values (2026); the pâté and mousse lines share
// flavor names but run higher, and are intentionally excluded. Cans: 2.8 oz ≈ 79 g,
// 5.5 oz ≈ 156 g (oz→g; Tiki labels by ounce).
const TIKI_AFTER_DARK = [
  // flavor, 2.8 oz kcal, 5.5 oz kcal
  ["Chicken", 66, 128],
  ["Chicken & Quail Egg", 66, 129],
  ["Chicken & Beef", 59, 116],
  ["Chicken & Duck", 59, 114],
  ["Chicken & Lamb", 61, 120],
  ["Chicken & Pork", 59, 116],
];
const tikiAfterDark = TIKI_AFTER_DARK.flatMap(([flavor, k28, k55]) => [
  { name: `Tiki Cat After Dark ${flavor} — 2.8 oz can`, mode: "perUnit", kcalPerUnit: k28, gramsPerUnit: 79 },
  { name: `Tiki Cat After Dark ${flavor} — 5.5 oz can`, mode: "perUnit", kcalPerUnit: k55, gramsPerUnit: 156 },
]);

// Weruva "Pumpkin Patch Up!" pouches (a pumpkin-purée supplement/topper). kcal per pouch
// from weruva.com (2026); pouches are 1.05 oz ≈ 30 g and 2.8 oz ≈ 79 g.
const WERUVA_PUMPKIN = [
  // flavor, 1.05 oz kcal, 2.8 oz kcal
  ["Puréed Pumpkin", 5, 15],
  ["with Ginger & Turmeric", 4, 12],
  ["with Coconut Oil & Flaxseeds", 16, 43],
];
const weruvaPumpkin = WERUVA_PUMPKIN.flatMap(([flavor, k105, k28]) => [
  { name: `Weruva Pumpkin Patch Up! ${flavor} — 1.05 oz pouch`, mode: "perUnit", kcalPerUnit: k105, gramsPerUnit: 30 },
  { name: `Weruva Pumpkin Patch Up! ${flavor} — 2.8 oz pouch`, mode: "perUnit", kcalPerUnit: k28, gramsPerUnit: 79 },
]);

export const BUILTIN_FOODS = [
  ...tikiAfterDark,
  ...weruvaPumpkin,
  { name: "Instinct Ultimate Protein Chicken", mode: "perKg", kcalPerKg: 4470, gramsPerCup: 110 },
  { name: "Orijen Original Cat", mode: "perKg", kcalPerKg: 4150, gramsPerCup: 124 },
  { name: "Orijen Fit & Trim", mode: "perKg", kcalPerKg: 3700, gramsPerCup: 120 },
  { name: "Orijen Guardian 8", mode: "perKg", kcalPerKg: 3980, gramsPerCup: 127 },
  { name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941, gramsPerCup: 111 },
  { name: "Fromm Adult Gold", mode: "perKg", kcalPerKg: 3820, gramsPerCup: 103 },
];

// The macro fields that define a food, independent of any ration (%, id excluded). Exported
// for lib/mergeData.js's order-independent library merge (mergeLibrary), which needs the same
// field list to combine two replicas' conflicting copies of a same-identity food.
export const MACRO_KEYS = ["kcalPerKg", "gramsPerCup", "kcalPerUnit", "gramsPerUnit"];

// Fresh library, one editable entry per built-in. This is the seed for useFoodLibrary.
export const makeLibrarySeed = () =>
  BUILTIN_FOODS.map((f) => ({ id: uid(), name: f.name, mode: f.mode, ...macrosOf(f) }));

function macrosOf(f) {
  const out = {};
  for (const k of MACRO_KEYS) out[k] = f[k] ?? "";
  return out;
}

// A library food -> the fields to drop onto a ration row (leaves name/pct to the caller
// so an exact-name match refills macros without clobbering an in-progress %/name).
export const libEntry = (food) => ({ name: food.name, mode: food.mode, ...macrosOf(food) });

// A ration/start row -> a library entry (strip the ration-only fields).
export const toLibraryEntry = (f) => ({ name: f.name.trim(), mode: f.mode, ...macrosOf(f) });

// A row is worth remembering once it has a name and an energy value for its mode.
export const isCompleteFood = (f) =>
  f.name.trim() !== "" &&
  (f.mode === "perKg" ? num(f.kcalPerKg) > 0 : num(f.kcalPerUnit) > 0);

const keyOf = (name) => String(name || "").trim().toLowerCase();

// Insert or update by name (case-insensitive). Keeps the existing id on update so
// React keys stay stable; new foods get a fresh id.
export function upsertFood(list, entry) {
  const k = keyOf(entry.name);
  if (!k) return list;
  const idx = list.findIndex((f) => keyOf(f.name) === k);
  if (idx < 0) return [...list, { id: uid(), ...entry }];
  const next = list.slice();
  next[idx] = { ...next[idx], ...entry };
  return next;
}

// Case-insensitive substring search over names; empty query returns all.
export function searchFoods(list, query) {
  const q = keyOf(query);
  if (!q) return list;
  return list.filter((f) => f.name.toLowerCase().includes(q));
}

// Drop a trailing "(dry)"/"(wet)" — noise, since the mode already says which.
export const stripKind = (name) => String(name || "").replace(/\s*\((?:dry|wet)\)\s*$/i, "").trim();

// Snap a food to a built-in's canonical name when they're macro-identical and the built-in
// name merely extends this one (e.g. legacy "Instinct Ultimate Protein" → the built-in
// "Instinct Ultimate Protein Chicken"). Only ever renames toward a built-in, and only on an
// exact macro + mode match with a name-prefix relationship, so it can't merge genuinely
// different foods. Returns the (possibly renamed) food's name.
export function canonicalFoodName(f) {
  const nm = keyOf(f.name);
  if (!nm) return f.name;
  const hit = BUILTIN_FOODS.find((b) =>
    b.mode === f.mode &&
    keyOf(b.name) !== nm &&
    MACRO_KEYS.every((k) => num(b[k]) === num(f[k])) &&
    (keyOf(b.name).startsWith(nm) || nm.startsWith(keyOf(b.name))));
  return hit ? hit.name : f.name;
}

// Legacy generic "Tiki Cat After Dark" with no flavor — every real flavor contains "Chicken",
// so the absence of it marks the old placeholder entries/seed.
const isLegacyGenericTiki = (name) => {
  const n = String(name || "").trim();
  return /^tiki cat after dark\b/i.test(n) && !/chicken/i.test(n);
};

// Retire the legacy generic Tiki: map it to the whole-food Chicken & Quail Egg of the matching
// can size — a sensible, editable default now that specific flavors exist. Others pass through.
export function migrateLegacyFood(f) {
  if (!f || !isLegacyGenericTiki(f.name)) return f;
  const big = /5\.5/.test(String(f.name)) || num(f.gramsPerUnit) >= 120;
  const b = BUILTIN_FOODS.find((x) => x.name === `Tiki Cat After Dark Chicken & Quail Egg — ${big ? "5.5" : "2.8"} oz can`);
  return b ? { ...f, name: b.name, mode: b.mode, ...macrosOf(b) } : f;
}

// Ensure every current built-in is present in a saved library (adds only what's missing,
// leaves the user's own foods), so existing users pick up food-list changes on load.
export function ensureBuiltins(list) {
  const out = list.slice();
  for (const b of BUILTIN_FOODS) {
    if (!out.some((f) => keyOf(f.name) === keyOf(b.name))) out.push({ id: uid(), name: b.name, mode: b.mode, ...macrosOf(b) });
  }
  return out;
}

// One-time cleanup for a saved library: merge entries that are the same food once the
// "(dry)"/"(wet)" suffix is ignored, keeping the clean name and filling in any missing
// macros from the duplicate. Order-preserving and idempotent.
export function dedupeFoods(list) {
  const byKey = new Map();
  const out = [];
  for (const f of list) {
    const key = keyOf(stripKind(f.name));
    if (!key) { out.push(f); continue; }
    if (byKey.has(key)) {
      const cur = byKey.get(key);
      for (const k of MACRO_KEYS) if (!num(cur[k]) && num(f[k])) cur[k] = f[k];
    } else {
      const clean = { ...f, name: stripKind(f.name) };
      byKey.set(key, clean);
      out.push(clean);
    }
  }
  return out;
}
