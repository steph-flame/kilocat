import { describe, it, expect } from "vitest";
import { addCat, deleteCat, clearCatHistory, switchCat, renameCat, updateCatProfile, updateActiveCatState, freshCatState, freshProfile, defaultExpSettings, resolveUnit, resolveEstimator, DEMO_CAT_ID } from "./catStore.js";
import { patchEntry } from "./series.js";
import { weightKey, intakeKey } from "./mergeData.js";

const stateWith = (ids) => ({
  activeCatId: ids[0],
  cats: Object.fromEntries(ids.map((id, i) => [id, {
    profile: { ...freshProfile(), name: `Cat ${i}` },
    ration: [{ id: "r", name: "Food", mode: "perKg", kcalPerKg: 4000, pct: 100 }],
    start: [{ id: "s", name: "Food", mode: "perKg", kcalPerKg: 4000, pct: 100 }],
    weightLog: [{ id: "w", date: "2026-01-01", kg: 4.4 }],
    intakeLog: [{ id: "i", date: "2026-01-01", kcal: 250 }],
    tr: { on: true, days: 5, timelineUnit: "kcal" },
    expSettings: { unit: "lb" },
  }])),
});

describe("freshCatState / freshProfile", () => {
  it("is blank, not a copy of the seed demo cat", () => {
    const p = freshProfile();
    expect(p.name).toBe("");
    expect(p.dob).toBe("");
    expect(p.goal).toBe("maintain");
  });
  it("gives a single 100%-share row for ration and start, and empty logs", () => {
    const c = freshCatState();
    expect(c.ration).toHaveLength(1);
    expect(c.ration[0].pct).toBe(100);
    expect(c.start).toHaveLength(1);
    expect(c.start[0].pct).toBe(100);
    expect(c.weightLog).toEqual([]);
    expect(c.intakeLog).toEqual([]);
    expect(c.intakeDayStatus).toEqual({});
  });
  it("starts at stateModAt 0 (oldest) with no deletedEntries tombstones", () => {
    const c = freshCatState();
    expect(c.stateModAt).toBe(0);
    expect(c.deletedEntries).toEqual({});
  });
});

describe("addCat", () => {
  it("adds a fresh blank cat and makes it active, leaving existing cats untouched", () => {
    const s0 = stateWith(["a"]);
    const s1 = addCat(s0);
    expect(Object.keys(s1.cats)).toHaveLength(2);
    expect(s1.cats.a).toBe(s0.cats.a); // untouched, same reference
    expect(s1.activeCatId).not.toBe("a");
    const newId = s1.activeCatId;
    expect(s1.cats[newId].profile.name).toBe("");
    expect(s1.cats[newId].weightLog).toEqual([]);
  });
  it("passes the top-level deletedCats tombstone map through untouched", () => {
    const s0 = { ...stateWith(["a"]), deletedCats: { "old-cat": 123 } };
    const s1 = addCat(s0);
    expect(s1.deletedCats).toEqual({ "old-cat": 123 });
  });
});

describe("deleteCat", () => {
  it("removes the given cat and keeps the rest", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, "b");
    expect(Object.keys(s1.cats)).toEqual(["a"]);
    expect(s1.activeCatId).toBe("a");
  });
  it("switches active to a remaining cat if the deleted one was active", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, "a");
    expect(Object.keys(s1.cats)).toEqual(["b"]);
    expect(s1.activeCatId).toBe("b");
  });
  it("leaves activeCatId alone when deleting a non-active cat", () => {
    const s0 = { ...stateWith(["a", "b", "c"]), activeCatId: "b" };
    const s1 = deleteCat(s0, "c");
    expect(s1.activeCatId).toBe("b");
    expect(Object.keys(s1.cats).sort()).toEqual(["a", "b"]);
  });
  it("switches active to Biscuit (the demo cat) rather than fabricating a fresh blank cat, when the last one is deleted", () => {
    const s0 = stateWith(["a"]);
    const s1 = deleteCat(s0, "a");
    expect(Object.keys(s1.cats)).toEqual([]);
    expect(s1.activeCatId).toBe(DEMO_CAT_ID);
  });
  it("no-ops gracefully deleting an id that isn't present (falls through the last-cat path only if truly empty)", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, "nope");
    expect(Object.keys(s1.cats).sort()).toEqual(["a", "b"]);
  });

  it("records a deletedCats tombstone (id -> deletedAt) for the deleted cat", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, "b", 12345);
    expect(s1.deletedCats).toEqual({ b: 12345 });
  });
  it("unions the tombstone into any pre-existing deletedCats map, leaving other ids untouched", () => {
    const s0 = { ...stateWith(["a", "b"]), deletedCats: { "already-gone": 111 } };
    const s1 = deleteCat(s0, "b", 999);
    expect(s1.deletedCats).toEqual({ "already-gone": 111, b: 999 });
  });
  it("does NOT tombstone an id that never named a real cat (no-op delete, e.g. a typo'd id)", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, "nope", 999);
    expect(s1.deletedCats).toEqual({});
  });
  it("does NOT tombstone Biscuit (DEMO_CAT_ID) even though targeting her is a no-op", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, DEMO_CAT_ID, 999);
    expect(s1.deletedCats).toEqual({});
  });
  it("still records the tombstone when deleting the last real cat (falls back to Biscuit)", () => {
    const s0 = stateWith(["a"]);
    const s1 = deleteCat(s0, "a", 555);
    expect(s1.activeCatId).toBe(DEMO_CAT_ID);
    expect(s1.deletedCats).toEqual({ a: 555 });
  });
  it("defaults `now` to Date.now() when omitted (app-code convenience)", () => {
    const before = Date.now();
    const s1 = deleteCat(stateWith(["a"]), "a");
    expect(s1.deletedCats.a).toBeGreaterThanOrEqual(before);
    expect(s1.deletedCats.a).toBeLessThanOrEqual(Date.now());
  });
});

describe("clearCatHistory", () => {
  it("wipes only weightLog + intakeLog, leaving profile/ration/start/tr/expSettings untouched", () => {
    const s0 = stateWith(["a"]);
    const s1 = clearCatHistory(s0, "a");
    expect(s1.cats.a.weightLog).toEqual([]);
    expect(s1.cats.a.intakeLog).toEqual([]);
    expect(s1.cats.a.profile).toBe(s0.cats.a.profile);
    expect(s1.cats.a.ration).toBe(s0.cats.a.ration);
    expect(s1.cats.a.start).toBe(s0.cats.a.start);
    expect(s1.cats.a.tr).toBe(s0.cats.a.tr);
    expect(s1.cats.a.expSettings).toBe(s0.cats.a.expSettings);
  });
  it("is a no-op for an id that doesn't exist", () => {
    const s0 = stateWith(["a"]);
    const s1 = clearCatHistory(s0, "nope");
    expect(s1).toEqual(s0);
  });
  it("is a no-op for Biscuit (the demo cat) — she's never a key in cats", () => {
    const s0 = stateWith(["a"]);
    expect(clearCatHistory(s0, DEMO_CAT_ID)).toEqual(s0);
  });

  it("records a deletedEntries tombstone (via mergeData's weightKey/intakeKey) for every cleared weigh-in/meal", () => {
    const s0 = stateWith(["a"]);
    const w = s0.cats.a.weightLog[0], m = s0.cats.a.intakeLog[0];
    const s1 = clearCatHistory(s0, "a", 777);
    expect(s1.cats.a.deletedEntries).toEqual({ [weightKey(w)]: 777, [intakeKey(m)]: 777 });
  });
  it("unions new tombstones into any deletedEntries already on the cat", () => {
    const s0 = stateWith(["a"]);
    s0.cats.a.deletedEntries = { "already-gone": 111 };
    const w = s0.cats.a.weightLog[0], m = s0.cats.a.intakeLog[0];
    const s1 = clearCatHistory(s0, "a", 888);
    expect(s1.cats.a.deletedEntries).toEqual({ "already-gone": 111, [weightKey(w)]: 888, [intakeKey(m)]: 888 });
  });
  it("does NOT stamp stateModAt — history isn't part of the current-state bundle", () => {
    const s0 = stateWith(["a"]);
    const s1 = clearCatHistory(s0, "a", 777);
    expect(s1.cats.a.stateModAt).toBe(s0.cats.a.stateModAt);
  });
});

describe("mutation seams no-op while Biscuit (the demo cat) is targeted", () => {
  it("updateCatProfile is a no-op for DEMO_CAT_ID", () => {
    const s0 = stateWith(["a"]);
    expect(updateCatProfile(s0, DEMO_CAT_ID, { name: "Hacked" })).toEqual(s0);
  });
  it("deleteCat leaves real cats untouched when targeting DEMO_CAT_ID", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, DEMO_CAT_ID);
    expect(Object.keys(s1.cats).sort()).toEqual(["a", "b"]);
    expect(s1.activeCatId).toBe(s0.activeCatId);
  });
  it("renameCat is a no-op for DEMO_CAT_ID", () => {
    const s0 = stateWith(["a"]);
    expect(renameCat(s0, DEMO_CAT_ID, "Hacked")).toBe(s0);
  });
  it("updateActiveCatState is a no-op when Biscuit is active", () => {
    const s0 = { activeCatId: DEMO_CAT_ID, cats: stateWith(["a"]).cats };
    const fn = (cat) => ({ ...cat, intakeLog: [] }); // would blow away "a"'s log if it ran
    expect(updateActiveCatState(s0, fn)).toBe(s0);
  });
});

// The seam every intake-log edit (Log.jsx's inline quantity edit) goes through: the active
// cat's per-cat state, patched via a caller-supplied fn — same seam profile/ration/tr/etc use.
describe("updateActiveCatState", () => {
  it("applies fn to the active cat only, leaving other cats' references untouched", () => {
    const s0 = stateWith(["a", "b"]);
    const fn = (cat) => ({ ...cat, intakeLog: patchEntry(cat.intakeLog, "i", { kcal: 300 }) });
    const s1 = updateActiveCatState(s0, fn);
    expect(s1.cats.a.intakeLog).toEqual([{ id: "i", date: "2026-01-01", kcal: 300 }]);
    expect(s1.cats.b).toBe(s0.cats.b); // untouched — same object reference
  });
});

describe("switchCat", () => {
  it("switches to an existing cat", () => {
    const s0 = stateWith(["a", "b"]);
    expect(switchCat(s0, "b").activeCatId).toBe("b");
  });
  it("no-ops for an id that doesn't exist", () => {
    const s0 = stateWith(["a", "b"]);
    expect(switchCat(s0, "nope")).toBe(s0);
  });
  it("switches to Biscuit (the demo cat) even though it's never a key in cats", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = switchCat(s0, DEMO_CAT_ID);
    expect(s1.activeCatId).toBe(DEMO_CAT_ID);
    expect(s1.cats).toBe(s0.cats); // untouched — demo is never stored
  });
});

describe("defaultExpSettings", () => {
  it("no longer carries a unit — that's a shared top-level field now, not per-cat", () => {
    expect(defaultExpSettings().unit).toBeUndefined();
  });
  it("no longer carries an algo — the estimator is a shared top-level field now, not per-cat", () => {
    expect(defaultExpSettings().algo).toBeUndefined();
  });
});

describe("resolveEstimator", () => {
  it("uses the shared top-level estimator when it's valid", () => {
    expect(resolveEstimator("v1", "v3")).toBe("v1");
    expect(resolveEstimator("v2", "v1")).toBe("v2");
    expect(resolveEstimator("v3", "v1")).toBe("v3");
  });
  it("falls back to the legacy per-cat expSettings.algo value when the top-level field is absent/invalid", () => {
    expect(resolveEstimator(undefined, "v1")).toBe("v1");
    expect(resolveEstimator("bogus", "v2")).toBe("v2");
  });
  it("is undefined when neither is a valid estimator — caller keeps the v3 default", () => {
    expect(resolveEstimator(undefined, undefined)).toBeUndefined();
    expect(resolveEstimator(null, "bogus")).toBeUndefined();
  });
});

describe("renameCat", () => {
  it("renames the given cat, leaving other cats untouched (same reference)", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = renameCat(s0, "a", "Mochi");
    expect(s1.cats.a.profile.name).toBe("Mochi");
    expect(s1.cats.b).toBe(s0.cats.b);
  });
  it("renames a cat that isn't the active one", () => {
    const s0 = { ...stateWith(["a", "b"]), activeCatId: "a" };
    const s1 = renameCat(s0, "b", "Biscuit");
    expect(s1.cats.b.profile.name).toBe("Biscuit");
    expect(s1.activeCatId).toBe("a");
  });
  it("leaves the rest of the profile untouched", () => {
    const s0 = stateWith(["a"]);
    const s1 = renameCat(s0, "a", "Mochi");
    expect(s1.cats.a.profile.goal).toBe(s0.cats.a.profile.goal);
    expect(s1.cats.a.profile.dob).toBe(s0.cats.a.profile.dob);
  });
  it("is a no-op for an id that doesn't exist", () => {
    const s0 = stateWith(["a"]);
    const s1 = renameCat(s0, "nope", "Mochi");
    expect(s1).toBe(s0);
  });
  it("stamps stateModAt too — it's a thin wrapper over updateCatProfile", () => {
    const s1 = renameCat(stateWith(["a"]), "a", "Mochi", 4242);
    expect(s1.cats.a.stateModAt).toBe(4242);
  });
});

describe("updateCatProfile", () => {
  it("patches dob, leaving other cats untouched (same reference)", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = updateCatProfile(s0, "a", { dob: "2020-01-01" });
    expect(s1.cats.a.profile.dob).toBe("2020-01-01");
    expect(s1.cats.b).toBe(s0.cats.b);
  });
  it("patches neutered", () => {
    const s0 = stateWith(["a"]);
    const s1 = updateCatProfile(s0, "a", { neutered: true });
    expect(s1.cats.a.profile.neutered).toBe(true);
  });
  it("patches multiple fields at once, leaving the rest of the profile untouched", () => {
    const s0 = stateWith(["a"]);
    const s1 = updateCatProfile(s0, "a", { dob: "2019-05-05", neutered: true });
    expect(s1.cats.a.profile.dob).toBe("2019-05-05");
    expect(s1.cats.a.profile.neutered).toBe(true);
    expect(s1.cats.a.profile.name).toBe(s0.cats.a.profile.name);
    expect(s1.cats.a.profile.goal).toBe(s0.cats.a.profile.goal);
  });
  it("is a no-op for an id that doesn't exist", () => {
    const s0 = stateWith(["a"]);
    const s1 = updateCatProfile(s0, "nope", { dob: "2020-01-01" });
    expect(s1).toBe(s0);
  });
  it("stamps that cat's stateModAt — profile is part of the current-state bundle mergeV2 LWWs on", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = updateCatProfile(s0, "a", { dob: "2020-01-01" }, 4242);
    expect(s1.cats.a.stateModAt).toBe(4242);
    expect(s1.cats.b.stateModAt).toBeUndefined(); // untouched cat unaffected
  });
  it("defaults `now` to Date.now() when omitted", () => {
    const before = Date.now();
    const s1 = updateCatProfile(stateWith(["a"]), "a", { name: "X" });
    expect(s1.cats.a.stateModAt).toBeGreaterThanOrEqual(before);
    expect(s1.cats.a.stateModAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("resolveUnit", () => {
  it("uses the shared top-level unit when it's valid", () => {
    expect(resolveUnit("lb", "kg")).toBe("lb");
    expect(resolveUnit("kg", "lb")).toBe("kg");
  });
  it("falls back to the legacy per-cat value when the top-level field is absent/invalid", () => {
    expect(resolveUnit(undefined, "lb")).toBe("lb");
    expect(resolveUnit("bogus", "lb")).toBe("lb");
  });
  it("is undefined when neither is a valid unit — caller keeps the kg default", () => {
    expect(resolveUnit(undefined, undefined)).toBeUndefined();
    expect(resolveUnit(null, "bogus")).toBeUndefined();
  });
});
