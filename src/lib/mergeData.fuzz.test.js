// Property-based convergence fuzzer for the sync merge layer (mergeV2). Complements the
// deterministic fixtures in mergeData.test.js with randomized multi-replica scenarios, built
// from the REAL pure reducers (catStore.js's addCat/deleteCat/clearCatHistory/
// updateCatProfile) plus a faithful re-implementation of AppState.jsx's log add/remove
// stamping seams (makeLogView.add/remove aren't exported standalone, so they're mirrored here
// exactly — see addLogEntry/removeEntryAt below — driving the same weightKey/intakeKey
// tombstone identity mergeData.js itself uses).
//
// Timestamps are a single globally-monotonic synthetic clock (`tick`, threaded explicitly
// through every reducer's `now` param) rather than Date.now() — every stamped op across every
// replica gets a strictly distinct tick, so LWW is deterministic and "two edits really did
// race" is never conflated with "two edits happened to get the same wall-clock ms". Ties are
// tested separately and explicitly (see the dedicated tie-focused properties below), with
// content that actually differs, so they can't accidentally be vacuously true.
//
// Intentional asymmetries (see mergeData.js's file banner) are NOT asserted as symmetric here:
//  - activeCatId and litterRobot are kept-local by design — excluded from projectConvergent
//    and covered by their own "must NOT be symmetric" properties instead.
//  - a stateModAt/settingsModAt TIE keeps local (not incoming) — the big fuzzer structurally
//    can't produce a content-differing tie (ticks never repeat except at the shared, identical
//    baseline of "never touched"), so tie behavior gets its own dedicated property with
//    hand-picked equal timestamps and differing content.
//
// Ops fuzzed: addCat, rename (profile edit), addWeighIn, addMeal, removeEntry (weight or
// intake), deleteCat, clearCatHistory — the full op list called for in the review brief. Food
// library edits are deliberately NOT in the op vocabulary (out of scope here — see the report).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeV2, weightKey, intakeKey, visibleCats } from "./mergeData.js";
import { addCat, deleteCat, clearCatHistory, updateCatProfile, freshCatState } from "./catStore.js";
import { uid } from "./util.js";

/* ---------- harness: wrap a catStore-shaped replica as a full v2 snapshot ---------- */

const BASE_NOW = 1_700_000_000_000; // fixed epoch, far from any TOMBSTONE_TTL_MS boundary

const wrapV2 = (replica) => ({
  v: 2,
  activeCatId: replica.activeCatId,
  cats: replica.cats,
  library: [],
  fridgeDays: 3,
  skin: "original",
  unit: "kg",
  estimator: "v3",
  litterRobot: null,
  settingsModAt: 0,
  deletedCats: replica.deletedCats || {},
});

// Everything mergeV2 is supposed to make converge, deliberately EXCLUDING the two fields
// that are kept-local by design (activeCatId, litterRobot) — see file banner.
const projectConvergent = (v2) => ({
  cats: v2.cats,
  deletedCats: v2.deletedCats,
  library: v2.library,
  fridgeDays: v2.fridgeDays,
  skin: v2.skin,
  unit: v2.unit,
  estimator: v2.estimator,
  settingsModAt: v2.settingsModAt,
});

// Mirrors AppState.jsx's makeLogView.add, generalized to an arbitrary catId (the real one is
// scoped to the active cat only). Deliberately does NOT stamp stateModAt — see catStore.js's
// updateActiveCatState banner: logs are append-only/unioned, not part of the LWW bundle.
const addLogEntry = (state, catId, field, entry) => {
  const cat = state.cats[catId];
  if (!cat) return state;
  return { ...state, cats: { ...state.cats, [catId]: { ...cat, [field]: [...cat[field], { id: uid(), ...entry }] } } };
};

// Mirrors AppState.jsx's makeLogView.remove, generalized to an arbitrary catId: removes one
// entry and records a deletedEntries tombstone under its mergeData key.
const removeEntryAt = (state, catId, field, pick, now) => {
  const cat = state.cats[catId];
  const arr = cat?.[field] || [];
  if (!arr.length) return state;
  const i = pick % arr.length;
  const removed = arr[i];
  const keyFn = field === "weightLog" ? weightKey : intakeKey;
  const nextCat = {
    ...cat,
    [field]: arr.filter((_, j) => j !== i),
    deletedEntries: { ...(cat.deletedEntries || {}), [keyFn(removed)]: now },
  };
  return { ...state, cats: { ...state.cats, [catId]: nextCat } };
};

// IMPORTANT: freshCatState() mints random ids (via blankFood()) for its blank ration/start
// rows. Every replica must start from the SAME baseline object (structurally cloned, not
// independently re-generated) — otherwise two replicas that never touch a given cat at all
// would still disagree on that cat's ration/start row ids, which isn't a merge bug, it's a
// test harness bug (comparing two "identical" cats that were never actually identical).
const makeBaselineTemplate = () => ({
  activeCatId: "cat-A",
  cats: { "cat-A": freshCatState(), "cat-B": freshCatState() },
  deletedCats: {},
});
const baselineReplica = (() => {
  const template = makeBaselineTemplate();
  return () => structuredClone(template);
})();

function applyOp(state, op, now) {
  switch (op.type) {
    case "rename": return state.cats[op.cat] ? updateCatProfile(state, op.cat, { name: op.name }, now) : state;
    case "addWeighIn": return addLogEntry(state, op.cat, "weightLog", { date: op.date, kg: op.kg, method: "petScale", source: "manual" });
    case "addMeal": return addLogEntry(state, op.cat, "intakeLog", { date: op.date, kcal: op.kcal, grams: null, name: null });
    case "removeEntry": return removeEntryAt(state, op.cat, op.field, op.pick, now);
    case "deleteCat": return state.cats[op.cat] ? deleteCat(state, op.cat, now) : state;
    case "clearHistory": return state.cats[op.cat] ? clearCatHistory(state, op.cat, now) : state;
    case "addCat": return addCat(state);
    default: return state;
  }
}

/* ---------- arbitraries ---------- */

const catArb = fc.constantFrom("cat-A", "cat-B");
const dateArb = fc.constantFrom("2026-01-01", "2026-01-02", "2026-01-03");
const opArb = fc.oneof(
  fc.record({ type: fc.constant("rename"), cat: catArb, name: fc.string({ minLength: 0, maxLength: 8 }) }),
  fc.record({ type: fc.constant("addWeighIn"), cat: catArb, kg: fc.float({ min: 2, max: 10, noNaN: true }), date: dateArb }),
  fc.record({ type: fc.constant("addMeal"), cat: catArb, kcal: fc.integer({ min: 50, max: 400 }), date: dateArb }),
  fc.record({ type: fc.constant("removeEntry"), cat: catArb, field: fc.constantFrom("weightLog", "intakeLog"), pick: fc.nat({ max: 6 }) }),
  fc.record({ type: fc.constant("deleteCat"), cat: catArb }),
  fc.record({ type: fc.constant("clearHistory"), cat: catArb }),
  fc.record({ type: fc.constant("addCat") }),
);

const makeScenarioArb = (replicaCount) => fc.record({
  replicaCount: fc.constant(replicaCount),
  ops: fc.array(fc.record({ replica: fc.nat({ max: replicaCount - 1 }), op: opArb }), { minLength: 0, maxLength: 14 }),
});

// The main gating property below runs at BOTH replicaCount 2 and 3 — 3-way CHAINED merges
// used to be excluded (see the file's former "KNOWN BUG" section, now fixed: mergeData.js is a
// proper join-semilattice — mergeCats never discards a tombstoned cat's data at merge time,
// deletion is a read-time projection instead — see visibleCats/isCatVisible). With that fix, a
// 3-replica chain no longer has an "intermediate, not-yet-final" step where data can be lost,
// so this property is exercised at both replica counts (see runConvergenceProperty below).
const scenarioArb2 = makeScenarioArb(2);
const scenarioArb3 = makeScenarioArb(3);

// Each replica starts from an IDENTICAL baseline (two blank cats) and independently evolves
// per its slice of a single globally-ordered op list — so op N always gets tick N regardless
// of which replica it targets, modeling arbitrary real-world interleaving of edits across
// devices with synchronized-enough clocks that no two edits ever land on the exact same ms
// (that scenario is the dedicated tie property, not this one).
function runScenario({ replicaCount, ops }) {
  const replicas = Array.from({ length: replicaCount }, baselineReplica);
  let tick = 0;
  for (const { replica, op } of ops) {
    const r = replica % replicaCount;
    tick += 1;
    replicas[r] = applyOp(replicas[r], op, BASE_NOW + tick * 1000);
  }
  return replicas;
}

const mergeChain = (snaps, order, now) => order.slice(1).reduce((acc, idx) => mergeV2(acc, snaps[idx], now), snaps[order[0]]);

// Replica i's converged view: itself, folded with every OTHER replica's snapshot, in every
// order (there are only ever ≤2 others since replicaCount ≤ 3) — also directly asserts the
// two orders agree (order-independence of the fold), not just that every replica agrees.
function convergedFor(snaps, i, now) {
  const others = snaps.map((_, idx) => idx).filter((idx) => idx !== i);
  if (others.length <= 1) return mergeChain(snaps, [i, ...others], now);
  const [a, b] = others;
  const forward = mergeChain(snaps, [i, a, b], now);
  const backward = mergeChain(snaps, [i, b, a], now);
  expect(projectConvergent(forward)).toEqual(projectConvergent(backward));
  return forward;
}

/* ---------- the big one: multi-replica convergence over random op sequences ---------- */

// Shared body for the gating property, parameterized by replicaCount so it can run at both 2
// (no chaining possible) and 3 (chained merges — see scenarioArb2/scenarioArb3 above) replicas
// with the exact same, full-strength set of assertions. Runs at HIGH numRuns for both — the
// associativity/data-loss bug this whole file exists to catch only showed up at replicaCount 3
// with chained merges, so that arm carries the real weight of the acceptance oracle.
function runConvergenceProperty(scenarioArb, numRuns) {
  fc.assert(
    fc.property(scenarioArb, (scenario) => {
      const replicas = runScenario(scenario);
      const now = BASE_NOW + (scenario.ops.length + 10) * 1000;
      const snaps = replicas.map(wrapV2);

      // CONVERGENCE: every replica's fully-merged view agrees on the data that should converge.
      // This is now a plain monotonic-union property (no tombstone-driven discarding at merge
      // time — see mergeData.js's file banner), so it holds for any number of chained replicas.
      const converged = snaps.map((_, i) => convergedFor(snaps, i, now));
      for (let i = 1; i < converged.length; i++) {
        expect(projectConvergent(converged[i])).toEqual(projectConvergent(converged[0]));
      }

      // COMMUTATIVITY (data only): mergeV2(a,b) vs mergeV2(b,a), every pair.
      for (let i = 0; i < snaps.length; i++) {
        for (let j = i + 1; j < snaps.length; j++) {
          const ab = mergeV2(snaps[i], snaps[j], now);
          const ba = mergeV2(snaps[j], snaps[i], now);
          expect(projectConvergent(ab)).toEqual(projectConvergent(ba));
        }
      }

      // ASSOCIATIVITY: mergeV2((a⊕b)⊕c) vs mergeV2(a⊕(b⊕c)) — the specific shape of the bug
      // this fuzzer originally caught (a single pairwise merge can't be non-associative; it
      // takes ≥3 replicas grouped two different ways). Only meaningful at replicaCount ≥ 3, but
      // harmless (and still exercised, trivially) at 2.
      if (snaps.length >= 3) {
        const [a, b, c] = snaps;
        const leftFirst = mergeV2(mergeV2(a, b, now), c, now);
        const rightFirst = mergeV2(a, mergeV2(b, c, now), now);
        expect(projectConvergent(leftFirst)).toEqual(projectConvergent(rightFirst));
      }

      // IDEMPOTENCE: merging the same incoming snapshot in again changes nothing further.
      const once = mergeV2(snaps[0], snaps[1], now);
      const twice = mergeV2(once, snaps[1], now);
      expect(projectConvergent(twice)).toEqual(projectConvergent(once));

      const finalView = converged[0];

      // Per-cat: derive the CORRECT outcome directly from the raw replica states (not from
      // mergeV2 itself, which is the thing under test) and check the converged view against it.
      const allCatIds = new Set(replicas.flatMap((r) => Object.keys(r.cats)));
      for (const catId of allCatIds) {
        const withCat = replicas.filter((r) => r.cats[catId]);
        const maxStateModAt = withCat.length ? Math.max(...withCat.map((r) => r.cats[catId].stateModAt ?? 0)) : -Infinity;
        const maxDeleteTick = Math.max(-Infinity, ...replicas.map((r) => r.deletedCats?.[catId] ?? -Infinity));
        const shouldSurvive = maxStateModAt > maxDeleteTick;

        // VISIBILITY (read-time projection, not raw presence — see mergeData.js's file banner):
        // whether the cat currently SHOWS is exactly `shouldSurvive`.
        const survived = !!visibleCats(finalView)[catId];
        expect(survived).toBe(shouldSurvive);

        // RETENTION (join-semilattice, always true regardless of visibility): the fuzzer's
        // `now` never reaches TOMBSTONE_TTL_MS, so mergeV2 must NEVER have physically discarded
        // this cat's raw bundle+logs — only pruneTombstones' GC (untested here) may ever do
        // that, and only once its tombstone itself ages out. This is the core of the fix: a
        // hidden cat's data survives every merge, it just isn't rendered.
        expect(!!finalView.cats[catId]).toBe(true);

        // NO LOST WRITES: every entry any replica still has locally must be present in the
        // final raw (not visibility-projected) log — whether or not the cat itself is
        // currently visible, since hidden data is retained, not discarded.
        for (const field of ["weightLog", "intakeLog"]) {
          const keyFn = field === "weightLog" ? weightKey : intakeKey;
          const survivorKeys = new Set(finalView.cats[catId][field].map(keyFn));
          for (const r of withCat) {
            for (const e of r.cats[catId][field]) expect(survivorKeys.has(keyFn(e))).toBe(true);
          }
        }

        // DELETES STICK: every tombstoned key (from any replica) stays gone.
        const tombstoned = new Set();
        for (const r of replicas) for (const k of Object.keys(r.cats[catId]?.deletedEntries || {})) tombstoned.add(k);
        for (const field of ["weightLog", "intakeLog"]) {
          const keyFn = field === "weightLog" ? weightKey : intakeKey;
          for (const e of finalView.cats[catId][field]) expect(tombstoned.has(keyFn(e))).toBe(false);
        }

        // LWW: the surviving bundle belongs to whichever replica achieved the max stateModAt —
        // true regardless of visibility, since bundle LWW and cat visibility are independent
        // mechanisms now (see mergeData.js's file banner). (Ties only occur at
        // maxStateModAt === 0 — "nobody ever touched the bundle" — where every tied replica's
        // bundle is still the identical, untouched freshCatState default.)
        const winner = withCat.find((r) => (r.cats[catId].stateModAt ?? 0) === maxStateModAt);
        expect(finalView.cats[catId].profile).toEqual(winner.cats[catId].profile);
        expect(finalView.cats[catId].ration).toEqual(winner.cats[catId].ration);
        expect(finalView.cats[catId].tr).toEqual(winner.cats[catId].tr);
        expect(finalView.cats[catId].expSettings).toEqual(winner.cats[catId].expSettings);
      }
    }),
    { numRuns },
  );
}

describe("fuzz: multi-replica convergence over random op sequences", () => {
  it("converges across 2 replicas/merge-orders, is idempotent, commutative on convergent data, loses no live write, keeps deletes stuck, and LWWs correctly", () => {
    runConvergenceProperty(scenarioArb2, 500);
  });

  // The 3-replica arm: this is the one that used to be a `it.fails` canary (see git history —
  // "KNOWN BUG: delete-vs-revive-vs-log-only-edit races across ≥3 replicas are not
  // associative") because chained 3-way merges could lose a third replica's log-only edit
  // depending on merge order. Now a real, non-xfail property at high numRuns — the acceptance
  // oracle for the join-semilattice fix (see mergeData.js's file banner).
  it("converges across 3 CHAINED replicas/merge-orders too — the associativity bug's exact shape — with every invariant above still holding", () => {
    runConvergenceProperty(scenarioArb3, 1000);
  });
});

/* ---------- dedicated properties for the intentional keep-local asymmetries ---------- */

describe("fuzz: keep-local fields are NOT falsely required to be symmetric", () => {
  it("activeCatId is always local's, never incoming's — merge is deliberately non-commutative here", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => {
      const local = wrapV2({ ...baselineReplica(), activeCatId: a });
      const incoming = wrapV2({ ...baselineReplica(), activeCatId: b });
      expect(mergeV2(local, incoming).activeCatId).toBe(a);
    }));
  });

  it("litterRobot: local's non-null connection is never replaced by incoming's — the reverse (adopt when local has none) is the only asymmetric exception", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (t1, t2) => {
      fc.pre(t1 !== t2);
      const conn = (t) => ({ refreshToken: t, robots: [], pets: [], petMap: {}, robotMap: {}, lastSyncTs: null, weightScale: null });
      const local = { ...wrapV2(baselineReplica()), litterRobot: conn(t1) };
      const incoming = { ...wrapV2(baselineReplica()), litterRobot: conn(t2) };
      expect(mergeV2(local, incoming).litterRobot).toEqual(conn(t1));
      expect(mergeV2(incoming, local).litterRobot).toEqual(conn(t2)); // swapping position swaps the winner — proves it's position-, not value-, based
    }));
  });
});

/* ---------- dedicated tie property (content differs, timestamps exactly equal) ---------- */

describe("fuzz: an exact stateModAt TIE keeps local — asymmetric by design, not value-based", () => {
  it("swapping which snapshot is 'local' swaps the winner, even though the timestamps are identical", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 1e9 }), (nameA, nameB, tie) => {
      fc.pre(nameA !== nameB);
      const mk = (name) => wrapV2({
        activeCatId: "cat-A",
        cats: { "cat-A": { ...freshCatState(), profile: { ...freshCatState().profile, name }, stateModAt: tie } },
        deletedCats: {},
      });
      const a = mk(nameA), b = mk(nameB);
      expect(mergeV2(a, b).cats["cat-A"].profile.name).toBe(nameA); // a is local: a wins
      expect(mergeV2(b, a).cats["cat-A"].profile.name).toBe(nameB); // b is local: b wins
    }));
  });
});

/* ---------- dedicated LWW property: the strictly-newer bundle wins regardless of position ---------- */

describe("fuzz: LWW (distinct timestamps) picks the strictly-newer bundle regardless of local/incoming position", () => {
  it("the winner is determined by the timestamp, not by which side is 'local' — LWW itself IS commutative", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 1e9 }),
      (nameA, nameB, t1, t2) => {
        fc.pre(t1 !== t2 && nameA !== nameB);
        const mk = (name, t) => wrapV2({
          activeCatId: "cat-A",
          cats: { "cat-A": { ...freshCatState(), profile: { ...freshCatState().profile, name }, stateModAt: t } },
          deletedCats: {},
        });
        const a = mk(nameA, t1), b = mk(nameB, t2);
        const expected = t1 > t2 ? nameA : nameB;
        expect(mergeV2(a, b).cats["cat-A"].profile.name).toBe(expected);
        expect(mergeV2(b, a).cats["cat-A"].profile.name).toBe(expected);
      },
    ));
  });
});

/* ---------- dedicated recreate/edit-beats-delete property ---------- */

describe("fuzz: recreate/edit beats an older delete tombstone; a tombstone >= the survivor's stateModAt still wins", () => {
  it("survival is exactly `editAt > deleteAt` (strict), for any relative ordering", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: -20, max: 20 }), (deleteAt, delta) => {
      const editAt = deleteAt + delta;
      fc.pre(editAt >= 0);
      const local = wrapV2({ activeCatId: "cat-A", cats: { "cat-A": freshCatState() }, deletedCats: { "cat-B": deleteAt } });
      const incoming = wrapV2({
        activeCatId: "cat-A",
        cats: { "cat-A": freshCatState(), "cat-B": { ...freshCatState(), stateModAt: editAt } },
        deletedCats: {},
      });
      const merged = mergeV2(local, incoming, Math.max(deleteAt, editAt) + 1_000_000); // `now` far from any TTL edge
      // VISIBILITY, not raw presence: mergeCats always retains cat-B's data now (see
      // mergeData.js's file banner) — survival is a read-time question, see visibleCats.
      expect(!!visibleCats(merged)["cat-B"]).toBe(editAt > deleteAt);
      // ...but the retained raw data is there either way (never physically dropped at merge
      // time), which is exactly what makes this no longer order-dependent across ≥3 replicas.
      expect(merged.cats["cat-B"]).toBeDefined();
    }));
  });
});

/* ==========================================================================================
 * FIXED BUG (formerly "KNOWN BUG" — see git history for the original xfail'd repro): mergeV2
 * was NOT associative across ≥3 parties (equivalently: 2 devices that sync more than once with
 * a third device's data landing in between) when a single cat was simultaneously:
 *   (1) deleted on one replica,
 *   (2) revived by a bundle edit (profile/ration/tr/expSettings — anything that bumps
 *       stateModAt) on a second replica, timestamped AFTER the delete — so the cat SHOULD
 *       survive ("recreate/edit beats delete", see mergeData.js's file banner and the
 *       dedicated property above), AND
 *   (3) given a LOG-ONLY edit (a weigh-in/meal add or remove — anything that does NOT bump
 *       stateModAt, by design; see catStore.js's updateActiveCatState banner) on a THIRD
 *       replica that never otherwise touches the bundle.
 *
 * Root cause: mergeCats() used to decide, independently at EACH pairwise merge call, whether a
 * cat's tombstone currently beat the stateModAt visible in just that call's two inputs — and
 * when it did, the losing side's ENTIRE per-cat object (bundle AND logs) was dropped from the
 * output, not merely hidden. A merge of (the deleter, the log-only replica) ALONE can't
 * distinguish "this cat is really gone" from "revival evidence exists on a third replica this
 * merge hasn't seen yet" — dropping it was destructive: once folded together, the log-only
 * replica's weigh-in was gone for good, even though merging the SAME three snapshots in a
 * different order (revival folded in before the deleter) preserved it.
 *
 * THE FIX (see mergeData.js's file banner): mergeCats now unions every cat's data
 * unconditionally — a tombstoned cat's bundle+logs are always retained, never discarded at
 * merge time. "Is this cat currently visible" moved to a pure read-time projection
 * (isCatVisible/visibleCats) applied at every UI read site instead (AppState.jsx's
 * catsSummary, activeCat resolution, catStore.js's switchCat/deleteCat). GC (pruneTombstones)
 * reclaims a hidden cat's orphaned data once its own tombstone ages out past TOMBSTONE_TTL_MS
 * AND it was never revived — see pruneTombstones' own comment.
 */

describe("FIXED: delete-vs-revive-vs-log-only-edit races across ≥3 replicas are now associative", () => {
  it("a weigh-in added on a not-yet-tombstoned replica survives regardless of merge order, AND the cat's visibility agrees across orders too", () => {
    // Exact minimal case that used to reproduce the bug (originally found by fast-check,
    // shrunk from a random run; hand-built here so this regression never depends on a seed):
    //   replica 1: deleteCat("cat-B")                    @ tick 1
    //   replica 0: rename("cat-B", "")                   @ tick 2  (bundle edit, newer than the delete)
    //   replica 2: addWeighIn("cat-B", kg: 2)             @ tick 3  (log-only, stateModAt untouched)
    const replicas = runScenario({
      replicaCount: 3,
      ops: [
        { replica: 1, op: { type: "deleteCat", cat: "cat-B" } },
        { replica: 0, op: { type: "rename", cat: "cat-B", name: "" } },
        { replica: 2, op: { type: "addWeighIn", cat: "cat-B", kg: 2, date: "2026-01-01" } },
      ],
    });
    const now = BASE_NOW + 1_000_000;
    const snaps = replicas.map(wrapV2);
    const deleterAndLogOnlyFirst = mergeChain(snaps, [1, 2, 0], now); // used to lose the weigh-in
    const reviverAndLogOnlyFirst = mergeChain(snaps, [0, 2, 1], now); // used to keep it
    expect(projectConvergent(deleterAndLogOnlyFirst)).toEqual(projectConvergent(reviverAndLogOnlyFirst));

    // Stronger than the bare convergence check above: pin down WHAT converges, not just that
    // both orders agree with each other. The rename (tick 2) is strictly newer than the delete
    // (tick 1), so cat-B must be VISIBLE in both orders...
    expect(!!visibleCats(deleterAndLogOnlyFirst)["cat-B"]).toBe(true);
    expect(!!visibleCats(reviverAndLogOnlyFirst)["cat-B"]).toBe(true);
    // ...and the tick-3 weigh-in must survive in BOTH orders, not just one.
    const hasTheWeighIn = (snap) => snap.cats["cat-B"].weightLog.some((e) => e.kg === 2);
    expect(hasTheWeighIn(deleterAndLogOnlyFirst)).toBe(true);
    expect(hasTheWeighIn(reviverAndLogOnlyFirst)).toBe(true);
  });

  // The broader canary this file used to carry ("multi-replica convergence still breaks
  // somewhere under 3-way chained merges") is gone — per its own former comment, a fix should
  // "convert [the hand-built repro] to a normal `it` (and delete the second, broader canary)".
  // Its job (finding ANY violation under general 3-way chained merges at high numRuns) is now
  // covered, more rigorously, by the "converges across 3 CHAINED replicas" property above,
  // which runs the FULL invariant set (not just bare convergence) at numRuns: 1000.
});
