// Pure reducer-style helpers for the multi-cat state shape: { activeCatId, cats: { [id]: <per-cat state> } }.
// No React, no I/O — testable directly. AppState.jsx is the only caller; pages never see this shape,
// they see the active cat's fields flattened onto the context (see AppState.jsx).

import { uid } from "./util.js";
import { defaultFactors } from "./nutrition.js";
import { blankFood } from "./foods.js";
import { weightKey, intakeKey } from "./mergeData.js";

// Biscuit, the virtual demo cat (see lib/demoCat.js) — never a key in `cats`, never
// persisted. Defined here (not in demoCat.js, which imports freshProfile/defaultTr/
// defaultExpSettings from THIS module) so the two files don't import each other.
export const DEMO_CAT_ID = "__demo__";

export const defaultTr = () => ({ on: false, days: 7, timelineUnit: "g" });
// weight unit and estimator algo used to live here (per-cat); both are now shared top-level
// fields (see AppState.jsx) — `algo` is deliberately no longer written here, though old
// stored/imported data that still has it on a cat's expSettings is tolerated (see resolveEstimator,
// validate.js, migrate.js), just ignored in favor of the shared field.
export const defaultExpSettings = () => ({ pctPerWeek: 1, energyBasis: "formula", direction: "auto", lastMethod: "petScale" });

// Resolve the shared weight unit on load/import: the blob's own top-level field if it's a
// valid unit, else (an older export from before `unit` was promoted out of per-cat
// expSettings) the given cat's old value. Undefined if neither — caller keeps whatever's
// already there (the "kg" default on first run, or the current value on import).
export function resolveUnit(topUnit, legacyUnit) {
  if (topUnit === "kg" || topUnit === "lb") return topUnit;
  if (legacyUnit === "kg" || legacyUnit === "lb") return legacyUnit;
  return undefined;
}

const ESTIMATORS = ["v1", "v2", "v3"];
// Resolve the shared expenditure estimator on load/import: same courtesy pattern as
// resolveUnit above. The blob's own top-level field if it's a valid estimator, else (an
// older export from before `estimator` was promoted out of per-cat expSettings.algo) the
// given cat's old `algo` value. Undefined if neither — caller keeps whatever's already
// there (the "v3" default on first run, or the current value on import).
export function resolveEstimator(topEstimator, legacyAlgo) {
  if (ESTIMATORS.includes(topEstimator)) return topEstimator;
  if (ESTIMATORS.includes(legacyAlgo)) return legacyAlgo;
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
// stateModAt/deletedEntries are the edit-propagation-sync fields (see lib/mergeData.js) —
// a brand-new cat starts at the oldest possible stateModAt (0) and no tombstones; the first
// real edit (setP/setTr/setExpSettings/ration/start via updateActiveCat, or updateCatProfile
// — see AppState.jsx) stamps a real one.
export const freshCatState = () => ({
  profile: freshProfile(),
  ration: [{ ...blankFood(), pct: 100 }],
  start: [{ ...blankFood(), pct: 100 }],
  weightLog: [],
  intakeLog: [],
  intakeDayStatus: {},
  tr: defaultTr(),
  expSettings: defaultExpSettings(),
  stateModAt: 0,
  deletedEntries: {},
});

// Add a fresh blank cat and make it active. Spreads `...state` (not just activeCatId/cats) so
// the top-level deletedCats tombstone map passes through untouched.
export function addCat(state) {
  const id = uid();
  return { ...state, activeCatId: id, cats: { ...state.cats, [id]: freshCatState() } };
}

// Delete a cat, recording a `deletedCats` tombstone (id → deletedAt) so the deletion can
// propagate to another device on the next merge (see lib/mergeData.js's mergeCats) instead of
// the cat silently reappearing there. Deleting the last real one switches active to Biscuit
// (the virtual demo cat) rather than fabricating a fresh blank real cat — a user who's just
// removed their only cat sees the demo, exactly like a brand-new install, instead of a blank
// profile that looks like data loss. `now` defaults to Date.now() (app code); tests pin it.
export function deleteCat(state, id, now = Date.now()) {
  const deletedCats = { ...(state.deletedCats || {}) };
  if (state.cats[id]) deletedCats[id] = now; // only tombstone a cat that actually existed
  const remaining = Object.keys(state.cats).filter((k) => k !== id);
  if (remaining.length === 0) return { activeCatId: DEMO_CAT_ID, cats: {}, deletedCats };
  const cats = { ...state.cats };
  delete cats[id];
  const activeCatId = state.activeCatId === id ? remaining[0] : state.activeCatId;
  return { ...state, activeCatId, cats, deletedCats };
}

// Wipe one cat's weigh-in + intake history only — profile, ration, and saved foods
// (which live outside this shape, in the shared library) are untouched. Records a
// `deletedEntries` tombstone for every weigh-in/meal key being cleared (using mergeData's own
// weightKey/intakeKey — the same identity the merge union uses) so the clear propagates on
// the next merge instead of a stale copy of the history reappearing from another device.
// Doesn't touch stateModAt: history isn't part of the current-state bundle that field covers.
export function clearCatHistory(state, id, now = Date.now()) {
  if (!state.cats[id]) return state;
  const cat = state.cats[id];
  const deletedEntries = { ...(cat.deletedEntries || {}) };
  for (const e of cat.weightLog || []) deletedEntries[weightKey(e)] = now;
  for (const e of cat.intakeLog || []) deletedEntries[intakeKey(e)] = now;
  return { ...state, cats: { ...state.cats, [id]: { ...cat, weightLog: [], intakeLog: [], deletedEntries } } };
}

// Switch the active cat; a no-op if the id doesn't exist. Biscuit (DEMO_CAT_ID) is always a
// valid target even though it's never a key in `cats` — it's generated on the fly (see
// lib/demoCat.js), not stored.
export function switchCat(state, id) {
  if (id === DEMO_CAT_ID) return { ...state, activeCatId: DEMO_CAT_ID };
  return state.cats[id] ? { ...state, activeCatId: id } : state;
}

// Patch any cat's profile fields by id — not just the active one, so Settings can edit
// every row inline without switching to it first. A no-op if the id doesn't exist;
// untouched cats keep reference equality. Stamps that cat's stateModAt — profile is part of
// the current-state bundle mergeV2 LWWs on (see lib/mergeData.js) — so this edit wins over an
// older copy of the same cat on another device. `now` defaults to Date.now(); tests pin it.
export function updateCatProfile(state, id, patch, now = Date.now()) {
  if (!state.cats[id]) return state;
  return { ...state, cats: { ...state.cats, [id]: { ...state.cats[id], profile: { ...state.cats[id].profile, ...patch }, stateModAt: now } } };
}

// Rename any cat by id — a thin wrapper over updateCatProfile for the common single-field case.
export function renameCat(state, id, name, now = Date.now()) {
  return updateCatProfile(state, id, { name }, now);
}

// THE seam every per-cat mutation (profile edits, ration/start, weigh-ins, intake log
// add/edit/remove, tr, expSettings — see AppState.jsx's updateActiveCat) funnels through.
// No-op while Biscuit (DEMO_CAT_ID) is active: her data is regenerated fresh every render
// (see lib/demoCat.js), so any "edit" would just be silently discarded on the next render
// anyway — this makes that explicit instead of writing a `cats[DEMO_CAT_ID]` entry into real
// state. Pure, so the no-op (and the update itself) is directly testable without React.
//
// Deliberately does NOT stamp stateModAt itself: this same seam is used for BOTH current-state
// bundle edits (profile/ration/start/tr/expSettings — which stateModAt covers, see
// lib/mergeData.js) and append-only log/day-status edits (weightLog/intakeLog/intakeDayStatus
// — which it must NOT cover, or an ordinary weigh-in would fake-bump the bundle's LWW clock).
// Callers that touch a bundle field include `stateModAt: Date.now()` in their own returned
// object (see AppState.jsx's setP/makeListView/setTr/setExpSettings); callers that only touch
// a log/day-status field don't.
export function updateActiveCatState(state, fn) {
  if (state.activeCatId === DEMO_CAT_ID) return state;
  return { ...state, cats: { ...state.cats, [state.activeCatId]: fn(state.cats[state.activeCatId]) } };
}
