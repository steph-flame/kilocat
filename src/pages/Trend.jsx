import { useState, useMemo } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { buildDailyFrame, weightChangeRate } from "../lib/timeline.js";
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

function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
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

const RANGES = [["3m", 90, "3m"], ["6m", 180, "6m"], ["all", null, "all"]];

export default function Trend() {
  const { p, t, expenditure: e, intakeLog, weightLog, intakeDayStatus, unit, today, currentWeight } = useApp();
  const [range, setRange] = useState("3m");
  const rangeDays = RANGES.find((r) => r[0] === range)[1];

  const bcs = pctToBcs(t.pctOver);
  const idealKg = currentWeight.kg > 0 ? currentWeight.kg / (1 + bcsToPct(bcs) / 100) : t.idealWeight;

  const frame = useMemo(
    () => buildDailyFrame(e.trend, intakeLog.items.map((x) => ({ date: x.date, value: x.kcal })), rangeDays, intakeDayStatus, today),
    [e.trend, intakeLog.items, rangeDays, intakeDayStatus, today]
  );
  const rates = useMemo(() => weightChangeRate(frame), [frame]);
  const weighDots = useMemo(() => {
    const byDate = new Map(frame.map((f, i) => [f.date, i]));
    return weightLog.items.filter((w) => byDate.has(w.date)).map((w) => ({ i: byDate.get(w.date), kg: w.kg }));
  }, [frame, weightLog.items]);

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
  const pm = r0(e.kcal - e.low); // ±95%
  const dispW = (kg) => toDisplayWeight(kg, unit);

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        <div style={{ padding: "18px 24px 0" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>trend · measured</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.26, letterSpacing: "-.012em", margin: "10px 0 4px" }}>
            {p.name || "Your cat"} burns about {burn} kcal a day.
          </h1>
          <p style={{ ...cap, margin: "0 0 4px" }}>Worked out from {e.nDays} days of weigh-ins and meals — not a formula's guess.</p>
        </div>

        {/* estimate card */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontFamily: TYPE.mono, fontSize: 40, fontWeight: 600, color: A.ink, lineHeight: 1 }}>{burn}</div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted, textAlign: "right" }}>±{pm} kcal<br />95% interval</div>
          </div>
          <IntervalBar lo={e.low} hi={e.high} point={e.kcal} />
          <p style={{ ...cap, fontSize: 11.5 }}>The band narrows as you log{e.missingIntake > 0 ? `; ${r0(e.missingIntake * 100)}% of days in range are incomplete and left out` : ""}.</p>
        </Card>

        {/* shared range control — outside the charts, governs all three */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 18px 12px" }}>
          <span style={label({ color: A.labelOnFill })}>Charts below show</span>
          <div style={{ display: "flex", gap: 5 }}>
            {RANGES.map(([key, , lbl]) => (
              <button key={key} onClick={() => setRange(key)} aria-pressed={range === key}
                style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "3px 11px", cursor: "pointer",
                  border: range === key ? "none" : `1px solid ${A.cardBorder}`, background: range === key ? A.ink : "transparent", color: range === key ? A.card : A.muted }}>{lbl}</button>
            ))}
          </div>
        </div>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Weight · {weightLabel(unit)}</div>
          <WeightChart frame={frame} dots={weighDots} idealKg={idealKg} disp={dispW} unit={unit} />
          <Legend items={[[A.chart.trend, "trend", "line"], [A.chart.weighDot, "weigh-in", "dot"], [A.chart.ideal, "ideal", "dash"]]} />
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Rate of change · %/wk</div>
          <RateChart rates={rates} frame={frame} />
          <p style={{ ...cap, fontSize: 11.5 }}>
            Currently {e.ratePctPerWeek < 0 ? "−" : e.ratePctPerWeek > 0 ? "+" : ""}{Math.abs(r1(e.ratePctPerWeek))}%/wk. The shaded band is the safe 0.5–2%/wk zone; above the dashed line she'd be gaining.
          </p>
        </Card>

        <Card style={{ padding: "12px 14px" }}>
          <div style={label({ marginBottom: 4 })}>Energy balance · kcal vs burn</div>
          <EnergyChart frame={frame} burn={e.kcal} />
          <p style={{ ...cap, fontSize: 11.5 }}>Weekly-average intake against her {burn} kcal burn. Bars below are a deficit (losing); above, a surplus.</p>
        </Card>

        {e.missingIntake > 0 && (
          <div style={{ background: A.caution.bg, border: `1px solid ${A.caution.border}`, borderRadius: 12, padding: "11px 13px", margin: "0 18px", display: "flex", gap: 8 }}>
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
  const weeks = [];
  for (let i = 0; i < frame.length; i += 7) {
    const chunk = frame.slice(i, i + 7).filter((f) => f.kin != null && !f.kinImputed);
    if (!chunk.length) continue;
    const avg = chunk.reduce((s, f) => s + f.kin, 0) / chunk.length;
    weeks.push({ mid: i + Math.min(6, frame.length - 1 - i) / 2, delta: avg - burn, date: frame[i]?.date });
  }
  if (!weeks.length) return <div style={{ fontSize: 12, color: A.muted, padding: "8px 0" }}>Not enough complete days in range yet.</div>;
  const maxAbs = Math.max(40, ...weeks.map((w) => Math.abs(w.delta)));
  const y = linScale([-maxAbs, maxAbs], [H - PADY, PADY]);
  const base = y(0);
  const bw = Math.min(26, (VW - PADL - PADR) / weeks.length - 4);
  const hw = idx != null ? weeks.reduce((b, w) => (Math.abs(w.mid - idx) < Math.abs(b.mid - idx) ? w : b), weeks[0]) : null;
  return (
    <div {...bind}>
      {hw && <Tip vbx={xAt(hw.mid, frame.length)}>wk of {mmdd(hw.date)} · {hw.delta > 0 ? "+" : "−"}{r0(Math.abs(hw.delta))} kcal</Tip>}
      <svg viewBox={`0 0 ${VW} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        {weeks.map((w, k) => {
          const cx = xAt(w.mid, frame.length);
          const yv = y(w.delta);
          const on = hw && w.mid === hw.mid;
          return <rect key={k} x={cx - bw / 2} y={Math.min(base, yv)} width={bw} height={Math.abs(yv - base)} rx="2" fill={w.delta > 0 ? A.chart.overBurn : A.chart.underBurn} opacity={hw && !on ? 0.5 : 1} />;
        })}
        <line x1={PADL} y1={base} x2={VW - PADR} y2={base} stroke={A.ink} strokeWidth="2" />
        <text x={PADL - 5} y={PADY + 7} textAnchor="end" style={{ ...axisText, fill: A.chart.overBurnLabel }}>+{r0(maxAbs)}</text>
        <text x={PADL - 5} y={base + 3} textAnchor="end" style={{ ...axisText, fill: A.ink }}>burn</text>
        <text x={PADL - 5} y={H - PADY + 3} textAnchor="end" style={axisText}>−{r0(maxAbs)}</text>
        <text x={VW - PADR} y={base - 4} textAnchor="end" style={axisText}>{burn} kcal</text>
        <text x={PADL + 2} y={PADY + 7} style={{ ...axisText, fill: A.chart.overBurnLabel }}>over ▲</text>
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
