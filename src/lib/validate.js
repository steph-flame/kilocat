// Shape-check an imported data blob before it's applied to state. Not a full schema —
// just enough to catch "this isn't our JSON" and reject up front, so a malformed file
// can't half-apply (some fields adopted, others left stale). Pure.
//
// Accepts two export shapes: v1 (a legacy flat single-cat blob — no `v` field) and v2
// (`{ v: 2, cats: {...}, ... }`, multi-cat). AppState migrates an accepted v1 blob on import
// (see lib/migrate.js); this module only judges whether the shape is well-formed.

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const arrOf = (v, pred) => Array.isArray(v) && v.every(pred);

// A ration/start/library row: name + mode are the load-bearing primitives. The macro
// fields vary by mode and are often blank, so they're not pinned down further here.
const isFoodEntry = (f) => isPlainObject(f) && typeof f.name === "string" && typeof f.mode === "string";
// `ts` (epoch ms the weigh-in actually happened) is optional — absent on any entry logged
// before this field existed, and on a deliberately-backfilled past-day entry (see Log.jsx),
// which has no real time-of-day behind it.
const isWeightEntry = (e) =>
  isPlainObject(e) && typeof e.date === "string" && typeof e.kg === "number"
  && (e.ts === undefined || e.ts === null || typeof e.ts === "number");
const isIntakeEntry = (e) => isPlainObject(e) && typeof e.date === "string" && typeof e.kcal === "number";

// Per-day "incomplete" flags: { "YYYY-MM-DD": "incomplete" }. Only that one status exists so
// far — absent for a day (or the whole field absent, on any export older than this feature)
// means "trust the logged entries as-is".
const isIntakeDayStatus = (m) => isPlainObject(m) && Object.values(m).every((v) => v === "incomplete");

// A tombstone map: { key: deletedAtMs }, epoch-ms values — used for both deletedCats
// (top-level) and each cat's deletedEntries. See lib/mergeData.js for the merge/GC rules.
const isTombstoneMap = (m) => isPlainObject(m) && Object.values(m).every((v) => typeof v === "number");

// Fields that live on one cat: profile, ration, start, weightLog, intakeLog, tr, expSettings,
// stateModAt, deletedEntries. Shared by both the top-level v1 shape and each per-cat entry
// inside a v2 blob's `cats` map. stateModAt/deletedEntries are new (edit-propagation sync) —
// both optional and tolerated when absent (an older export simply has neither; lib/mergeData.js
// treats a missing stateModAt as 0, the oldest possible value).
function validateCatShape(d) {
  if (!isPlainObject(d)) return false;
  if (d.profile !== undefined && !isPlainObject(d.profile)) return false;
  if (d.ration !== undefined && !arrOf(d.ration, isFoodEntry)) return false;
  if (d.start !== undefined && !arrOf(d.start, isFoodEntry)) return false;
  if (d.weightLog !== undefined && !arrOf(d.weightLog, isWeightEntry)) return false;
  if (d.intakeLog !== undefined && !arrOf(d.intakeLog, isIntakeEntry)) return false;
  if (d.intakeDayStatus !== undefined && !isIntakeDayStatus(d.intakeDayStatus)) return false;
  if (d.tr !== undefined && !isPlainObject(d.tr)) return false;
  if (d.expSettings !== undefined && !isPlainObject(d.expSettings)) return false;
  if (d.stateModAt !== undefined && typeof d.stateModAt !== "number") return false;
  if (d.deletedEntries !== undefined && !isTombstoneMap(d.deletedEntries)) return false;
  return true;
}

// The Litter-Robot connection: shared, top-level, like skin/unit — tolerated when absent
// (an older export simply has no connection) and only loosely shape-checked here (this
// module deliberately isn't a full schema — see the file banner).
//
// Two accepted shapes, both normalized to the current one by lib/litterRobot.js's
// migrateConnection() before AppState ever touches them — this module only judges whether
// EITHER is well-formed, it doesn't do the normalizing itself:
//   - old (one-robot-one-cat): { refreshToken, serial, model?, catId?, lastSyncTs?, weightScale? }
//   - new (all-robots + per-pet attribution): { refreshToken, robots[], pets?, petMap?,
//     robotMap?, lastSyncTs?, weightScale? }
//
// `model` ("LR4"/"LR5") and `weightScale` (LR5 only — which petWeight unit interpretation won,
// see lib/litterRobot.js) are both optional on the old shape — an export from before LR5
// support simply lacks them, which validates fine.
const isCatIdOrNull = (v) => v === null || typeof v === "string";

function isOldLRConnection(v) {
  if (typeof v.refreshToken !== "string") return false;
  if (typeof v.serial !== "string") return false;
  if (v.catId !== undefined && typeof v.catId !== "string") return false;
  if (v.lastSyncTs !== undefined && v.lastSyncTs !== null && typeof v.lastSyncTs !== "number") return false;
  if (v.model !== undefined && v.model !== "LR4" && v.model !== "LR5") return false;
  if (v.weightScale !== undefined && v.weightScale !== null && typeof v.weightScale !== "string") return false;
  return true;
}

const isRobotEntry = (r) =>
  isPlainObject(r) && typeof r.serial === "string"
  && (r.model === undefined || r.model === "LR4" || r.model === "LR5")
  && (r.name === undefined || r.name === null || typeof r.name === "string");
const isPetEntry = (p) => isPlainObject(p) && typeof p.petId === "string" && (p.name === undefined || typeof p.name === "string");
const isIdMap = (m) => isPlainObject(m) && Object.values(m).every(isCatIdOrNull);

function isNewLRConnection(v) {
  if (typeof v.refreshToken !== "string") return false;
  if (!arrOf(v.robots, isRobotEntry)) return false;
  if (v.pets !== undefined && !arrOf(v.pets, isPetEntry)) return false;
  if (v.petMap !== undefined && !isIdMap(v.petMap)) return false;
  if (v.robotMap !== undefined && !isIdMap(v.robotMap)) return false;
  if (v.lastSyncTs !== undefined && v.lastSyncTs !== null && typeof v.lastSyncTs !== "number") return false;
  if (v.weightScale !== undefined && v.weightScale !== null && typeof v.weightScale !== "string") return false;
  return true;
}

function isLRConnection(v) {
  if (v === null) return true; // explicitly disconnected
  if (!isPlainObject(v)) return false;
  return isNewLRConnection(v) || isOldLRConnection(v);
}

// Fields shared across every cat, common to both v1 (top-level) and v2 (top-level too).
// settingsModAt/deletedCats are new (edit-propagation sync) — same tolerate-when-absent
// treatment as stateModAt/deletedEntries above.
function validateSharedShape(d) {
  if (d.library !== undefined && !arrOf(d.library, isFoodEntry)) return false;
  if (d.fridgeDays !== undefined && typeof d.fridgeDays !== "number") return false;
  if (d.litterRobot !== undefined && !isLRConnection(d.litterRobot)) return false;
  if (d.settingsModAt !== undefined && typeof d.settingsModAt !== "number") return false;
  if (d.deletedCats !== undefined && !isTombstoneMap(d.deletedCats)) return false;
  return true;
}

// v1: a flat blob — one cat's fields at the top level, alongside the shared ones.
function validateV1(d) {
  return validateCatShape(d) && validateSharedShape(d);
}

// v2: { v: 2, activeCatId?, cats: { [id]: <cat shape> }, library?, fridgeDays? }. At least
// one cat is required — an empty `cats` map isn't a valid export.
function validateV2(d) {
  if (!isPlainObject(d.cats)) return false;
  const ids = Object.keys(d.cats);
  if (ids.length === 0) return false;
  if (!ids.every((id) => validateCatShape(d.cats[id]))) return false;
  if (d.activeCatId !== undefined && typeof d.activeCatId !== "string") return false;
  return validateSharedShape(d);
}

export function validateImport(d) {
  if (!isPlainObject(d)) return false;
  return d.v === 2 ? validateV2(d) : validateV1(d);
}
