// Food semantics: the math of a food list (energy density, % splits, transitions)
// and the food library (built-in starters + the shape of a saved food). Pure — no I/O.

import { num, r0, r1, uid } from "./util.js";

/* ---------- energy density & % helpers (shared by every list) ---------- */
export const sumPct = (rows) => rows.reduce((s, f) => s + num(f.pct), 0);

export const kcalPerG = (f) =>
  f.mode === "perKg" ? num(f.kcalPerKg) / 1000
    : (num(f.gramsPerUnit) > 0 ? num(f.kcalPerUnit) / num(f.gramsPerUnit) : 0);

export const FOOD_TYPES = ["wet", "dry", "treat"];

// Food type. An EXPLICIT `type` ('wet' | 'dry' | 'treat') always wins — it's the only way to mark
// a treat, since a treat can't be inferred from packaging or moisture (it's just a small per-unit
// item). With no explicit type we fall back to the honest discriminator, moisture (wet food is
// ~75-82% water, dry kibble ~6-10%, nothing real sits near the 50% line), and before macros are
// entered, to packaging shape (per-unit = can/pouch = wet; per-kg = kibble by the cup = dry).
export const WET_MOISTURE_PCT = 50;
export const foodType = (f) => {
  if (f?.type === "wet" || f?.type === "dry" || f?.type === "treat") return f.type;
  const m = num(f?.moisture);
  if (m > 0) return m >= WET_MOISTURE_PCT ? "wet" : "dry";
  return f?.mode === "perUnit" ? "wet" : "dry";
};

// A treat is priced per treat: mode 'perUnit' with kcalPerUnit = kcal/treat, gramsPerUnit = the
// treat's weight. Energy density (kcalPerG, kcal/kg) then follows exactly as for a can. This
// converts between the two ways a treat label states energy — "1 kcal/treat" and "3423 kcal/kg" —
// so entering either fills the other. Give it {kcalPerTreat, gramsPerTreat} and/or kcalPerKg;
// returns the completed { kcalPerUnit, gramsPerUnit, kcalPerKg }.
export function treatEnergy({ kcalPerTreat, gramsPerTreat, kcalPerKg }) {
  const kt = num(kcalPerTreat), gt = num(gramsPerTreat), kk = num(kcalPerKg);
  // grams/treat unknown but both energies known → derive the treat weight.
  const grams = gt > 0 ? gt : kt > 0 && kk > 0 ? (kt / kk) * 1000 : 0;
  const perKg = kk > 0 ? kk : kt > 0 && grams > 0 ? (kt / grams) * 1000 : 0;
  // keep the derived weight at full-ish precision so kcalPerG (= kcalPerUnit/gramsPerUnit) stays
  // equal to the kcal/kg the owner typed, rather than drifting from a 1-decimal rounding.
  return { kcalPerUnit: kt, gramsPerUnit: grams > 0 ? Math.round(grams * 1e4) / 1e4 : 0, kcalPerKg: r0(perKg) };
}

// Modified-Atwater factors for pet food (kcal per gram of each macro) — lower than human Atwater
// (4/9/4) to reflect pet-diet digestibility. The standard basis for turning a guaranteed analysis
// into a caloric macro distribution.
export const ATWATER = { protein: 3.5, fat: 8.5, carb: 3.5 };

// Derived nutrition from a food's guaranteed analysis (all as-fed %). Returns null until at least
// protein & fat are entered (nothing meaningful to say otherwise). carbs = NFE (nitrogen-free
// extract) = 100 − protein − fat − fiber − moisture − ash, floored at 0. `caloric` is each macro's
// share of metabolizable energy via ATWATER; `dryMatter` restates the percentages moisture-free,
// the honest way to compare a wet food against a dry one.
export function macroProfile(f) {
  if (!f) return null;
  const protein = num(f.protein), fat = num(f.fat);
  if (!(protein > 0) || !(fat > 0)) return null;
  const fiber = num(f.fiber), moisture = num(f.moisture), ash = num(f.ash);
  const carb = Math.max(0, 100 - protein - fat - fiber - moisture - ash);
  const kcalP = protein * ATWATER.protein, kcalF = fat * ATWATER.fat, kcalC = carb * ATWATER.carb;
  const kcalTotal = kcalP + kcalF + kcalC;
  const pct = (x) => (kcalTotal > 0 ? r1((x / kcalTotal) * 100) : 0);
  const dm = 100 - moisture;
  const asDM = (x) => (dm > 0 ? r1((x / dm) * 100) : 0);
  return {
    protein, fat, fiber, moisture, ash, carb: r1(carb),
    caloric: { protein: pct(kcalP), fat: pct(kcalF), carb: pct(kcalC) },
    dryMatter: { protein: asDM(protein), fat: asDM(fat), fiber: asDM(fiber), ash: asDM(ash), carb: asDM(carb) },
  };
}

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

export const blankFood = () => ({ id: uid(), name: "", mode: "perKg", type: "", kcalPerKg: "", gramsPerCup: "", kcalPerUnit: "", gramsPerUnit: "", protein: "", fat: "", fiber: "", moisture: "", ash: "", pct: 0 });

// The macro profile of a whole RATION — a blend of foods, each with a caloric share `pct`.
// Guaranteed-analysis percentages are per gram, so the foods are combined on a MASS basis: a
// food's grams share is proportional to pct/kcalPerG (its energy share ÷ its energy density),
// which is independent of the daily target (the target is a common factor that cancels). Only
// foods with BOTH a usable energy density AND enough GA (macroProfile != null) contribute; the
// returned coverageKcalPct is the caloric share those covered foods represent, so a partial blend
// is never presented as complete. Returns null when nothing in the blend can be analyzed.
export function rationMacroProfile(rows) {
  let wSum = 0; // Σ relative-grams of the covered foods
  let coveredPct = 0, totalPct = 0;
  const blended = { protein: 0, fat: 0, fiber: 0, moisture: 0, ash: 0 };
  for (const f of rows || []) {
    const pct = num(f.pct);
    if (pct <= 0) continue;
    totalPct += pct;
    const density = kcalPerG(f);
    const prof = macroProfile(f);
    if (!(density > 0) || !prof) continue;
    const w = pct / density; // ∝ grams contributed
    wSum += w;
    coveredPct += pct;
    for (const k of ["protein", "fat", "fiber", "moisture", "ash"]) blended[k] += w * num(f[k]);
  }
  if (wSum <= 0) return null;
  for (const k of Object.keys(blended)) blended[k] = blended[k] / wSum;
  const prof = macroProfile(blended);
  if (!prof) return null;
  // Blend energy density: Σkcal/Σgrams = coveredPct / wSum (kcal per gram; ×1000 for kcal/kg).
  return { ...prof, coverageKcalPct: totalPct > 0 ? r1((coveredPct / totalPct) * 100) : 0, kcalPerG: r1((coveredPct / wSum) * 1000) / 1000 };
}

// AAFCO cat-food nutrient MINIMUMS, dry-matter basis (%). The two gates an owner can actually
// check from a label — crude protein and crude fat — for the two life stages. Reference values
// ONLY: not veterinary advice, and silent about the many vitamins/minerals/amino acids (taurine!)
// a complete diet also needs. A diet clearing these two isn't thereby "complete."
export const AAFCO_MIN = {
  adult: { protein: 26, fat: 9 }, // adult maintenance
  growth: { protein: 30, fat: 9 }, // growth & reproduction (kittens, gestation/lactation)
};

// Rate a blend's dry-matter protein/fat against the AAFCO minimum for a life stage. Each →
// "ok" | "near" | "below" (null if that value is unknown). "near" = within 10% above the floor:
// a nudge to double-check, not a failure. `stage` is coarse — anything but "adult" uses growth.
export function aafcoCheck(dryMatter, stage = "adult") {
  const key = stage === "adult" ? "adult" : "growth";
  const min = AAFCO_MIN[key];
  const rate = (val, floor) => {
    if (!(num(val) > 0)) return null;
    if (num(val) < floor) return "below";
    if (num(val) < floor * 1.1) return "near";
    return "ok";
  };
  return { stage: key, min, protein: rate(dryMatter?.protein, min.protein), fat: rate(dryMatter?.fat, min.fat) };
}

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
// Guaranteed analysis (as-fed %) per recipe from tikipets.com (2026) — identical across the two
// can sizes. Ash isn't stated on Tiki's label, so it's left blank (folds into NFE). The lamb/pork
// recipes genuinely differ (higher protein, lower fiber) — verified on the manufacturer pages.
const TIKI_AFTER_DARK = [
  // flavor, 2.8 oz kcal, 5.5 oz kcal, { protein, fat, fiber, moisture }
  ["Chicken", 66, 128, { protein: 11, fat: 2, fiber: 2, moisture: 83 }],
  ["Chicken & Quail Egg", 66, 129, { protein: 11, fat: 2, fiber: 2, moisture: 83 }],
  ["Chicken & Beef", 59, 116, { protein: 11, fat: 2, fiber: 2, moisture: 83 }],
  ["Chicken & Duck", 59, 114, { protein: 11, fat: 2, fiber: 2, moisture: 83 }],
  ["Chicken & Lamb", 61, 120, { protein: 13, fat: 2.3, fiber: 0.6, moisture: 82 }],
  ["Chicken & Pork", 59, 116, { protein: 13, fat: 2, fiber: 0.6, moisture: 81 }],
];
const tikiAfterDark = TIKI_AFTER_DARK.flatMap(([flavor, k28, k55, ga]) => [
  { name: `Tiki Cat After Dark ${flavor} — 2.8 oz can`, mode: "perUnit", kcalPerUnit: k28, gramsPerUnit: 79, ...ga },
  { name: `Tiki Cat After Dark ${flavor} — 5.5 oz can`, mode: "perUnit", kcalPerUnit: k55, gramsPerUnit: 156, ...ga },
]);

// Weruva "Pumpkin Patch Up!" pouches (a pumpkin-purée supplement/topper). kcal per pouch and
// guaranteed analysis (as-fed %) from weruva.com (2026); pouches are 1.05 oz ≈ 30 g and 2.8 oz
// ≈ 79 g. Barely any protein/fat — these are almost all water + fiber (pumpkin), which the macro
// split reflects. Ash not stated on label.
const WERUVA_PUMPKIN = [
  // flavor, 1.05 oz kcal, 2.8 oz kcal, { protein, fat, fiber, moisture }
  ["Puréed Pumpkin", 5, 15, { protein: 0.5, fat: 0.05, fiber: 3.5, moisture: 93 }],
  ["with Ginger & Turmeric", 4, 12, { protein: 0.5, fat: 0.05, fiber: 2.5, moisture: 95 }],
  ["with Coconut Oil & Flaxseeds", 16, 43, { protein: 0.5, fat: 0.5, fiber: 3, moisture: 94 }],
];
const weruvaPumpkin = WERUVA_PUMPKIN.flatMap(([flavor, k105, k28, ga]) => [
  { name: `Weruva Pumpkin Patch Up! ${flavor} — 1.05 oz pouch`, mode: "perUnit", kcalPerUnit: k105, gramsPerUnit: 30, ...ga },
  { name: `Weruva Pumpkin Patch Up! ${flavor} — 2.8 oz pouch`, mode: "perUnit", kcalPerUnit: k28, gramsPerUnit: 79, ...ga },
]);

// Dry foods — guaranteed analysis (as-fed %) from each manufacturer's own site (2026): Instinct,
// Orijen (orijenpetfoods.com), Fromm (frommfamily.com), Farmina N&D. Where a brand doesn't print
// ash on the label it's left blank (it then folds into the derived NFE/carb figure, the standard
// caveat). N&D Prime is included because it's a common premium food and lets an owner who feeds
// it pick up its macros automatically (see backfillBuiltinMacros).
export const BUILTIN_FOODS = [
  ...tikiAfterDark,
  ...weruvaPumpkin,
  { name: "Instinct Ultimate Protein Chicken", mode: "perKg", kcalPerKg: 4470, gramsPerCup: 110, protein: 47, fat: 17, fiber: 3, moisture: 10 },
  { name: "Orijen Original Cat", mode: "perKg", kcalPerKg: 4150, gramsPerCup: 124, protein: 40, fat: 20, fiber: 3, moisture: 10, ash: 8 },
  { name: "Orijen Fit & Trim", mode: "perKg", kcalPerKg: 3700, gramsPerCup: 120, protein: 42, fat: 14, fiber: 6, moisture: 10 },
  { name: "Orijen Guardian 8", mode: "perKg", kcalPerKg: 3980, gramsPerCup: 127, protein: 40, fat: 18, fiber: 4, moisture: 10 },
  { name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941, gramsPerCup: 111, protein: 34, fat: 20, fiber: 3.5, moisture: 10 },
  { name: "Fromm Adult Gold", mode: "perKg", kcalPerKg: 3820, gramsPerCup: 103, protein: 32, fat: 18, fiber: 4.5, moisture: 10 },
  { name: "N&D Prime Chicken & Pomegranate - Adult", mode: "perKg", kcalPerKg: 4396, gramsPerCup: 98, protein: 36, fat: 18, fiber: 2.9, moisture: 8, ash: 7.8 },
];

// The ENERGY fields that define a food's caloric density, independent of any ration. Used as
// the food's IDENTITY for canonicalFoodName's macro-match rename (nutrition is deliberately NOT
// part of identity — two same-energy foods should still canonicalize even if only one has GA
// data). Kept separate from NUTRITION_KEYS for exactly that reason.
export const MACRO_KEYS = ["kcalPerKg", "gramsPerCup", "kcalPerUnit", "gramsPerUnit"];

// Guaranteed-analysis nutrition, as-fed % (the standard cat-food label): crude protein/fat
// (min), crude fiber (max), moisture (max), ash. Carbohydrate (NFE) and the caloric macro split
// are DERIVED from these, not stored — see macroProfile. moisture also drives wet/dry (foodType).
export const NUTRITION_KEYS = ["protein", "fat", "fiber", "moisture", "ash"];

// Every numeric content field (energy + nutrition) — the full set that travels with a food
// through copy/seed and the order-independent library merge (lib/mergeData.js's combineFoodEntry).
export const FOOD_NUM_KEYS = [...MACRO_KEYS, ...NUTRITION_KEYS];

// Fresh library, one editable entry per built-in. This is the seed for useFoodLibrary.
export const makeLibrarySeed = () =>
  BUILTIN_FOODS.map((f) => ({ id: uid(), name: f.name, mode: f.mode, ...macrosOf(f) }));

function macrosOf(f) {
  const out = {};
  for (const k of FOOD_NUM_KEYS) out[k] = f[k] ?? "";
  return out;
}

const isBlankNum = (v) => !(num(v) > 0);

// Heal ration rows written by the early Bowl, which stored the SPLIT mode (fixed/share/remainder)
// in `mode` — the same field kcalPerG reads for the ENERGY mode (perKg/perUnit) — silently
// clobbering it, so dry foods lost their grams. The energy *values* survived, so infer the energy
// mode back from them and move the split mode to its own `splitMode` field. No-op once migrated.
const SPLIT_MODES = ["fixed", "share", "remainder"];
export function migrateSplitMode(f) {
  if (!f || !SPLIT_MODES.includes(f.mode)) return f;
  const energyMode = num(f.kcalPerKg) > 0 ? "perKg" : num(f.kcalPerUnit) > 0 || num(f.gramsPerUnit) > 0 ? "perUnit" : "perKg";
  return { ...f, splitMode: f.splitMode || f.mode, mode: energyMode };
}

// Fill any blank energy/nutrition field on a food from the matching built-in (exact name, after
// canonicalization), so a food saved before a built-in gained its macros picks them up on load —
// WITHOUT ever overwriting a value the user actually entered. Non-built-in foods pass through.
// This is what auto-fills existing users' libraries when BUILTIN_FOODS gains guaranteed-analysis
// data; harmless (a no-op) for any field the built-in itself leaves blank.
export function backfillBuiltinMacros(f) {
  if (!f || f.name == null) return f;
  const b = BUILTIN_FOODS.find((x) => keyOf(x.name) === keyOf(f.name));
  if (!b) return f;
  let out = f;
  for (const k of FOOD_NUM_KEYS) {
    if (isBlankNum(out[k]) && !isBlankNum(b[k])) out = { ...out, [k]: b[k] };
  }
  return out;
}

// A library food -> the fields to drop onto a ration row (leaves name/pct to the caller
// so an exact-name match refills macros without clobbering an in-progress %/name).
export const libEntry = (food) => ({ name: food.name, mode: food.mode, type: food.type ?? "", ...macrosOf(food) });

// A ration/start row -> a library entry (strip the ration-only fields).
export const toLibraryEntry = (f) => ({ name: f.name.trim(), mode: f.mode, type: f.type ?? "", ...macrosOf(f) });

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

// Case-insensitive, word-order-independent search over names. The query is split into tokens and
// a food matches only if EVERY token appears somewhere in its name — so "lamb" finds "Tiki Cat
// After Dark Chicken & Lamb", and "tiki lamb" finds it too regardless of the words' order. Results
// are ranked so the most relevant surface first within any display cap: a name that starts with
// the whole query beats one where a word merely starts with a token, which beats a mid-word hit;
// shorter names break ties. Empty query returns the list unchanged.
export function searchFoods(list, query) {
  const q = keyOf(query);
  if (!q) return list;
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const f of list) {
    const name = String(f.name || "").toLowerCase();
    if (!tokens.every((t) => name.includes(t))) continue;
    const words = name.split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    if (name.startsWith(q)) score += 100;
    for (const t of tokens) {
      if (words.some((w) => w.startsWith(t))) score += 10; // token begins a word
      else score += 1; // token only appears mid-word
    }
    scored.push({ f, score, len: name.length });
  }
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.f.name.localeCompare(b.f.name));
  return scored.map((s) => s.f);
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
