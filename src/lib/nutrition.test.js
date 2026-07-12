import { describe, it, expect } from "vitest";
import { RER, computeTargets, bcsToPct, pctToBcs, defaultFactors } from "./nutrition.js";

// A minimal profile; override per test.
const profile = (over = {}) => ({
  weightKg: 5, ageMonths: 24, neutered: true,
  bcMode: "pct", pctOver: 0, bcs: 5, goal: "maintain",
  customTarget: "", gentleBasis: "current",
  factors: { ...defaultFactors }, ...over,
});

describe("RER", () => {
  it("is 70 * kg^0.75", () => {
    expect(RER(5)).toBeCloseTo(70 * Math.pow(5, 0.75), 6);
  });
});

describe("maintain uses the adult factor, never the growth factor", () => {
  // The 424-kcal regression: maintenance must multiply RER by the adult status
  // factor at *any* age — it must not borrow the (much larger) kitten growth factor.
  it("adult neutered: maintain = RER * 1.2", () => {
    const t = computeTargets(profile({ ageMonths: 24 }));
    expect(t.refs.maintain).toBeCloseTo(t.rerCur * 1.2, 6);
  });
  it("kitten: maintain still uses the adult factor and stays below growth", () => {
    const t = computeTargets(profile({ ageMonths: 6 }));
    expect(t.refs.maintain).toBeCloseTo(t.rerCur * 1.2, 6); // adult factor, not growthFactor
    expect(t.refs.maintain).toBeLessThan(t.refs.grow);       // growth funds more than maintenance
  });
});

describe("growth factor taper", () => {
  const gf = (ageMonths) => computeTargets(profile({ ageMonths, neutered: true })).growthFactor;
  it("holds at the kitten peak (2.5) through 4 months", () => {
    expect(gf(2)).toBeCloseTo(2.5, 6);
    expect(gf(4)).toBeCloseTo(2.5, 6);
  });
  it("lands on the adult factor (1.2) by 12 months", () => {
    expect(gf(12)).toBeCloseTo(1.2, 6);
  });
  it("is ~1.52 at 10 months (linear taper between the two)", () => {
    expect(gf(10)).toBeCloseTo(1.525, 3);
  });
});

describe("BCS <-> % round-trips", () => {
  it("BCS 7 -> 20% -> BCS 7", () => {
    expect(bcsToPct(7)).toBe(20);
    expect(pctToBcs(20)).toBe(7);
  });
  it("every integer BCS survives the round trip", () => {
    for (let bcs = 1; bcs <= 9; bcs++) {
      expect(pctToBcs(bcsToPct(bcs))).toBe(bcs);
    }
  });
  it("clamps out-of-range percentages into 1-9", () => {
    expect(pctToBcs(200)).toBe(9);
    expect(pctToBcs(-200)).toBe(1);
  });
});

describe("ideal weight backs out the excess", () => {
  it("20% over at 4.38 kg implies ~3.65 kg ideal", () => {
    const t = computeTargets(profile({ weightKg: 4.38, pctOver: 20 }));
    expect(t.idealWeight).toBeCloseTo(4.38 / 1.2, 4);
  });
  it("clamps ideal weight to a physiological band for a wild % (no runaway target)", () => {
    const t = computeTargets(profile({ weightKg: 5, pctOver: -95 }));
    expect(t.idealWeight).toBeLessThanOrEqual(2.5 * 5); // clamped, not w/0.05 = 100 kg
    expect(t.idealWeight).toBeGreaterThanOrEqual(0.4 * 5);
  });
});
