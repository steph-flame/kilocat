import { describe, it, expect } from "vitest";
import { foodType } from "./foods.js";
import { foodSummary, trailingWindow, itemsInRange, macroBreakdown, rebalanceRemaining } from "./foodStats.js";

describe("foodType (wet vs dry)", () => {
  it("classifies by packaging shape when no moisture is known", () => {
    expect(foodType({ mode: "perUnit" })).toBe("wet"); // cans/pouches
    expect(foodType({ mode: "perKg" })).toBe("dry"); // kibble
  });
  it("lets an explicit moisture % override the shape heuristic", () => {
    expect(foodType({ mode: "perKg", moisture: 78 })).toBe("wet"); // e.g. a raw/freeze-dried food priced per-kg
    expect(foodType({ mode: "perUnit", moisture: 8 })).toBe("dry"); // e.g. a dry topper in a tub
  });
  it("ignores a zero/blank moisture and falls back to shape", () => {
    expect(foodType({ mode: "perUnit", moisture: 0 })).toBe("wet");
    expect(foodType({ mode: "perKg", moisture: "" })).toBe("dry");
  });
});

describe("trailingWindow / itemsInRange", () => {
  it("spans nDays ending at endDate, inclusive, across a month boundary", () => {
    expect(trailingWindow("2026-07-24", 7)).toEqual({ start: "2026-07-18", end: "2026-07-24" });
    expect(trailingWindow("2026-08-02", 7)).toEqual({ start: "2026-07-27", end: "2026-08-02" });
    expect(trailingWindow("2026-07-24", 1)).toEqual({ start: "2026-07-24", end: "2026-07-24" });
  });
  it("filters items to the inclusive date range", () => {
    const items = ["2026-07-17", "2026-07-18", "2026-07-24", "2026-07-25"].map((date) => ({ date }));
    expect(itemsInRange(items, "2026-07-18", "2026-07-24").map((e) => e.date)).toEqual(["2026-07-18", "2026-07-24"]);
  });
});

describe("foodSummary", () => {
  const library = [
    { name: "Instinct Ultimate Protein Chicken", mode: "perKg" }, // dry
    { name: "Fromm Kitten Gold", mode: "perKg" }, // dry
    { name: "Tiki Cat After Dark Chicken — 2.8 oz can", mode: "perUnit" }, // wet
  ];

  it("splits kcal and grams by wet/dry and reports per-food shares", () => {
    const items = [
      { date: "d", name: "Instinct Ultimate Protein Chicken", kcal: 90, grams: 20 }, // dry
      { date: "d", name: "Fromm Kitten Gold", kcal: 60, grams: 15 }, // dry
      { date: "d", name: "Tiki Cat After Dark Chicken — 2.8 oz can", kcal: 50, grams: 65 }, // wet
    ];
    const s = foodSummary(items, library, 1);
    expect(s.totals).toEqual({ kcal: 200, grams: 100 });
    // dry = 150/200 kcal, wet = 50/200
    expect(s.dryPctKcal).toBe(75);
    expect(s.wetPctKcal).toBe(25);
    // by grams: dry = 35/100, wet = 65/100
    expect(s.dryPctGrams).toBe(35);
    expect(s.wetPctGrams).toBe(65);
    // per-food, sorted by kcal desc
    expect(s.byFood.map((f) => [f.name, f.kcalPct, f.gramsPct])).toEqual([
      ["Instinct Ultimate Protein Chicken", 45, 20],
      ["Fromm Kitten Gold", 30, 15],
      ["Tiki Cat After Dark Chicken — 2.8 oz can", 25, 65],
    ]);
    expect(s.byFood.every((f) => f.type === (f.name.includes("Tiki") ? "wet" : "dry"))).toBe(true);
  });

  it("buckets a name absent from the library as 'unknown' (percentages still sum over it)", () => {
    const items = [
      { date: "d", name: "Instinct Ultimate Protein Chicken", kcal: 80, grams: 18 },
      { date: "d", name: "Some Deleted Food", kcal: 20, grams: 10 },
    ];
    const s = foodSummary(items, library, 1);
    expect(s.byType.unknown).toEqual({ kcal: 20, grams: 10 });
    expect(s.dryPctKcal).toBe(80);
    expect(s.wetPctKcal).toBe(0);
    const unknownRow = s.byFood.find((f) => f.name === "Some Deleted Food");
    expect(unknownRow.type).toBe("unknown");
    expect(unknownRow.kcalPct).toBe(20);
  });

  it("sums repeated entries of the same food and skips the explicit 0/0 'nothing eaten' marker", () => {
    const items = [
      { date: "d", name: "Fromm Kitten Gold", kcal: 40, grams: 10 },
      { date: "d", name: "Fromm Kitten Gold", kcal: 60, grams: 15 },
      { date: "d", name: "", kcal: 0, grams: 0 }, // fasted-day marker — ignored
    ];
    const s = foodSummary(items, library, 1);
    expect(s.byFood).toHaveLength(1);
    expect(s.byFood[0]).toMatchObject({ name: "Fromm Kitten Gold", kcal: 100, grams: 25, kcalPct: 100 });
  });

  it("averages totals over the window length for a weekly view", () => {
    const items = [
      { date: "2026-07-20", name: "Fromm Kitten Gold", kcal: 210, grams: 50 },
      { date: "2026-07-21", name: "Fromm Kitten Gold", kcal: 140, grams: 35 },
    ];
    const s = foodSummary(items, library, 7);
    expect(s.totals.kcal).toBe(350);
    expect(s.perDay.kcal).toBe(50); // 350 / 7
    expect(s.nDays).toBe(7);
  });

  it("reports empty for no real intake", () => {
    expect(foodSummary([], library, 1).isEmpty).toBe(true);
    expect(foodSummary([{ date: "d", name: "x", kcal: 0, grams: 0 }], library, 1).isEmpty).toBe(true);
  });
});

describe("macroBreakdown", () => {
  const library = [
    { name: "Kibble", mode: "perKg", protein: 40, fat: 20, fiber: 3, moisture: 8, ash: 8 }, // carb 21
    { name: "Wet", mode: "perUnit", protein: 11, fat: 5, fiber: 1, moisture: 78, ash: 2 }, // carb 3
    { name: "NoMacros", mode: "perKg" }, // no GA -> unanalyzable
  ];

  it("weights each entry's grams by its food's GA and splits energy via Atwater", () => {
    const items = [
      { date: "d", name: "Kibble", kcal: 200, grams: 50 },
      { date: "d", name: "Wet", kcal: 90, grams: 100 },
    ];
    const m = macroBreakdown(items, library, 1);
    expect(m.hasData).toBe(true);
    // grams: protein 20+11=31, fat 10+5=15, carb 10.5+3=13.5, moisture 4+78=82
    expect(m.grams).toEqual({ protein: 31, fat: 15, carb: 13.5, moisture: 82 });
    // kcal: P 108.5, F 127.5, C 47.25 -> total 283.25
    expect(m.caloric.protein).toBe(38.3);
    expect(m.caloric.fat).toBe(45);
    expect(m.caloric.carb).toBe(16.7);
    expect(m.moisturePctByWeight).toBe(54.7); // 82/150
    expect(m.coverageKcalPct).toBe(100);
  });

  it("reports coverage below 100% when some logged energy can't be analyzed", () => {
    const items = [
      { date: "d", name: "Kibble", kcal: 200, grams: 50 }, // analyzable
      { date: "d", name: "NoMacros", kcal: 60, grams: 20 }, // in library but no GA
      { date: "d", name: "Kibble", kcal: 40, grams: null }, // no grams -> not analyzable
    ];
    const m = macroBreakdown(items, library, 1);
    // accounted stored kcal = 200; total = 300 -> 66.7%
    expect(m.coverageKcalPct).toBe(66.7);
    expect(m.hasData).toBe(true);
  });

  it("has no data when nothing analyzable is present", () => {
    const m = macroBreakdown([{ date: "d", name: "NoMacros", kcal: 60, grams: 20 }], library, 1);
    expect(m.hasData).toBe(false);
    expect(m.caloric).toEqual({ protein: 0, fat: 0, carb: 0 });
  });

  it("averages macro grams over the window length", () => {
    const items = [{ date: "d", name: "Kibble", kcal: 200, grams: 70 }];
    const m = macroBreakdown(items, library, 7);
    expect(m.grams.protein).toBe(28); // 70 * 0.40
    expect(m.perDayGrams.protein).toBe(4); // 28 / 7
  });
});

describe("rebalanceRemaining — flex foods flex to hit target; fixed/supplements protected", () => {
  // Plan: 100 (flex) + 100 (flex) + 20 (protected supplement) = 220 target.
  const items = [
    { plannedK: 100, fedK: 0, protected: false },
    { plannedK: 100, fedK: 0, protected: false },
    { plannedK: 20, fedK: 0, protected: true },
  ];
  it("nothing fed yet → everyone's naive remainder, summing to target", () => {
    const out = rebalanceRemaining(items, 220, 0);
    expect(out).toEqual([100, 100, 20]);
  });
  it("over-feeding the supplement shrinks the flex foods so the day still hits target", () => {
    // fed 30 of the 20-planned supplement (a bonus). budget = 220 − 30 = 190; protected keeps 0
    // remaining (already over); flex share 190 → 95 each.
    const fed = [{ plannedK: 100, fedK: 0, protected: false }, { plannedK: 100, fedK: 0, protected: false }, { plannedK: 20, fedK: 30, protected: true }];
    const out = rebalanceRemaining(fed, 220, 30);
    expect(out[2]).toBe(0);            // supplement already over → nothing more
    expect(out[0]).toBeCloseTo(95, 5); // flex foods shrank to absorb the extra 10
    expect(out[1]).toBeCloseTo(95, 5);
    expect(out[0] + out[1] + out[2]).toBeCloseTo(190, 5); // total remaining = budget
  });
  it("over-feeding one flex food is absorbed by the other flex food", () => {
    // fed 130 of a 100-flex food. budget = 220 − 130 = 90; protected still owed 20; flexBudget = 70;
    // only the second flex food is under-fed, so it gets all 70.
    const fed = [{ plannedK: 100, fedK: 130, protected: false }, { plannedK: 100, fedK: 0, protected: false }, { plannedK: 20, fedK: 0, protected: true }];
    const out = rebalanceRemaining(fed, 220, 130);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(70, 5);
    expect(out[2]).toBe(20); // supplement protected
  });
  it("a supplement stays owed even when the day is already over target", () => {
    const fed = [{ plannedK: 100, fedK: 250, protected: false }, { plannedK: 20, fedK: 0, protected: true }];
    const out = rebalanceRemaining(fed, 220, 250);
    expect(out[0]).toBe(0);   // flex zeroed (over budget)
    expect(out[1]).toBe(20);  // supplement still owed
  });
});
