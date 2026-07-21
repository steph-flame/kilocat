import { describe, it, expect } from "vitest";
import { migrateV1, toV2 } from "./migrate.js";

const v1Blob = () => ({
  profile: { name: "Mithril", dob: "2025-09-13", weightKg: 4.38, goal: "gentle", factors: {} },
  ration: [{ id: "a", name: "Food A", mode: "perKg", kcalPerKg: 4000, pct: 100 }],
  start: [{ id: "b", name: "Food B", mode: "perKg", kcalPerKg: 3900, pct: 100 }],
  library: [{ id: "c", name: "Food C", mode: "perUnit", kcalPerUnit: 60, gramsPerUnit: 79 }],
  weightLog: [{ id: "d", date: "2026-01-01", kg: 4.4, method: "petScale", source: "manual" }],
  intakeLog: [{ id: "e", date: "2026-01-01", kcal: 250, grams: 60, name: "Food A" }],
  intakeDayStatus: { "2026-01-01": "incomplete" },
  tr: { on: true, days: 10, timelineUnit: "kcal" },
  fridgeDays: 5,
  expSettings: { unit: "lb", algo: "v2" },
  stateModAt: 1700000000000,
  deletedEntries: { w1: 1699999999999 },
  settingsModAt: 1700000000001,
  deletedCats: { "old-cat": 1699999999998 },
});

describe("migrateV1", () => {
  it("wraps a v1 blob as one cat under a v2 shape, preserving every field", () => {
    const src = v1Blob();
    const out = migrateV1(src);
    expect(out.v).toBe(2);
    expect(typeof out.activeCatId).toBe("string");
    const ids = Object.keys(out.cats);
    expect(ids).toEqual([out.activeCatId]);
    const cat = out.cats[out.activeCatId];
    expect(cat.profile).toEqual(src.profile);
    expect(cat.ration).toEqual(src.ration);
    expect(cat.start).toEqual(src.start);
    expect(cat.weightLog).toEqual(src.weightLog);
    expect(cat.intakeLog).toEqual(src.intakeLog);
    expect(cat.intakeDayStatus).toEqual(src.intakeDayStatus);
    expect(cat.tr).toEqual(src.tr);
    expect(cat.expSettings).toEqual(src.expSettings);
    // library and fridgeDays stay shared, outside the per-cat bucket
    expect(out.library).toEqual(src.library);
    expect(out.fridgeDays).toBe(src.fridgeDays);
    expect(cat.library).toBeUndefined();
    expect(cat.fridgeDays).toBeUndefined();
    // edit-propagation-sync fields: per-cat ones pass through onto the cat, top-level ones
    // stay top-level, same shared-vs-per-cat split as library/fridgeDays above (a v1 file
    // carrying these is a hand-rolled/hypothetical case — see the CAT_FIELDS comment — but
    // migrateV1 must not drop them if present).
    expect(cat.stateModAt).toBe(src.stateModAt);
    expect(cat.deletedEntries).toEqual(src.deletedEntries);
    expect(out.settingsModAt).toBe(src.settingsModAt);
    expect(out.deletedCats).toEqual(src.deletedCats);
  });

  it("gives every migrated cat a distinct id", () => {
    const a = migrateV1(v1Blob());
    const b = migrateV1(v1Blob());
    expect(a.activeCatId).not.toBe(b.activeCatId);
  });

  it("doesn't fabricate fields that weren't present", () => {
    const out = migrateV1({ profile: { name: "X" } });
    const cat = out.cats[out.activeCatId];
    expect(cat).toEqual({ profile: { name: "X" } });
    expect(out.library).toBeUndefined();
    expect(out.fridgeDays).toBeUndefined();
  });

  it("handles a fully empty blob without throwing", () => {
    const out = migrateV1({});
    expect(out.v).toBe(2);
    expect(out.cats[out.activeCatId]).toEqual({});
  });

  it("handles null/non-object input without throwing", () => {
    expect(() => migrateV1(null)).not.toThrow();
    expect(() => migrateV1(undefined)).not.toThrow();
    const out = migrateV1(null);
    expect(out.cats[out.activeCatId]).toEqual({});
  });
});

describe("toV2", () => {
  it("migrates a v1 blob", () => {
    const out = toV2(v1Blob());
    expect(out.v).toBe(2);
    expect(Object.keys(out.cats)).toHaveLength(1);
  });

  it("is idempotent on an already-v2 blob — passes it through unchanged", () => {
    const v2 = { v: 2, activeCatId: "x", cats: { x: { profile: { name: "Y" } } }, library: [], fridgeDays: 3 };
    expect(toV2(v2)).toBe(v2); // same reference — a true no-op, not just deep-equal
    expect(toV2(toV2(v2))).toBe(v2);
  });
});
