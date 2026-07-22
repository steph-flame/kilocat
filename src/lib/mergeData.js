// UNION + timestamped-LWW merge of two v2 snapshots (current ⊕ incoming) → a v2 snapshot.
// This is the reusable merge core behind Import — and, by design, the core the cross-device
// sync feature reuses too. Deterministic given its inputs: the only non-pure bit is the
// optional `now` used for tombstone GC (see mergeV2/pruneTombstones), which defaults to
// Date.now() but can be pinned in tests.
//
// See AppState.jsx's importData for how this gets wired in (merge, then adopt the result
// through the same seams `hydrate` uses, so persistence/derived-state stay correct).
//
// JOIN-SEMILATTICE DESIGN (post data-loss-bug fix): mergeV2 is a monotonic UNION of every
// input — it NEVER discards cat/log/tombstone data at merge time, which is what makes it
// truly associative & commutative (any two merge orders/groupings of the same set of
// snapshots converge on the identical accumulated state). "Deletion" is instead a READ-TIME
// PROJECTION over that accumulated state: see visibleCats/isCatVisible below. This fixes a
// real, reproducible data-loss bug (see mergeData.fuzz.test.js's git history / this file's
// old KNOWN BUG section) where a tombstoned cat's bundle+logs were physically dropped at
// merge time, which could lose a third replica's log-only edit depending on merge order.
//
// MERGE SEMANTICS
//  - cats: UNION by id, ALWAYS — a cat only in incoming is added wholesale, a cat in both is
//    merged field-by-field (see mergeCat below), and a cat already in `local` is NEVER dropped
//    here even when a deletedCats tombstone dominates it. The tombstoned cat's bundle+logs
//    keep accumulating normally (so a later merge that reveals newer revival evidence, or a
//    third replica's log-only edit, is never working from data that's already gone) — whether
//    it's currently VISIBLE is a separate, pure read-time question: see visibleCats/
//    isCatVisible. Every UI read site (AppState.jsx's catsSummary, activeCat resolution,
//    switchCat, etc.) projects through that before rendering/counting/switching, so a
//    tombstoned cat never surfaces despite still being present in storage/exports.
//  - weightLog / intakeLog (per cat): UNION, deduped by a stable identity (see weightKey/
//    intakeKey below), sorted deterministically, then any entry whose key is covered by a
//    deletedEntries tombstone (either side) is dropped. This one IS safe to do at merge time
//    (unlike cat-level deletion): an entry tombstone is permanent — there's no "revive a single
//    log entry" concept — so once a key is tombstoned it stays tombstoned regardless of merge
//    order, and dropping it from the array can never lose a DIFFERENT entry's data. Idempotent
//    — merging the same data in twice never grows the list, and a deleted entry never
//    resurrects.
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
//    deletion is presumed to have propagated to every device well within the TTL. GC now also
//    reclaims the orphaned cat bundle+logs a deletedCats tombstone was hiding, once that
//    tombstone itself ages out AND the cat wasn't revived (see pruneTombstones) — data and its
//    tombstone age out together, so storage doesn't grow unbounded from retained-hidden cats.
//  - library: UNION, deduped by the food library's existing identity (name, case-insensitive,
//    "(dry)"/"(wet)"-stripped — the same identity foods.js's dedupeFoods uses), but via
//    mergeLibrary below rather than dedupeFoods directly: dedupeFoods keeps whichever
//    same-identity entry it sees FIRST (only filling the other's blank fields), which made a
//    3-way merge's chain order decide the winner on a genuine macro conflict — order-dependent,
//    breaking associativity. mergeLibrary instead combines conflicting entries with a
//    deterministic, order-independent content tiebreak per field (see combineFoodEntry) so any
//    grouping/order of merges converges on the same library. Doesn't run cleanFood/
//    ensureBuiltins itself (those are AppState-level migration concerns) — callers that need
//    that normalization apply it before/after, same as hydrate already does on load.
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
import { stripKind, MACRO_KEYS } from "./foods.js";

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
//
// A deletedCats tombstone that ages out here (removed by gcTombstoneMap below) is presumed to
// have propagated to every device long ago — but mergeCats no longer physically drops a
// tombstoned cat's bundle+logs at merge time (see the file banner), it's retained in `cats`
// and only hidden via the read-time isCatVisible/visibleCats projection below. If we removed
// the aged-out tombstone and left that retained data sitting in `cats` with nothing left to
// hide it, it would silently un-hide itself the instant GC ran. So: when a cat's deletedCats
// tombstone expires here, its orphaned bundle+logs are reclaimed in the SAME pass — data and
// its tombstone age out together — UNLESS the cat was actually revived (a bundle edit newer
// than the now-expiring tombstone; see isCatVisible), in which case it's already legitimately
// visible and simply keeps its data with no tombstone left to reference. Deterministic and
// order-independent: driven only by absolute age (`now` vs. the stored deletedAt/stateModAt
// values), never by merge history.
export function pruneTombstones(snapshot, now = Date.now()) {
  const s = snapshot || {};
  const prevDeletedCats = s.deletedCats || {};
  const deletedCats = gcTombstoneMap(prevDeletedCats, now);
  const cats = {};
  for (const [id, cat] of Object.entries(s.cats || {})) {
    const prevTomb = prevDeletedCats[id];
    const tombJustExpired = prevTomb !== undefined && deletedCats[id] === undefined;
    if (tombJustExpired && !isCatVisible(cat, prevTomb)) continue; // orphaned hidden data — GC'd with its tombstone
    cats[id] = cat?.deletedEntries ? { ...cat, deletedEntries: gcTombstoneMap(cat.deletedEntries, now) } : cat;
  }
  return { ...s, cats, deletedCats };
}

/* ---------- read-time cat visibility (the projection half of the join-semilattice) ---------- */

// A cat is hidden iff a deletedCats tombstone DOMINATES it: `deletedAt` is at least as new as
// the cat's own stateModAt (mirrors the old merge-time drop rule in mergeCats, now applied at
// READ time instead — see the file banner's "recreate/edit beats delete" note). `deletedAt`
// undefined means "never tombstoned" (or the tombstone already aged out via pruneTombstones,
// which reclaims the data too when the cat wasn't revived) — always visible in that case. A
// bundle edit strictly newer than the tombstone (stateModAt > deletedAt) un-hides the cat —
// deletion doesn't permanently poison an id.
export function isCatVisible(cat, deletedAt) {
  return deletedAt === undefined || deletedAt < (cat?.stateModAt ?? 0);
}

// Read-time projection of which cats in a v2-shaped state ({ cats, deletedCats }) are
// currently visible. mergeCats/mergeV2 never drop a tombstoned cat's data at merge time (see
// the file banner) — EVERY site that lists/counts/looks up cats for a user-facing purpose
// must project through this (or isCatVisible directly) instead of reading `cats` raw, or a
// deleted-but-not-yet-GC'd cat could render/count/become active. See AppState.jsx's
// catsSummary, hydrate's activeCatId resolution, and catStore.js's switchCat/deleteCat.
export function visibleCats(state) {
  const out = {};
  for (const [id, cat] of Object.entries(state?.cats || {})) {
    if (isCatVisible(cat, state?.deletedCats?.[id])) out[id] = cat;
  }
  return out;
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

// Normalize a cat present on only ONE side of a merge to the exact same shape/defaults
// mergeCat produces for a cat present on both — sorted logs (filtered by its own
// deletedEntries), defaulted stateModAt/intakeDayStatus/deletedEntries. Without this, a cat
// added "wholesale" (see mergeCats) would keep its logs in raw insertion order while the SAME
// cat, once merged a second time against any other snapshot (even an empty one), would come
// out through mergeCat's sortLog — two different byte-shapes for the identical data, breaking
// idempotence (merging the same data in twice must never change anything further). This isn't
// hypothetical: the fuzzer's IDEMPOTENCE property caught it once tombstoned cats stopped being
// discarded early (see the file banner) and started actually reaching this path.
function normalizeCat(cat) {
  const deletedEntries = cat.deletedEntries || {};
  const weightLog = sortLog((cat.weightLog || []).filter((e) => !(weightKey(e) in deletedEntries)));
  const intakeLog = sortLog((cat.intakeLog || []).filter((e) => !(intakeKey(e) in deletedEntries)));
  return {
    profile: cat.profile,
    ration: cat.ration,
    start: cat.start,
    tr: cat.tr,
    expSettings: cat.expSettings,
    stateModAt: cat.stateModAt ?? 0,
    weightLog,
    intakeLog,
    intakeDayStatus: cat.intakeDayStatus || {},
    deletedEntries,
  };
}

// Union the `cats` maps by id — ALWAYS, regardless of any deletedCats tombstone. A cat only
// on one side is added wholesale (normalized to the same shape mergeCat would produce — see
// normalizeCat); a cat on both is merged field-by-field (mergeCat above). NO tombstone check
// here anymore (see file banner) — whether a cat is currently visible is a pure read-time
// question (isCatVisible/visibleCats), decoupled from this union so a tombstoned cat's data
// never has to be reconstructed from a merge order that happened to preserve it.
function mergeCats(localCats, incomingCats) {
  const ids = new Set([...Object.keys(localCats || {}), ...Object.keys(incomingCats || {})]);
  const out = {};
  for (const id of ids) {
    const l = localCats?.[id], inc = incomingCats?.[id];
    out[id] = l && inc ? mergeCat(l, inc) : normalizeCat(l || inc);
  }
  return out;
}

/* ---------- food library merge (order-independent) ---------- */

// Combine one field from two same-identity food entries. `isBlank` decides what counts as
// "nothing here yet" (so the other side's value can fill it in for free, safe regardless of
// merge order); once BOTH sides have a real, differing value, there's a genuine conflict with
// no "correct" answer from data alone — broken by a deterministic content tiebreak (the
// lexicographically-greater string form) instead of "whichever happened to be seen first",
// which is what made the old dedupeFoods-based merge order-dependent. This combine is
// commutative AND associative (it's exactly `max` over a total order, with "blank" as the
// bottom element) — a genuine join, so folding any subset of replicas in any order/grouping
// converges on the same result.
function combineField(a, b, isBlank) {
  if (isBlank(b)) return a;
  if (isBlank(a)) return b;
  if (a === b) return a;
  return String(a) > String(b) ? a : b;
}
const isBlankNum = (v) => !num(v);
const isBlankStr = (v) => !String(v ?? "").trim();

// Combine two same-identity food entries (see mergeLibrary). id/name/mode use the string-blank
// rule; the four macro fields use the numeric-blank rule (matching dedupeFoods' own "!num(v)"
// notion of blank) — same combineField join either way, so every field (including id) resolves
// the same deterministic way regardless of merge order.
function combineFoodEntry(a, b) {
  const id = combineField(a.id, b.id, isBlankStr);
  const name = combineField(stripKind(a.name), stripKind(b.name), isBlankStr);
  const mode = combineField(a.mode, b.mode, isBlankStr);
  const out = { id, name, mode };
  for (const k of MACRO_KEYS) out[k] = combineField(a[k], b[k], isBlankNum);
  return out;
}

const libKeyOf = (name) => String(name || "").trim().toLowerCase();

// Merge two food-library arrays, deduped by the same identity foods.js's dedupeFoods uses
// (name, case-insensitive, "(dry)"/"(wet)"-stripped), but order-independently: a genuine
// macro/name/mode conflict between two same-identity entries is broken by combineFoodEntry's
// deterministic tiebreak rather than "whichever array came first" — see the file banner for
// why that mattered (it broke 3-way merge associativity). Folding is itself a reduce over
// combineFoodEntry (associative+commutative), so the result is identical regardless of how
// many replicas' worth of library data got folded in, or in what order/grouping.
export function mergeLibrary(localList, incomingList) {
  const order = [];
  const byKey = new Map();
  for (const f of [...(localList || []), ...(incomingList || [])]) {
    const key = f?.name != null ? libKeyOf(stripKind(f.name)) : "";
    if (!key) { order.push(f); continue; } // no identity to dedupe by — pass through untouched
    if (byKey.has(key)) {
      const idx = byKey.get(key);
      order[idx] = combineFoodEntry(order[idx], f);
    } else {
      byKey.set(key, order.length);
      order.push({ ...f, name: stripKind(f.name) });
    }
  }
  return order;
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
    cats: mergeCats(l.cats, inc.cats),
    library: mergeLibrary(l.library || [], inc.library || []),
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
