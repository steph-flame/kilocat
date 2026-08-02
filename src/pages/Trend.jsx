import { useState, useMemo } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { buildDailyFrame, historySpanDays, trailingWeeklyRate } from "../lib/timeline.js";
import { dailyReduce, median, ewma, addDays, linregXY } from "../lib/series.js";
import { extent, linScale } from "../lib/scale.js";
import { toDisplayWeight, weightLabel } from "../lib/units.js";
import { bcsToPct, pctToBcs } from "../lib/nutrition.js";

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
  const { p, t, expenditure: e, intakeLog, weightLog, intakeDayStatus, unit, today, currentWeight } = useApp();
  // Fit the range control to the cat's actual history: the default is the tightest window that
  // still shows every logged day, and windows longer than that are disabled (they'd show the exact
  // same chart as "all"). Until the owner picks a window explicitly, we follow the fit as data grows.
  const spanDays = historySpanDays(e.trend);
  const fit = RANGES.find(([, d]) => d != null && d >= spanDays)?.[0] ?? "all";
  const fitDays = fit === "all" ? Infinity : RANGES.find((r) => r[0] === fit)[1];
  const [range, setRange] = useState(null);
  const effRange = range ?? fit;
  const rangeDays = RANGES.find((r) => r[0] === effRange)[1];

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
    const dots = weightLog.items.filter((w) => idxByDate.has(w.date)).map((w) => ({ i: idxByDate.get(w.date), kg: w.kg }));
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
          <IntervalBar lo={e.low} hi={e.high} point={e.kcal} />
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

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Measured burn · kcal/day</div>
          <BurnChart frame={frame} />
          <p style={{ ...cap, fontSize: 11.5 }}>The line is the day-by-day estimate; the shaded band is its 95% interval, which tightens as more weigh-ins pin down the trend.</p>
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Weight · {weightLabel(unit)}</div>
          <WeightChart frame={wdisp.frame} dots={wdisp.dots} idealKg={idealKg} disp={dispW} unit={unit} />
          <Legend items={[[A.chart.trend, "trend", "line"], [A.chart.weighDot, "weigh-in", "dot"], [A.chart.ideal, "ideal", "dash"]]} />
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Rate of change · %/wk</div>
          <RateChart rates={wdisp.rates} frame={wdisp.frame} />
          <p style={{ ...cap, fontSize: 11.5 }}>
            {(() => { const tw = trailingWeeklyRate(weightLog.items); return tw
              ? `Over the last ${tw.days} days: ${tw.gramsPerWeek < 0 ? "−" : "+"}${Math.abs(Math.round(tw.gramsPerWeek))} g/wk (${tw.pctPerWeek < 0 ? "−" : "+"}${Math.abs(r1(tw.pctPerWeek))}%/wk).`
              : "Not enough days yet to call a rate."; })()} The shaded band is the safe 0.5–2%/wk zone; above the dashed line she'd be gaining.
          </p>
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Energy balance · kcal vs burn</div>
          <EnergyChart frame={frame} burn={e.kcal} />
          <p style={{ ...cap, fontSize: 11.5 }}>Each day's intake against <b style={{ fontWeight: 600 }}>that day's</b> estimated burn — the break-even line drifts as her weight (and maintenance) change, so it isn't pinned to today's {burn} kcal. Below the line is a deficit (losing), above is a surplus; the dark line is the smoothed average.</p>
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

function IntervalBar({ lo, hi, point }) {
  const padKcal = Math.max(20, (hi - lo) * 0.6);
  const s = linScale([lo - padKcal, hi + padKcal], [0, 100]);
  const L = s(lo), Hh = s(hi), P = s(point);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: A.track }}>
        <div style={{ position: "absolute", left: `${L}%`, width: `${Hh - L}%`, top: 0, bottom: 0, background: A.good, borderRadius: 4, opacity: 0.85 }} />
        <div style={{ position: "absolute", left: `${P}%`, top: -2, width: 2, height: 12, background: A.ink }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: TYPE.mono, fontSize: 10, color: A.muted, marginTop: 3 }}>
        <span>{r0(lo - padKcal)}</span><span>{r0(lo)}–{r0(hi)}</span><span>{r0(hi + padKcal)}</span>
      </div>
    </div>
  );
}

// The measured-burn timeline: the per-day estimate as a line, wrapped in its 95% confidence band
// (e ± 1.96·sd). Early history is wide; the band visibly narrows as weigh-ins accumulate — the
// honest picture of how well we know the burn. This is the evidence behind the headline number.
function BurnChart({ frame }) {
  const K = 1.96;
  const pts = frame.map((f, i) => (f.e != null ? { i, e: f.e, sd: Number.isFinite(f.sd) && f.sd >= 0 ? f.sd : 0, date: f.date } : null)).filter(Boolean);
  const { idx, bind } = useHoverIndex(frame.length);
  const H = 130, PADY = 12;
  if (pts.length < 2) return <div style={{ fontSize: 12, color: A.muted, padding: "8px 0" }}>Not enough weigh-ins in range yet.</div>;
  // scale from the band's own extent (e ± k·sd) — not intake — so the burn line and its interval
  // fill the panel and the early-history widening reads clearly; a little padding top and bottom.
  const [blo, bhi] = extent(pts.flatMap((p) => [p.e - K * p.sd, p.e + K * p.sd]));
  const pad = (bhi - blo) * 0.12 || 10;
  const [lo, hi] = [blo - pad, bhi + pad];
  const y = linScale([lo, hi], [H - PADY, PADY]);
  const x = (i) => xAt(i, frame.length);
  const line = pts.map((p) => [x(p.i), y(p.e)]);
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
        {dots.map((d, k) => <circle key={k} cx={xAt(d.i, frame.length)} cy={y(disp(d.kg))} r="3" fill={A.chart.weighDot} opacity="0.5" />)}
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

function RateChart({ rates, frame }) {
  const { idx, bind } = useHoverIndex(rates.length);
  const H = 104, PADY = 12;
  const vals = rates.map((r) => r.pctPerWeek).filter((v) => v != null);
  const lo = Math.min(-2.2, ...vals, 0);
  const hi = Math.max(0.6, ...vals, 0);
  const y = linScale([lo, hi], [H - PADY, PADY]);
  const line = rates.map((r, i) => (r.pctPerWeek != null ? [xAt(i, rates.length), y(r.pctPerWeek)] : null)).filter(Boolean);
  const bandTop = y(-0.5), bandBot = y(-2.0), zero = y(0);
  const hv = idx != null && rates[idx]?.pctPerWeek != null ? { x: xAt(idx, rates.length), yv: y(rates[idx].pctPerWeek), val: rates[idx].pctPerWeek, date: frame[idx]?.date } : null;
  return (
    <div {...bind}>
      {hv && <Tip vbx={hv.x}>{mmdd(hv.date)} · {hv.val > 0 ? "+" : hv.val < 0 ? "−" : ""}{Math.abs(hv.val).toFixed(1)}%/wk</Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <rect x={PADL} y={Math.min(bandTop, bandBot)} width={VW - PADL - PADR} height={Math.abs(bandBot - bandTop)} fill={A.chart.safeBand} opacity="0.13" />
        {hv && <HoverGuide x={hv.x} />}
        <line x1={PADL} y1={zero} x2={VW - PADR} y2={zero} stroke={A.chart.zeroLine} strokeWidth="1" strokeDasharray="4 3" />
        {line.length > 1 && <path d={dPath(line)} fill="none" stroke={A.chart.trend} strokeWidth="2" />}
        {hv && <circle cx={hv.x} cy={hv.yv} r="4" fill={A.ink} />}
        <text x={PADL - 5} y={y(hi) + 7} textAnchor="end" style={axisText}>+{hi.toFixed(1)}</text>
        <text x={PADL - 5} y={zero + 3} textAnchor="end" style={{ ...axisText, fill: A.body }}>0</text>
        <text x={PADL - 5} y={bandBot + 3} textAnchor="end" style={axisText}>−2.0</text>
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
  // one bar PER DAY: that day's logged intake minus THAT DAY'S estimated burn (skip
  // missing/incomplete days). The burn isn't a constant — it drifts as the cat's weight (and so
  // its maintenance) changes, so each day is measured against the frame's own expenditure for that
  // day (f.e), falling back to the latest estimate only when a day has none. Using a single flat
  // burn would misattribute a rising/falling baseline as a surplus/deficit.
  const daily = frame.map((f) => (f.kin != null && !f.kinImputed ? f.kin - (Number.isFinite(f.e) ? f.e : burn) : null));
  if (!daily.some((d) => d != null)) return <div style={{ fontSize: 12, color: A.muted, padding: "8px 0" }}>No complete days in range yet.</div>;
  // smoothed running average (EWMA over the days that have data) — the line on top.
  const alpha = 0.2;
  let ema = null;
  const smooth = [];
  daily.forEach((d, i) => { if (d == null) return; ema = ema == null ? d : alpha * d + (1 - alpha) * ema; smooth.push([xAt(i, n), i, ema]); });
  const maxAbs = Math.max(40, ...daily.map((d) => (d == null ? 0 : Math.abs(d))), ...smooth.map((s) => Math.abs(s[2])));
  const y = linScale([-maxAbs, maxAbs], [H - PADY, PADY]);
  const base = y(0);
  const bw = Math.max(1.5, (VW - PADL - PADR) / n - 1);
  const smoothPts = smooth.map(([x, , v]) => [x, y(v)]);
  const hv = idx != null && daily[idx] != null ? { x: xAt(idx, n), val: daily[idx], date: frame[idx].date } : null;
  return (
    <div {...bind}>
      {hv && <Tip vbx={hv.x}>{mmdd(hv.date)} · {hv.val > 0 ? "+" : "−"}{r0(Math.abs(hv.val))} kcal</Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        {daily.map((d, i) => {
          if (d == null) return null;
          const cx = xAt(i, n), yv = y(d);
          return <rect key={i} x={cx - bw / 2} y={Math.min(base, yv)} width={bw} height={Math.max(0.5, Math.abs(yv - base))} fill={d > 0 ? A.chart.overBurn : A.chart.underBurn} opacity={hv && i !== idx ? 0.55 : 0.9} />;
        })}
        <line x1={PADL} y1={base} x2={VW - PADR} y2={base} stroke={A.chart.zeroLine} strokeWidth="1" strokeDasharray="4 3" />
        {smoothPts.length > 1 && <path d={dPath(smoothPts)} fill="none" stroke={A.ink} strokeWidth="2" />}
        {hv && <HoverGuide x={hv.x} />}
        <text x={PADL - 5} y={PADY + 7} textAnchor="end" style={{ ...axisText, fill: A.chart.overBurnLabel }}>+{r0(maxAbs)}</text>
        <text x={PADL - 5} y={base + 3} textAnchor="end" style={{ ...axisText, fill: A.ink }}>burn</text>
        <text x={PADL - 5} y={H - PADY + 3} textAnchor="end" style={axisText}>−{r0(maxAbs)}</text>
        <text x={VW - PADR} y={base - 4} textAnchor="end" style={axisText}>≈{r0(burn)} kcal now</text>
      </svg>
      <XDates frame={frame} />
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
