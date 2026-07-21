// Non-destructive UNION merge of two v2 snapshots (current ⊕ incoming) → a v2 snapshot.
// This is the reusable merge core behind Import — and, by design, the core a future
// cross-device sync feature would reuse too. Pure: no I/O, no React, no Date.now() (a
// caller-supplied "local wins" snapshot in, a merged snapshot out — fully deterministic).
//
// See AppState.jsx's importData for how this gets wired in (merge, then adopt the result
// through the same seams `hydrate` uses, so persistence/derived-state stay correct).
//
// MERGE SEMANTICS
//  - cats: UNION by id. A cat only in incoming is added wholesale. A cat in both is merged
//    field-by-field — see mergeCat below. A cat already in `local` is NEVER dropped.
//  - weightLog / intakeLog (per cat): UNION, deduped by a stable identity (see weightKey/
//    intakeKey below), then sorted deterministically. Idempotent — merging the same data in
//    twice never grows the list.
//  - intakeDayStatus (per cat): UNION of the two { date: "incomplete" } maps — a day flagged
//    in EITHER stays flagged.
//  - profile / ration / start / tr / expSettings (per cat, when the cat exists in BOTH): kept
//    LOCAL. Importing must never silently change your current profile/ration/settings for a
//    cat you already have. (A future timestamped-LWW pass — comparing per-field edit times —
//    is the right way to let an import ALSO propagate profile/setting edits; that's out of
//    scope here, so for now local always wins outright for these fields.)
//  - library: UNION, deduped by the food library's existing identity — reuses foods.js's
//    dedupeFoods (name, case-insensitive, "(dry)"/"(wet)"-stripped) rather than reinventing
//    one. Doesn't run cleanFood/ensureBuiltins itself (those are AppState-level migration
//    concerns) — callers that need that normalization apply it before/after, same as hydrate
//    already does on load.
//  - fridgeDays / skin / unit / estimator: kept LOCAL, unconditionally.
//  - litterRobot: kept LOCAL. EXCEPT: if local has no connection (null/undefined — "never
//    connected" and "explicitly disconnected" look the same in this shape) and incoming has
//    one, the incoming connection is adopted — there's nothing local to protect in that case,
//    and it's the one way a Litter-Robot connection could ever reach a new device via this
//    file-based import. Never the reverse: a local connection's token is never replaced by
//    an imported one.
//  - activeCatId: kept LOCAL.

import { num } from "./util.js";
import { dedupeFoods } from "./foods.js";

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

// Merge one cat present in BOTH snapshots. See file banner for the full rule table.
function mergeCat(local, incoming) {
  return {
    profile: local.profile,
    ration: local.ration,
    start: local.start,
    tr: local.tr,
    expSettings: local.expSettings,
    weightLog: sortLog(unionBy(local.weightLog || [], incoming.weightLog || [], weightKey)),
    intakeLog: sortLog(unionBy(local.intakeLog || [], incoming.intakeLog || [], intakeKey)),
    intakeDayStatus: mergeIntakeDayStatus(local.intakeDayStatus, incoming.intakeDayStatus),
  };
}

// Union the `cats` maps by id. A cat on only one side is added/kept wholesale (whatever
// fields it has — the caller's sanitize/hydrate pass fills in any missing ones, exactly as it
// already does for a freshly-adopted import today). A cat on both sides is merged per
// mergeCat above. A cat already in `local` is never dropped.
function mergeCats(localCats, incomingCats) {
  const ids = new Set([...Object.keys(localCats || {}), ...Object.keys(incomingCats || {})]);
  const out = {};
  for (const id of ids) {
    const l = localCats?.[id], inc = incomingCats?.[id];
    out[id] = l && inc ? mergeCat(l, inc) : (l || inc);
  }
  return out;
}

/* ---------- top-level merge ---------- */

// Merge two v2 snapshots. `local` is the device's current state (persistData's shape — see
// AppState.jsx); `incoming` is the imported file, already normalized to v2 (see lib/migrate.js
// toV2/migrateV1 — callers migrate a v1 file BEFORE calling this). Local always wins ties on
// every field EXCEPT the append-only per-cat logs/day-status and the food library, which
// union; see the file banner for the full table. Returns a valid v2 blob (assuming both
// inputs already were) — always has `v: 2`.
export function mergeV2(local, incoming) {
  const l = local || {};
  const inc = incoming || {};
  return {
    v: 2,
    activeCatId: l.activeCatId,
    cats: mergeCats(l.cats, inc.cats),
    library: dedupeFoods([...(l.library || []), ...(inc.library || [])]),
    fridgeDays: l.fridgeDays,
    skin: l.skin,
    unit: l.unit,
    estimator: l.estimator,
    // "Local has none" covers both undefined (never touched this field) and null (no
    // connection / explicitly disconnected) — either way there's nothing local to protect,
    // so an incoming connection may be adopted. A local connection is never replaced.
    litterRobot: l.litterRobot ?? inc.litterRobot ?? null,
  };
}
