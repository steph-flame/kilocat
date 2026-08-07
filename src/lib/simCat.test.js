import { describe, it, expect } from "vitest";
import { simulateCat, scoreEstimator, rng, SIM_DEFAULTS } from "./simCat.js";
import { ucEstimateExpenditure, alloEstimateExpenditure, KCAL_PER_KG } from "./expenditure.js";

const v3 = (opts = {}) => (w, i) => ucEstimateExpenditure(w, i, { priorKcal: 250, priorSdKcal: 60, ...opts });

describe("the simulated cat is a fair test subject", () => {
  it("is deterministic — a coverage figure is a fact about the code, not the seed", () => {
    const a = simulateCat({ seed: 7 }), b = simulateCat({ seed: 7 });
    expect(a.weightEntries.map((e) => e.value)).toEqual(b.weightEntries.map((e) => e.value));
    expect(simulateCat({ seed: 8 }).EtrueEnd).not.toBe(a.EtrueEnd);
  });

  it("rng.normal has roughly the right moments (a broken RNG would fake every result)", () => {
    const R = rng(42);
    const xs = Array.from({ length: 20000 }, () => R.normal());
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const s = Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length);
    expect(Math.abs(m)).toBeLessThan(0.05);
    expect(s).toBeGreaterThan(0.95);
    expect(s).toBeLessThan(1.05);
  });

  it("allometric drift makes losing weight LOWER the burn, and self-limit", () => {
    const s = simulateCat({ deficit: 60, days: 56 });
    expect(s.Wend).toBeLessThan(s.W0);
    expect(s.EtrueEnd).toBeLessThan(250);
    // the loss decelerates as maintenance falls toward intake
    const half = Math.floor(s.truth.length / 2);
    const firstHalf = s.truth[0].W - s.truth[half].W;
    const secondHalf = s.truth[half].W - s.truth[s.truth.length - 1].W;
    expect(secondHalf).toBeLessThan(firstHalf);
  });

  it("gaining raises the burn — the mirror case", () => {
    const s = simulateCat({ deficit: -60 });
    expect(s.Wend).toBeGreaterThan(s.W0);
    expect(s.EtrueEnd).toBeGreaterThan(250);
  });

  it("gut fill moves the SCALE without moving true mass or the energy balance", () => {
    const quiet = simulateCat({ gutPct: 0, seed: 3 });
    const noisy = simulateCat({ gutPct: 0.02, seed: 3 });
    expect(noisy.Wend).toBeCloseTo(quiet.Wend, 6);   // identical true trajectory...
    const spread = (s) => { const v = s.weightEntries.map((e) => e.value); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length); };
    expect(spread(noisy)).toBeGreaterThan(spread(quiet)); // ...but a noisier scale
  });

  it("gut fill scales with the animal, so the same % is a bigger wobble on a bigger body", () => {
    const spread = (s) => { const v = s.weightEntries.map((e) => e.value); const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length); };
    const small = simulateCat({ W0: 3, E0: 170, deficit: 0, gutPct: 0.02, seed: 5 });
    const big = simulateCat({ W0: 7, E0: 330, deficit: 0, gutPct: 0.02, seed: 5 });
    expect(spread(big)).toBeGreaterThan(spread(small));
  });

  it("constant and randomWalk modes are available for comparison", () => {
    expect(simulateCat({ drift: "constant", deficit: 50 }).EtrueEnd).toBeCloseTo(250, 6);
    expect(simulateCat({ drift: "randomWalk", driftSd: 3, deficit: 0 }).EtrueEnd).not.toBeCloseTo(250, 1);
  });
});

// These pin the CURRENT estimator's calibration. They are not aspirational — they record what v3
// actually does, so a change to the model (or to qE) that alters it has to do so deliberately.
describe("v3 calibration, scored against known truth", () => {
  it("is conservative rather than over-confident under realistic conditions", () => {
    const r = scoreEstimator(v3(), { cases: 60, deficit: 45, vary: { gutPct: [0.003, 0.02], sigmaW: [0.01, 0.08] } });
    // a 95% band; anything under ~90 would mean it misleads, which is the failure that matters
    expect(r.coverage).toBeGreaterThanOrEqual(90);
    expect(r.n).toBeGreaterThan(50);
  });

  it("reads HIGH for a losing cat and LOW for a gaining one — a tracking lag, not noise", () => {
    const losing = scoreEstimator(v3(), { cases: 40, deficit: 60, gutPct: 0.005 });
    const gaining = scoreEstimator(v3(), { cases: 40, deficit: -60, gutPct: 0.005 });
    expect(losing.bias).toBeGreaterThan(1);
    expect(gaining.bias).toBeLessThan(-1);
  });

  // The finding that motivates v4: the lag is a property of the model's SHAPE, so no amount of
  // process-noise tuning removes it. If a future change makes this fail, the lag was fixed.
  it("the lag does NOT go away by tuning qE", () => {
    const hi = scoreEstimator(v3({ qE: 10 }), { cases: 40, deficit: 60, gutPct: 0.005 });
    const lo = scoreEstimator(v3({ qE: 2 }), { cases: 40, deficit: 60, gutPct: 0.005 });
    expect(Math.abs(hi.bias - lo.bias)).toBeLessThan(3); // barely moves
    expect(lo.bias).toBeGreaterThan(1);                  // still lagging
  });

  // The band is set by qE, not by how good the data is — the other half of the v4 case.
  it("the band width barely responds to measurement precision", () => {
    const precise = scoreEstimator(v3(), { cases: 30, deficit: 45, sigmaW: 0.01, gutPct: 0.005 });
    const sloppy = scoreEstimator(v3(), { cases: 30, deficit: 45, sigmaW: 0.08, gutPct: 0.005 });
    expect(Math.abs(precise.halfWidth - sloppy.halfWidth) / precise.halfWidth).toBeLessThan(0.15);
  });
});

// v4 exists because of two measured v3 failures pinned above: a tracking lag no qE removes, and a
// band set by assumed drift rather than by the data. These lock in that v4 actually fixes both —
// if a future change regresses either, this fails rather than quietly shipping.
describe("v4 (allometric) vs v3, scored against known truth", () => {
  const v4 = (o = {}) => (w, i) => alloEstimateExpenditure(w, i, { priorKcal: 250, priorSdKcal: 60, ...o });
  // Mithril's measured profile: gut fill 0.42% of body mass, persistence 0.58, Litter-Robot at
  // ~6 reads/day — derived from ~150 real readings, see the project notes.
  const REAL = { gutPct: 0.0042, gutPhi: 0.58, sigmaW: 0.026, readsPerDay: 6, days: 56 };

  it("removes the lag on a LOSING cat (v3 reads high; v4 doesn't)", () => {
    const a = scoreEstimator(v3(), { cases: 60, deficit: 45, ...REAL });
    const b = scoreEstimator(v4(), { cases: 60, deficit: 45, ...REAL });
    expect(a.bias).toBeGreaterThan(2);          // v3 lags above the falling truth
    expect(Math.abs(b.bias)).toBeLessThan(1.5); // v4 predicts the fall instead of chasing it
  });

  it("removes the mirror lag on a GAINING cat", () => {
    const a = scoreEstimator(v3(), { cases: 60, deficit: -45, ...REAL });
    const b = scoreEstimator(v4(), { cases: 60, deficit: -45, ...REAL });
    expect(a.bias).toBeLessThan(-2);
    expect(Math.abs(b.bias)).toBeLessThan(1.5);
  });

  it("is more accurate, not just more confident", () => {
    const a = scoreEstimator(v3(), { cases: 60, deficit: 45, ...REAL });
    const b = scoreEstimator(v4(), { cases: 60, deficit: 45, ...REAL });
    expect(b.mae).toBeLessThan(a.mae * 0.8);
  });

  it("roughly halves the reported band", () => {
    const a = scoreEstimator(v3(), { cases: 40, deficit: 45, ...REAL });
    const b = scoreEstimator(v4(), { cases: 40, deficit: 45, ...REAL });
    expect(b.halfWidth).toBeLessThan(a.halfWidth * 0.65);
  });

  // The band is only worth halving if it's still honest. This is the test that matters most:
  // a narrower interval that under-covers is worse than a wide one, because it misleads.
  it("stays calibrated across other cats and scales — the default qK is chosen for THIS", () => {
    const r = scoreEstimator(v4(), { cases: 100, deficit: 45, days: 56, vary: { gutPct: [0.002, 0.015], sigmaW: [0.01, 0.08] } });
    expect(r.coverage).toBeGreaterThanOrEqual(90); // nominal 95; measured ~94
    expect(Math.abs(r.bias)).toBeLessThan(2);
  });

  it("a tighter qK would be over-confident — documenting why the default isn't smaller", () => {
    const tight = scoreEstimator(v4({ qK: 0.01 }), { cases: 100, deficit: 45, days: 56, vary: { gutPct: [0.002, 0.015], sigmaW: [0.01, 0.08] } });
    expect(tight.coverage).toBeLessThan(90); // narrower, but it starts lying
  });

  it("handles the degenerate inputs the real app will hand it", () => {
    expect(alloEstimateExpenditure([], []).enoughData).toBe(false);
    expect(alloEstimateExpenditure([{ date: "2026-01-01", value: 4.4 }], []).kcal).toBeNull();
    // a nonsense weight must not produce NaN — W^0.75 is undefined at or below zero
    const junk = [{ date: "2026-01-01", value: 0 }, { date: "2026-01-02", value: 0 }];
    const out = alloEstimateExpenditure(junk, [{ date: "2026-01-01", value: 200 }]);
    expect(out.kcal === null || Number.isFinite(out.kcal)).toBe(true);
  });

  it("reports a per-day trend series like every other estimator", () => {
    const sim = simulateCat({ ...REAL, deficit: 45 });
    const out = alloEstimateExpenditure(sim.weightEntries, sim.intakeEntries, { priorKcal: 250 });
    expect(out.trend.length).toBeGreaterThan(50);
    expect(out.trend.every((p) => Number.isFinite(p.e) && Number.isFinite(p.sd) && Number.isFinite(p.kg))).toBe(true);
  });
});
