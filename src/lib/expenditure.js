// Adaptive energy-expenditure estimate — "MacroFactor for cats".
//
// Energy balance: over a window, expenditure ≈ mean intake − ρ·(rate of weight change).
// We log what's *dispensed* (a constant grazing-leftover bias cancels out — see README),
// smooth the weight trend, and back-calculate the maintenance requirement the vet formula
// can only guess at.
//
// This is the v1 estimator: EWMA trend weight + OLS rate over a trailing window. The return
// shape (kcal + confidence band + enoughData) is stable, so a v2 Kalman / v3 unobserved-
// components model can replace the internals without touching callers. See README "The science".

import { median, mean, dailyReduce, fillDaily, ewma, linreg, addDays, diffDays, enumerateDays } from "./series.js";
import { matmul, transpose, matadd, symmetrize, diag, identity } from "./mat.js";

// Energy density of feline weight change. A cat in weight management moves mostly fat, so this
// skews higher than the human ~7700 kcal/kg (3500/lb) blended figure. Tunable.
export const KCAL_PER_KG = 8000;

export const DEFAULTS = { rho: KCAL_PER_KG, windowDays: 28, minDays: 10, alpha: 0.25, maxMissing: 0.5 };

// How a weigh-in was measured. `sigmaKg` is the rough per-reading measurement noise —
// captured now, and reserved for precision-weighting (WLS) in the v2 filter. Mixing
// methods risks a systematic between-method offset that looks like a weight jump, so the
// UI nudges toward picking one.
export const WEIGH_METHODS = {
  petScale:    { label: "Pet scale",     hint: "dedicated pet / baby scale",  sigmaKg: 0.01 },
  litterRobot: { label: "Litter-Robot",  hint: "read from the Whisker app",   sigmaKg: 0.03 },
  difference:  { label: "Scale − you",   hint: "you, then you + cat, subtract", sigmaKg: 0.15 },
  other:       { label: "Other",         hint: "",                            sigmaKg: 0.05 },
};
export const DEFAULT_METHOD = "petScale";

// How the reading got into the app.
export const WEIGH_SOURCES = { manual: "manual", litterRobot: "litter-robot" };

// weightEntries: [{ date, value: kg }]   intakeEntries: [{ date, value: kcal }]
// (multiple per day are fine — weight is median-reduced, intake summed.)
export function estimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const { rho, windowDays, minDays, alpha, maxMissing } = { ...DEFAULTS, ...opts };

  const dailyW = dailyReduce(weightEntries, median);
  const dailyI = dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0));

  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dailyW.length ? dailyW[dailyW.length - 1].value : null,
    rateKgPerWeek: null, ratePctPerWeek: null, nDays: dailyW.length, missingIntake: null, trend: [] };
  if (dailyW.length < 2) return empty;

  const last = dailyW[dailyW.length - 1].date;
  const span = diffDays(dailyW[0].date, last) + 1;
  const winStart = addDays(last, -(Math.min(windowDays, span) - 1));

  // Weight: fill to a daily grid over the window and fit a line for the rate (kg/day).
  const wWin = dailyW.filter((d) => d.date >= winStart);
  if (wWin.length < 2) return { ...empty, trendWeightKg: dailyW[dailyW.length - 1].value };
  const wFilled = fillDaily(wWin, "interp");
  const ys = wFilled.map((d) => d.value);
  const { slope, slopeSE } = linreg(ys);            // kg per day (negative = losing)
  const trendSeries = ewma(ys, alpha);
  const trendWeightKg = trendSeries[trendSeries.length - 1];

  // Intake: mean over the days we actually logged in the window; track how sparse it was.
  const winDays = enumerateDays(winStart, last);
  const iByDay = new Map(dailyI.map((d) => [d.date, d.value]));
  const present = winDays.filter((d) => iByDay.has(d));
  const missingIntake = 1 - present.length / winDays.length;
  const meanIntake = mean(present.map((d) => iByDay.get(d)));

  const kcal = meanIntake - rho * slope;            // − because slope<0 during loss raises expenditure
  const sd = rho * (Number.isFinite(slopeSE) ? slopeSE : 0); // rate uncertainty dominates the band
  const rateKgPerWeek = slope * 7;
  const ratePctPerWeek = trendWeightKg > 0 ? (rateKgPerWeek / trendWeightKg) * 100 : 0;

  const enoughData = span >= minDays && present.length >= 2 && missingIntake <= maxMissing;

  return {
    enoughData, kcal, sd, low: kcal - 1.96 * sd, high: kcal + 1.96 * sd,
    trendWeightKg, rateKgPerWeek, ratePctPerWeek, nDays: span, missingIntake,
    trend: wFilled.map((d, i) => ({ date: d.date, kg: trendSeries[i] })),
  };
}

/* ==================== v2: Kalman-filter estimator ==================== */
// A 2-state Kalman filter over the same energy balance, state x = [W, E]:
//   W_k = W_{k-1} + (I_k − E_{k-1})/ρ        (weight follows the energy balance)
//   E_k = E_{k-1} + noise                     (expenditure drifts slowly — a random walk)
// Measurement is the day's weight, z = W + noise. This gives, for free, a confidence band
// (√P[E,E]) that tightens with data, robustness to a bad weigh-in, and — crucially — it
// weights each day by its measurement precision (from the weigh-in method). The prediction-
// error → estimate update is the same recursive shape MacroFactor describes; see README.

const sigmaFor = (method) => (WEIGH_METHODS[method] || WEIGH_METHODS[DEFAULT_METHOD]).sigmaKg;

// Collapse a day's weigh-ins to one measurement (z) and its variance (R), inverse-variance
// weighting by each reading's method precision, after gating gross outliers off the median.
export function dailyWeightWithVariance(entries, { outlierKg = 0.2 } = {}) {
  const byDay = new Map();
  for (const e of entries) {
    if (!e || e.date == null || e.value == null || Number.isNaN(Number(e.value))) continue;
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push({ kg: Number(e.value), sigma: sigmaFor(e.method) });
  }
  const out = [];
  for (const [date, reads] of byDay) {
    const med = median(reads.map((r) => r.kg));
    const kept = reads.filter((r) => Math.abs(r.kg - med) <= outlierKg);
    const use = kept.length ? kept : reads;
    let wsum = 0, psum = 0;
    for (const r of use) { const prec = 1 / (r.sigma * r.sigma); wsum += r.kg * prec; psum += prec; }
    out.push({ date, z: wsum / psum, R: 1 / psum, n: use.length });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// qE (kcal/day)²/day is the stability↔responsiveness knob: larger = tracks real changes
// faster but noisier. Cats drift slowly, so it's set low. priorKcal seeds E from the vet
// formula (the cold start), with a wide priorSd so data quickly takes over.
// maxJumpKg gates physically impossible day-over-day swings (a spurious single reading):
// real feline weight change is < ~15 g/day even on an aggressive plan, and gut-fill swings
// are smaller than this, so anything past it is a bad read and skips the update.
export const KALMAN_DEFAULTS = { rho: KCAL_PER_KG, qW: 1e-5, qE: 2.0, priorKcal: 200, priorSdKcal: 120, minDays: 10, maxMissing: 0.5, recentIntakeDays: 7, maxJumpKg: 0.3 };

export function kalmanEstimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const P = { ...KALMAN_DEFAULTS, ...opts };
  const rho = P.rho;
  const dW = dailyWeightWithVariance(weightEntries);
  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dW.length ? dW[dW.length - 1].z : null, rateKgPerWeek: null, ratePctPerWeek: null,
    nDays: dW.length, missingIntake: null, trend: [] };
  if (dW.length < 2) return empty;

  const first = dW[0].date, last = dW[dW.length - 1].date;
  const days = enumerateDays(first, last);
  const dailyI = dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0));
  const iByDay = new Map(dailyI.map((d) => [d.date, d.value]));
  const present = days.filter((d) => iByDay.has(d));
  const missingIntake = 1 - present.length / days.length;
  const meanI = present.length ? mean(present.map((d) => iByDay.get(d))) : 0;
  const intakeOn = (d) => (iByDay.has(d) ? iByDay.get(d) : meanI); // impute gaps with the mean
  const wByDay = new Map(dW.map((d) => [d.date, d]));

  const F = [[1, -1 / rho], [0, 1]];
  const Q = [[P.qW, 0], [0, P.qE]];
  let x = [wByDay.get(first).z, P.priorKcal];
  let Pcov = [[wByDay.get(first).R, 0], [0, P.priorSdKcal * P.priorSdKcal]];
  const trend = [{ date: first, kg: x[0], e: x[1], sd: Math.sqrt(Pcov[1][1]) }];

  for (let k = 1; k < days.length; k++) {
    const d = days[k];
    // predict
    const xPred = [x[0] + (intakeOn(d) - x[1]) / rho, x[1]];
    const Ppred = matadd(matmul(matmul(F, Pcov), transpose(F)), Q);
    // update on a scalar weight measurement (H = [1, 0]) when we have one that isn't a
    // physically impossible jump from where we expect her to be
    const meas = wByDay.get(d);
    if (meas && Math.abs(meas.z - xPred[0]) <= P.maxJumpKg) {
      const { z, R } = meas;
      const S = Ppred[0][0] + R;
      const K0 = Ppred[0][0] / S, K1 = Ppred[1][0] / S;
      const y = z - xPred[0]; // innovation = the prediction error
      x = [xPred[0] + K0 * y, xPred[1] + K1 * y];
      Pcov = symmetrize([
        [(1 - K0) * Ppred[0][0], (1 - K0) * Ppred[0][1]],
        [Ppred[1][0] - K1 * Ppred[0][0], Ppred[1][1] - K1 * Ppred[0][1]],
      ]);
    } else {
      x = xPred; Pcov = Ppred; // no reading, or a rejected outlier → prediction only
    }
    trend.push({ date: d, kg: x[0], e: x[1], sd: Math.sqrt(Pcov[1][1]) });
  }

  const kcal = x[1];
  const sd = Math.sqrt(Pcov[1][1]);
  const recent = present.slice(-P.recentIntakeDays);
  const recentI = recent.length ? mean(recent.map((d) => iByDay.get(d))) : meanI;
  const rateKgPerWeek = ((recentI - kcal) / rho) * 7;
  const trendWeightKg = x[0];
  const ratePctPerWeek = trendWeightKg > 0 ? (rateKgPerWeek / trendWeightKg) * 100 : 0;
  const span = diffDays(first, last) + 1;
  const enoughData = span >= P.minDays && present.length >= 2 && missingIntake <= P.maxMissing;

  return { enoughData, kcal, sd, low: kcal - 1.96 * sd, high: kcal + 1.96 * sd,
    trendWeightKg, rateKgPerWeek, ratePctPerWeek, nDays: span, missingIntake, trend };
}

/* ==================== v3: unobserved-components estimator ==================== */
// v2 conflates gut-fill/hydration swings with sensor noise, so they either corrupt the
// expenditure estimate or force qE down (sluggish). v3 adds a third state T — a latent,
// mean-reverting transient (the shared daily gut/hydration offset that averaging reads
// can't remove) — so the filter can attribute a bump to T (which decays) instead of E.
// state x = [W, E, T]:  W_k = W + (I−E)/ρ ;  E_k = E + drift ;  T_k = φ·T + drift
// measurement z = W + T + sensor noise  →  H = [1, 0, 1].
// Because T soaks up the transient, qE can be raised for responsiveness without jitter —
// the "stable AND responsive" shift. Parameters tuned in research/v3_expenditure.py.
export const V3_DEFAULTS = {
  rho: KCAL_PER_KG, qW: 1e-5, qE: 10, qT: 0.0025, phi: 0.5,
  priorKcal: 200, priorSdKcal: 120, transientSd0: 0.06,
  minDays: 10, maxMissing: 0.5, recentIntakeDays: 7, maxJumpKg: 0.3,
};

export function ucEstimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const P = { ...V3_DEFAULTS, ...opts };
  const rho = P.rho;
  const dW = dailyWeightWithVariance(weightEntries);
  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dW.length ? dW[dW.length - 1].z : null, rateKgPerWeek: null, ratePctPerWeek: null,
    nDays: dW.length, missingIntake: null, trend: [] };
  if (dW.length < 2) return empty;

  const first = dW[0].date, last = dW[dW.length - 1].date;
  const days = enumerateDays(first, last);
  const dailyI = dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0));
  const iByDay = new Map(dailyI.map((d) => [d.date, d.value]));
  const present = days.filter((d) => iByDay.has(d));
  const missingIntake = 1 - present.length / days.length;
  const meanI = present.length ? mean(present.map((d) => iByDay.get(d))) : 0;
  const intakeOn = (d) => (iByDay.has(d) ? iByDay.get(d) : meanI);
  const wByDay = new Map(dW.map((d) => [d.date, d]));

  const F = [[1, -1 / rho, 0], [0, 1, 0], [0, 0, P.phi]];
  const Q = diag([P.qW, P.qE, P.qT]);
  const H = [1, 0, 1];
  let x = [wByDay.get(first).z, P.priorKcal, 0];
  let Pcov = diag([wByDay.get(first).R, P.priorSdKcal * P.priorSdKcal, P.transientSd0 * P.transientSd0]);
  const trend = [{ date: first, kg: x[0], e: x[1], sd: Math.sqrt(Pcov[1][1]) }];

  for (let k = 1; k < days.length; k++) {
    const d = days[k];
    // predict: x⁻ = F x + B u  (B u adds intake/ρ to W)
    const xPred = [x[0] - x[1] / rho + intakeOn(d) / rho, x[1], P.phi * x[2]];
    const Ppred = matadd(matmul(matmul(F, Pcov), transpose(F)), Q);
    const zPred = xPred[0] + xPred[2]; // H x⁻
    const meas = wByDay.get(d);
    if (meas && Math.abs(meas.z - zPred) <= P.maxJumpKg) {
      const { z, R } = meas;
      // scalar measurement: S = H P Hᵀ + R ; PHt = P Hᵀ (H = [1,0,1])
      const PHt = [Ppred[0][0] + Ppred[0][2], Ppred[1][0] + Ppred[1][2], Ppred[2][0] + Ppred[2][2]];
      const S = PHt[0] + PHt[2] + R;
      const K = PHt.map((v) => v / S);
      const y = z - zPred;
      x = xPred.map((xi, i) => xi + K[i] * y);
      const ImKH = identity(3).map((row, i) => row.map((v, j) => v - K[i] * H[j]));
      Pcov = symmetrize(matmul(ImKH, Ppred));
    } else {
      x = xPred; Pcov = Ppred;
    }
    trend.push({ date: d, kg: x[0], e: x[1], sd: Math.sqrt(Pcov[1][1]) }); // report the de-transiented trend weight
  }

  const kcal = x[1];
  const sd = Math.sqrt(Pcov[1][1]);
  const recent = present.slice(-P.recentIntakeDays);
  const recentI = recent.length ? mean(recent.map((d) => iByDay.get(d))) : meanI;
  const rateKgPerWeek = ((recentI - kcal) / rho) * 7;
  const trendWeightKg = x[0];
  const ratePctPerWeek = trendWeightKg > 0 ? (rateKgPerWeek / trendWeightKg) * 100 : 0;
  const span = diffDays(first, last) + 1;
  const enoughData = span >= P.minDays && present.length >= 2 && missingIntake <= P.maxMissing;

  return { enoughData, kcal, sd, low: kcal - 1.96 * sd, high: kcal + 1.96 * sd,
    trendWeightKg, rateKgPerWeek, ratePctPerWeek, nDays: span, missingIntake, trend };
}
