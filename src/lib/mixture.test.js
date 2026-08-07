import { describe, it, expect } from "vitest";
import {
  mixtureEstimateExpenditure, alloEstimateExpenditure, mixtureMoments, mixtureQuantile, V5_GRID,
} from "./expenditure.js";
import { simulateCat, scoreEstimator } from "./simCat.js";

const OPTS = { priorKcal: 250, priorSdKcal: 60 };
const REAL = { gutPct: 0.0042, gutPhi: 0.58, sigmaW: 0.026, readsPerDay: 6, days: 56 };

describe("mixture arithmetic", () => {
  it("law of total variance: spread BETWEEN components counts, not just within", () => {
    const same = mixtureMoments([{ w: 1, kcal: 200, sd: 10 }, { w: 1, kcal: 200, sd: 10 }]);
    expect(same.sd).toBeCloseTo(10, 6); // identical components -> unchanged
    const apart = mixtureMoments([{ w: 1, kcal: 190, sd: 10 }, { w: 1, kcal: 210, sd: 10 }]);
    expect(apart.kcal).toBeCloseTo(200, 6);
    expect(apart.sd).toBeCloseTo(Math.sqrt(100 + 100), 6); // 10^2 within + 10^2 between
  });

  it("weights are honoured", () => {
    const m = mixtureMoments([{ w: 3, kcal: 200, sd: 5 }, { w: 1, kcal: 240, sd: 5 }]);
    expect(m.kcal).toBeCloseTo(210, 6);
  });

  it("a single component reduces to plain Gaussian quantiles", () => {
    const one = [{ w: 1, kcal: 200, sd: 10 }];
    expect(mixtureQuantile(one, 0.025)).toBeCloseTo(200 - 1.96 * 10, 0);
    expect(mixtureQuantile(one, 0.975)).toBeCloseTo(200 + 1.96 * 10, 0);
    expect(mixtureQuantile(one, 0.5)).toBeCloseTo(200, 1);
  });

  // The reason the quantile function exists: for a mixture, mean ± 1.96·sd is NOT the 95% interval,
  // and using it would quietly reimpose the Gaussian assumption v5 is there to remove.
  it("a mixture's 95% interval is NOT mean ± 1.96·sd", () => {
    const c = [{ w: 1, kcal: 200, sd: 3 }, { w: 1, kcal: 200, sd: 30 }]; // sharp + diffuse
    const m = mixtureMoments(c);
    const lo = mixtureQuantile(c, 0.025);
    expect(Math.abs(lo - (m.kcal - 1.96 * m.sd))).toBeGreaterThan(1);
  });

  it("degenerate input doesn't produce NaN", () => {
    expect(mixtureMoments([])).toBeNull();
    expect(mixtureQuantile([], 0.5)).toBeNull();
  });
});

describe("v5 marginalises rather than asserting hyperparameters", () => {
  const sim = () => simulateCat({ ...REAL, deficit: 45, seed: 4242 });

  it("returns a mixture with one component per grid point", () => {
    const s = sim();
    const r = mixtureEstimateExpenditure(s.weightEntries, s.intakeEntries, OPTS);
    expect(r.mixture.length).toBe(V5_GRID.qK.length * V5_GRID.phi.length * V5_GRID.rScale.length);
    expect(r.mixture.every((c) => c.w > 0 && c.sd > 0)).toBe(true);
  });

  it("is wider than v4, because uncertainty about the model is now included", () => {
    const s = sim();
    const a = alloEstimateExpenditure(s.weightEntries, s.intakeEntries, OPTS);
    const b = mixtureEstimateExpenditure(s.weightEntries, s.intakeEntries, OPTS);
    expect(b.high - b.low).toBeGreaterThan(a.high - a.low);
    expect(b.kcal).toBeCloseTo(a.kcal, 0); // but centred in the same place
  });

  it("the evidence recovers a hyperparameter it was not told — persistence", () => {
    // data generated with phi 0.58; the weighting should favour the grid's nearby values
    const s = simulateCat({ ...REAL, gutPhi: 0.55, deficit: 45, seed: 99 });
    const r = mixtureEstimateExpenditure(s.weightEntries, s.intakeEntries, OPTS);
    expect(r.thetaBest.phi).toBeGreaterThanOrEqual(0.3);
  });

  it("the answer is not an artifact of where the grid edges are", () => {
    const s = sim();
    const a = mixtureEstimateExpenditure(s.weightEntries, s.intakeEntries, OPTS);
    const b = mixtureEstimateExpenditure(s.weightEntries, s.intakeEntries, {
      ...OPTS, grid: { qK: [0.005, ...V5_GRID.qK], rScale: [0.12, ...V5_GRID.rScale] },
    });
    expect(Math.abs(a.low - b.low)).toBeLessThan(5);
    expect(Math.abs(a.high - b.high)).toBeLessThan(5);
  });

  it("still reports everything the app needs from an estimator", () => {
    const s = sim();
    const r = mixtureEstimateExpenditure(s.weightEntries, s.intakeEntries, OPTS);
    for (const k of ["enoughData", "kcal", "sd", "low", "high", "trend", "trendWeightKg", "nDays"]) {
      expect(r[k], `missing ${k}`).not.toBeUndefined();
    }
    expect(r.low).toBeLessThan(r.kcal);
    expect(r.high).toBeGreaterThan(r.kcal);
  });

  it("degrades to v4 rather than throwing when there's nothing to fit", () => {
    expect(mixtureEstimateExpenditure([], []).enoughData).toBe(false);
  });
});

// The whole justification for paying v5's extra width. v4 is already nominal when the model is
// RIGHT — so v5 only earns its keep where v4's assumptions fail, which is exactly where an
// over-confident band would mislead.
describe("v5 is insurance: it holds up where v4's assumptions break", () => {
  const cases = 30;
  const v4 = (w, i) => alloEstimateExpenditure(w, i, OPTS);
  const v5 = (w, i) => mixtureEstimateExpenditure(w, i, OPTS);

  it("gut fill 3x bigger than assumed: v4 under-covers badly, v5 doesn't", () => {
    const cfg = { cases, deficit: 45, days: 56, gutPct: 0.015, gutPhi: 0.8, sigmaW: 0.026, readsPerDay: 6 };
    expect(scoreEstimator(v4, cfg).coverage).toBeLessThan(90);
    expect(scoreEstimator(v5, cfg).coverage).toBeGreaterThan(90);
  });

  it("drift that isn't allometric at all: v5 recovers a chunk of the lost coverage", () => {
    const cfg = { cases, drift: "randomWalk", driftSd: 3.2, deficit: 20, days: 56, ...REAL };
    const a = scoreEstimator(v4, cfg), b = scoreEstimator(v5, cfg);
    expect(b.coverage).toBeGreaterThan(a.coverage + 5);
  });

  it("when the model IS right, v5 is merely conservative — never worse-centred", () => {
    const cfg = { cases, deficit: 45, ...REAL };
    const a = scoreEstimator(v4, cfg), b = scoreEstimator(v5, cfg);
    expect(b.coverage).toBeGreaterThanOrEqual(a.coverage - 2);
    expect(Math.abs(b.bias)).toBeLessThan(2);
  });
});
