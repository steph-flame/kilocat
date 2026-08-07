import { describe, it, expect } from "vitest";
import { withIntakeUncertainty, checkK, DEFAULT_INTAKE_CV, K_PLAUSIBLE, alloEstimateExpenditure } from "./expenditure.js";
import { simulateCat } from "./simCat.js";

describe("intake uncertainty widens the band by the error the filter can't see", () => {
  const r = () => ({ kcal: 200, sd: 8, low: 200 - 15.7, high: 200 + 15.7, enoughData: true });

  it("adds in quadrature and keeps the two parts separable", () => {
    const o = withIntakeUncertainty(r(), 215, 0.05);
    expect(o.sdFilter).toBe(8);
    expect(o.sdIntake).toBeCloseTo(10.75, 2); // 5% of 215
    expect(o.sd).toBeCloseTo(Math.sqrt(64 + 10.75 ** 2), 4);
    expect(o.low).toBeCloseTo(200 - 1.96 * o.sd, 6);
    expect(o.high).toBeCloseTo(200 + 1.96 * o.sd, 6);
  });

  it("can only widen, never narrow", () => {
    for (const cv of [0, 0.01, 0.05, 0.2]) {
      expect(withIntakeUncertainty(r(), 215, cv).sd).toBeGreaterThanOrEqual(8);
    }
  });

  it("is a FLOOR: it does not shrink as the filter converges", () => {
    const early = withIntakeUncertainty({ ...r(), sd: 30 }, 215, 0.05);
    const late = withIntakeUncertainty({ ...r(), sd: 2 }, 215, 0.05);
    expect(late.sdIntake).toBeCloseTo(early.sdIntake, 6);   // identical contribution
    expect(late.sd).toBeGreaterThan(10);                     // so the band can't collapse below it
  });

  it("scales with how much the cat eats, not with the filter", () => {
    expect(withIntakeUncertainty(r(), 400, 0.05).sdIntake)
      .toBeCloseTo(2 * withIntakeUncertainty(r(), 200, 0.05).sdIntake, 6);
  });

  it("leaves a not-yet-estimable result alone", () => {
    expect(withIntakeUncertainty({ kcal: null, sd: null }, 215).kcal).toBeNull();
    expect(withIntakeUncertainty(null, 215)).toBeNull();
  });

  it("zero or nonsense cv is a no-op, not a NaN", () => {
    for (const cv of [0, -1, NaN, undefined]) {
      const o = withIntakeUncertainty(r(), 215, cv);
      expect(Number.isFinite(o.sd)).toBe(true);
    }
    expect(withIntakeUncertainty(r(), 215, 0).sd).toBe(8);
  });

  // The point of the whole exercise: with a real logging bias, the widened band should still
  // contain the truth where the filter-only band would not.
  it("covers a truth that a filter-only band would miss", () => {
    const sim = simulateCat({ days: 120, deficit: 30, gutPct: 0.0042, gutPhi: 0.58, sigmaW: 0.026, readsPerDay: 6 });
    const overlogged = sim.intakeEntries.map((x) => ({ ...x, value: x.value * 1.08 })); // 8% over-reported
    const raw = alloEstimateExpenditure(sim.weightEntries, overlogged, { priorKcal: 250, priorSdKcal: 60 });
    const mean = overlogged.reduce((a, b) => a + b.value, 0) / overlogged.length;
    const wide = withIntakeUncertainty(raw, mean, 0.08);
    const inside = (o) => sim.EtrueEnd >= o.low && sim.EtrueEnd <= o.high;
    expect(inside(raw)).toBe(false);  // the filter alone is confidently wrong
    expect(inside(wide)).toBe(true);  // acknowledging the logging error rescues it
  });

  it("the default is a stated assumption about the OWNER, not a tuned constant", () => {
    expect(DEFAULT_INTAKE_CV).toBeGreaterThan(0);
    expect(DEFAULT_INTAKE_CV).toBeLessThanOrEqual(0.1);
  });
});

describe("checkK flags a burn no cat should have", () => {
  it("accepts a real cat", () => {
    const c = checkK(199.6, 4.46); // Mithril
    expect(c.plausible).toBe(true);
    expect(c.xRer).toBeGreaterThan(0.8);
    expect(c.xRer).toBeLessThan(1.1);
    expect(c.note).toBeNull();
  });

  it("flags implausibly low, and blames the log rather than the cat", () => {
    const c = checkK(120, 4.46);
    expect(c.plausible).toBe(false);
    expect(c.note).toMatch(/under-recorded/);
  });

  it("flags implausibly high", () => {
    const c = checkK(400, 4.46);
    expect(c.plausible).toBe(false);
    expect(c.note).toMatch(/over-recorded|another pet/);
  });

  it("the band is deliberately wide — it catches mistakes, not unusual cats", () => {
    expect(K_PLAUSIBLE.lo / 70).toBeCloseTo(0.7, 2);
    expect(K_PLAUSIBLE.hi / 70).toBeCloseTo(1.5, 2);
  });

  it("handles missing inputs", () => {
    expect(checkK(0, 4.4)).toBeNull();
    expect(checkK(200, 0)).toBeNull();
  });
});
