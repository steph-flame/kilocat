import { describe, it, expect } from "vitest";
import {
  distribute, waterfall, transitionAmount, kcalPerG, kcalFromGrams, isValidQty,
  upsertFood, searchFoods, isCompleteFood, toLibraryEntry, makeLibrarySeed, dedupeFoods, canonicalFoodName,
  migrateLegacyFood, ensureBuiltins, macroProfile, backfillBuiltinMacros, blankFood, BUILTIN_FOODS, FOOD_NUM_KEYS,
  rationMacroProfile, aafcoCheck, treatEnergy, foodType,
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

describe("kcalFromGrams (intake-log inline grams edit)", () => {
  it("re-derives kcal using the entry's stored kcalPerG", () => {
    expect(kcalFromGrams({ kcalPerG: 4 }, 60)).toBe(240);
  });
  it("rounds like entry creation does", () => {
    expect(kcalFromGrams({ kcalPerG: 70 / 79.4 }, 60)).toBe(Math.round((70 / 79.4) * 60));
  });
  it("returns null when the entry has no kcalPerG basis (older entry, or hand-typed kcal)", () => {
    expect(kcalFromGrams({ grams: 50, kcal: 200 }, 60)).toBeNull();
    expect(kcalFromGrams({ kcalPerG: 0 }, 60)).toBeNull();
    expect(kcalFromGrams({ kcalPerG: null }, 60)).toBeNull();
  });
});

describe("isValidQty guards edited intake quantities", () => {
  it("accepts ordinary positive numbers", () => {
    expect(isValidQty(1)).toBe(true);
    expect(isValidQty(240)).toBe(true);
    expect(isValidQty(0.5)).toBe(true);
  });
  it("rejects zero — reserved for the explicit 'nothing eaten' marker, not an edited-down entry", () => {
    expect(isValidQty(0)).toBe(false);
  });
  it("rejects negative, NaN, and non-finite values", () => {
    expect(isValidQty(-5)).toBe(false);
    expect(isValidQty(NaN)).toBe(false);
    expect(isValidQty(Infinity)).toBe(false);
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
  it("matches a token anywhere in the name (not just as a prefix)", () => {
    const list = [
      { name: "Tiki Cat After Dark Chicken & Lamb" },
      { name: "Instinct Original Chicken" },
      { name: "Lamb & Rice Dinner" },
    ];
    expect(searchFoods(list, "lamb").map((f) => f.name)).toEqual([
      "Lamb & Rice Dinner", // starts with the query → ranked first
      "Tiki Cat After Dark Chicken & Lamb",
    ]);
  });
  it("is word-order-independent across multiple tokens", () => {
    const list = [
      { name: "Tiki Cat After Dark Chicken & Lamb" },
      { name: "Lamb & Rice Dinner" },
    ];
    expect(searchFoods(list, "lamb tiki").map((f) => f.name)).toEqual([
      "Tiki Cat After Dark Chicken & Lamb",
    ]);
  });
  it("ranks whole-name and word-start matches above mid-word hits", () => {
    const list = [
      { name: "Salmon Pate" }, // 'sal' mid-word? no — word-start
      { name: "Wild-Caught Salmon" }, // word-start, longer
      { name: "Unsalted Broth" }, // 'sal' only mid-word
    ];
    const out = searchFoods(list, "sal").map((f) => f.name);
    expect(out[0]).toBe("Salmon Pate");
    expect(out[out.length - 1]).toBe("Unsalted Broth");
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

describe("migrateLegacyFood (retire the generic Tiki)", () => {
  it("maps a generic Tiki to the whole-food Chicken & Quail Egg of the matching size", () => {
    const small = migrateLegacyFood({ id: "1", name: "Tiki Cat After Dark", mode: "perUnit", kcalPerUnit: 70, gramsPerUnit: 79, pct: 17 });
    expect(small.name).toBe("Tiki Cat After Dark Chicken & Quail Egg — 2.8 oz can");
    expect(small.kcalPerUnit).toBe(66);
    expect(small.pct).toBe(17); // ration % preserved
    const big = migrateLegacyFood({ name: "Tiki Cat After Dark — 5.5 oz can", mode: "perUnit", kcalPerUnit: 130, gramsPerUnit: 156 });
    expect(big.name).toBe("Tiki Cat After Dark Chicken & Quail Egg — 5.5 oz can");
    expect(big.kcalPerUnit).toBe(129);
  });
  it("leaves a real flavor and non-Tiki foods untouched", () => {
    const real = { name: "Tiki Cat After Dark Chicken & Beef — 2.8 oz can", mode: "perUnit", kcalPerUnit: 59 };
    expect(migrateLegacyFood(real)).toBe(real);
    const other = { name: "Fromm Kitten Gold", mode: "perKg", kcalPerKg: 3941 };
    expect(migrateLegacyFood(other)).toBe(other);
  });
});

describe("ensureBuiltins", () => {
  it("adds missing built-ins and keeps the user's own foods", () => {
    const out = ensureBuiltins([{ id: "u", name: "My Homemade Mix", mode: "perKg", kcalPerKg: 1500 }]);
    expect(out.some((f) => f.name === "My Homemade Mix")).toBe(true);
    expect(out.some((f) => f.name === "Fromm Kitten Gold")).toBe(true); // built-in added
    expect(out.length).toBeGreaterThan(makeLibrarySeed().length);
  });
  it("is a no-op when all built-ins are already present", () => {
    expect(ensureBuiltins(makeLibrarySeed())).toHaveLength(makeLibrarySeed().length);
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
    expect(e).toEqual({ name: "A", mode: "perKg", type: "", kcalPerKg: 1, gramsPerCup: 2, kcalPerUnit: "", gramsPerUnit: "", protein: "", fat: "", fiber: "", moisture: "", ash: "" });
  });
});

describe("macroProfile (derived nutrition from guaranteed analysis)", () => {
  it("returns null until at least protein and fat are entered", () => {
    expect(macroProfile({})).toBe(null);
    expect(macroProfile({ protein: 40 })).toBe(null);
    expect(macroProfile({ fat: 20 })).toBe(null);
  });
  it("computes carbs as NFE and the caloric split via modified Atwater", () => {
    // A typical premium kibble GA: 40 protein, 20 fat, 3 fiber, 8 moisture, 8 ash.
    const p = macroProfile({ protein: 40, fat: 20, fiber: 3, moisture: 8, ash: 8 });
    expect(p.carb).toBe(21); // 100 - 40 - 20 - 3 - 8 - 8
    // kcal: protein 40*3.5=140, fat 20*8.5=170, carb 21*3.5=73.5; total 383.5
    expect(p.caloric.protein).toBe(36.5); // 140/383.5
    expect(p.caloric.fat).toBe(44.3); // 170/383.5
    expect(p.caloric.carb).toBe(19.2); // 73.5/383.5
    expect(p.caloric.protein + p.caloric.fat + p.caloric.carb).toBeCloseTo(100, 0);
  });
  it("floors carbs at zero when the GA over-sums", () => {
    expect(macroProfile({ protein: 60, fat: 30, fiber: 5, moisture: 8, ash: 5 }).carb).toBe(0);
  });
  it("restates percentages on a dry-matter (moisture-free) basis", () => {
    // A wet food: 11 protein, 5 fat as-fed, 78 moisture -> dry matter is 22%.
    const p = macroProfile({ protein: 11, fat: 5, moisture: 78 });
    expect(p.dryMatter.protein).toBe(50); // 11 / (100-78)
    expect(p.dryMatter.fat).toBeCloseTo(22.7, 1);
  });
});

describe("backfillBuiltinMacros", () => {
  it("fills only blank fields on a food matching a built-in by name, never overwriting", () => {
    const b = BUILTIN_FOODS[0];
    const stale = { id: "x", name: b.name, mode: b.mode, kcalPerKg: "", gramsPerCup: "", kcalPerUnit: "", gramsPerUnit: "", protein: 99 };
    const filled = backfillBuiltinMacros(stale);
    // an energy field the built-in defines gets filled...
    for (const k of FOOD_NUM_KEYS) {
      const bv = b[k];
      if (bv != null && bv !== "" && Number(bv) > 0 && k !== "protein") {
        expect(Number(filled[k])).toBe(Number(bv));
      }
    }
    // ...but a value the user already set is untouched
    expect(filled.protein).toBe(99);
  });
  it("passes non-built-in foods through untouched", () => {
    const f = { ...blankFood(), name: "Homemade Mystery Stew", kcalPerUnit: 50, gramsPerUnit: 60 };
    expect(backfillBuiltinMacros(f)).toEqual(f);
  });
});

describe("rationMacroProfile (blend of foods by caloric share)", () => {
  const kibble = { name: "Kibble", mode: "perKg", kcalPerKg: 4000, protein: 40, fat: 20, fiber: 3, moisture: 8, ash: 8, pct: 50 };
  const wet = { name: "Wet", mode: "perUnit", kcalPerUnit: 80, gramsPerUnit: 100, protein: 11, fat: 5, fiber: 1, moisture: 78, ash: 2, pct: 50 };

  it("combines foods on a mass basis and derives the blend profile + density", () => {
    const p = rationMacroProfile([kibble, wet]);
    expect(p.coverageKcalPct).toBe(100);
    // mass weights: kibble 50/4=12.5, wet 50/0.8=62.5 -> the wet food dominates the grams
    expect(p.moisture).toBeCloseTo(66.33, 1);
    expect(p.dryMatter.protein).toBe(47); // 15.83 / (100-66.33)
    expect(p.kcalPerG).toBeCloseTo(1.333, 2); // 100 pct / 75 wSum
    expect(p.caloric.protein + p.caloric.fat + p.caloric.carb).toBeCloseTo(100, 0);
  });

  it("reports coverage below 100% when a blend food lacks GA, and ignores it in the profile", () => {
    const noGA = { name: "Mystery", mode: "perKg", kcalPerKg: 4000, pct: 50 };
    const p = rationMacroProfile([kibble, wet, noGA]);
    expect(p.coverageKcalPct).toBe(66.7); // 100 covered of 150 total pct
  });

  it("returns null when nothing in the blend can be analyzed", () => {
    expect(rationMacroProfile([{ name: "x", mode: "perKg", kcalPerKg: 4000, pct: 100 }])).toBe(null);
    expect(rationMacroProfile([])).toBe(null);
  });
});

describe("aafcoCheck (dry-matter minimums)", () => {
  it("rates adult protein/fat against the 26/9 floor", () => {
    expect(aafcoCheck({ protein: 47, fat: 40 }, "adult")).toMatchObject({ protein: "ok", fat: "ok" });
    expect(aafcoCheck({ protein: 24 }, "adult").protein).toBe("below");
    expect(aafcoCheck({ protein: 27 }, "adult").protein).toBe("near"); // within 10% above 26
    expect(aafcoCheck({ fat: 8 }, "adult").fat).toBe("below");
    expect(aafcoCheck({ fat: 9.5 }, "adult").fat).toBe("near");
  });
  it("uses the higher growth protein floor (30) for kittens", () => {
    expect(aafcoCheck({ protein: 27 }, "growing kitten").protein).toBe("below");
    expect(aafcoCheck({ protein: 31 }, "growing kitten").protein).toBe("near");
    expect(aafcoCheck({ protein: 40 }, "growing kitten").protein).toBe("ok");
  });
  it("returns null for an unknown value", () => {
    expect(aafcoCheck({ protein: 0 }, "adult").protein).toBe(null);
    expect(aafcoCheck({}, "adult").fat).toBe(null);
  });
});

describe("food type + treats", () => {
  it("an explicit type wins over the moisture/mode heuristic", () => {
    expect(foodType({ type: "treat", mode: "perUnit" })).toBe("treat");
    expect(foodType({ type: "dry", mode: "perUnit", moisture: 78 })).toBe("dry");
    expect(foodType({ mode: "perUnit" })).toBe("wet"); // no explicit type -> heuristic
  });
  it("treatEnergy converts between kcal/treat and kcal/kg", () => {
    // 1 kcal/treat + 3423 kcal/kg -> treat weighs 1/3423*1000 ≈ 0.29 g
    const a = treatEnergy({ kcalPerTreat: 1, kcalPerKg: 3423 });
    expect(a.kcalPerUnit).toBe(1);
    expect(a.gramsPerUnit).toBeCloseTo(0.3, 1);
    // given kcal/treat + grams/treat -> derive kcal/kg
    const b = treatEnergy({ kcalPerTreat: 1, gramsPerTreat: 0.29 });
    expect(b.kcalPerKg).toBe(Math.round((1 / 0.29) * 1000)); // ~3448
  });
});
