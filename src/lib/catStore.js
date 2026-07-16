// Pure reducer-style helpers for the multi-cat state shape: { activeCatId, cats: { [id]: <per-cat state> } }.
// No React, no I/O — testable directly. AppState.jsx is the only caller; pages never see this shape,
// they see the active cat's fields flattened onto the context (see AppState.jsx).

import { uid } from "./util.js";
import { defaultFactors } from "./nutrition.js";
import { blankFood } from "./foods.js";

export const defaultTr = () => ({ on: false, days: 7, timelineUnit: "g" });
// weight unit used to live here (per-cat); it's now a shared top-level field (see AppState.jsx).
export const defaultExpSettings = () => ({ pctPerWeek: 1, energyBasis: "formula", algo: "v3", direction: "auto", lastMethod: "petScale" });

// The active cat, cycled to the next in catsSummary order — same behavior for the header's
// tap-to-cycle switcher and the Home masthead's tappable name.
export const nextCatId = (catsSummary, activeCatId) => {
  const idx = catsSummary.findIndex((c) => c.id === activeCatId);
  return catsSummary[(idx + 1) % catsSummary.length].id;
};

// Resolve the shared weight unit on load/import: the blob's own top-level field if it's a
// valid unit, else (an older export from before `unit` was promoted out of per-cat
// expSettings) the given cat's old value. Undefined if neither — caller keeps whatever's
// already there (the "kg" default on first run, or the current value on import).
export function resolveUnit(topUnit, legacyUnit) {
  if (topUnit === "kg" || topUnit === "lb") return topUnit;
  if (legacyUnit === "kg" || legacyUnit === "lb") return legacyUnit;
  return undefined;
}

// A brand-new cat's profile — blank, never a copy of the seed demo cat (Mithril). "maintain"
// is the first adult goal; goalsForAge falls back to it if the cat turns out to be a kitten
// once a dob is set.
export const freshProfile = () => ({
  name: "", dob: "", weightKg: "", ageUnit: "months",
  neutered: false, bcMode: "pct", bcs: 5, pctOver: 0, bcAsOf: null, goal: "maintain",
  customTarget: "", gentleBasis: "current", factors: { ...defaultFactors },
});

// A brand-new cat's full per-cat state: one blank ration row and one blank "currently
// feeding" row (each at 100% — with a single row it IS the whole diet), no history yet.
export const freshCatState = () => ({
  profile: freshProfile(),
  ration: [{ ...blankFood(), pct: 100 }],
  start: [{ ...blankFood(), pct: 100 }],
  weightLog: [],
  intakeLog: [],
  tr: defaultTr(),
  expSettings: defaultExpSettings(),
});

// Add a fresh blank cat and make it active.
export function addCat(state) {
  const id = uid();
  return { activeCatId: id, cats: { ...state.cats, [id]: freshCatState() } };
}

// Delete a cat. Deleting the last one replaces it with a fresh blank cat rather than
// leaving zero cats — every page assumes an active cat exists.
export function deleteCat(state, id) {
  const remaining = Object.keys(state.cats).filter((k) => k !== id);
  if (remaining.length === 0) {
    const newId = uid();
    return { activeCatId: newId, cats: { [newId]: freshCatState() } };
  }
  const cats = { ...state.cats };
  delete cats[id];
  const activeCatId = state.activeCatId === id ? remaining[0] : state.activeCatId;
  return { activeCatId, cats };
}

// Wipe one cat's weigh-in + intake history only — profile, ration, and saved foods
// (which live outside this shape, in the shared library) are untouched.
export function clearCatHistory(state, id) {
  if (!state.cats[id]) return state;
  return { ...state, cats: { ...state.cats, [id]: { ...state.cats[id], weightLog: [], intakeLog: [] } } };
}

// Switch the active cat; a no-op if the id doesn't exist.
export function switchCat(state, id) {
  return state.cats[id] ? { ...state, activeCatId: id } : state;
}
