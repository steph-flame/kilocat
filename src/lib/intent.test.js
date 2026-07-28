import { describe, it, expect } from "vitest";
import { computeIntent, recommendedZone, RATE_MAX } from "./intent.js";
import { RER } from "./nutrition.js";

// The handoff's worked example, recomputed on the CORRECT ρ = 7800 (not the mockup's 1960).
const EX = { basis: "measured", measuredKcal: 262, formulaKcal: 248, currentKg: 5.42, idealKg: 4.9, pctOver: 10 };

describe("recommendedZone (advisory, from % over ideal)", () => {
  it("BCS 6 (10% over) recommends −1.0…−0.5 %/wk — matches the handoff", () => {
    expect(recommendedZone(10)).toEqual({ lo: -1.0, hi: -0.5 });
  });
  it("widens/quickens with severity, flips to gain when underweight, holds at ideal", () => {
    expect(recommendedZone(22)).toEqual({ lo: -1.5, hi: -0.75 });
    expect(recommendedZone(35)).toEqual({ lo: -2.0, hi: -1.0 });
    expect(recommendedZone(-10)).toEqual({ lo: 0.5, hi: 1.0 });
    expect(recommendedZone(0)).toBe(null);
  });
});

describe("computeIntent — ρ = 7800 consistently", () => {
  it("reproduces the worked example's rate at target ≈ 214 (NOT the mockup's 249)", () => {
    const r = computeIntent({ ...EX, ratePctPerWeek: -0.8 });
    expect(r.maintenance).toBe(262);
    // dailyDelta = 7800 * (5.42 * -0.8)/100 / 7 ≈ -48.3
    expect(r.dailyDelta).toBeCloseTo(-48.3, 1);
    expect(Math.round(r.target)).toBe(214);
    // the target actually delivers the −0.8%/wk it promises (not floored)
    expect(r.belowFloor).toBe(false);
    expect(r.resultingRatePct).toBeCloseTo(-0.8, 2);
    expect(Math.round(r.weeksToIdeal)).toBe(12);
    expect(r.inZone).toBe(true); // −0.8 is inside −1.0…−0.5
  });

  it("proves the mockup's 249 would NOT deliver −0.8%/wk", () => {
    // If you fed 249 (a 13 kcal/day deficit) the real rate at ρ=7800 is only ~0.2%/wk.
    const deficit = 262 - 249; // 13 kcal/day
    const weeklyKg = (deficit * 7) / 7800;
    const pctWk = (weeklyKg / 5.42) * 100;
    expect(pctWk).toBeCloseTo(0.21, 1); // ~a quarter of the promised 0.8
  });

  it("holds at maintenance when rate is 0", () => {
    const r = computeIntent({ ...EX, ratePctPerWeek: 0 });
    expect(r.target).toBe(262);
    expect(r.resultingRatePct).toBe(0);
    expect(r.weeksToIdeal).toBe(null);
  });

  it("floors a too-aggressive loss at 0.8 × RER(ideal) and reports the slower delivered rate", () => {
    const r = computeIntent({ ...EX, ratePctPerWeek: -2 });
    const floor = 0.8 * RER(4.9);
    expect(r.floorKcal).toBeCloseTo(floor, 3);
    // -2%/wk would want 262 - 121 = 141, below the ~184 floor -> held at floor
    expect(r.belowFloor).toBe(true);
    expect(r.target).toBeCloseTo(floor, 3);
    // delivered rate is gentler than the requested 2%
    expect(Math.abs(r.resultingRatePct)).toBeLessThan(2);
  });

  it("gain: target above maintenance, no floor, weeks-to-ideal only toward ideal", () => {
    const under = { basis: "measured", measuredKcal: 200, formulaKcal: 210, currentKg: 3.5, idealKg: 4.0, pctOver: -12.5 };
    const r = computeIntent({ ...under, ratePctPerWeek: 1.0 });
    expect(r.target).toBeGreaterThan(200);
    expect(r.belowFloor).toBe(false);
    expect(r.resultingRatePct).toBeCloseTo(1.0, 2);
    expect(r.weeksToIdeal).toBeGreaterThan(0);
    expect(r.contraIndicated).toBe(false); // gaining an underweight cat is aligned
  });

  it("flags a contra-indicated direction (gain on an overweight cat)", () => {
    const r = computeIntent({ ...EX, ratePctPerWeek: 1.0 });
    expect(r.contraIndicated).toBe(true);
    expect(r.inZone).toBe(false);
  });

  it("falls back to the formula maintenance when measured data is absent", () => {
    const r = computeIntent({ ...EX, basis: "measured", measuredKcal: null, ratePctPerWeek: -0.8 });
    expect(r.usingMeasured).toBe(false);
    expect(r.maintenance).toBe(248); // the vet formula
  });

  it("caps rate magnitude at ±2 %/wk", () => {
    const hot = computeIntent({ ...EX, ratePctPerWeek: -9 });
    expect(hot.rate).toBe(-RATE_MAX);
  });
});
