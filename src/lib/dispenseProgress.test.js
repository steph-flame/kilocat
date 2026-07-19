import { describe, it, expect } from "vitest";
import { dispensedToday, dispenseProgress } from "./dispenseProgress.js";

describe("dispensedToday", () => {
  it("sums only entries dated today", () => {
    const items = [
      { date: "2026-07-14", kcal: 100 },
      { date: "2026-07-13", kcal: 200 },
      { date: "2026-07-14", kcal: 50 },
    ];
    expect(dispensedToday(items, "2026-07-14")).toBe(150);
  });

  it("returns 0 for an empty log", () => {
    expect(dispensedToday([], "2026-07-14")).toBe(0);
    expect(dispensedToday(undefined, "2026-07-14")).toBe(0);
  });

  it("treats an explicit 0-kcal 'nothing eaten' entry the same as no entries", () => {
    const items = [{ date: "2026-07-14", kcal: 0, name: "nothing eaten" }];
    expect(dispensedToday(items, "2026-07-14")).toBe(0);
  });

  it("ignores entries missing kcal", () => {
    const items = [{ date: "2026-07-14" }];
    expect(dispensedToday(items, "2026-07-14")).toBe(0);
  });
});

describe("dispenseProgress", () => {
  it("flags empty (nothing dispensed yet) at 0", () => {
    const p = dispenseProgress(0, 300);
    expect(p.isEmpty).toBe(true);
    expect(p.fillPct).toBe(0);
    expect(p.overPct).toBe(0);
    expect(p.overKcal).toBe(0);
  });

  it("fills proportionally under target", () => {
    const p = dispenseProgress(150, 300);
    expect(p.isEmpty).toBe(false);
    expect(p.fillPct).toBeCloseTo(50);
    expect(p.overPct).toBe(0);
    expect(p.overKcal).toBe(0);
  });

  it("fills exactly to 100 at target, no overflow", () => {
    const p = dispenseProgress(300, 300);
    expect(p.fillPct).toBe(100);
    expect(p.overPct).toBe(0);
    expect(p.overKcal).toBe(0);
  });

  it("splits into an ok segment (up to target) and a warn segment (the excess) over target, summing to 100", () => {
    const p = dispenseProgress(360, 300);
    expect(p.overKcal).toBe(60);
    expect(p.fillPct).toBeCloseTo((300 / 360) * 100);
    expect(p.overPct).toBeCloseTo((60 / 360) * 100);
    expect(p.fillPct + p.overPct).toBeCloseTo(100);
    expect(p.isEmpty).toBe(false);
  });

  it("never reports a fillPct or overPct outside [0, 100]", () => {
    const p = dispenseProgress(10000, 300);
    expect(p.fillPct).toBeGreaterThanOrEqual(0);
    expect(p.fillPct).toBeLessThanOrEqual(100);
    expect(p.overPct).toBeGreaterThanOrEqual(0);
    expect(p.overPct).toBeLessThanOrEqual(100);
  });

  it("guards a non-positive target instead of dividing by zero", () => {
    expect(dispenseProgress(50, 0)).toEqual({ fillPct: 0, overPct: 0, overKcal: 0, isEmpty: false });
    expect(dispenseProgress(0, 0)).toEqual({ fillPct: 0, overPct: 0, overKcal: 0, isEmpty: true });
  });

  it("guards a negative/garbage dispensed value as empty", () => {
    expect(dispenseProgress(-5, 300).isEmpty).toBe(true);
    expect(dispenseProgress(NaN, 300).isEmpty).toBe(true);
  });
});
