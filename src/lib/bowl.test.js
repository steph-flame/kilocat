import { describe, it, expect } from "vitest";
import { distributeBowl } from "./bowl.js";

// three foods, worked-example shape (target 249): a fixed treat, a share, and a remainder.
const dry = { id: "d", name: "Orijen", mode: "remainder", kcalPerKg: 4060 }; // ~4.06 kcal/g
const wet = { id: "w", name: "After Dark", mode: "share", pct: 74, kcalPerUnit: 85, gramsPerUnit: 79 }; // ~1.076 kcal/g
const treat = { id: "t", name: "Churu", mode: "fixed", fixedKcal: 14, kcalPerUnit: 7, gramsPerUnit: 14 };

describe("distributeBowl", () => {
  it("fixed off the top, share of the target, remainder absorbs the rest — total lands on target", () => {
    const b = distributeBowl([treat, wet, dry], 249);
    const kc = Object.fromEntries(b.rows.map((r) => [r.id, Math.round(r.kcal)]));
    expect(kc.t).toBe(14); // fixed, off the top
    expect(kc.w).toBe(Math.round(0.74 * 249)); // 184 (share of full target)
    expect(kc.d).toBe(Math.round(249 - 14 - 0.74 * 249)); // 51 — remainder absorbs the rest
    expect(Math.round(b.totalKcal)).toBe(249);
    expect(b.balances).toBe(true);
    expect(b.overAllocated).toBe(false);
  });

  it("derives grams per food from each food's own energy density", () => {
    const b = distributeBowl([wet], 100); // one share food at 100% -> but no remainder, share pct 74 of 100 = 74 kcal
    const w = b.rows[0];
    // 74 kcal at 85/79 = 1.0759 kcal/g -> ~68.8 g
    expect(w.grams).toBeCloseTo(74 / (85 / 79), 1);
  });

  it("expresses every row as a share of the one basis (the full target)", () => {
    const b = distributeBowl([treat, wet, dry], 249);
    const totalPct = b.rows.reduce((s, r) => s + r.pct, 0);
    expect(totalPct).toBeCloseTo(100, 5); // fixed + share + remainder cover exactly 100% of target
    const treatRow = b.rows.find((r) => r.id === "t");
    expect(treatRow.pct).toBeCloseTo((14 / 249) * 100, 5); // ~5.6%
  });

  it("flags over-allocation when fixed + shares exceed the target (remainder has nothing left)", () => {
    const b = distributeBowl([
      { id: "a", mode: "share", pct: 80, kcalPerKg: 4000 },
      { id: "b", mode: "fixed", fixedKcal: 100, kcalPerKg: 4000 },
      { id: "c", mode: "remainder", kcalPerKg: 4000 },
    ], 249); // 0.8*249=199 + 100 = 299 > 249
    expect(b.overAllocated).toBe(true);
    expect(b.remainderKcal).toBe(0);
    expect(b.balances).toBe(false);
  });

  it("without a remainder, reports what's still unallocated", () => {
    const b = distributeBowl([{ id: "a", mode: "share", pct: 60, kcalPerKg: 4000 }], 200);
    expect(Math.round(b.totalKcal)).toBe(120); // 60% of 200
    expect(Math.round(b.unallocated)).toBe(80);
    expect(b.balances).toBe(false);
  });

  it("only the first remainder absorbs when more than one is (mis)set", () => {
    const b = distributeBowl([
      { id: "a", mode: "share", pct: 50, kcalPerKg: 4000 },
      { id: "r1", mode: "remainder", kcalPerKg: 4000 },
      { id: "r2", mode: "remainder", kcalPerKg: 4000 },
    ], 200);
    const r1 = b.rows.find((r) => r.id === "r1");
    const r2 = b.rows.find((r) => r.id === "r2");
    expect(Math.round(r1.kcal)).toBe(100); // 200 - 100 share
    expect(r2.kcal).toBe(0);
  });
});
