import { describe, it, expect } from "vitest";
import { addCat, deleteCat, clearCatHistory, switchCat, freshCatState, freshProfile, defaultExpSettings, nextCatId, resolveUnit } from "./catStore.js";

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
  it("replaces the last cat with a fresh blank one rather than leaving zero cats", () => {
    const s0 = stateWith(["a"]);
    const s1 = deleteCat(s0, "a");
    const ids = Object.keys(s1.cats);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe("a");
    expect(s1.activeCatId).toBe(ids[0]);
    expect(s1.cats[ids[0]].profile.name).toBe("");
    expect(s1.cats[ids[0]].weightLog).toEqual([]);
  });
  it("no-ops gracefully deleting an id that isn't present (falls through the last-cat path only if truly empty)", () => {
    const s0 = stateWith(["a", "b"]);
    const s1 = deleteCat(s0, "nope");
    expect(Object.keys(s1.cats).sort()).toEqual(["a", "b"]);
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
});

describe("defaultExpSettings", () => {
  it("no longer carries a unit — that's a shared top-level field now, not per-cat", () => {
    expect(defaultExpSettings().unit).toBeUndefined();
  });
});

describe("nextCatId", () => {
  const summary = (ids) => ids.map((id) => ({ id }));
  it("cycles to the next cat in order", () => {
    expect(nextCatId(summary(["a", "b", "c"]), "a")).toBe("b");
    expect(nextCatId(summary(["a", "b", "c"]), "b")).toBe("c");
  });
  it("wraps from the last cat back to the first", () => {
    expect(nextCatId(summary(["a", "b", "c"]), "c")).toBe("a");
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
