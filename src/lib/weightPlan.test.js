import { describe, it, expect } from "vitest";
import { planWeightChange, autoDirection, RATE, MAINTAIN_BAND, safeRateBand } from "./weightPlan.js";
import { RER } from "./nutrition.js";

const RHO = 8000;

describe("autoDirection from body condition", () => {
  it("overweight → lose, underweight → gain, near-ideal → maintain", () => {
    expect(autoDirection(20)).toBe("lose");
    expect(autoDirection(-15)).toBe("gain");
    expect(autoDirection(0)).toBe("maintain");
    expect(autoDirection(2)).toBe("maintain"); // within the ±2% dead zone
  });
});

describe("lose", () => {
  it("1%/week of a 5 kg cat at 250 kcal → ~193 kcal (deficit)", () => {
    const p = planWeightChange({ direction: "lose", maintenanceKcal: 250, currentKg: 5, idealKg: 4, pctPerWeek: 1, rho: RHO });
    expect(p.dailyDelta).toBeCloseTo(-(RHO * 0.05) / 7, 4);
    expect(p.targetKcal).toBeCloseTo(250 - (RHO * 0.05) / 7, 4);
    expect(p.applicable).toBe(true);
  });
  it("caps a too-fast rate and warns about lipidosis", () => {
    const p = planWeightChange({ direction: "lose", maintenanceKcal: 300, currentKg: 6, idealKg: 4, pctPerWeek: 5, rho: RHO });
    expect(p.rate).toBe(RATE.max);
    expect(p.warnings.some((w) => /hepatic lipidosis/i.test(w))).toBe(true);
  });
  it("floors the target at 0.8×RER(ideal) and reports the slower actual rate", () => {
    const idealKg = 4;
    const p = planWeightChange({ direction: "lose", maintenanceKcal: 120, currentKg: 5, idealKg, pctPerWeek: 2, rho: RHO });
    expect(p.belowFloor).toBe(true);
    expect(p.targetKcal).toBeCloseTo(0.8 * RER(idealKg), 6);
    expect(p.resultingRatePctPerWeek).toBeLessThan(p.rate);
  });
});

describe("gain", () => {
  it("1%/week of a 3 kg underweight cat at 200 kcal → surplus above maintenance", () => {
    const p = planWeightChange({ direction: "gain", maintenanceKcal: 200, currentKg: 3, idealKg: 4, pctPerWeek: 1, rho: RHO });
    expect(p.dailyDelta).toBeCloseTo(+(RHO * 0.03) / 7, 4); // positive surplus
    expect(p.targetKcal).toBeGreaterThan(200);
    expect(p.applicable).toBe(true);
    expect(p.belowFloor).toBe(false); // no nutritional floor on gain
  });
  it("projects weeks to reach ideal when gaining toward it", () => {
    const p = planWeightChange({ direction: "gain", maintenanceKcal: 200, currentKg: 3.5, idealKg: 4, pctPerWeek: 1, rho: RHO });
    expect(p.weeksToIdeal).toBeGreaterThan(0);
  });
  it("warns when the cat is already at/above ideal", () => {
    const p = planWeightChange({ direction: "gain", maintenanceKcal: 250, currentKg: 5, idealKg: 4, pctPerWeek: 1, rho: RHO });
    expect(p.applicable).toBe(false);
    expect(p.warnings.some((w) => /no surplus needed/i.test(w))).toBe(true);
  });
});

describe("maintain", () => {
  it("targets maintenance exactly, no delta", () => {
    const p = planWeightChange({ direction: "maintain", maintenanceKcal: 240, currentKg: 4, idealKg: 4, pctPerWeek: 1 });
    expect(p.targetKcal).toBe(240);
    expect(p.dailyDelta).toBe(0);
    expect(p.weeksToIdeal).toBeNull();
  });
});

// The timeline chart's rate-panel safe-zone shading must land on the side of zero the plan is
// actually aiming for — the reported bug was the zone rendering on the gain (positive) side
// for a losing cat, contradicting the axis's own "(loss −)" label.
describe("safeRateBand (rate-panel safe-zone shading)", () => {
  it("lose: the whole zone is negative (below zero), bounded by RATE.min/max", () => {
    const z = safeRateBand("lose");
    expect(z.lo).toBe(-RATE.max);
    expect(z.hi).toBe(-RATE.min);
    expect(z.lo).toBeLessThan(0);
    expect(z.hi).toBeLessThan(0);
  });
  it("gain: the whole zone is positive (above zero), bounded by RATE.min/max", () => {
    const z = safeRateBand("gain");
    expect(z.lo).toBe(RATE.min);
    expect(z.hi).toBe(RATE.max);
    expect(z.lo).toBeGreaterThan(0);
    expect(z.hi).toBeGreaterThan(0);
  });
  it("maintain: a thin band centered on zero, narrower than the lose/gain zone", () => {
    const z = safeRateBand("maintain");
    expect(z.lo).toBe(-MAINTAIN_BAND);
    expect(z.hi).toBe(MAINTAIN_BAND);
    expect(z.hi - z.lo).toBeLessThan(RATE.max - RATE.min);
  });
  it("lose and gain zones never overlap zero, so they can never be confused for each other", () => {
    const lose = safeRateBand("lose"), gain = safeRateBand("gain");
    expect(lose.hi).toBeLessThanOrEqual(0);
    expect(gain.lo).toBeGreaterThanOrEqual(0);
  });
});
