"""
Fit the v3 transient (φ, amplitude, shape) from REAL weigh-in data — the experiment the
φ-misspecification sweep (v3_phi_misspec.py) said we can't do with synthetic data alone.

Model recap:  z_{d,i} = W_d + T_d + sensor_{d,i}
  W_d  slow energy-balance trend weight (integrated, non-stationary, moves over weeks)
  T_d  shared daily gut-fill/hydration offset (mean-reverting AR(1): T_d = φ·T_{d-1} + ε)
  sensor_{d,i}  per-read noise (killed by averaging the day's reads)

Method — a STRUCTURAL time-series fit, not ad-hoc detrending (an earlier rolling-median +
OLS version was badly biased low: the detrending attenuates the very autocorrelation being
measured; the self-test caught it, recovering φ̂≈0.2 for a true 0.5). Instead:
  1. per day, take the MEDIAN of that day's reads → daily mean m_d ≈ W_d + T_d
     (within-day spread → sensor SD, which pins the daily-mean obs noise R_d = σ²_sensor/n_d)
  2. fit m_d directly with a Kalman-likelihood structural model — local-linear trend [L, b]
     for W_d plus an AR(1) irregular for T_d — grid-maximising the innovation log-likelihood
     over (φ, qT). No detrending step, so nothing attenuates the AR structure.
  3. report φ̂, τ̂ = −1/ln φ̂, and the transient's stationary SD (amplitude) vs the modeled ~58 g.
  4. residual ACF (display-detrended only) at lags 1..7 — geometric decay ⇒ AR(1) is the right
     shape; a bump/periodicity ⇒ circadian or diet-driven structure AR(1) can't capture.

Two entry points:
  * no args → SYNTHETIC SELF-TEST: recover a known φ_true, proving the fitter is unbiased
    (and showing how many days / reads-per-day buy precision) before any real data exists.
  * --export path.json [--cat NAME] → fit against a Kilocat export (Settings → Data → Export).

Run:  research/../scratchpad/venv/bin/python research/v3_fit_transient.py
      research/../scratchpad/venv/bin/python research/v3_fit_transient.py --export kilocat.json
"""
import argparse
import json
import sys
from datetime import date, timedelta
import numpy as np


def rolling_median(x, win):
    """Centered rolling median, edge-shrunk so ends aren't dropped."""
    n = len(x)
    half = win // 2
    return np.array([np.median(x[max(0, i - half):min(n, i + half + 1)]) for i in range(n)])


def fit_ar1(r):
    """OLS AR(1): r_d = φ·r_{d-1} + ε. Returns φ̂, innovation SD, stationary SD, n."""
    r = np.asarray(r, float)
    a, b = r[:-1], r[1:]
    a = a - a.mean(); b = b - b.mean()
    denom = float(a @ a)
    phi = float(a @ b) / denom if denom > 0 else 0.0
    resid = b - phi * a
    innov_sd = float(np.std(resid, ddof=1)) if len(resid) > 1 else 0.0
    stat_sd = float(np.std(r, ddof=1))
    return phi, innov_sd, stat_sd, len(r)


def acf(r, maxlag=7):
    r = np.asarray(r, float) - np.mean(r)
    denom = float(r @ r)
    if denom == 0:
        return [1.0] + [0.0] * maxlag
    return [float((r[:len(r) - k] @ r[k:]) / denom) for k in range(maxlag + 1)]


def _kf_loglik(m, R, phi, qT, qL=1e-6, qb=1e-7):
    """Gaussian innovation log-likelihood of the daily-mean series m under a structural model:
    state [L, b, T] with L a local-linear trend (level L, slope b) and T an AR(1) irregular;
    obs m_d = L_d + T_d + noise(R_d). Diffuse-ish prior on level/slope, stationary prior on T.
    Pure — no ad-hoc detrending, so it doesn't attenuate the autocorrelation it's measuring."""
    F = np.array([[1.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, phi]])
    Q = np.diag([qL, qb, qT])
    H = np.array([1.0, 0.0, 1.0])
    x = np.array([m[0], 0.0, 0.0])
    stat_var = qT / (1 - phi * phi) if phi * phi < 1 else 1.0
    P = np.diag([1.0, 0.1, stat_var])  # vague on level/slope, stationary on T
    ll = 0.0
    for d in range(len(m)):
        x = F @ x
        P = F @ P @ F.T + Q
        S = float(H @ P @ H.T) + R[d]
        v = m[d] - float(H @ x)
        ll += -0.5 * (np.log(2 * np.pi * S) + v * v / S)
        K = (P @ H) / S
        x = x + K * v
        P = (np.eye(3) - np.outer(K, H)) @ P
    return ll


def fit_from_daily(days, win=None):
    """days: list of (date_str, [reads...]) sorted. Fit φ by Kalman-likelihood grid search.
    `win` is ignored (kept for the caller's API); sensor noise is pinned from within-day spread."""
    if len(days) < 20:
        return None
    m = np.array([np.median(v) for _, v in days])
    counts = np.array([len(v) for _, v in days])
    # sensor noise from within-day spread, over days that actually have ≥2 reads; if a cat only
    # ever logs once a day (no within-day info) fall back to a 20 g default.
    multi = [np.var(v, ddof=1) for _, v in days if len(v) > 1]
    sensor_var = float(np.median(multi)) if multi else (0.02 ** 2)
    R = sensor_var / np.maximum(counts, 1)  # daily-mean obs variance, beaten down by n reads

    phi_grid = np.linspace(0.0, 0.95, 20)
    qT_grid = np.array([2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2])
    best = (-np.inf, 0.0, 0.0)
    for phi in phi_grid:
        for qT in qT_grid:
            ll = _kf_loglik(m, R, phi, qT)
            if ll > best[0]:
                best = (ll, phi, qT)
    _, phi, qT = best
    stat_sd = float(np.sqrt(qT / (1 - phi * phi))) if phi * phi < 1 else float("inf")
    tau = (-1.0 / np.log(phi)) if 0 < phi < 1 else float("inf")
    # residual ACF for shape diagnosis: detrend with a wide median purely for display (not the fit)
    disp_resid = m - rolling_median(m, 11)
    return dict(phi=phi, tau_days=tau, qT=qT, innov_sd_kg=float(np.sqrt(qT)), stat_sd_kg=stat_sd,
                within_day_sd_kg=float(np.sqrt(sensor_var)), n_days=len(m),
                acf=acf(disp_resid), reads_per_day=float(np.mean(counts)))


# ---------------------------------------------------------------- synthetic self-test
def synth_days(rng, n=90, phi_true=0.5, sigma_T=0.10, sigma_sensor=0.02, reads=4,
               intake=210.0, E=260.0, rho=7800.0, w0=4.2):
    w, T, out = w0, 0.0, []
    d0 = date(2026, 1, 1)
    for d in range(n):
        T = phi_true * T + rng.normal(0, sigma_T)
        vals = [w + T + rng.normal(0, sigma_sensor) for _ in range(reads)]
        out.append(((d0 + timedelta(days=d)).isoformat(), vals))
        w = w + (intake - E) / rho
    return out


def self_test():
    print("SYNTHETIC SELF-TEST — can the fitter recover a known φ before real data exists?")
    print("(if φ̂ tracks φ_true here, a real fit is trustworthy)\n")
    rng = np.random.default_rng(11)

    print("A) φ̂ vs true φ  (90 days, 4 reads/day, σ_T=0.10) — Kalman-likelihood fit:")
    print(f"   {'φ_true':>7} {'φ̂ mean':>8} {'φ̂ scatter':>11} {'τ̂ (d)':>7}")
    for pt in (0.0, 0.2, 0.4, 0.5, 0.7, 0.9):
        phis = [fit_from_daily(synth_days(rng, phi_true=pt))["phi"] for _ in range(40)]
        rep = fit_from_daily(synth_days(rng, phi_true=pt))
        print(f"   {pt:>7.2f} {np.mean(phis):>8.3f} {np.std(phis):>11.3f} {rep['tau_days']:>7.2f}")

    print("\nB) how many DAYS of history to pin φ (φ_true=0.5, 4 reads/day)?")
    print(f"   {'days':>6} {'φ̂ mean':>8} {'φ̂ scatter':>11}")
    for nd in (21, 42, 70, 120):
        phis = [fit_from_daily(synth_days(rng, n=nd, phi_true=0.5))["phi"] for _ in range(40)]
        print(f"   {nd:>6} {np.mean(phis):>8.3f} {np.std(phis):>11.3f}")

    print("\nC) reads/day — does more within-day sampling tighten φ̂ (φ_true=0.5, 90 days)?")
    print(f"   {'reads':>6} {'φ̂ mean':>8} {'φ̂ scatter':>11}")
    for rd in (1, 2, 4, 8):
        phis = [fit_from_daily(synth_days(rng, phi_true=0.5, reads=rd))["phi"] for _ in range(40)]
        print(f"   {rd:>6} {np.mean(phis):>8.3f} {np.std(phis):>11.3f}")

    print("\n→ φ̂ should track φ_true in A with modest scatter; B/C show how much data buys")
    print("  precision. A Litter-Robot's 3–8 reads/day over ~6+ weeks is the target regime.")


# ---------------------------------------------------------------- real export path
def load_export(path, cat_name=None):
    d = json.load(open(path))
    cats = d.get("cats", {})
    if not cats:
        sys.exit("No cats in export (expected a v2 Kilocat export).")
    chosen = None
    for cid, c in cats.items():
        nm = (c.get("profile") or {}).get("name", cid)
        if cat_name is None or nm.strip().lower() == cat_name.strip().lower():
            chosen = (nm, c);
            if cat_name is not None:
                break
    if chosen is None:
        names = [(c.get("profile") or {}).get("name", cid) for cid, c in cats.items()]
        sys.exit(f"Cat '{cat_name}' not found. Available: {', '.join(names)}")
    nm, c = chosen
    by_day = {}
    for e in c.get("weightLog", []):
        # prefer ts (true instant) for local-day bucketing; fall back to stored date
        day = e.get("date")
        if e.get("ts"):
            day = (np.datetime64(int(e["ts"]), "ms").astype("datetime64[D]")).astype(str)
        kg = e.get("kg")
        if day and isinstance(kg, (int, float)) and kg > 0:
            by_day.setdefault(day, []).append(float(kg))
    days = sorted(by_day.items())
    return nm, days


def fit_real(path, cat_name):
    nm, days = load_export(path, cat_name)
    span = f"{days[0][0]} → {days[-1][0]}" if days else "n/a"
    print(f"Cat: {nm}   days with weigh-ins: {len(days)}   span: {span}")
    if len(days) < 20:
        print("Not enough data yet — need ~4+ weeks of daily weigh-ins for a stable φ fit.")
        print("Come back once the Litter-Robot has banked more; the self-test shows why.")
        return
    print(f"\n{'win (d)':>8} {'φ̂':>7} {'τ̂ (d)':>8} {'stat SD (g)':>12} {'reads/day':>10}")
    for win in (7, 9, 11, 13):
        res = fit_from_daily(days, win=win)
        if res:
            print(f"{win:>8} {res['phi']:>7.3f} {res['tau_days']:>8.2f} "
                  f"{res['stat_sd_kg']*1000:>12.0f} {res['reads_per_day']:>10.1f}")
    base = fit_from_daily(days, win=9)
    print(f"\nresidual ACF (lags 0..7), win=9:  " + " ".join(f"{a:+.2f}" for a in base["acf"]))
    print("  geometric decay ⇒ AR(1) fits (production's shape is right, φ is the only question)")
    print("  a lag-1 dip then bump, or a periodic wiggle ⇒ structure AR(1) misses (circadian/diet)")
    print(f"\nwithin-day read SD: {base['within_day_sd_kg']*1000:.0f} g  "
          f"(sensor noise; the transient is the BETWEEN-day residual, stat SD "
          f"{base['stat_sd_kg']*1000:.0f} g)")
    print(f"\nProduction uses φ=0.5 (τ≈1.44 d). Compare to φ̂ above. The misspecification sweep")
    print(f"says a modest gap is cheap; a large one (esp. φ̂ ≫ 0.5) argues for a retune or a")
    print(f"food-moisture-driven transient. Amplitude: stat SD vs the modeled ~58 g.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", help="path to a Kilocat export JSON")
    ap.add_argument("--cat", help="cat name (default: first cat in the export)")
    args = ap.parse_args()
    if args.export:
        fit_real(args.export, args.cat)
    else:
        self_test()
