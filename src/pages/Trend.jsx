import { useState, useMemo } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { buildDailyFrame, historySpanDays, trailingWeeklyRate } from "../lib/timeline.js";
import { dailyReduce, median, ewma, addDays, linregXY } from "../lib/series.js";
import { extent, linScale } from "../lib/scale.js";
import { toDisplayWeight, weightLabel } from "../lib/units.js";
import { bcsToPct, pctToBcs, RER } from "../lib/nutrition.js";
import { WEIGH_METHODS } from "../lib/expenditure.js";
import { describeOffsets } from "../lib/methodBias.js";

// Trend — the measured burn, its uncertainty, and the evidence the plan is working. Three
// SEPARATE plots (weight / rate-of-change / energy-balance), each on its own honest scale, with
// one shared range control OUTSIDE them governing all three.

const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const VW = 360; // svg viewBox width
const PADL = 38; // left gutter for the y-axis labels
const PADR = 12; // right gutter (end-of-line labels)
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const cap = { fontSize: 12, color: A.bodyOnFill, lineHeight: 1.45, margin: "8px 0 0" };
const axisText = { fontFamily: TYPE.mono, fontSize: 9, fill: A.muted };

function Card({ children, style, className }) {
  return <div className={className} style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}
const xAt = (i, n) => (n <= 1 ? (PADL + VW - PADR) / 2 : PADL + (i / (n - 1)) * (VW - PADL - PADR));
const dPath = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const mmdd = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "");
// A small x-axis date row under a chart (start … end).
function XDates({ frame }) {
  if (!frame.length) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: TYPE.mono, fontSize: 9, color: A.muted, padding: `2px ${PADR}px 0 ${PADL}px` }}>
      <span>{mmdd(frame[0].date)}</span><span>{mmdd(frame[frame.length - 1].date)}</span>
    </div>
  );
}

// Pointer → nearest data index, accounting for the SVG's L/R gutters. Works for mouse and touch.
function useHoverIndex(n) {
  const [idx, setIdx] = useState(null);
  const at = (clientX, el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || n < 1) return;
    const vbX = ((clientX - rect.left) / rect.width) * VW;
    const i = Math.round(((vbX - PADL) / (VW - PADL - PADR)) * (n - 1));
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };
  const bind = {
    onMouseMove: (e) => at(e.clientX, e.currentTarget),
    onMouseLeave: () => setIdx(null),
    onTouchStart: (e) => e.touches[0] && at(e.touches[0].clientX, e.currentTarget),
    onTouchMove: (e) => e.touches[0] && at(e.touches[0].clientX, e.currentTarget),
    onTouchEnd: () => setIdx(null),
    style: { position: "relative", touchAction: "pan-y", cursor: "crosshair" },
  };
  return { idx, bind };
}
// A tooltip pinned to a viewBox x-coordinate over a full-width relative container.
function Tip({ vbx, children }) {
  const leftPct = Math.max(10, Math.min(90, (vbx / VW) * 100));
  return (
    <div style={{ position: "absolute", top: 0, left: `${leftPct}%`, transform: "translateX(-50%)", pointerEvents: "none",
      background: A.ink, color: A.card, fontFamily: TYPE.mono, fontSize: 10, borderRadius: 6, padding: "3px 7px", whiteSpace: "nowrap", zIndex: 5 }}>
      {children}
    </div>
  );
}
const HoverGuide = ({ x }) => <line x1={x} x2={x} y1={0} y2={999} stroke={A.cardBorder} strokeWidth="1" />;

const RANGES = [["1w", 7, "1w"], ["2w", 14, "2w"], ["1m", 30, "1m"], ["3m", 90, "3m"], ["6m", 180, "6m"], ["all", null, "all"]];

export default function Trend() {
  const { p, t, expenditure: e, intakeLog, weightLog, intakeDayStatus, unit, today, currentWeight, weighOffsets } = useApp();
  // Fit the range control to the cat's actual history: the default is the tightest window that
  // still shows every logged day, and windows longer than that are disabled (they'd show the exact
  // same chart as "all"). Until the owner picks a window explicitly, we follow the fit as data grows.
  const spanDays = historySpanDays(e.trend);
  const fit = RANGES.find(([, d]) => d != null && d >= spanDays)?.[0] ?? "all";
  const fitDays = fit === "all" ? Infinity : RANGES.find((r) => r[0] === fit)[1];
  const [range, setRange] = useState(null);
  const effRange = range ?? fit;
  const rangeDays = RANGES.find((r) => r[0] === effRange)[1];

  const offsetLines = describeOffsets(weighOffsets, (m) => (WEIGH_METHODS[m] || {}).label || m);
  const bcs = pctToBcs(t.pctOver);
  const idealKg = currentWeight.kg > 0 ? currentWeight.kg / (1 + bcsToPct(bcs) / 100) : t.idealWeight;

  const frame = useMemo(
    () => buildDailyFrame(e.trend, intakeLog.items.map((x) => ({ date: x.date, value: x.kcal })), rangeDays, intakeDayStatus, today),
    [e.trend, intakeLog.items, rangeDays, intakeDayStatus, today]
  );
  // Weight + rate DISPLAY charts run off the raw scale (daily medians, today included), NOT the
  // estimator's Kalman latent (e.trend) — that latent lags real moves and, since we exclude today
  // from the estimate, stops at yesterday. The burn/energy charts keep using `frame` (they need the
  // estimator's e/sd and its today-exclusion); only the weight line and the rate line move here so
  // they agree with the scale and with the trailingWeeklyRate readout on Today.
  const wdisp = useMemo(() => {
    let daily = dailyReduce(weightLog.items.map((x) => ({ date: x.date, value: x.kg })), median); // [{date,value}] asc
    if (rangeDays && daily.length) {
      const start = addDays(daily[daily.length - 1].date, -(rangeDays - 1));
      daily = daily.filter((d) => d.date >= start);
    }
    const sm = ewma(daily.map((d) => d.value), 0.4); // light EWMA trend line — responsive, rides out the ±40 g bounce
    const dispFrame = daily.map((d, i) => ({ date: d.date, w: sm[i] }));
    const idxByDate = new Map(daily.map((d, i) => [d.date, i]));
    const dots = weightLog.items.filter((w) => idxByDate.has(w.date)).map((w) => ({ i: idxByDate.get(w.date), kg: w.kg, method: w.method }));
    // Per-day rate = a trailing-7-day line fit on the raw medians (same method as trailingWeeklyRate),
    // so the last point of this chart equals the headline %/wk instead of the old Kalman-derived one.
    // A "per-week" rate needs most of a week behind it: with only 2–3 daily medians the fit just
    // extrapolates one day's ±40 g bounce out to a full week (an impossible ±5%/wk), so hold the line
    // off until the trailing window is nearly full. It simply starts a few days into the range.
    const MIN_RATE_PTS = 5;
    const rates = daily.map((_, i) => {
      const wnd = daily.slice(Math.max(0, i - 6), i + 1);
      if (wnd.length < MIN_RATE_PTS) return { kgPerWeek: null, pctPerWeek: null };
      const { slope } = linregXY(wnd.map((_, k) => k), wnd.map((p) => p.value));
      const kgPerWeek = slope * 7;
      const last = wnd[wnd.length - 1].value;
      return { kgPerWeek, pctPerWeek: last > 0 ? (kgPerWeek / last) * 100 : 0 };
    });
    return { frame: dispFrame, dots, rates };
  }, [weightLog.items, rangeDays]);

  if (!e.enoughData || frame.length < 2) {
    return (
      <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink }}>
        <div style={{ maxWidth: 430, margin: "0 auto", padding: "18px 24px" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>trend</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.24, margin: "10px 0 8px" }}>Not enough logged yet to measure {p.name || "your cat"}'s burn.</h1>
          <p style={{ ...cap }}>Log weigh-ins and meals for about two weeks and the estimate and its trend appear here. Until then the calorie plan leans on the vet formula. <a href="#/log" style={{ color: A.good }}>Log →</a></p>
        </div>
      </div>
    );
  }

  const burn = r0(e.kcal);
  const plus = r0(e.high - e.kcal), minus = r0(e.kcal - e.low);
  const asym = Math.abs(plus - minus) > 1;
  // When the interval is still wide (early / weight-stable cats), lead with the RANGE instead of a
  // confident-looking single number — the honest read is "somewhere in here, still narrowing", not
  // "197, precisely". Threshold: ±15% of the estimate.
  const wide = e.kcal > 0 && (e.high - e.low) / 2 > 0.15 * e.kcal;
  const dispW = (kg) => toDisplayWeight(kg, unit);

  // The vet-formula maintenance the estimate started from, drawn per-day off each day's weight
  // (statusFactor × RER(kg)) — the same basis as the estimator's prior — so the burn chart can show
  // how far the measured number has moved from what the formula alone predicts.
  const formula = frame.map((f) => (f.w != null ? t.statusFactor * RER(f.w) : null));

  // The rate-of-change "safe zone" depends on the PLAN, not a fixed loss band: an overweight cat on
  // a loss plan wants −2…−0.5 %/wk, a maintenance plan wants to hold (±0.5 %/wk), an underweight cat
  // gaining wants +0.5…+2 %/wk. Drive it off target vs. maintenance (the same delta the plan uses).
  const planDelta = (t.target || 0) - (t.refs?.maintain || 0);
  const rateZone = planDelta < -1 ? { lo: -2, hi: -0.5, kind: "loss" }
    : planDelta > 1 ? { lo: 0.5, hi: 2, kind: "gain" }
    : { lo: -0.5, hi: 0.5, kind: "hold" };
  const zoneCap = rateZone.kind === "loss"
    ? "The shaded band is the safe 0.5–2%/wk loss zone for her weight-loss plan; above the zero line she'd be gaining."
    : rateZone.kind === "gain"
    ? "The shaded band is the safe 0.5–2%/wk gain zone for her weight-gain plan; below the zero line she'd be losing."
    : "The shaded band is the ±0.5%/wk holding zone; drifting well outside it means she's trending up or down.";

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div className="alm-page alm-grid">
        <div className="span-all" style={{ padding: "18px 24px 0" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>trend · measured</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.26, letterSpacing: "-.012em", margin: "10px 0 4px" }}>
            {wide
              ? <>{p.name || "Your cat"} burns somewhere around {r0(e.low)}–{r0(e.high)} kcal a day.</>
              : <>{p.name || "Your cat"} burns about {burn} kcal a day.</>}
          </h1>
          <p style={{ ...cap, margin: "0 0 4px" }}>{wide ? `Only ${e.nDays} days in — the range narrows as you keep logging.` : `Worked out from ${e.nDays} days of weigh-ins and meals — not a formula's guess.`}</p>
        </div>

        {/* estimate card */}
        <Card className="span-all">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontFamily: TYPE.mono, fontSize: wide ? 27 : 40, fontWeight: 600, color: A.ink, lineHeight: 1 }}>{wide ? `${r0(e.low)}–${r0(e.high)}` : burn}</div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted, textAlign: "right" }}>{wide ? "95% range" : <>{asym ? `+${plus} / −${minus}` : `±${plus}`} kcal<br />95% interval</>}</div>
          </div>
          <PosteriorDensity kcal={e.kcal} sd={e.sd} priorKcal={e.priorKcal} priorSd={e.priorSdKcal} sdFilter={e.sdFilter} sdIntake={e.sdIntake} mixture={e.mixture} low={e.low} high={e.high} />
          <p style={{ ...cap, fontSize: 11.5 }}>{wide ? `Best single guess ~${burn}, but it's genuinely uncertain this early — trust the range. It tightens as you log` : "The band narrows as you log"}{e.missingIntake > 0 ? `; ${r0(e.missingIntake * 100)}% of days in range are incomplete and left out` : ""}.</p>
        </Card>

        {/* shared range control — outside the charts, governs all three */}
        <div className="span-all" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "0 18px 12px" }}>
          <span style={label({ color: A.labelOnFill })}>Charts below show</span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {RANGES.map(([key, days, lbl]) => {
              const disabled = days != null && days > fitDays;
              const on = effRange === key;
              return (
                <button key={key} disabled={disabled} onClick={() => setRange(key)} aria-pressed={on}
                  title={disabled ? "Longer than the logged history" : undefined}
                  style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "3px 11px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.32 : 1,
                    border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? A.ink : "transparent", color: on ? A.card : A.muted }}>{lbl}</button>
              );
            })}
          </div>
        </div>

        {/* ── model-fit family: the burn estimate, and the energy balance measured against it.
             Both lean on the Kalman fit (its per-day burn + uncertainty), so they're grouped and
             both carry the same 95% band — a visual cue that these two are fitted, not measured. ── */}
        <GroupRule>from the model fit</GroupRule>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Measured burn · kcal/day</div>
          <BurnChart frame={frame} formula={formula} />
          <Legend items={[[A.chart.expenditure || A.good, "measured", "line"], [A.muted, "vet formula", "dash"]]} />
          <p style={{ ...cap, fontSize: 11.5 }}>Band = the estimate's 95% range, tightening as you log. Dotted = the vet formula for her weight; the gap is what the data revealed.</p>
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Energy balance · kcal vs burn</div>
          <EnergyChart frame={frame} burn={e.kcal} />
          <p style={{ ...cap, fontSize: 11.5 }}>Each day's intake minus that day's burn. The dot is the balance, the pill its 95% range — a pill crossing the line is too close to call.</p>
        </Card>

        {/* ── measured family: the raw scale weight and its rate — no model, straight from weigh-ins. ── */}
        <GroupRule>straight from the scale</GroupRule>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Weight · {weightLabel(unit)}</div>
          <WeightChart frame={wdisp.frame} dots={wdisp.dots} idealKg={idealKg} disp={dispW} unit={unit} />
          <Legend items={[
            [A.chart.trend, "trend", "line"],
            ...[...new Set(wdisp.dots.map((d) => d.method || "other"))]
              .map((m) => [methodColor(m), (WEIGH_METHODS[m] || {}).label || "unknown", "dot"]),
            [A.chart.ideal, "ideal", "dash"],
          ]} />
          {/* Whether the methods agree — measured, not assumed. Relative only: it can say one reads
              lower than the other, never which is closer to the true weight. */}
          {offsetLines.map((o) => (
            <p key={o.method} style={{ ...cap, fontSize: 11.5, color: o.applied ? A.bodyOnFill : A.muted }}>{o.text}</p>
          ))}
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Rate of change · %/wk</div>
          <RateChart rates={wdisp.rates} frame={wdisp.frame} zone={rateZone} />
          <p style={{ ...cap, fontSize: 11.5 }}>
            {(() => { const tw = trailingWeeklyRate(weightLog.items); return tw
              ? `Over the last ${tw.days} days: ${tw.gramsPerWeek < 0 ? "−" : "+"}${Math.abs(Math.round(tw.gramsPerWeek))} g/wk (${tw.pctPerWeek < 0 ? "−" : "+"}${Math.abs(r1(tw.pctPerWeek))}%/wk).`
              : "Not enough days yet to call a rate."; })()} {zoneCap}
          </p>
        </Card>

        {e.missingIntake > 0 && (
          <div className="span-all" style={{ background: A.caution.bg, border: `1px solid ${A.caution.border}`, borderRadius: 12, padding: "11px 13px", margin: "0 18px", display: "flex", gap: 8 }}>
            <span style={{ fontFamily: TYPE.mono, color: A.caution.text, fontWeight: 700 }}>!</span>
            <span style={{ fontSize: 12, color: A.caution.text, lineHeight: 1.4 }}>{r0(e.missingIntake * 100)}% of days in this range are incomplete. They're excluded from the estimate, which is why the band isn't tighter.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// The POSTERIOR, drawn as a density rather than a bar.
//
// v2-v4 are Bayesian: the Kalman/EKF covariance IS a posterior variance, and with Gaussian noise the
// posterior over expenditure is Gaussian. A bar throws that away — it shows the 95% endpoints and
// implies everything inside is equally likely, which is exactly what a posterior does NOT say. The
// curve shows where the mass actually is.
//
// The vet formula is drawn behind it as the PRIOR it genuinely is (the filters are seeded with it —
// see AppState's priorKcal/priorSdKcal). Both curves are scaled by the SAME factor, so each encloses
// the same area and the narrower one is correspondingly taller: the visible gap between them is the
// information the cat's own data added. That's the app's whole claim, shown instead of asserted.
function PosteriorDensity({ kcal, sd, priorKcal, priorSd, sdFilter, sdIntake, mixture, low, high }) {
  const W = 360, H = 96, PADB = 16;
  const hasPrior = priorKcal > 0 && priorSd > 0;
  // Span both curves, so neither is clipped and their relative width is honest.
  const lo = Math.min(kcal - 3.4 * sd, hasPrior ? priorKcal - 3.4 * priorSd : Infinity);
  const hi = Math.max(kcal + 3.4 * sd, hasPrior ? priorKcal + 3.4 * priorSd : -Infinity);
  const x = (v) => ((v - lo) / (hi - lo)) * W;
  const gauss = (v, mu, s) => Math.exp(-0.5 * ((v - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  // With v5 the posterior is a MIXTURE — uncertainty about the model's own parameters folded in —
  // so draw the mixture itself rather than a Gaussian fitted to its first two moments. The visible
  // difference is the tails: a mixture is heavier there, which is the honest shape.
  const wsum = mixture?.length ? mixture.reduce((a, c) => a + c.w, 0) : 0;
  const pdf = wsum > 0
    ? (v) => mixture.reduce((a, c) => a + (c.w / wsum) * gauss(v, c.kcal, c.sd), 0)
    : (v) => gauss(v, kcal, sd);
  // one shared vertical scale => equal area under each curve
  const peak = Math.max(pdf(kcal), hasPrior ? gauss(priorKcal, priorKcal, priorSd) : 0);
  const y = (d) => H - PADB - (d / peak) * (H - PADB - 6);
  const N = 160;
  const curveOf = (f) => Array.from({ length: N + 1 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / N;
    return [x(v), y(f(v))];
  });
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const post = curveOf(pdf);
  // Shade the reported 95% interval. For a mixture that is NOT mean ± 1.96 sd (see
  // mixtureQuantile), so use the interval the estimator actually reported.
  const q05 = low != null ? low : kcal - 1.96 * sd;
  const q95 = high != null ? high : kcal + 1.96 * sd;
  const inner = post.filter((_, i) => { const v = lo + ((hi - lo) * i) / N; return v >= q05 && v <= q95; });
  const fill = inner.length > 1
    ? `${path(inner)} L${inner[inner.length - 1][0].toFixed(1)},${H - PADB} L${inner[0][0].toFixed(1)},${H - PADB} Z`
    : null;
  const tick = (v, extra = {}) => <line x1={x(v)} x2={x(v)} y1={6} y2={H - PADB} {...extra} />;
  return (
    <div style={{ marginTop: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block", overflow: "visible" }} role="img"
        aria-label={`Posterior distribution for expenditure, most likely ${r0(kcal)} kcal per day, 95% between ${r0(low != null ? low : kcal - 1.96 * sd)} and ${r0(high != null ? high : kcal + 1.96 * sd)}`}>
        {/* the prior — what the vet formula alone believed, before this cat's data */}
        {hasPrior && <path d={path(curveOf((v) => gauss(v, priorKcal, priorSd)))} fill="none" stroke={A.muted} strokeWidth="1.3" strokeDasharray="3 3" opacity="0.55" />}
        {fill && <path d={fill} fill={A.chart.expenditure || A.good} opacity="0.18" />}
        <path d={path(post)} fill="none" stroke={A.chart.expenditure || A.good} strokeWidth="2" />
        {tick(kcal, { stroke: A.ink, strokeWidth: 1.5 })}
        <line x1={0} x2={W} y1={H - PADB} y2={H - PADB} stroke={A.cardBorder} strokeWidth="1" />
        <text x={x(kcal)} y={H - 4} textAnchor="middle" style={{ ...axisText, fill: A.ink }}>{r0(kcal)}</text>
        <text x={x(q05)} y={H - 4} textAnchor="middle" style={axisText}>{r0(q05)}</text>
        <text x={x(q95)} y={H - 4} textAnchor="middle" style={axisText}>{r0(q95)}</text>
        {hasPrior && <text x={x(priorKcal)} y={12} textAnchor="middle" style={{ ...axisText, fill: A.muted }}>vet formula</text>}
      </svg>
      <p style={{ ...cap, fontSize: 11.5 }}>
        The shaded area is the middle 95% — the curve's height is how likely each value is, so the
        peak is the best estimate and the tails are genuinely less believable, which a plain bar
        can't say.{hasPrior ? " The dashed curve is the vet formula's guess before your cat's own data; both enclose the same area, so the taller, narrower shape is what the logging bought." : ""}
        {sdFilter > 0 && sdIntake > 0 && <> Width here is <b style={{ fontWeight: 600 }}>±{r0(1.96 * sdFilter)}</b> from the model and <b style={{ fontWeight: 600 }}>±{r0(1.96 * sdIntake)}</b> from how exactly food is measured.</>}
      </p>
    </div>
  );
}

// The measured-burn timeline: the per-day estimate as a line, wrapped in its 95% confidence band
// (e ± 1.96·sd). Early history is wide; the band visibly narrows as weigh-ins accumulate — the
// honest picture of how well we know the burn. This is the evidence behind the headline number.
function BurnChart({ frame, formula }) {
  const K = 1.96;
  const pts = frame.map((f, i) => (f.e != null ? { i, e: f.e, sd: Number.isFinite(f.sd) && f.sd >= 0 ? f.sd : 0, date: f.date } : null)).filter(Boolean);
  const { idx, bind } = useHoverIndex(frame.length);
  const H = 130, PADY = 12;
  if (pts.length < 2) return <div style={{ fontSize: 12, color: A.muted, padding: "8px 0" }}>Not enough weigh-ins in range yet.</div>;
  // the vet-formula reference (per-day), aligned to the days that have an estimate.
  const fpts = (formula || []).map((v, i) => (v != null && frame[i]?.e != null ? { i, v } : null)).filter(Boolean);
  // scale from the band's own extent (e ± k·sd) plus the formula line — not intake — so the burn
  // line, its interval, AND the formula reference all fit; a little padding top and bottom.
  const domainVals = pts.flatMap((p) => [p.e - K * p.sd, p.e + K * p.sd]);
  fpts.forEach((f) => domainVals.push(f.v));
  const [blo, bhi] = extent(domainVals);
  const pad = (bhi - blo) * 0.12 || 10;
  const [lo, hi] = [blo - pad, bhi + pad];
  const y = linScale([lo, hi], [H - PADY, PADY]);
  const x = (i) => xAt(i, frame.length);
  const line = pts.map((p) => [x(p.i), y(p.e)]);
  const fline = fpts.map((f) => [x(f.i), y(f.v)]);
  const top = pts.map((p) => [x(p.i), y(p.e + K * p.sd)]);
  const bot = pts.map((p) => [x(p.i), y(p.e - K * p.sd)]);
  const bandD = dPath(top) + " " + bot.reverse().map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
  const endI = pts[pts.length - 1].i;
  const hp = idx != null ? pts.find((p) => p.i === idx) : null;
  const hv = hp ? { x: x(hp.i), yv: y(hp.e), e: hp.e, sd: hp.sd, date: hp.date } : null;
  return (
    <div {...bind}>
      {hv && <Tip vbx={hv.x}>{mmdd(hv.date)} · {r0(hv.e)} ±{r0(K * hv.sd)} kcal</Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <path d={bandD} fill={A.chart.expenditure || A.good} opacity="0.16" />
        {/* vet-formula reference, low-opacity dashed behind the measured line */}
        {fline.length > 1 && <path d={dPath(fline)} fill="none" stroke={A.muted} strokeWidth="1.4" strokeDasharray="3 3" opacity="0.6" />}
        {hv && <HoverGuide x={hv.x} />}
        <path d={dPath(line)} fill="none" stroke={A.chart.expenditure || A.good} strokeWidth="2.2" />
        <circle cx={x(endI)} cy={y(pts[pts.length - 1].e)} r="4.5" fill={A.chart.expenditure || A.good} />
        {hv && <circle cx={hv.x} cy={hv.yv} r="4" fill={A.ink} />}
        <text x={PADL - 5} y={PADY + 7} textAnchor="end" style={axisText}>{r0(hi)}</text>
        <text x={PADL - 5} y={H - PADY + 3} textAnchor="end" style={axisText}>{r0(lo)}</text>
      </svg>
      <XDates frame={frame} />
    </div>
  );
}

// Weigh-ins are coloured by HOW they were measured. Precision differs by an order of magnitude
// between methods (pet scale σ=0.01 kg, bathroom-scale subtraction σ=0.15), and so can their
// calibration — so when a dot sits off the trend, "was that a different method?" is the first
// useful question, and this answers it without a trip to the log.
const METHOD_COLOR = {
  litterRobot: A.chart.weighDot,
  petScale: A.good,
  difference: A.caution.text,
  other: A.muted,
};
export const methodColor = (m) => METHOD_COLOR[m] || A.muted;

function WeightChart({ frame, dots, idealKg, disp, unit }) {
  const { idx, bind } = useHoverIndex(frame.length);
  const H = 130, PADY = 12;
  const ws = frame.map((f) => f.w).filter((v) => v != null).map(disp);
  const dws = dots.map((d) => disp(d.kg));
  const all = [...ws, ...dws, disp(idealKg)].filter((v) => Number.isFinite(v));
  const [lo, hi] = all.length ? extent(all) : [0, 1];
  const pad = (hi - lo) * 0.15 || 0.1;
  const y = linScale([lo - pad, hi + pad], [H - PADY, PADY]);
  const line = frame.map((f, i) => (f.w != null ? [xAt(i, frame.length), y(disp(f.w))] : null)).filter(Boolean);
  const idealY = y(disp(idealKg));
  const endI = frame.length - 1;
  const f2 = (v) => Number(v.toFixed(2));
  const hv = idx != null && frame[idx]?.w != null ? { x: xAt(idx, frame.length), yv: y(disp(frame[idx].w)), val: disp(frame[idx].w), date: frame[idx].date } : null;
  return (
    <div {...bind}>
      {hv && <Tip vbx={hv.x}>{mmdd(hv.date)} · {f2(hv.val)} {weightLabel(unit)}</Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        {hv && <HoverGuide x={hv.x} />}
        {/* weigh-in dots BEHIND the trend line, dimmed so the trend reads clearly */}
        {dots.map((d, k) => <circle key={k} cx={xAt(d.i, frame.length)} cy={y(disp(d.kg))} r="3" fill={methodColor(d.method)} opacity="0.6" />)}
        <line x1={PADL} y1={idealY} x2={VW - PADR} y2={idealY} stroke={A.chart.ideal} strokeWidth="1.6" strokeDasharray="5 4" />
        <text x={VW - PADR} y={idealY - 3} textAnchor="end" style={{ ...axisText, fill: A.chart.ideal }}>ideal {f2(disp(idealKg))}</text>
        {line.length > 1 && <path d={dPath(line)} fill="none" stroke={A.chart.trend} strokeWidth="2.2" />}
        {frame[endI]?.w != null && <circle cx={xAt(endI, frame.length)} cy={y(disp(frame[endI].w))} r="4.5" fill={A.chart.endDot} />}
        {hv && <circle cx={hv.x} cy={hv.yv} r="4" fill={A.ink} />}
        <text x={PADL - 5} y={y(hi) + 3} textAnchor="end" style={axisText}>{f2(hi)}</text>
        <text x={PADL - 5} y={y(lo) + 3} textAnchor="end" style={axisText}>{f2(lo)}</text>
      </svg>
      <XDates frame={frame} />
    </div>
  );
}

function RateChart({ rates, frame, zone }) {
  const { idx, bind } = useHoverIndex(rates.length);
  const H = 104, PADY = 12;
  const vals = rates.map((r) => r.pctPerWeek).filter((v) => v != null);
  // domain always holds the plan's safe zone, zero, and the data — with a little padding — so the
  // band is visible whether the plan is loss (below zero), hold (around zero), or gain (above).
  const lo = Math.min(zone.lo, 0, ...vals) - 0.3;
  const hi = Math.max(zone.hi, 0, ...vals) + 0.3;
  const y = linScale([lo, hi], [H - PADY, PADY]);
  const line = rates.map((r, i) => (r.pctPerWeek != null ? [xAt(i, rates.length), y(r.pctPerWeek)] : null)).filter(Boolean);
  const bandTop = y(zone.hi), bandBot = y(zone.lo), zero = y(0);
  const sgn = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
  const hv = idx != null && rates[idx]?.pctPerWeek != null ? { x: xAt(idx, rates.length), yv: y(rates[idx].pctPerWeek), val: rates[idx].pctPerWeek, date: frame[idx]?.date } : null;
  return (
    <div {...bind}>
      {hv && <Tip vbx={hv.x}>{mmdd(hv.date)} · {sgn(hv.val)}{Math.abs(hv.val).toFixed(1)}%/wk</Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <rect x={PADL} y={Math.min(bandTop, bandBot)} width={VW - PADL - PADR} height={Math.abs(bandBot - bandTop)} fill={A.chart.safeBand} opacity="0.13" />
        {hv && <HoverGuide x={hv.x} />}
        <line x1={PADL} y1={zero} x2={VW - PADR} y2={zero} stroke={A.chart.zeroLine} strokeWidth="1" strokeDasharray="4 3" />
        {line.length > 1 && <path d={dPath(line)} fill="none" stroke={A.chart.trend} strokeWidth="2" />}
        {hv && <circle cx={hv.x} cy={hv.yv} r="4" fill={A.ink} />}
        <text x={PADL - 5} y={y(hi) + 7} textAnchor="end" style={axisText}>{sgn(hi)}{Math.abs(hi).toFixed(1)}</text>
        <text x={PADL - 5} y={zero + 3} textAnchor="end" style={{ ...axisText, fill: A.body }}>0</text>
        <text x={PADL - 5} y={y(lo) - 2} textAnchor="end" style={axisText}>{sgn(lo)}{Math.abs(lo).toFixed(1)}</text>
        <text x={VW - PADR} y={bandTop - 2} textAnchor="end" style={axisText}>safe zone</text>
      </svg>
      <XDates frame={frame} />
    </div>
  );
}

function EnergyChart({ frame, burn }) {
  const { idx, bind } = useHoverIndex(frame.length);
  const H = 100, PADY = 12;
  const n = frame.length;
  const K = 1.96;
  // One point PER DAY: that day's logged intake minus THAT DAY'S estimated burn (skip
  // missing/incomplete days). The burn isn't a constant — it drifts as the cat's weight (and so its
  // maintenance) changes, so each day is measured against the frame's own expenditure for that day
  // (f.e), falling back to the latest estimate only when a day has none. The point is the balance
  // estimate; intake is exact, so the point's uncertainty is entirely the burn's own 95% (±K·sd),
  // drawn as a pill around the dot. A pill straddling the break-even = that day's deficit/surplus is
  // within the noise; only a pill clearly on one side is a real deficit (below) or surplus (above).
  const daily = frame.map((f) =>
    f.kin != null && !f.kinImputed
      ? { b: f.kin - (Number.isFinite(f.e) ? f.e : burn), sd: Number.isFinite(f.sd) && f.sd >= 0 ? f.sd : 0 }
      : null
  );
  if (!daily.some((d) => d != null)) return <div style={{ fontSize: 12, color: A.muted, padding: "8px 0" }}>No complete days in range yet.</div>;
  // smoothed running average of the point estimates (EWMA over days with data) — the line on top.
  const alpha = 0.2;
  let ema = null;
  const smooth = [];
  daily.forEach((d, i) => { if (d == null) return; ema = ema == null ? d.b : alpha * d.b + (1 - alpha) * ema; smooth.push([xAt(i, n), i, ema]); });
  // domain must hold each pill's full extent (|b| + K·sd), not just the point, so nothing clips.
  const maxAbs = Math.max(40, ...daily.map((d) => (d == null ? 0 : Math.abs(d.b) + K * d.sd)), ...smooth.map((s) => Math.abs(s[2])));
  const y = linScale([-maxAbs, maxAbs], [H - PADY, PADY]);
  const base = y(0);
  const pillW = Math.max(4, Math.min(7, (VW - PADL - PADR) / n - 2));
  const dotR = 2.8;
  const smoothPts = smooth.map(([x, , v]) => [x, y(v)]);
  const hv = idx != null && daily[idx] != null ? { x: xAt(idx, n), d: daily[idx], date: frame[idx].date } : null;
  return (
    <div {...bind}>
      {hv && <Tip vbx={hv.x}>{mmdd(hv.date)} · {hv.d.b > 0 ? "+" : "−"}{r0(Math.abs(hv.d.b))} kcal <span style={{ color: A.muted }}>± {r0(K * hv.d.sd)}</span></Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <line x1={PADL} y1={base} x2={VW - PADR} y2={base} stroke={A.chart.zeroLine} strokeWidth="1" strokeDasharray="4 3" />
        {daily.map((d, i) => {
          if (d == null) return null;
          const cx = xAt(i, n);
          const yTop = y(d.b + K * d.sd), yBot = y(d.b - K * d.sd);
          const col = d.b > 0 ? A.chart.overBurn : A.chart.underBurn;
          return (
            <g key={i} opacity={hv && i !== idx ? 0.45 : 1}>
              {/* the 95% interval as a pill; collapses to a dot-sized capsule when the burn is well pinned */}
              <rect x={cx - pillW / 2} y={Math.min(yTop, yBot)} width={pillW} height={Math.max(pillW, Math.abs(yBot - yTop))} rx={pillW / 2} fill={col} opacity="0.24" />
              {/* the point estimate */}
              <circle cx={cx} cy={y(d.b)} r={dotR} fill={col} />
            </g>
          );
        })}
        {smoothPts.length > 1 && <path d={dPath(smoothPts)} fill="none" stroke={A.ink} strokeWidth="1.6" opacity="0.65" />}
        {hv && <HoverGuide x={hv.x} />}
        {hv && <circle cx={hv.x} cy={y(hv.d.b)} r="4" fill={A.ink} />}
        <text x={PADL - 5} y={PADY + 7} textAnchor="end" style={{ ...axisText, fill: A.chart.overBurnLabel }}>+{r0(maxAbs)}</text>
        {/* baseline label stacked in the left gutter (not on the line) so it never sits under the
            near-break-even pills that cluster on the zero line at the right */}
        <text x={PADL - 5} y={base - 1} textAnchor="end" style={{ ...axisText, fill: A.ink }}>burn</text>
        <text x={PADL - 5} y={base + 9} textAnchor="end" style={axisText}>≈{r0(burn)}</text>
        <text x={PADL - 5} y={H - PADY + 3} textAnchor="end" style={axisText}>−{r0(maxAbs)}</text>
      </svg>
      <XDates frame={frame} />
    </div>
  );
}

// A section eyebrow + hairline that spans the grid, grouping the charts by data source: the fitted
// (model) pair vs. the measured (scale) pair. On desktop the grid is 2-up, so each rule heads a row
// of its two charts; on phones it just precedes the stacked pair.
function GroupRule({ children }) {
  return (
    <div className="span-all" style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 18px 0" }}>
      <span style={label({ color: A.labelOnFill })}>{children}</span>
      <span style={{ flex: 1, height: 1, background: A.cardBorder }} />
    </div>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 6, fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted }}>
      {items.map(([color, text, shape], i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {shape === "dot" ? <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
            : shape === "dash" ? <span style={{ width: 12, height: 0, borderTop: `1.6px dashed ${color}` }} />
              : <span style={{ width: 12, height: 2, background: color }} />}
          {text}
        </span>
      ))}
    </div>
  );
}
