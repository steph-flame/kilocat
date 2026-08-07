import { describe, it, expect } from "vitest";
import {
  mixtureEstimateExpenditure, alloEstimateExpenditure, mixtureMoments, mixtureQuantile,
  withIntakeUncertainty, ucEstimateExpenditure, V5_GRID,
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

// A skewed posterior has more than one defensible "95% interval". We report the CENTRAL
// (equal-tailed) one: 2.5% of the mass below, 2.5% above. The alternative is HPD — the shortest
// interval holding 95% — which sits off-centre on a skewed posterior and is narrower. Central is
// the choice because it reads plainly ("2.5% chance she's under this") and is monotone under
// reparameterisation, so it can't be gamed by rescaling. These pin the convention.
describe("the reported interval is the CENTRAL 95%", () => {
  const normCdf = (z) => {
    const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp((-z * z) / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  };
  const cdfAt = (comps, v) => {
    const W = comps.reduce((a, c) => a + c.w, 0);
    return comps.reduce((a, c) => a + (c.w / W) * normCdf((v - c.kcal) / c.sd), 0);
  };
  // deliberately skewed: a sharp component plus a diffuse one displaced to one side
  const skewed = [{ w: 3, kcal: 200, sd: 6 }, { w: 1, kcal: 250, sd: 25 }];

  it("puts 2.5% of the mass in each tail", () => {
    expect(cdfAt(skewed, mixtureQuantile(skewed, 0.025))).toBeCloseTo(0.025, 3);
    expect(cdfAt(skewed, mixtureQuantile(skewed, 0.975))).toBeCloseTo(0.975, 3);
  });

  it("is genuinely asymmetric about the mean when the posterior is skewed", () => {
    const m = mixtureMoments(skewed);
    const lo = mixtureQuantile(skewed, 0.025), hi = mixtureQuantile(skewed, 0.975);
    expect(hi - m.kcal).toBeGreaterThan((m.kcal - lo) * 1.2); // the long tail is the upper one
  });

  it("is NOT the same as mean ± 1.96·sd — that would be the symmetric approximation", () => {
    const m = mixtureMoments(skewed);
    expect(Math.abs(mixtureQuantile(skewed, 0.975) - (m.kcal + 1.96 * m.sd))).toBeGreaterThan(1);
  });
});

describe("intake uncertainty must not flatten an asymmetric posterior", () => {
  const OPTS2 = { priorKcal: 250, priorSdKcal: 60 };
  const sim = simulateCat({ days: 56, deficit: 45, gutPct: 0.0042, gutPhi: 0.58, sigmaW: 0.026, readsPerDay: 6, seed: 77 });

  it("keeps the mixture and re-derives the quantiles rather than overwriting them", () => {
    const raw = mixtureEstimateExpenditure(sim.weightEntries, sim.intakeEntries, OPTS2);
    const wide = withIntakeUncertainty(raw, 215, 0.05);
    expect(wide.mixture).toBeTruthy();
    expect(wide.mixture.length).toBe(raw.mixture.length);
    // every component widened by the same independent variance
    wide.mixture.forEach((c, i) => {
      expect(c.sd).toBeCloseTo(Math.sqrt(raw.mixture[i].sd ** 2 + (0.05 * 215) ** 2), 6);
    });
    expect(wide.high - wide.low).toBeGreaterThan(raw.high - raw.low);
  });

  it("the widened interval is still the central 95%, not mean ± 1.96·sd", () => {
    const wide = withIntakeUncertainty(
      mixtureEstimateExpenditure(sim.weightEntries, sim.intakeEntries, OPTS2), 215, 0.05);
    const sym = { lo: wide.kcal - 1.96 * wide.sd, hi: wide.kcal + 1.96 * wide.sd };
    // they may be close, but the reported bounds come from the CDF, not from the moments
    expect(wide.low).toBeCloseTo(mixtureQuantile(wide.mixture, 0.025), 6);
    expect(wide.high).toBeCloseTo(mixtureQuantile(wide.mixture, 0.975), 6);
    expect(Number.isFinite(sym.lo)).toBe(true);
  });

  it("widens the per-day trend band too, so the timeline matches the headline", () => {
    const raw = mixtureEstimateExpenditure(sim.weightEntries, sim.intakeEntries, OPTS2);
    const wide = withIntakeUncertainty(raw, 215, 0.05);
    expect(wide.trend[wide.trend.length - 1].sd).toBeGreaterThan(raw.trend[raw.trend.length - 1].sd);
  });

  it("a non-mixture result still gets the plain symmetric treatment", () => {
    const v4r = alloEstimateExpenditure(sim.weightEntries, sim.intakeEntries, OPTS2);
    const wide = withIntakeUncertainty(v4r, 215, 0.05);
    expect(wide.mixture).toBeUndefined();
    expect(wide.kcal - wide.low).toBeCloseTo(wide.high - wide.kcal, 6); // Gaussian: symmetric
  });
});

// Reported by Steph: the estimate card said 204 while the timeline's last point said 210. For v5
// the headline was the weighted MIXTURE mean but `trend` came from the single best-fitting
// component — two different quantities on one screen. The chart is meant to be the evidence for the
// headline, so its final point has to BE the headline.
describe("the timeline's last point IS the headline", () => {
  const OPTS3 = { priorKcal: 250, priorSdKcal: 60 };
  const sim = simulateCat({ days: 56, deficit: 45, gutPct: 0.0042, gutPhi: 0.58, sigmaW: 0.026, readsPerDay: 6, seed: 31 });
  const run = (fn) => fn(sim.weightEntries, sim.intakeEntries, OPTS3);

  for (const [name, fn] of [
    ["v3", ucEstimateExpenditure],
    ["v4", alloEstimateExpenditure],
    ["v5", mixtureEstimateExpenditure],
  ]) {
    it(`${name}: final trend point matches the reported estimate and sd`, () => {
      const r = run(fn);
      const last = r.trend[r.trend.length - 1];
      expect(last.e).toBeCloseTo(r.kcal, 6);
      expect(last.sd).toBeCloseTo(r.sd, 6);
    });

    it(`${name}: still matches after intake uncertainty widens both`, () => {
      const r = withIntakeUncertainty(run(fn), 215, 0.05);
      const last = r.trend[r.trend.length - 1];
      expect(last.e).toBeCloseTo(r.kcal, 6);
      expect(last.sd).toBeCloseTo(r.sd, 6);
    });
  }

  it("v5's timeline is the mixture, not the best component's path", () => {
    const r = run(mixtureEstimateExpenditure);
    const best = r.mixture.reduce((a, c) => (c.w > a.w ? c : a), r.mixture[0]);
    // the mixture sd exceeds any single component's, because it includes the spread BETWEEN them
    expect(r.sd).toBeGreaterThan(best.sd);
    expect(r.trend[r.trend.length - 1].sd).toBeGreaterThan(best.sd);
  });

  it("every day of the series is finite — no holes from a component that failed to fit", () => {
    const r = run(mixtureEstimateExpenditure);
    expect(r.trend.every((p) => Number.isFinite(p.e) && Number.isFinite(p.sd) && Number.isFinite(p.kg))).toBe(true);
  });
});
