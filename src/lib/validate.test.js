import { describe, it, expect } from "vitest";
import { validateImport } from "./validate.js";

const validExport = () => ({
  profile: { name: "Mithril", dob: "2025-09-13", weightKg: 4.38, goal: "gentle", factors: {} },
  ration: [{ id: "a", name: "Food A", mode: "perKg", kcalPerKg: 4000, pct: 100 }],
  start: [],
  library: [{ id: "b", name: "Food B", mode: "perUnit", kcalPerUnit: 60, gramsPerUnit: 79 }],
  weightLog: [{ id: "c", date: "2026-01-01", kg: 4.4, method: "petScale", source: "manual" }],
  intakeLog: [{ id: "d", date: "2026-01-01", kcal: 250, grams: 60, name: "Food A" }],
  tr: { on: false, days: 7, timelineUnit: "g" },
  fridgeDays: 3,
  expSettings: { unit: "kg" },
});

describe("validateImport accepts a well-formed export", () => {
  it("accepts a full export", () => {
    expect(validateImport(validExport())).toBe(true);
  });
  it("accepts a partial blob (every field optional)", () => {
    expect(validateImport({ profile: { name: "X" } })).toBe(true);
    expect(validateImport({})).toBe(true);
  });
});

describe("validateImport rejects malformed shapes", () => {
  it("rejects non-objects at the top level", () => {
    expect(validateImport(null)).toBe(false);
    expect(validateImport(undefined)).toBe(false);
    expect(validateImport("not json")).toBe(false);
    expect(validateImport([1, 2, 3])).toBe(false);
    expect(validateImport(42)).toBe(false);
  });
  it("rejects a profile that isn't an object", () => {
    expect(validateImport({ ...validExport(), profile: "Mithril" })).toBe(false);
    expect(validateImport({ ...validExport(), profile: [] })).toBe(false);
  });
  it("rejects list fields that aren't arrays", () => {
    expect(validateImport({ ...validExport(), ration: { name: "Food A" } })).toBe(false);
    expect(validateImport({ ...validExport(), weightLog: "oops" })).toBe(false);
  });
  it("rejects food entries missing name/mode", () => {
    expect(validateImport({ ...validExport(), ration: [{ pct: 100 }] })).toBe(false);
    expect(validateImport({ ...validExport(), library: [{ name: "Food A" }] })).toBe(false); // no mode
  });
  it("rejects log entries missing their primitive fields", () => {
    expect(validateImport({ ...validExport(), weightLog: [{ date: "2026-01-01", kg: "4.4" }] })).toBe(false); // kg not a number
    expect(validateImport({ ...validExport(), intakeLog: [{ kcal: 250 }] })).toBe(false); // no date
  });
  it("tolerates a weigh-in's optional `ts` (epoch ms) — absent on older entries and backfilled ones", () => {
    expect(validateImport({ ...validExport(), weightLog: [{ date: "2026-01-01", kg: 4.4 }] })).toBe(true); // no ts at all
    expect(validateImport({ ...validExport(), weightLog: [{ date: "2026-01-01", kg: 4.4, ts: null }] })).toBe(true);
    expect(validateImport({ ...validExport(), weightLog: [{ date: "2026-01-01", kg: 4.4, ts: 1735689600000 }] })).toBe(true);
  });
  it("rejects a non-numeric `ts` on a weigh-in", () => {
    expect(validateImport({ ...validExport(), weightLog: [{ date: "2026-01-01", kg: 4.4, ts: "not-a-number" }] })).toBe(false);
  });
});

const validV2Export = () => ({
  v: 2,
  activeCatId: "cat-1",
  cats: {
    "cat-1": {
      profile: { name: "Mithril", dob: "2025-09-13", weightKg: 4.38, goal: "gentle", factors: {} },
      ration: [{ id: "a", name: "Food A", mode: "perKg", kcalPerKg: 4000, pct: 100 }],
      start: [],
      weightLog: [{ id: "c", date: "2026-01-01", kg: 4.4, method: "petScale", source: "manual" }],
      intakeLog: [{ id: "d", date: "2026-01-01", kcal: 250, grams: 60, name: "Food A" }],
      tr: { on: false, days: 7, timelineUnit: "g" },
      expSettings: { unit: "kg" },
    },
    "cat-2": { profile: { name: "Second Cat" } },
  },
  library: [{ id: "b", name: "Food B", mode: "perUnit", kcalPerUnit: 60, gramsPerUnit: 79 }],
  fridgeDays: 3,
});

describe("validateImport accepts a well-formed v2 (multi-cat) export", () => {
  it("accepts a full v2 export with multiple cats", () => {
    expect(validateImport(validV2Export())).toBe(true);
  });
  it("accepts a v2 export with a single, mostly-empty cat", () => {
    expect(validateImport({ v: 2, cats: { x: {} } })).toBe(true);
  });
  it("accepts a v2 export missing the optional activeCatId/library/fridgeDays", () => {
    const { activeCatId, library, fridgeDays, ...rest } = validV2Export();
    expect(validateImport(rest)).toBe(true);
  });
});

describe("validateImport rejects malformed v2 shapes", () => {
  it("rejects a v2 blob with no cats field, or cats not an object", () => {
    expect(validateImport({ v: 2 })).toBe(false);
    expect(validateImport({ v: 2, cats: [] })).toBe(false);
    expect(validateImport({ v: 2, cats: "nope" })).toBe(false);
  });
  it("rejects a v2 blob with an empty cats map", () => {
    expect(validateImport({ v: 2, cats: {} })).toBe(false);
  });
  it("rejects a v2 blob with a malformed cat inside cats", () => {
    expect(validateImport({ ...validV2Export(), cats: { "cat-1": { ration: [{ pct: 100 }] } } })).toBe(false);
    expect(validateImport({ ...validV2Export(), cats: { "cat-1": { weightLog: "oops" } } })).toBe(false);
  });
  it("rejects a non-string activeCatId", () => {
    expect(validateImport({ ...validV2Export(), activeCatId: 42 })).toBe(false);
  });
  it("rejects malformed shared fields (library/fridgeDays) same as v1", () => {
    expect(validateImport({ ...validV2Export(), library: { name: "Food A" } })).toBe(false);
    expect(validateImport({ ...validV2Export(), fridgeDays: "3" })).toBe(false);
  });
});

describe("validateImport tolerates/checks the litterRobot connection field", () => {
  it("accepts a blob with no litterRobot field at all (older export)", () => {
    expect(validateImport(validV2Export())).toBe(true);
  });
  it("accepts an explicit null (disconnected)", () => {
    expect(validateImport({ ...validV2Export(), litterRobot: null })).toBe(true);
  });
  it("accepts a well-formed connection", () => {
    const lr = { refreshToken: "rt-1", serial: "LR4-123", catId: "cat-1", lastSyncTs: 1234567890 };
    expect(validateImport({ ...validV2Export(), litterRobot: lr })).toBe(true);
  });
  it("accepts a well-formed connection missing the optional catId/lastSyncTs", () => {
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: "rt-1", serial: "LR4-123" } })).toBe(true);
  });
  it("rejects a malformed connection", () => {
    expect(validateImport({ ...validV2Export(), litterRobot: { serial: "LR4-123" } })).toBe(false); // no refreshToken
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: "rt-1" } })).toBe(false); // no serial, no robots
    expect(validateImport({ ...validV2Export(), litterRobot: "nope" })).toBe(false);
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: 1, serial: "LR4-123" } })).toBe(false);
  });

  it("accepts the new all-robots + per-pet-attribution shape", () => {
    const lr = {
      refreshToken: "rt-1",
      lastSyncTs: 1700000000000,
      weightScale: "lb100",
      robots: [{ serial: "LR4-123", model: "LR4", name: "Living Room" }, { serial: "LR5-1", model: "LR5" }],
      pets: [{ petId: "PET-1", name: "Mithril" }],
      petMap: { "PET-1": "cat-1", "PET-2": null },
      robotMap: { "LR4-123": "cat-1" },
    };
    expect(validateImport({ ...validV2Export(), litterRobot: lr })).toBe(true);
  });

  it("accepts the new shape missing every optional field (just refreshToken + robots)", () => {
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: "rt-1", robots: [] } })).toBe(true);
  });

  it("rejects a new-shape connection with a malformed robot entry", () => {
    const bad = { refreshToken: "rt-1", robots: [{ model: "LR4" }] }; // no serial
    expect(validateImport({ ...validV2Export(), litterRobot: bad })).toBe(false);
  });

  it("rejects a new-shape connection with a bad model, weightScale, or map value", () => {
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: "rt-1", robots: [{ serial: "s", model: "LR9" }] } })).toBe(false);
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: "rt-1", robots: [], weightScale: 5 } })).toBe(false);
    expect(validateImport({ ...validV2Export(), litterRobot: { refreshToken: "rt-1", robots: [], petMap: { "PET-1": 5 } } })).toBe(false);
  });
});

describe("validateImport tolerates/checks the edit-propagation-sync fields (stateModAt/deletedEntries/settingsModAt/deletedCats)", () => {
  it("accepts a blob with none of these fields at all (an export from before sync)", () => {
    expect(validateImport(validExport())).toBe(true);
    expect(validateImport(validV2Export())).toBe(true);
  });
  it("accepts a well-formed stateModAt/deletedEntries on a per-cat entry", () => {
    const cats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], stateModAt: 1700000000000, deletedEntries: { w1: 1700000000000 } } };
    expect(validateImport({ ...validV2Export(), cats })).toBe(true);
  });
  it("rejects a non-numeric stateModAt", () => {
    const cats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], stateModAt: "not-a-number" } };
    expect(validateImport({ ...validV2Export(), cats })).toBe(false);
  });
  it("rejects a deletedEntries map whose values aren't numbers", () => {
    const cats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], deletedEntries: { w1: "not-a-number" } } };
    expect(validateImport({ ...validV2Export(), cats })).toBe(false);
  });
  it("rejects a deletedEntries that isn't an object", () => {
    const cats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], deletedEntries: ["w1"] } };
    expect(validateImport({ ...validV2Export(), cats })).toBe(false);
  });
  it("accepts an empty deletedEntries map", () => {
    const cats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], deletedEntries: {} } };
    expect(validateImport({ ...validV2Export(), cats })).toBe(true);
  });
  it("accepts a well-formed top-level settingsModAt/deletedCats", () => {
    expect(validateImport({ ...validV2Export(), settingsModAt: 1700000000000, deletedCats: { "cat-2": 1700000000000 } })).toBe(true);
  });
  it("rejects a non-numeric settingsModAt", () => {
    expect(validateImport({ ...validV2Export(), settingsModAt: "not-a-number" })).toBe(false);
  });
  it("rejects a deletedCats map whose values aren't numbers, or that isn't an object", () => {
    expect(validateImport({ ...validV2Export(), deletedCats: { "cat-2": "not-a-number" } })).toBe(false);
    expect(validateImport({ ...validV2Export(), deletedCats: ["cat-2"] })).toBe(false);
  });
  it("checks stateModAt/deletedEntries on a v1 blob's implicit cat too, and settingsModAt/deletedCats at v1's top level", () => {
    expect(validateImport({ ...validExport(), stateModAt: 1700000000000, deletedEntries: { w1: 1700000000000 } })).toBe(true);
    expect(validateImport({ ...validExport(), stateModAt: "nope" })).toBe(false);
    expect(validateImport({ ...validExport(), settingsModAt: 1700000000000, deletedCats: {} })).toBe(true);
    expect(validateImport({ ...validExport(), deletedCats: { x: "nope" } })).toBe(false);
  });
});

describe("validateImport tolerates/checks intakeDayStatus (per-day incomplete flags)", () => {
  it("accepts a blob with no intakeDayStatus field at all (an export from before this feature)", () => {
    expect(validateImport(validExport())).toBe(true);
    expect(validateImport(validV2Export())).toBe(true);
  });
  it("accepts a well-formed intakeDayStatus map", () => {
    expect(validateImport({ ...validExport(), intakeDayStatus: { "2026-01-02": "incomplete" } })).toBe(true);
  });
  it("accepts an empty intakeDayStatus map", () => {
    expect(validateImport({ ...validExport(), intakeDayStatus: {} })).toBe(true);
  });
  it("rejects intakeDayStatus that isn't an object, or whose values aren't the recognized status", () => {
    expect(validateImport({ ...validExport(), intakeDayStatus: "nope" })).toBe(false);
    expect(validateImport({ ...validExport(), intakeDayStatus: ["incomplete"] })).toBe(false);
    expect(validateImport({ ...validExport(), intakeDayStatus: { "2026-01-02": "complete" } })).toBe(false);
    expect(validateImport({ ...validExport(), intakeDayStatus: { "2026-01-02": true } })).toBe(false);
  });
  it("checks it inside a v2 cat entry too", () => {
    const cats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], intakeDayStatus: { "2026-01-02": "incomplete" } } };
    expect(validateImport({ ...validV2Export(), cats })).toBe(true);
    const badCats = { ...validV2Export().cats, "cat-1": { ...validV2Export().cats["cat-1"], intakeDayStatus: { "2026-01-02": "bogus" } } };
    expect(validateImport({ ...validV2Export(), cats: badCats })).toBe(false);
  });
});
