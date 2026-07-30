import { describe, it, expect } from "vitest";
import { distributeBowl } from "./bowl.js";

// Each food carries an ENERGY mode (perKg/perUnit, read by kcalPerG) AND a SPLIT mode
// (splitMode: fixed/share/remainder) — deliberately separate fields so one never clobbers the other.
const dry = { id: "d", name: "Orijen", mode: "perKg", splitMode: "remainder", kcalPerKg: 4060 }; // ~4.06 kcal/g
const wet = { id: "w", name: "After Dark", mode: "perUnit", splitMode: "share", pct: 74, kcalPerUnit: 85, gramsPerUnit: 79 }; // ~1.076 kcal/g
const treat = { id: "t", name: "Churu", mode: "perUnit", splitMode: "fixed", fixedKcal: 14, kcalPerUnit: 7, gramsPerUnit: 14 };

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

  it("gives a dry (perKg) remainder food its grams — the bug where split mode clobbered energy mode", () => {
    const b = distributeBowl([treat, wet, dry], 249);
    const d = b.rows.find((r) => r.id === "d");
    expect(d.grams).toBeCloseTo(d.kcal / 4.06, 1); // ~51 kcal / 4.06 kcal/g ≈ 12.6 g — NOT null
  });

  it("derives grams per food from each food's own energy density", () => {
    const b = distributeBowl([wet], 100); // one share food, pct 74 -> 74 kcal
    expect(b.rows[0].grams).toBeCloseTo(74 / (85 / 79), 1);
  });

  it("expresses every row as a share of the one basis (the full target)", () => {
    const b = distributeBowl([treat, wet, dry], 249);
    expect(b.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 5);
    expect(b.rows.find((r) => r.id === "t").pct).toBeCloseTo((14 / 249) * 100, 5);
  });

  it("flags over-allocation when fixed + shares exceed the target", () => {
    const b = distributeBowl([
      { id: "a", mode: "perKg", splitMode: "share", pct: 80, kcalPerKg: 4000 },
      { id: "b", mode: "perKg", splitMode: "fixed", fixedKcal: 100, kcalPerKg: 4000 },
      { id: "c", mode: "perKg", splitMode: "remainder", kcalPerKg: 4000 },
    ], 249);
    expect(b.overAllocated).toBe(true);
    expect(b.remainderKcal).toBe(0);
    expect(b.balances).toBe(false);
  });

  it("without a remainder, reports what's still unallocated", () => {
    const b = distributeBowl([{ id: "a", mode: "perKg", splitMode: "share", pct: 60, kcalPerKg: 4000 }], 200);
    expect(Math.round(b.totalKcal)).toBe(120);
    expect(Math.round(b.unallocated)).toBe(80);
    expect(b.balances).toBe(false);
  });

  it("a row with no splitMode counts as a share", () => {
    const b = distributeBowl([{ id: "a", mode: "perKg", pct: 50, kcalPerKg: 4000 }], 200);
    expect(Math.round(b.rows[0].kcal)).toBe(100);
    expect(b.rows[0].splitMode).toBe("share");
  });

  it("only the first remainder absorbs when more than one is (mis)set", () => {
    const b = distributeBowl([
      { id: "a", mode: "perKg", splitMode: "share", pct: 50, kcalPerKg: 4000 },
      { id: "r1", mode: "perKg", splitMode: "remainder", kcalPerKg: 4000 },
      { id: "r2", mode: "perKg", splitMode: "remainder", kcalPerKg: 4000 },
    ], 200);
    expect(Math.round(b.rows.find((r) => r.id === "r1").kcal)).toBe(100);
    expect(b.rows.find((r) => r.id === "r2").kcal).toBe(0);
  });
});
