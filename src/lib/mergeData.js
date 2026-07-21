// UNION + timestamped-LWW merge of two v2 snapshots (current ⊕ incoming) → a v2 snapshot.
// This is the reusable merge core behind Import — and, by design, the core the cross-device
// sync feature reuses too. Deterministic given its inputs: the only non-pure bit is the
// optional `now` used for tombstone GC (see mergeV2/pruneTombstones), which defaults to
// Date.now() but can be pinned in tests.
//
// See AppState.jsx's importData for how this gets wired in (merge, then adopt the result
// through the same seams `hydrate` uses, so persistence/derived-state stay correct).
//
// MERGE SEMANTICS
//  - cats: UNION by id. A cat only in incoming is added wholesale. A cat in both is merged
//    field-by-field — see mergeCat below. A cat already in `local` is dropped ONLY if a
//    deletedCats tombstone (from either side) is at least as new as its surviving stateModAt
//    — see mergeCats below.
//  - weightLog / intakeLog (per cat): UNION, deduped by a stable identity (see weightKey/
//    intakeKey below), sorted deterministically, then any entry whose key is covered by a
//    deletedEntries tombstone (either side) is dropped. Idempotent — merging the same data in
//    twice never grows the list, and a deleted entry never resurrects.
//  - intakeDayStatus (per cat): UNION of the two { date: "incomplete" } maps — a day flagged
//    in EITHER stays flagged.
//  - profile / ration / start / tr / expSettings (per cat, when the cat exists in BOTH): this
//    whole bundle moves together as ONE unit, last-writer-wins by the cat's `stateModAt`
//    (epoch ms — see catStore.js/AppState.jsx for where it's stamped). Whichever side has the
//    STRICTLY newer stateModAt wins the entire bundle; a tie (including the common "neither
//    side ever stamped it" case, both 0) keeps local, same as the old unconditional-local
//    rule. LIMITATION (intentional, v1 of sync): the granularity is the whole bundle, not the
//    individual field — if device A edits the profile and device B (independently, before
//    seeing A's edit) edits the ration, whichever device's edit is timestamped later wins
//    BOTH fields; the other device's edit to the field IT changed is silently lost. A future
//    per-field LWW pass would fix this; out of scope for v1.
//  - deletedEntries (per cat) / deletedCats (top-level): tombstone maps, `{ key: deletedAtMs }`.
//    Unioned newest-deletedAt-per-key, then GC'd (see pruneTombstones) to bound growth — a
//    deletion is presumed to have propagated to every device well within the TTL.
//  - library: UNION, deduped by the food library's existing identity — reuses foods.js's
//    dedupeFoods (name, case-insensitive, "(dry)"/"(wet)"-stripped) rather than reinventing
//    one. Doesn't run cleanFood/ensureBuiltins itself (those are AppState-level migration
//    concerns) — callers that need that normalization apply it before/after, same as hydrate
//    already does on load.
//  - fridgeDays / skin / unit / estimator: one shared bundle, LWW by top-level `settingsModAt`
//    — same rule/limitation shape as the per-cat bundle above (whole bundle moves together;
//    a tie keeps local).
//  - litterRobot: kept LOCAL. EXCEPT: if local has no connection (null/undefined — "never
//    connected" and "explicitly disconnected" look the same in this shape) and incoming has
//    one, the incoming connection is adopted — there's nothing local to protect in that case,
//    and it's the one way a Litter-Robot connection could ever reach a new device via this
//    file-based import. Never the reverse: a local connection's token is never replaced by
//    an imported one. Deliberately NOT LWW'd — it's a device-bound token, not shared data.
//  - activeCatId: kept LOCAL.

import { num } from "./util.js";
import { dedupeFoods } from "./foods.js";

/* ---------- tombstones ---------- */

// How long a delete tombstone (cat or log entry) survives before GC — see pruneTombstones.
// A deletion that hasn't reached every device within this window is treated as moot; in
// practice a delete propagates on the next import/sync long before 180 days pass.
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

// Union two tombstone maps ({ key: deletedAtMs }) — newest deletedAt wins per key. Same shape
// (and same "newest wins" idea) for both deletedCats (top-level) and deletedEntries (per-cat).
function unionTombstones(a, b) {
  const out = { ...(a || {}) };
  for (const [k, t] of Object.entries(b || {})) if (t > (out[k] ?? -Infinity)) out[k] = t;
  return out;
}

// Drop entries older than TOMBSTONE_TTL_MS relative to `now`, bounding a tombstone map's growth.
function gcTombstoneMap(map, now) {
  const out = {};
  for (const [k, t] of Object.entries(map || {})) if (now - t < TOMBSTONE_TTL_MS) out[k] = t;
  return out;
}

// Prune every tombstone map in a v2 snapshot (top-level deletedCats + each cat's
// deletedEntries) relative to `now`. Exported so AppState.jsx's plain load path can bound
// growth even on a device that never imports/merges — mergeV2 also runs this on its result.
export function pruneTombstones(snapshot, now = Date.now()) {
  const s = snapshot || {};
  const cats = {};
  for (const [id, cat] of Object.entries(s.cats || {})) {
    cats[id] = cat?.deletedEntries ? { ...cat, deletedEntries: gcTombstoneMap(cat.deletedEntries, now) } : cat;
  }
  return { ...s, cats, deletedCats: gcTombstoneMap(s.deletedCats, now) };
}

/* ---------- per-entry identity (dedupe keys) ---------- */

// Stable identity for a weigh-in: its own `id` if present (every entry the app itself
// creates has one — see AppState.jsx's makeLogView `add`), else a composite of the fields
// that make it a distinct real-world reading. The composite fallback only matters for
// hand-edited or pre-`id` legacy files — validate.js doesn't require an id on a weigh-in.
export const weightKey = (e) => e.id ?? `d:${e.date}|t:${e.ts ?? ""}|k:${num(e.kg)}|m:${e.method ?? ""}|s:${e.source ?? ""}`;

// Same idea for an intake entry. This log's shape never carries a `ts` (Log.jsx's addEntry
// stamps date only), so the composite leans on date + kcal + grams + name — the fields that
// together identify "the same logged meal."
export const intakeKey = (e) => e.id ?? `d:${e.date}|k:${num(e.kcal)}|g:${e.grams ?? ""}|n:${e.name ?? ""}`;

// Union two entry arrays, deduped by `keyFn` — first-seen (local's copy) wins when both
// sides have an entry under the same key; they're supposed to be identical anyway since the
// key IS the entries' identity, but this keeps merge deterministic if a field the key
// ignores (e.g. `id` itself, on two legacy composite-keyed dupes) happens to differ.
function unionBy(localItems, incomingItems, keyFn) {
  const seen = new Map();
  for (const e of localItems) if (!seen.has(keyFn(e))) seen.set(keyFn(e), e);
  for (const e of incomingItems) if (!seen.has(keyFn(e))) seen.set(keyFn(e), e);
  return [...seen.values()];
}

/* ---------- deterministic sort ---------- */

// Sort key: date first (ISO strings sort chronologically as plain strings), then `ts`
// (zero-padded so it compares correctly as a string) when present — entries with no `ts`
// (backfilled/future-dated manual weigh-ins, or any intake entry) sort before timestamped
// ones on the same day — then `id` as a final deterministic tiebreak.
const sortKey = (e) => `${e.date ?? ""}|${Number.isFinite(e.ts) ? String(e.ts).padStart(20, "0") : ""}|${e.id ?? ""}`;
const sortLog = (items) => [...items].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

/* ---------- per-cat merge ---------- */

// Union two "incomplete" day-flag maps: a day flagged in either input stays flagged. (Only
// "incomplete" exists as a value so far — see validate.js — so this is a plain merge, not a
// real conflict resolution; written this way so it stays correct if a second status value is
// ever added and a real conflict becomes possible.)
function mergeIntakeDayStatus(local, incoming) {
  const out = { ...(incoming || {}) };
  for (const [date, status] of Object.entries(local || {})) out[date] = status;
  return out;
}

// Merge one cat present in BOTH snapshots. See file banner for the full rule table: the
// current-state bundle (profile/ration/start/tr/expSettings) moves as one unit, LWW by
// stateModAt (missing/undefined treated as 0 — the oldest possible value, so any real stamped
// edit on either side beats never-stamped legacy data); logs union+dedupe as before, then drop
// anything covered by a (unioned) deletedEntries tombstone.
function mergeCat(local, incoming) {
  const localModAt = local.stateModAt ?? 0;
  const incModAt = incoming.stateModAt ?? 0;
  const newer = incModAt > localModAt ? incoming : local; // tie (incl. both-0/legacy) keeps local
  const deletedEntries = unionTombstones(local.deletedEntries, incoming.deletedEntries);
  const weightLog = unionBy(local.weightLog || [], incoming.weightLog || [], weightKey)
    .filter((e) => !(weightKey(e) in deletedEntries));
  const intakeLog = unionBy(local.intakeLog || [], incoming.intakeLog || [], intakeKey)
    .filter((e) => !(intakeKey(e) in deletedEntries));
  return {
    profile: newer.profile,
    ration: newer.ration,
    start: newer.start,
    tr: newer.tr,
    expSettings: newer.expSettings,
    stateModAt: Math.max(localModAt, incModAt),
    weightLog: sortLog(weightLog),
    intakeLog: sortLog(intakeLog),
    intakeDayStatus: mergeIntakeDayStatus(local.intakeDayStatus, incoming.intakeDayStatus),
    deletedEntries,
  };
}

// Union the `cats` maps by id, then apply the deletedCats tombstones: a cat (whether it came
// from one side wholesale or was just merged above) is dropped if a tombstone's deletedAt is
// >= its surviving stateModAt — i.e. the deletion is at least as new as the cat's last known
// edit. A cat that was RE-CREATED/edited more recently than the tombstone (stateModAt newer
// than deletedAt) survives — a delete doesn't permanently poison an id. `deletedCats` here is
// already the union of both sides' tombstone maps (see mergeV2).
function mergeCats(localCats, incomingCats, deletedCats) {
  const ids = new Set([...Object.keys(localCats || {}), ...Object.keys(incomingCats || {})]);
  const out = {};
  for (const id of ids) {
    const l = localCats?.[id], inc = incomingCats?.[id];
    const cat = l && inc ? mergeCat(l, inc) : (l || inc);
    const tomb = deletedCats[id];
    if (tomb !== undefined && tomb >= (cat.stateModAt ?? 0)) continue; // deleted, not resurrected
    out[id] = cat;
  }
  return out;
}

/* ---------- top-level merge ---------- */

// Merge two v2 snapshots. `local` is the device's current state (persistData's shape — see
// AppState.jsx); `incoming` is the imported file, already normalized to v2 (see lib/migrate.js
// toV2/migrateV1 — callers migrate a v1 file BEFORE calling this). See the file banner for
// the full rule table (LWW bundles by stateModAt/settingsModAt, tombstone-aware cat/entry
// union, food library union, litterRobot/activeCatId kept local). Returns a valid v2 blob
// (assuming both inputs already were) — always has `v: 2`, then runs pruneTombstones (`now`
// defaults to Date.now(), overridable so this stays deterministic in tests).
export function mergeV2(local, incoming, now = Date.now()) {
  const l = local || {};
  const inc = incoming || {};
  const deletedCats = unionTombstones(l.deletedCats, inc.deletedCats);
  const localSettingsAt = l.settingsModAt ?? 0;
  const incSettingsAt = inc.settingsModAt ?? 0;
  // Shared-settings bundle (fridgeDays/skin/unit/estimator) moves together, LWW by
  // settingsModAt — same tie-keeps-local rule as the per-cat bundle above.
  const settings = incSettingsAt > localSettingsAt ? inc : l;
  const merged = {
    v: 2,
    activeCatId: l.activeCatId,
    cats: mergeCats(l.cats, inc.cats, deletedCats),
    library: dedupeFoods([...(l.library || []), ...(inc.library || [])]),
    fridgeDays: settings.fridgeDays,
    skin: settings.skin,
    unit: settings.unit,
    estimator: settings.estimator,
    settingsModAt: Math.max(localSettingsAt, incSettingsAt),
    deletedCats,
    // "Local has none" covers both undefined (never touched this field) and null (no
    // connection / explicitly disconnected) — either way there's nothing local to protect,
    // so an incoming connection may be adopted. A local connection is never replaced.
    litterRobot: l.litterRobot ?? inc.litterRobot ?? null,
  };
  return pruneTombstones(merged, now);
}
