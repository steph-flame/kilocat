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

import { median, mean, dailyReduce, fillDaily, ewma, linregXY, addDays, diffDays, enumerateDays } from "./series.js";
import { matmul, transpose, matadd, symmetrize, diag, identity } from "./mat.js";

// Energy density of feline weight change (ρ), kcal per kg. There is NO directly measured
// feline value — no cat analogue of the human 7,700 kcal/kg (3,500/lb) rule. It's INFERRED
// from DEXA body-composition studies (feline weight loss is ~73–86% fat: Opetz 2023,
// German 2008) × per-tissue energy densities (fat ~9,440, lean ~1,816 kcal/kg; Hall 2008),
// giving ~7,400–8,350 kcal/kg. That brackets the human figure and leans slightly higher,
// because clinical (high-protein) feline loss is more fat-dominated. 7800 is chosen simply
// because it's near the CENTRE of that inferred range (8000 is also defensible for strongly
// fat-sparing diets). Note ρ's effect on a measured-basis loss target nearly cancels: a
// lower ρ shrinks the prescribed deficit (raises the target) but also lowers the *estimated*
// maintenance (lowers it) — net target ≈ mean intake + ρ·(observed − target rate), so ρ
// barely moves it. The "lower ρ = gentler target" shortcut only holds for a FIXED (vet-
// formula) maintenance, i.e. the cold start. NB: gaining weight
// costs MORE per kg (tissue synthesis is only ~60–80% efficient), but that extra heat lands
// in the ESTIMATED expenditure via the energy balance, so ρ stays the tissue density for
// both directions. Citations in the README. Tunable.
export const KCAL_PER_KG = 7800;

export const DEFAULTS = { rho: KCAL_PER_KG, windowDays: 28, minDays: 10, alpha: 0.25, maxMissing: 0.5 };
const V1_WEIGHT_SIGMA = 0.03; // kg, a per-weigh-in noise floor so the v1 band can't read ±0

/* ==================== intake day-status seam ==================== */
// Three states, previously conflated: (a) no entries logged that day — already imputed by
// every estimator below (excluded from the mean / filled from it); (b) a true zero-intake
// day (cat fasted/refused food) — an explicit 0-kcal entry, which sums to 0 and is REAL data,
// not missing; (c) a partially-logged day (some meals logged, some forgotten) — silently read
// as a complete low-intake day and biased the estimate downward, with no way to say "don't
// trust this one."
//
// `flags` is a cat's intakeDayStatus map: { "YYYY-MM-DD": "incomplete" } (the only status that
// exists so far — absent for a day means "trust the entries as logged"). This is the single
// seam every estimator below reads through instead of building iByDay from raw entries
// directly: a day's value is the sum of its entries UNLESS that day is flagged, in which case
// it's dropped entirely so it's indistinguishable from a day with no entries at all — the
// existing imputation (mean-fill / exclusion) picks it up exactly like any other missing day.
// A flag on a day with no entries is harmless: there's nothing in `daily` to drop.
//
// `excludeDay` (typically the caller's local "today") drops one further day unconditionally —
// same treatment as a flagged-incomplete day — because a day that's still being logged reads,
// morning after morning, as a complete low-intake day: partial-so-far totals bias every
// estimator downward until the day ends, then "recover" overnight, a daily oscillation that's
// pure artifact, not signal. An explicit 0-kcal "nothing eaten" entry dated `excludeDay` is
// excluded too (the day could still gain a meal before it's done) — it starts counting the
// day after. This is orthogonal to `flags`: a past day can be BOTH flagged incomplete and (if
// somehow also excludeDay) excluded — either reason drops it.
export function buildIntakeDayMap(intakeEntries, flags = {}, excludeDay = null) {
  const daily = dailyReduce(intakeEntries, (v) => v.reduce((a, b) => a + b, 0));
  const map = new Map();
  for (const { date, value } of daily) {
    if (flags && flags[date] === "incomplete") continue; // treated as missing, not zero
    if (excludeDay && date === excludeDay) continue; // in-progress day — not a complete day yet
    map.set(date, value);
  }
  return map;
}

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
  const { rho, windowDays, minDays, alpha, maxMissing, intakeDayStatus, excludeDay } = { ...DEFAULTS, ...opts };

  // Drop the in-progress day's weigh-ins too (not just its intake): today's day isn't complete, and
  // a fresh endpoint — especially the Litter-Robot's many auto-reads — otherwise jitters the fit all
  // day. The estimate settles on complete days; the live weight display still uses today's reading.
  const wEntries = excludeDay ? weightEntries.filter((e) => e.date !== excludeDay) : weightEntries;
  const dailyW = dailyReduce(wEntries, median);

  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dailyW.length ? dailyW[dailyW.length - 1].value : null,
    rateKgPerWeek: null, ratePctPerWeek: null, nDays: dailyW.length, missingIntake: null, trend: [] };
  if (dailyW.length < 2) return empty;

  const last = dailyW[dailyW.length - 1].date;
  const span = diffDays(dailyW[0].date, last) + 1;
  const winStart = addDays(last, -(Math.min(windowDays, span) - 1));

  // Weight: fit the rate (kg/day) on the REAL weigh-ins (against their day offsets), not the
  // interpolated grid — otherwise imputed points sit exactly on the fit and collapse the SE to
  // ~0, giving false certainty. Floor the SE by a measurement-noise term so a couple of points
  // can never read ±0.
  const wWin = dailyW.filter((d) => d.date >= winStart);
  if (wWin.length < 2) return { ...empty, trendWeightKg: dailyW[dailyW.length - 1].value };
  const xs = wWin.map((d) => diffDays(winStart, d.date));
  const { slope, slopeSE: rawSE } = linregXY(xs, wWin.map((d) => d.value)); // kg/day (neg = losing)
  const spanDays = Math.max(1, xs[xs.length - 1] - xs[0]);
  const seFloor = (V1_WEIGHT_SIGMA * Math.SQRT2) / spanDays;  // endpoint-noise slope SE
  const slopeSE = Math.max(Number.isFinite(rawSE) ? rawSE : 0, seFloor);
  const wFilled = fillDaily(wWin, "interp");         // smoothed weight for the display trend line
  const trendSeries = ewma(wFilled.map((d) => d.value), alpha);
  const trendWeightKg = trendSeries[trendSeries.length - 1];

  // Intake: mean over the days we actually logged in the window; track how sparse it was.
  const winDays = enumerateDays(winStart, last);
  const iByDay = buildIntakeDayMap(intakeEntries, intakeDayStatus, excludeDay);
  // missingIntake counts genuine logging gaps, not the excluded in-progress day (that day is
  // ALWAYS missing from iByDay by construction, every single calculation — counting it would
  // permanently inflate the "% of days imputed" the UI shows, for a reason that has nothing to
  // do with the owner's logging habits).
  const countedDays = excludeDay ? winDays.filter((d) => d !== excludeDay) : winDays;
  const present = countedDays.filter((d) => iByDay.has(d));
  const missingIntake = countedDays.length ? 1 - present.length / countedDays.length : 0;
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

/* ==================== display-only uncertainty floor ==================== */
// This does NOT touch any estimator's internal covariances/priors (qE, priorSdKcal, etc. —
// those stay as tuned, and keep governing the actual filter math the convergence tests pin).
// It's purely for what the page RENDERS before enoughData: with 0–1 weigh-ins the filters
// haven't produced an sd at all (kcal/sd are null), and the vet formula being shown in their
// place is itself only accurate to something like ±15% across the general cat population —
// so a UI that displayed "no band" (or a falsely tight one) at day zero would be lying by
// omission. floorSdKcal supplies a floor for the DISPLAYED sd only: full width
// (±floorPct of the prior, at 95%) at zero logged days, linearly decaying to inactive (0) by
// the time nDays reaches the enoughData threshold — at and after that point the filter's own
// (already-converged, and typically already wider than this floor) sd stands on its own.
export function floorSdKcal(nDays, priorKcal, { floorPct = 0.15, threshold = 10 } = {}) {
  if (!(priorKcal > 0) || !(threshold > 0)) return 0;
  const full = (floorPct * priorKcal) / 1.96; // sd whose 95% band is ± floorPct of the prior
  const n = Math.max(0, Number(nDays) || 0);
  if (n >= threshold) return 0;
  return full * (1 - n / threshold);
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
export const KALMAN_DEFAULTS = { rho: KCAL_PER_KG, qW: 1e-5, qE: 2.0, priorKcal: 200, priorSdKcal: 120, minDays: 10, maxMissing: 0.5, recentIntakeDays: 7, maxJumpKg: 0.3, maxReject: 3 };

export function kalmanEstimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const P = { ...KALMAN_DEFAULTS, ...opts };
  const rho = P.rho;
  const wEntries = P.excludeDay ? weightEntries.filter((e) => e.date !== P.excludeDay) : weightEntries; // exclude the in-progress day's weigh-ins (see v1)
  const dW = dailyWeightWithVariance(wEntries);
  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dW.length ? dW[dW.length - 1].z : null, rateKgPerWeek: null, ratePctPerWeek: null,
    nDays: dW.length, missingIntake: null, trend: [] };
  if (dW.length < 2) return empty;

  const first = dW[0].date, last = dW[dW.length - 1].date;
  const days = enumerateDays(first, last);
  const iByDay = buildIntakeDayMap(intakeEntries, P.intakeDayStatus, P.excludeDay);
  // See the v1 comment above: the excluded in-progress day is dropped from the missingIntake
  // denominator too, so it never permanently inflates the displayed "% imputed".
  const countedDays = P.excludeDay ? days.filter((d) => d !== P.excludeDay) : days;
  const present = countedDays.filter((d) => iByDay.has(d));
  const missingIntake = countedDays.length ? 1 - present.length / countedDays.length : 0;
  const meanI = present.length ? mean(present.map((d) => iByDay.get(d))) : 0;
  const intakeOn = (d) => (iByDay.has(d) ? iByDay.get(d) : meanI); // impute gaps with the mean
  const wByDay = new Map(dW.map((d) => [d.date, d]));

  const F = [[1, -1 / rho], [0, 1]];
  const Q = [[P.qW, 0], [0, P.qE]];
  let x = [wByDay.get(first).z, P.priorKcal];
  let Pcov = [[wByDay.get(first).R, 0], [0, P.priorSdKcal * P.priorSdKcal]];
  const trend = [{ date: first, kg: x[0], e: x[1], sd: Math.sqrt(Pcov[1][1]) }];
  let lastAcceptK = 0, rejects = 0, accepted = 0;

  for (let k = 1; k < days.length; k++) {
    const d = days[k];
    // predict
    const xPred = [x[0] + (intakeOn(d) - x[1]) / rho, x[1]];
    const Ppred = matadd(matmul(matmul(F, Pcov), transpose(F)), Q);
    // update on a scalar weight measurement (H = [1, 0]). Gate against a physically impossible
    // jump, but SCALE the allowance by the gap since the last accepted reading (the prediction
    // drifts over gaps), and force-accept after maxReject in a row so a bad prior can never pin
    // the estimate to itself forever.
    const meas = wByDay.get(d);
    if (meas) {
      const gate = P.maxJumpKg * Math.max(1, k - lastAcceptK);
      const y = meas.z - xPred[0]; // innovation = prediction error
      if (Math.abs(y) <= gate || rejects >= P.maxReject) {
        const { R } = meas;
        const S = Ppred[0][0] + R;
        const K0 = Ppred[0][0] / S, K1 = Ppred[1][0] / S;
        x = [xPred[0] + K0 * y, xPred[1] + K1 * y];
        Pcov = symmetrize([
          [(1 - K0) * Ppred[0][0], (1 - K0) * Ppred[0][1]],
          [Ppred[1][0] - K1 * Ppred[0][0], Ppred[1][1] - K1 * Ppred[0][1]],
        ]);
        lastAcceptK = k; rejects = 0; accepted += 1;
      } else {
        rejects += 1; x = xPred; Pcov = Ppred;
      }
    } else {
      x = xPred; Pcov = Ppred; // no reading → prediction only
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
  const enoughData = span >= P.minDays && present.length >= 2 && missingIntake <= P.maxMissing && accepted >= 2;

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
  minDays: 10, maxMissing: 0.5, recentIntakeDays: 7, maxJumpKg: 0.3, maxReject: 3,
};

export function ucEstimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const P = { ...V3_DEFAULTS, ...opts };
  const rho = P.rho;
  const wEntries = P.excludeDay ? weightEntries.filter((e) => e.date !== P.excludeDay) : weightEntries; // exclude the in-progress day's weigh-ins (see v1)
  const dW = dailyWeightWithVariance(wEntries);
  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dW.length ? dW[dW.length - 1].z : null, rateKgPerWeek: null, ratePctPerWeek: null,
    nDays: dW.length, missingIntake: null, trend: [] };
  if (dW.length < 2) return empty;

  const first = dW[0].date, last = dW[dW.length - 1].date;
  const days = enumerateDays(first, last);
  const iByDay = buildIntakeDayMap(intakeEntries, P.intakeDayStatus, P.excludeDay);
  // See the v1 comment above: the excluded in-progress day is dropped from the missingIntake
  // denominator too, so it never permanently inflates the displayed "% imputed".
  const countedDays = P.excludeDay ? days.filter((d) => d !== P.excludeDay) : days;
  const present = countedDays.filter((d) => iByDay.has(d));
  const missingIntake = countedDays.length ? 1 - present.length / countedDays.length : 0;
  const meanI = present.length ? mean(present.map((d) => iByDay.get(d))) : 0;
  const intakeOn = (d) => (iByDay.has(d) ? iByDay.get(d) : meanI);
  const wByDay = new Map(dW.map((d) => [d.date, d]));

  const F = [[1, -1 / rho, 0], [0, 1, 0], [0, 0, P.phi]];
  const Q = diag([P.qW, P.qE, P.qT]);
  const H = [1, 0, 1];
  let x = [wByDay.get(first).z, P.priorKcal, 0];
  let Pcov = diag([wByDay.get(first).R, P.priorSdKcal * P.priorSdKcal, P.transientSd0 * P.transientSd0]);
  const trend = [{ date: first, kg: x[0], e: x[1], sd: Math.sqrt(Pcov[1][1]) }];
  let lastAcceptK = 0, rejects = 0, accepted = 0;

  for (let k = 1; k < days.length; k++) {
    const d = days[k];
    // predict: x⁻ = F x + B u  (B u adds intake/ρ to W)
    const xPred = [x[0] - x[1] / rho + intakeOn(d) / rho, x[1], P.phi * x[2]];
    const Ppred = matadd(matmul(matmul(F, Pcov), transpose(F)), Q);
    const zPred = xPred[0] + xPred[2]; // H x⁻
    // gate scaled by the gap since the last accepted reading, with force-accept after maxReject
    // (see the v2 comment) so the estimate can never stay pinned to a bad prior.
    const meas = wByDay.get(d);
    if (meas) {
      const gate = P.maxJumpKg * Math.max(1, k - lastAcceptK);
      const y = meas.z - zPred;
      if (Math.abs(y) <= gate || rejects >= P.maxReject) {
        const { R } = meas;
        const PHt = [Ppred[0][0] + Ppred[0][2], Ppred[1][0] + Ppred[1][2], Ppred[2][0] + Ppred[2][2]];
        const S = PHt[0] + PHt[2] + R;
        const K = PHt.map((v) => v / S);
        x = xPred.map((xi, i) => xi + K[i] * y);
        const ImKH = identity(3).map((row, i) => row.map((v, j) => v - K[i] * H[j]));
        Pcov = symmetrize(matmul(ImKH, Ppred));
        lastAcceptK = k; rejects = 0; accepted += 1;
      } else {
        rejects += 1; x = xPred; Pcov = Ppred;
      }
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
  const enoughData = span >= P.minDays && present.length >= 2 && missingIntake <= P.maxMissing && accepted >= 2;

  return { enoughData, kcal, sd, low: kcal - 1.96 * sd, high: kcal + 1.96 * sd,
    trendWeightKg, rateKgPerWeek, ratePctPerWeek, nDays: span, missingIntake, trend };
}

/* ==================== v4: allometric expenditure ==================== */
// v3 lets E random-walk and hopes the filter rediscovers where it went. But most of E's real
// movement is NOT random — it's a consequence of the weight we already track. Maintenance scales
// with metabolic body size, E ≈ k·W^0.75 (the RER exponent), so a cat that loses 300 g genuinely
// needs ~11 kcal/day less, and v3 can only learn that AFTER the weight has moved and the fit has
// caught up. Measured on simulated cats with known truth (see simCat.js), that shows up as a
// systematic lag: v3 reads ~4-5 kcal HIGH for a losing cat and equally LOW for a gaining one, and
// — the key finding — the lag barely moves between qE=2 and qE=10, so no amount of process-noise
// tuning removes it. It's a property of the model's shape.
//
// v4 changes the state so the predictable part is PREDICTED. Instead of tracking E directly it
// tracks k — the cat's own metabolic constant — and derives E from the weight it already has:
//
//   state x = [W, k, T],  E = k·W^0.75
//   W_t = W + (I − k·W^0.75)/ρ      k_t = k + tiny drift      T_t = φ·T + drift
//   measurement z = W + T           (same as v3: the scale sees body mass plus gut fill)
//
// Two consequences. The declining burn of a slimming cat needs no learning at all — it falls out
// of W. And k really is near-constant (it changes with age, season, illness — not with this week's
// weight), so its process noise can be far smaller than v3's qE, which is what lets the reported
// band tighten instead of sitting at a floor set by assumed drift.
//
// The transient state T is KEPT and unchanged. Measuring a real cat's Litter-Robot series
// (~150 reads) put the day-to-day persistence at φ≈0.58 after correcting for the attenuation that
// measurement noise induces — v3's 0.5 is right, and the gut-fill state is modelling something
// real. Only the E-vs-k part changes.
//
// Nonlinear (E depends on W^0.75), so this is an EXTENDED Kalman filter: the same predict/update
// as v3 with the transition linearised about the current state each step. `sd` comes from the
// delta method — the variance of k·W^0.75 given the covariance of (W, k).
export const ALLO_EXP = 0.75; // RER's metabolic-body-size exponent; see nutrition.js's RER()
export const V4_DEFAULTS = {
  // qK 0.2 is CHOSEN BY COVERAGE, not by taste: scored across simulated cats spanning gut fill
  // 0.2-1.5% of body mass and scale noise 0.01-0.08 kg, it holds 94% coverage against a nominal
  // 95%. Tighter values look tempting (qK 0.05 halves the band again) but under-cover at 86% —
  // over-confident, which is the failure mode that actually misleads. See simCat.test.js.
  rho: KCAL_PER_KG, qW: 1e-5, qK: 0.2, qT: 0.0025, phi: 0.5,
  priorKcal: 200, priorSdKcal: 120, transientSd0: 0.06,
  minDays: 10, maxMissing: 0.5, recentIntakeDays: 7, maxJumpKg: 0.3, maxReject: 3,
};

export function alloEstimateExpenditure(weightEntries = [], intakeEntries = [], opts = {}) {
  const P = { ...V4_DEFAULTS, ...opts };
  const rho = P.rho;
  const wEntries = P.excludeDay ? weightEntries.filter((e) => e.date !== P.excludeDay) : weightEntries;
  const dW = dailyWeightWithVariance(wEntries);
  const empty = { enoughData: false, kcal: null, sd: null, low: null, high: null,
    trendWeightKg: dW.length ? dW[dW.length - 1].z : null, rateKgPerWeek: null, ratePctPerWeek: null,
    nDays: dW.length, missingIntake: null, trend: [] };
  if (dW.length < 2) return empty;

  const first = dW[0].date, last = dW[dW.length - 1].date;
  const days = enumerateDays(first, last);
  const iByDay = buildIntakeDayMap(intakeEntries, P.intakeDayStatus, P.excludeDay);
  const countedDays = P.excludeDay ? days.filter((d) => d !== P.excludeDay) : days;
  const present = countedDays.filter((d) => iByDay.has(d));
  const missingIntake = countedDays.length ? 1 - present.length / countedDays.length : 0;
  const meanI = present.length ? mean(present.map((d) => iByDay.get(d))) : 0;
  const intakeOn = (d) => (iByDay.has(d) ? iByDay.get(d) : meanI);
  const wByDay = new Map(dW.map((d) => [d.date, d]));

  // Metabolic size and its derivative, guarded: a non-positive weight would make W^0.75 and its
  // derivative undefined, and one bad row must never take the whole estimate with it.
  const msize = (W) => (W > 0 ? Math.pow(W, ALLO_EXP) : 0);
  const dmsize = (W) => (W > 0 ? ALLO_EXP * Math.pow(W, ALLO_EXP - 1) : 0);

  const Q = diag([P.qW, P.qK, P.qT]);
  const H = [1, 0, 1];
  const W0 = wByDay.get(first).z;
  // Seed k from the vet-formula prior so the cold start matches v3's: k0·W0^0.75 === priorKcal.
  const m0 = msize(W0) || 1;
  let x = [W0, P.priorKcal / m0, 0];
  let Pcov = diag([wByDay.get(first).R, (P.priorSdKcal / m0) ** 2, P.transientSd0 ** 2]);

  // E and its sd from (W, k) — the delta method: J = [∂E/∂W, ∂E/∂k, 0].
  const eOf = (xx) => xx[1] * msize(xx[0]);
  const sdOf = (xx, PP) => {
    const J = [xx[1] * dmsize(xx[0]), msize(xx[0]), 0];
    let v = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += J[a] * PP[a][b] * J[b];
    return Math.sqrt(Math.max(0, v));
  };

  const trend = [{ date: first, kg: x[0], e: eOf(x), sd: sdOf(x, Pcov) }];
  let lastAcceptK = 0, rejects = 0, accepted = 0;

  for (let k = 1; k < days.length; k++) {
    const d = days[k];
    const W = x[0], kk = x[1];
    // predict — the nonlinear transition, then linearise about (W, k) for the covariance
    const xPred = [W + (intakeOn(d) - kk * msize(W)) / rho, kk, P.phi * x[2]];
    const F = [
      [1 - (kk * dmsize(W)) / rho, -msize(W) / rho, 0],
      [0, 1, 0],
      [0, 0, P.phi],
    ];
    const Ppred = matadd(matmul(matmul(F, Pcov), transpose(F)), Q);
    const zPred = xPred[0] + xPred[2];

    const meas = wByDay.get(d);
    if (meas) {
      const gate = P.maxJumpKg * Math.max(1, k - lastAcceptK);
      const y = meas.z - zPred;
      if (Math.abs(y) <= gate || rejects >= P.maxReject) {
        const { R } = meas;
        const PHt = [Ppred[0][0] + Ppred[0][2], Ppred[1][0] + Ppred[1][2], Ppred[2][0] + Ppred[2][2]];
        const S = PHt[0] + PHt[2] + R;
        const K = PHt.map((v) => v / S);
        x = xPred.map((xi, i) => xi + K[i] * y);
        const ImKH = identity(3).map((row, i) => row.map((v, j) => v - K[i] * H[j]));
        Pcov = symmetrize(matmul(ImKH, Ppred));
        lastAcceptK = k; rejects = 0; accepted += 1;
      } else {
        x = xPred; Pcov = Ppred; rejects += 1;
      }
    } else {
      x = xPred; Pcov = Ppred;
    }
    trend.push({ date: d, kg: x[0], e: eOf(x), sd: sdOf(x, Pcov) });
  }

  const kcal = eOf(x);
  const sd = sdOf(x, Pcov);
  const recent = present.slice(-P.recentIntakeDays);
  const recentI = recent.length ? mean(recent.map((d) => iByDay.get(d))) : meanI;
  const rateKgPerWeek = ((recentI - kcal) / rho) * 7;
  const trendWeightKg = x[0];
  const ratePctPerWeek = trendWeightKg > 0 ? (rateKgPerWeek / trendWeightKg) * 100 : 0;
  const span = diffDays(first, last) + 1;
  const enoughData = span >= P.minDays && present.length >= 2 && missingIntake <= P.maxMissing && accepted >= 2;

  return { enoughData, kcal, sd, low: kcal - 1.96 * sd, high: kcal + 1.96 * sd,
    trendWeightKg, rateKgPerWeek, ratePctPerWeek, nDays: span, missingIntake, trend };
}
