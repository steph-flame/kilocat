import { describe, it, expect } from "vitest";
import {
  distribute, waterfall, transitionAmount, kcalPerG,
  upsertFood, searchFoods, isCompleteFood, toLibraryEntry, makeLibrarySeed, dedupeFoods, canonicalFoodName,
} from "./foods.js";

const sum = (a) => a.reduce((s, x) => s + x, 0);

describe("distribute", () => {
  it("returns integers that sum exactly to S", () => {
    for (const [vals, S] of [[[1, 1, 1], 100], [[3, 1], 10], [[0, 0, 0], 100], [[7, 2, 1], 55]]) {
      const out = distribute(vals, S);
      expect(out.every(Number.isInteger)).toBe(true);
      expect(sum(out)).toBe(S);
    }
  });
  it("splits evenly when all inputs are zero", () => {
    expect(sum(distribute([0, 0, 0, 0], 100))).toBe(100);
  });
});

describe("waterfall keeps the total at 100", () => {
  const rows = [{ id: "a", pct: 34 }, { id: "b", pct: 33 }, { id: "c", pct: 33 }];
  it("dragging a middle row re-flexes the rows below", () => {
    expect(sum(waterfall(rows, "a", 60).map((f) => f.pct))).toBe(100);
  });
  it("dragging the LAST row re-flexes the rows above", () => {
    expect(sum(waterfall(rows, "c", 80).map((f) => f.pct))).toBe(100);
  });
  it("clamps an over-100 drag and still totals 100", () => {
    expect(sum(waterfall(rows, "a", 999).map((f) => f.pct))).toBe(100);
  });
});

describe("kcalPerG", () => {
  it("dry: kcal/kg / 1000", () => {
    expect(kcalPerG({ mode: "perKg", kcalPerKg: 4000 })).toBe(4);
  });
  it("wet: kcal/can / grams/can", () => {
    expect(kcalPerG({ mode: "perUnit", kcalPerUnit: 70, gramsPerUnit: 79.4 })).toBeCloseTo(70 / 79.4, 6);
  });
});

describe("transitionAmount holds total energy at the target", () => {
  // A day's whole kcal column (old blend + new ration) must equal the target, for any
  // blend fraction — that's the promise the transition table makes.
  const start = [{ pct: 100, mode: "perKg", kcalPerKg: 3941 }];
  const ration = [
    { pct: 17, mode: "perUnit", kcalPerUnit: 70, gramsPerUnit: 79.4 },
    { pct: 83, mode: "perKg", kcalPerKg: 4470 },
  ];
  const target = 300;
  const startSum = 100, rationSum = 100;

  it.each([0, 0.25, 0.5, 0.75, 1])("kcal column sums to target at toNew=%s", (toNew) => {
    const kcals =
      start.map((f) => transitionAmount(f, 1 - toNew, startSum, target, "kcal"))
        .concat(ration.map((f) => transitionAmount(f, toNew, rationSum, target, "kcal")));
    expect(sum(kcals)).toBeCloseTo(target, 6);
  });

  it("gram amounts convert each food's kcal by its own density", () => {
    const g = transitionAmount(ration[1], 1, rationSum, target, "g"); // 83% of 300 kcal of a 4.47 kcal/g food
    expect(g).toBeCloseTo((target * 0.83) / 4.47, 4);
  });
});

describe("food library", () => {
  it("upserts by name case-insensitively, keeping the id and updating macros", () => {
    let lib = [{ id: "x", name: "Fromm Kitten Gold (dry)", mode: "perKg", kcalPerKg: 3941 }];
    lib = upsertFood(lib, { name: "fromm kitten gold (dry)", mode: "perKg", kcalPerKg: 4000 });
    expect(lib).toHaveLength(1);
    expect(lib[0].id).toBe("x");
    expect(lib[0].kcalPerKg).toBe(4000);
  });
  it("appends a genuinely new food", () => {
    const lib = upsertFood([], { name: "New", mode: "perUnit", kcalPerUnit: 70 });
    expect(lib).toHaveLength(1);
    expect(lib[0].id).toBeTruthy();
  });
  it("ignores a nameless entry", () => {
    expect(upsertFood([], { name: "   ", mode: "perKg", kcalPerKg: 100 })).toHaveLength(0);
  });
  it("searches names by substring; empty query returns all", () => {
    const seed = makeLibrarySeed();
    expect(searchFoods(seed, "orijen")).toHaveLength(3);
    expect(searchFoods(seed, "")).toHaveLength(seed.length);
    expect(searchFoods(seed, "zzz")).toHaveLength(0);
  });
  it("built-in names carry no (dry)/(wet) suffix", () => {
    expect(makeLibrarySeed().some((f) => /\((?:dry|wet)\)/i.test(f.name))).toBe(false);
  });
});

describe("dedupeFoods", () => {
  it("merges a food and its (dry)-suffixed twin, keeping the clean name + macros", () => {
    const out = dedupeFoods([
      { id: "a", name: "Fromm Kitten Gold (dry)", mode: "perKg", kcalPerKg: 3941, gramsPerCup: "" },
      { id: "b", name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: "", gramsPerCup: 111 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Fromm Kitten Gold");
    expect(out[0].kcalPerKg).toBe(3941); // filled from the twin
    expect(out[0].gramsPerCup).toBe(111);
  });
  it("keeps genuinely different foods and preserves order", () => {
    const out = dedupeFoods([
      { id: "1", name: "Orijen Original Cat", mode: "perKg", kcalPerKg: 4150 },
      { id: "2", name: "Orijen Fit & Trim", mode: "perKg", kcalPerKg: 3700 },
    ]);
    expect(out.map((f) => f.name)).toEqual(["Orijen Original Cat", "Orijen Fit & Trim"]);
  });
  it("is idempotent", () => {
    const once = dedupeFoods(makeLibrarySeed());
    expect(dedupeFoods(once)).toEqual(once);
  });
});

describe("canonicalFoodName", () => {
  it("snaps a macro-identical name-prefix to the built-in (Instinct generic → Chicken)", () => {
    const f = { name: "Instinct Ultimate Protein", mode: "perKg", kcalPerKg: 4470, gramsPerCup: 110, kcalPerUnit: "", gramsPerUnit: "" };
    expect(canonicalFoodName(f)).toBe("Instinct Ultimate Protein Chicken");
  });
  it("leaves a food alone when macros differ", () => {
    const f = { name: "Instinct Ultimate Protein", mode: "perKg", kcalPerKg: 4000, gramsPerCup: 110 };
    expect(canonicalFoodName(f)).toBe("Instinct Ultimate Protein");
  });
  it("doesn't touch a food that already matches a built-in name", () => {
    expect(canonicalFoodName({ name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941, gramsPerCup: 111 })).toBe("Fromm Kitten Gold");
  });
});

describe("isCompleteFood gates auto-save", () => {
  it("requires a name and an energy value for the mode", () => {
    expect(isCompleteFood({ name: "  ", mode: "perKg", kcalPerKg: 100 })).toBe(false);
    expect(isCompleteFood({ name: "X", mode: "perKg", kcalPerKg: 0 })).toBe(false);
    expect(isCompleteFood({ name: "X", mode: "perUnit", kcalPerUnit: 70 })).toBe(true);
  });
  it("toLibraryEntry drops the ration-only fields (id, pct) and trims the name", () => {
    const e = toLibraryEntry({ id: "z", name: "A ", mode: "perKg", kcalPerKg: 1, gramsPerCup: 2, kcalPerUnit: "", gramsPerUnit: "", pct: 50 });
    expect(e).toEqual({ name: "A", mode: "perKg", kcalPerKg: 1, gramsPerCup: 2, kcalPerUnit: "", gramsPerUnit: "" });
  });
});
