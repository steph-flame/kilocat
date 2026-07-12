// Food semantics: the math of a food list (energy density, % splits, transitions)
// and the food library (built-in starters + the shape of a saved food). Pure — no I/O.

import { num, r1, uid } from "./util.js";

/* ---------- energy density & % helpers (shared by every list) ---------- */
export const sumPct = (rows) => rows.reduce((s, f) => s + num(f.pct), 0);

export const kcalPerG = (f) =>
  f.mode === "perKg" ? num(f.kcalPerKg) / 1000
    : (num(f.gramsPerUnit) > 0 ? num(f.kcalPerUnit) / num(f.gramsPerUnit) : 0);

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
  { ...blankFood(), name: "Tiki Cat After Dark — 2.8 oz can", mode: "perUnit", kcalPerUnit: 70, gramsPerUnit: 79, pct: 17 },
  { ...blankFood(), name: "Instinct Ultimate Protein Chicken", mode: "perKg", kcalPerKg: 4470, gramsPerCup: 110, pct: 83 },
];
export const makeStartSeed = () => [{ ...blankFood(), name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941, gramsPerCup: 111, pct: 100 }];

/* ---------- food library ---------- */
// Curated starter foods — verified kcal/kg (or kcal/can) and grams/cup from labels. No
// "(dry)"/"(wet)" in names: the mode already carries that, and it only bred duplicates.
// Own the list rather than depend on a sparse external DB; the user's saved foods extend it.
export const BUILTIN_FOODS = [
  { name: "Tiki Cat After Dark — 2.8 oz can", mode: "perUnit", kcalPerUnit: 70, gramsPerUnit: 79 },
  { name: "Tiki Cat After Dark — 5.5 oz can", mode: "perUnit", kcalPerUnit: 130, gramsPerUnit: 156 },
  { name: "Instinct Ultimate Protein Chicken", mode: "perKg", kcalPerKg: 4470, gramsPerCup: 110 },
  { name: "Orijen Original Cat", mode: "perKg", kcalPerKg: 4150, gramsPerCup: 124 },
  { name: "Orijen Fit & Trim", mode: "perKg", kcalPerKg: 3700, gramsPerCup: 120 },
  { name: "Orijen Guardian 8", mode: "perKg", kcalPerKg: 3980, gramsPerCup: 127 },
  { name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941, gramsPerCup: 111 },
  { name: "Fromm Adult Gold", mode: "perKg", kcalPerKg: 3820, gramsPerCup: 103 },
];

// The macro fields that define a food, independent of any ration (%, id excluded).
const MACRO_KEYS = ["kcalPerKg", "gramsPerCup", "kcalPerUnit", "gramsPerUnit"];

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
