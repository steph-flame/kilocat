import { useRef, useState, useEffect } from "react";
import { C, CHART } from "../theme.js";
import { r0, r1 } from "../lib/util.js";
import { extent, niceTicks, linScale } from "../lib/scale.js";
import { diffDays } from "../lib/series.js";
import { weightChangeRate, pickEndLabelBelow, energyDomain } from "../lib/timeline.js";
import { RATE, safeRateBand, MAINTAIN_BAND } from "../lib/weightPlan.js";
import { toDisplayWeight, weightLabel, weeklyRate } from "../lib/units.js";

// x-aligned panels sharing one time axis: weight on top, energy (calories in vs. estimated
// expenditure) below, and optionally an energy-balance (deficit/surplus) panel. NOT a
// dual-axis overlay — each unit gets its own panel.
//
// Each panel is its own <svg> "subsection": an HTML header row (title left, that panel's own
// mini-legend chips right) sits above it, with real vertical whitespace between subsections —
// the single shared canvas from pass 1 crowded a panel's title against the one above it. All
// panels still share the same viewBox width and left/right padding (px0/px1 below), so the
// date→x mapping lines up across subsections even though each draws into its own SVG; hover
// state (below) is tracked once on the wrapping div and fanned out to every panel's own
// crosshair. x-axis date labels are drawn only inside the LAST visible panel's svg. The single
// bottom legend from pass 1 is gone — its entries now live in each panel's own header.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d, withYear) => { const t = new Date(`${d}T00:00:00Z`); return `${MON[t.getUTCMonth()]} ${t.getUTCDate()}${withYear ? ` '${d.slice(2, 4)}` : ""}`; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtTick = (v) => String(+v.toFixed(3));

function linePath(frame, accessor, xAt, yScale) {
  let d = "", pen = false;
  frame.forEach((p, i) => {
    const v = accessor(p, i);
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${yScale(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

// A confidence band polygon (top edge L→R, bottom edge R→L) over points with a center + sd.
function bandPolygon(frame, center, xAt, yScale, k = 1.96) {
  const pts = frame.map((p, i) => ({ i, p })).filter(({ p, i }) => center(p, i) != null && p.sd != null);
  if (pts.length < 2) return "";
  const top = pts.map(({ i, p }) => `${i === pts[0].i ? "M" : "L"}${xAt(i).toFixed(1)} ${yScale(center(p, i) + k * p.sd).toFixed(1)}`).join("");
  const bot = pts.slice().reverse().map(({ i, p }) => `L${xAt(i).toFixed(1)} ${yScale(center(p, i) - k * p.sd).toFixed(1)}`).join("");
  return `${top}${bot}Z`;
}

// Per-panel internal top/bottom padding (headroom for tick labels and end-of-line labels so
// they never crowd that panel's OWN top/bottom edge — a separate concern from the whitespace
// BETWEEN panels, which is real DOM margin on the header rows below).
const PAD = 8;
const AXIS_H = 22; // x-axis date row, appended only to whichever panel is drawn last

export default function TimelineChart({ frame, range, onRange, ranges, unit = "kg", analysisMode = null, rho = 7800, planDirection = "maintain" }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const n = frame.length;
  const showAnalysis = analysisMode != null;
  const isRate = analysisMode === "rate";

  const W = 640, padL = 46, padR = 14;
  const px0 = padL, px1 = W - padR;
  // Enlarge SVG-unit font sizes on narrow screens: the viewBox scales to the container, so a
  // hardcoded 9px would render at ~4.5px on a 320px phone. fs = W/displayed-px, clamped.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setWidth(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const fs = clamp(W / Math.max(width || W, 220), 1, 2);
  const wH = 74, eH = 96, bH = 74;

  const hasExp = frame.some((p) => p.e != null);
  const xAt = (i) => (n <= 1 ? (px0 + px1) / 2 : px0 + (i / (n - 1)) * (px1 - px0));
  const wOf = (p) => (p.w == null ? null : toDisplayWeight(p.w, unit));
  const defOf = (p) => (p.kin != null && p.e != null ? p.kin - p.e : null);
  // analysis series: weight-change rate (%/week, smoothed) or caloric balance (kcal).
  const rateSeries = n >= 2 ? weightChangeRate(frame) : [];
  const aOf = (p, i) => (isRate ? (rateSeries[i] ? rateSeries[i].pctPerWeek : null) : defOf(p));

  if (n < 1) {
    return (
      <div>
        <RangeRow range={range} onRange={onRange} ranges={ranges} />
        <div style={{ color: C.faint, borderColor: C.line }} className="border border-dashed rounded-xl text-xs text-center py-10 mt-2">
          No logged data yet — log a weigh-in to start the timeline.
        </div>
      </div>
    );
  }

  // Which panel is drawn last (gets the x-axis date row).
  const lastPanel = showAnalysis ? "rate" : "energy";
  // Full viewBox height for a panel of body-height H: internal top+bottom padding, plus the
  // x-axis strip if (and only if) this is the last visible panel.
  const panelViewH = (H, isLast) => (isLast ? PAD + H + AXIS_H : PAD + H + PAD);
  const axisLabelY = (H) => PAD + H + 14;

  // weight scale
  const [wLo, wHi] = extent(frame.map(wOf));
  const wPad = (wHi - wLo) * 0.15 || 0.15;
  const wTicks = niceTicks(wLo - wPad, wHi + wPad, 4);
  const wY = linScale([wTicks[0], wTicks[wTicks.length - 1]], [PAD + wH, PAD]);

  // energy scale — the domain must cover the confidence band's full extent, not just the two
  // lines (see energyDomain in timeline.js): a wide early-history band must never clip at the
  // panel edge, even though the lines compress toward the middle as a result — that compression
  // IS the honest picture of low confidence, and it visibly "zooms in" as the band narrows.
  const [eLo, eHi] = energyDomain(frame);
  const eTicks = niceTicks(eLo, eHi, 4);
  const eY = linScale([eTicks[0], eTicks[eTicks.length - 1]], [PAD + eH, PAD]);

  // analysis scale (includes 0 so the reference line is on-chart; in rate mode also the
  // active safe-zone's bounds, so the shaded zone is always fully visible even when the
  // actual data never reaches it)
  const rateZone = isRate ? safeRateBand(planDirection) : null;
  const aVals = frame.map((p, i) => aOf(p, i)).concat([0]);
  if (rateZone) aVals.push(rateZone.lo, rateZone.hi);
  const [bLo, bHi] = extent(aVals);
  const bTicks = niceTicks(bLo, bHi, 4);
  const bY = linScale([bTicks[0], bTicks[bTicks.length - 1]], [PAD + bH, PAD]);

  const nLabels = Math.min(5, n);
  const xLabels = Array.from({ length: nLabels }, (_, k) => (nLabels <= 1 ? 0 : Math.round((k / (nLabels - 1)) * (n - 1))));
  // show the year on long spans / when the window crosses a year boundary
  const showYear = frame[0].date.slice(0, 4) !== frame[n - 1].date.slice(0, 4) || diffDays(frame[0].date, frame[n - 1].date) > 300;

  // Hover tracking lives on the wrapping div (not any one panel's svg) — every panel's own
  // crosshair reads the same `hover` index, so they move together across subsections even
  // though each is a separate SVG element.
  const onMove = (ev) => {
    const rect = ref.current.getBoundingClientRect();
    setHover(clamp(Math.round(((ev.clientX - rect.left) / rect.width) * (n - 1)), 0, n - 1));
  };
  const onTouch = (ev) => { const t = ev.touches && ev.touches[0]; if (t) onMove(t); };

  const hp = hover != null ? frame[hover] : null;
  const hx = hover != null ? xAt(hover) : 0;
  const last = frame[n - 1];
  const prev = n >= 2 ? frame[n - 2] : null;
  // End-of-line label placement for the two energy-panel series (intake defaults below,
  // expenditure defaults above, so the two are never on the same side by default) — nudged to
  // dodge each one's own incoming line segment, unless the two end points sit close enough
  // together that keeping them apart matters more (see pickEndLabelBelow).
  const kinPx = last.kin != null ? eY(last.kin) : null;
  const ePx = hasExp && last.e != null ? eY(last.e) : null;
  const intakeBelow = pickEndLabelBelow({ prevValue: prev?.kin, lastValue: last.kin, preferBelow: true, ownPx: kinPx, otherPx: ePx });
  const expBelow = pickEndLabelBelow({ prevValue: prev?.e, lastValue: last.e, preferBelow: false, ownPx: ePx, otherPx: kinPx });
  const hDef = hp ? defOf(hp) : null;
  const hRate = hDef != null ? weeklyRate((hDef / rho) * 7, unit) : null;
  const hA = hp ? aOf(hp, hover) : null;
  const hRateW = hp && rateSeries[hover] ? weeklyRate(rateSeries[hover].kgPerWeek, unit) : null;

  // Tick numbers only — the unit ("lb"/"kcal"/"%/wk") lives solely in each panel's own HTML
  // header (e.g. "Weight · lb"), so it never overprints the topmost tick number.
  const gridAxis = (ticks, yScale) => (
    <g>
      {ticks.map((tv) => (
        <g key={tv}>
          <line x1={px0} x2={px1} y1={yScale(tv)} y2={yScale(tv)} stroke={C.line} strokeWidth="1" />
          <text x={px0 - 6} y={yScale(tv) + 3} textAnchor="end" fontSize={9 * fs} fontFamily="monospace" fill={C.faint}>{fmtTick(tv)}</text>
        </g>
      ))}
    </g>
  );

  const crosshairLine = (top, bottom) => hp && (
    <line x1={hx} x2={hx} y1={top} y2={bottom} stroke={C.sub} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" pointerEvents="none" />
  );

  const xAxisRow = (H) => (
    <>
      {xLabels.map((i) => (
        <text key={i} x={clamp(xAt(i), px0 + 8, px1 - 8)} y={axisLabelY(H)} textAnchor="middle" fontSize={9 * fs} fontFamily="monospace" fill={C.faint}>{fmtDate(frame[i].date, showYear)}</text>
      ))}
    </>
  );

  const summary = `Timeline over ${range}. Latest weight ${r1(wOf(last))} ${weightLabel(unit)}`
    + (hasExp && last.e != null ? `, estimated expenditure ${r0(last.e)} kcal/day` : "")
    + (last.kin != null ? `, ${r0(last.kin)} kcal in` : "") + ".";

  const hasImputed = frame.some((p) => p.kinImputed && p.kin != null);

  return (
    <div>
      <RangeRow range={range} onRange={onRange} ranges={ranges} />
      <div ref={ref} style={{ position: "relative" }} className="mt-2" role="img" aria-label={summary}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onTouch} onTouchMove={onTouch}>

        {/* Weight subsection */}
        <PanelHeader W={W} px0={px0} px1={px1} title={`Weight · ${weightLabel(unit)}`}
          chips={<LegendChip color={CHART.weight} label="weight" />} />
        <svg viewBox={`0 0 ${W} ${panelViewH(wH, lastPanel === "weight")}`} width="100%" style={{ display: "block", touchAction: "none" }} aria-hidden="true">
          {gridAxis(wTicks, wY)}
          <path d={linePath(frame, wOf, xAt, wY)} fill="none" stroke={CHART.weight} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <EndDot x={xAt(n - 1)} y={wY(wOf(last))} color={CHART.weight} label={`${r1(wOf(last))} ${weightLabel(unit)}`} fs={fs} />
          {hp && (
            <g pointerEvents="none">
              {crosshairLine(PAD, PAD + wH)}
              {wOf(hp) != null && <circle cx={hx} cy={wY(wOf(hp))} r="3.5" fill={CHART.weight} stroke="#fff" strokeWidth="1.5" />}
            </g>
          )}
        </svg>

        {/* Energy subsection */}
        <PanelHeader W={W} px0={px0} px1={px1} title="Energy · kcal/day" separator
          chips={<>
            <LegendChip color={CHART.intake} label="calories in" />
            {hasExp && <LegendChip color={CHART.expenditure} label="est. expenditure" />}
            {hasExp && <LegendChip color={CHART.expenditure} label="shaded = 95% confidence" band />}
            {hasImputed && <LegendChip color={CHART.intake} label="imputed / excluded" hollow />}
          </>} />
        <svg viewBox={`0 0 ${W} ${panelViewH(eH, lastPanel === "energy")}`} width="100%" style={{ display: "block", touchAction: "none" }} aria-hidden="true">
          <defs><clipPath id="eClip"><rect x={px0} y={PAD} width={px1 - px0} height={eH} /></clipPath></defs>
          {gridAxis(eTicks, eY)}
          <g clipPath="url(#eClip)">
            <path d={bandPolygon(frame, (p) => p.e, xAt, eY)} fill={CHART.expenditure} opacity="0.2" />
            {/* intake is logged, day-to-day, noisy data (unlike the smoothed trend/expenditure
                lines) — over long ranges the raw zigzag reads as visual noise, so it's drawn
                thinner and slightly translucent. Still the real per-day numbers, just quieter;
                the end dot/hover point stay full-strength for precision. */}
            <path d={linePath(frame, (p) => p.kin, xAt, eY)} fill="none" stroke={CHART.intake} strokeWidth="1.5" opacity="0.85" strokeLinejoin="round" strokeLinecap="round" />
            {hasExp && <path d={linePath(frame, (p) => p.e, xAt, eY)} fill="none" stroke={CHART.expenditure} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
            {/* honesty markers: a day the estimator didn't trust (no entries that day, or
                flagged incomplete) — hollow so it visually reads as "not counted", not as a
                normal logged point. Only drawn where there IS a kin value to place it at;
                a day with no entries at all is already a gap in the line above. */}
            {frame.map((p, i) => p.kinImputed && p.kin != null && (
              <circle key={p.date} cx={xAt(i)} cy={eY(p.kin)} r="2.5" fill="none" stroke={CHART.intake} strokeWidth="1.5" />
            ))}
          </g>
          {last.kin != null && <EndDot x={xAt(n - 1)} y={kinPx} color={CHART.intake} label={`${r0(last.kin)}`} fs={fs} below={intakeBelow} hollow={last.kinImputed} />}
          {hasExp && last.e != null && <EndDot x={xAt(n - 1)} y={ePx} color={CHART.expenditure} label={`${r0(last.e)}`} fs={fs} below={expBelow} />}
          {hp && (
            <g pointerEvents="none">
              {crosshairLine(PAD, PAD + eH)}
              {hp.kin != null && (hp.kinImputed
                ? <circle cx={hx} cy={eY(hp.kin)} r="3.5" fill="none" stroke={CHART.intake} strokeWidth="2" />
                : <circle cx={hx} cy={eY(hp.kin)} r="3.5" fill={CHART.intake} stroke="#fff" strokeWidth="1.5" />)}
              {hasExp && hp.e != null && <circle cx={hx} cy={eY(hp.e)} r="3.5" fill={CHART.expenditure} stroke="#fff" strokeWidth="1.5" />}
            </g>
          )}
          {lastPanel === "energy" && xAxisRow(eH)}
        </svg>

        {/* Rate / balance subsection (optional) */}
        {showAnalysis && (
          <>
            <PanelHeader W={W} px0={px0} px1={px1} separator
              title={isRate ? "Rate · %/week (loss −)" : "Balance · kcal/day (deficit −)"}
              chips={<LegendChip color={C.ink} label={isRate ? "weight-change rate" : "balance (in − burns)"} />} />
            <svg viewBox={`0 0 ${W} ${panelViewH(bH, lastPanel === "rate")}`} width="100%" style={{ display: "block", touchAction: "none" }} aria-hidden="true">
              <defs><clipPath id="bClip"><rect x={px0} y={PAD} width={px1 - px0} height={bH} /></clipPath></defs>
              {gridAxis(bTicks, bY)}
              {isRate && rateZone && (
                <g clipPath="url(#bClip)">
                  {/* safe-rate zone: C.ok specifically (not CHART.expenditure) — this is a
                      safe-state indicator, not the trend series, and must stay green even in
                      skins where data1/second diverge from ok. Shades ONLY the side of zero the
                      feeding plan is actually aiming for (rateZone from safeRateBand) — the
                      axis reads "loss −", so a losing cat's safe zone is negative, a gaining
                      cat's is positive, and "maintain" gets a thin band centered on zero. A
                      single rect spanning rateZone.lo→hi covers whichever case is active. */}
                  <rect x={px0} width={px1 - px0} y={bY(rateZone.hi)} height={Math.max(0, bY(rateZone.lo) - bY(rateZone.hi))} fill={C.ok} opacity="0.14" />
                  {[rateZone.lo, rateZone.hi].map((v) => (
                    <line key={v} x1={px0} x2={px1} y1={bY(v)} y2={bY(v)} stroke={C.ok} strokeWidth="1" strokeDasharray="2 3" opacity="0.55" />
                  ))}
                  {/* label sits inside the band, anchored near whichever edge is farthest from
                      zero (the "extreme" bound), nudged inward so it never crosses the border */}
                  <text x={px1 - 2} y={(Math.abs(rateZone.lo) > Math.abs(rateZone.hi) ? bY(rateZone.lo) - 3 : bY(rateZone.hi) + 10 * fs)} textAnchor="end" fontSize={8 * fs} fontFamily="monospace" fill={C.ok}>
                    {planDirection === "maintain" ? `stable ±${MAINTAIN_BAND}%/wk` : `safe ${RATE.min}–${RATE.max}%/wk`}
                  </text>
                </g>
              )}
              <g clipPath="url(#bClip)">
                {!isRate && <path d={bandPolygon(frame, aOf, xAt, bY)} fill={C.ink} opacity="0.16" />}
                <path d={linePath(frame, aOf, xAt, bY)} fill="none" stroke={C.ink} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
              <line x1={px0} x2={px1} y1={bY(0)} y2={bY(0)} stroke={C.sub} strokeWidth="1" strokeDasharray="2 2" />
              {hp && (
                <g pointerEvents="none">
                  {crosshairLine(PAD, PAD + bH)}
                  {/* balance is derived straight from kin (in − burns), so a day the estimate
                      didn't trust (today's still-running total, or a flagged/imputed day) gets
                      the same hollow treatment as the energy panel's kin point above — rate
                      mode is weight-only and untouched by this. */}
                  {hA != null && (!isRate && hp.kinImputed
                    ? <circle cx={hx} cy={bY(hA)} r="3.5" fill="none" stroke={C.ink} strokeWidth="2" />
                    : <circle cx={hx} cy={bY(hA)} r="3.5" fill={C.ink} stroke="#fff" strokeWidth="1.5" />)}
                </g>
              )}
              {lastPanel === "rate" && xAxisRow(bH)}
            </svg>
          </>
        )}

        {hp && (
          <div style={{ position: "absolute", top: 0, left: `${clamp(n <= 1 ? 0 : (hover / (n - 1)) * 100, 0, 100)}%`,
            transform: `translateX(${(n > 1 && hover / (n - 1) > 0.6) ? "-105%" : "8px"})`, background: C.card, borderColor: C.line, pointerEvents: "none" }}
            className="border rounded-lg px-2 py-1.5 text-xs shadow-sm font-mono whitespace-nowrap">
            <div style={{ color: C.sub }} className="mb-0.5">{fmtDate(hp.date, showYear)}</div>
            <TipRow color={CHART.weight} label="weight" value={wOf(hp) != null ? `${r1(wOf(hp))} ${weightLabel(unit)}` : "—"} />
            <TipRow color={CHART.intake} label="in" value={hp.kin != null ? `${r0(hp.kin)} kcal${hp.kinImputed ? " (excluded)" : ""}` : "—"} />
            {hasExp && <TipRow color={CHART.expenditure} label="burns" value={hp.e != null ? `${r0(hp.e)} kcal` : "—"} />}
            {showAnalysis && isRate && <TipRow color={C.ink} label="rate" value={hA != null ? `${hA > 0 ? "+" : ""}${r1(hA)} %/wk · ${r0(hRateW.value)} ${hRateW.unit}` : "—"} />}
            {showAnalysis && !isRate && <TipRow color={C.ink} label="balance" value={hDef != null ? `${hDef > 0 ? "+" : ""}${r0(hDef)} kcal · ${r0(hRate.value)} ${hRate.unit}` : "—"} />}
          </div>
        )}
      </div>

      {/* screen-reader / no-pointer data fallback for the SVG. The sr-only class goes on a
          wrapper div, NOT the table: tables ignore width:1px (content min-width wins) and
          overflow doesn't reliably apply to table boxes, so a classed table leaks its full
          intrinsic width into the page's scrollWidth on narrow screens. */}
      <div className="sr-only">
      <table>
        <caption>{summary}</caption>
        <thead><tr><th>Date</th><th>Weight ({weightLabel(unit)})</th><th>Calories in (kcal)</th>{hasExp && <th>Est. expenditure (kcal)</th>}<th>Counted in estimate</th></tr></thead>
        <tbody>
          {frame.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{wOf(p) != null ? r1(wOf(p)) : "—"}</td>
              <td>{p.kin != null ? r0(p.kin) : "—"}</td>
              {hasExp && <td>{p.e != null ? r0(p.e) : "—"}</td>}
              <td>{p.kin == null ? "—" : p.kinImputed ? "no — excluded" : "yes"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function RangeRow({ range, onRange, ranges }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: C.sub }} className="text-xs">Timeline</span>
      <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
        {ranges.map((r) => (
          <button key={r.key} onClick={() => onRange(r.key)} aria-pressed={range === r.key} style={{ background: range === r.key ? C.spruce : "transparent", color: range === r.key ? "#fff" : C.sub }} className="text-xs px-2.5 py-1 font-mono">{r.label}</button>
        ))}
      </div>
    </div>
  );
}

// A panel subsection's header row: title left, that panel's own mini-legend chips right.
// Horizontal padding mirrors the plot area's own left/right edges (px0/px1 in the svg below,
// expressed as a % of the shared viewBox width W) so the header visually lines up with the
// chart it introduces, not with the container's raw edge. `separator` draws a faint hairline
// above the header — the visual break between this subsection and the one above it — plus
// the vertical whitespace that comes from ordinary margin.
function PanelHeader({ W, px0, px1, title, chips, separator = false }) {
  return (
    <div
      style={{
        paddingLeft: `${(px0 / W) * 100}%`, paddingRight: `${((W - px1) / W) * 100}%`,
        marginTop: separator ? 20 : 0, paddingTop: separator ? 10 : 0,
        borderTop: separator ? `1px solid ${C.line}` : "none",
      }}
      className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1"
    >
      <span style={{ color: C.sub }} className="text-xs font-mono">{title}</span>
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: C.sub }}>{chips}</div>
    </div>
  );
}

function EndDot({ x, y, color, label, fs = 1, below = false, hollow = false }) {
  return (
    <g>
      <circle cx={x} cy={y} r="3" fill={hollow ? "none" : color} stroke={hollow ? color : "#fff"} strokeWidth={hollow ? "1.5" : "1.5"} />
      <text x={x - 6} y={y + (below ? 10 * fs : -6)} textAnchor="end" fontSize={9 * fs} fontFamily="monospace" fill={color} fontWeight="600">{label}</text>
    </g>
  );
}

function TipRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ background: color }} className="inline-block w-2 h-2 rounded-full shrink-0" />
      <span style={{ color: C.faint }}>{label}</span>
      <span style={{ color: C.ink }} className="ml-auto tabular-nums">{value}</span>
    </div>
  );
}

function LegendChip({ color, label, band, hollow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {hollow ? (
        <span style={{ borderColor: color }} className="inline-block w-2 h-2 rounded-full border" />
      ) : (
        <span style={{ background: color, opacity: band ? 0.5 : 1 }} className="inline-block w-4 h-[3px] rounded-full" />
      )}
      {label}
    </span>
  );
}
