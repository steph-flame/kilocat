import { useRef, useState } from "react";
import { C, CHART } from "../theme.js";
import { r0, r1 } from "../lib/util.js";
import { extent, niceTicks, linScale } from "../lib/scale.js";
import { toDisplayWeight, weightLabel, weeklyRate } from "../lib/units.js";

// x-aligned panels sharing one time axis: weight on top, energy (calories in vs. estimated
// expenditure) below, and optionally an energy-balance (deficit/surplus) panel. NOT a
// dual-axis overlay — each unit gets its own panel.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d) => { const t = new Date(`${d}T00:00:00Z`); return `${MON[t.getUTCMonth()]} ${t.getUTCDate()}`; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtTick = (v) => String(+v.toFixed(3));

function linePath(frame, accessor, xAt, yScale) {
  let d = "", pen = false;
  frame.forEach((p, i) => {
    const v = accessor(p);
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)} ${yScale(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

// A confidence band polygon (top edge L→R, bottom edge R→L) over points with a center + sd.
function bandPolygon(frame, center, xAt, yScale, k = 1.96) {
  const pts = frame.map((p, i) => ({ i, p })).filter(({ p }) => center(p) != null && p.sd != null);
  if (pts.length < 2) return "";
  const top = pts.map(({ i, p }) => `${i === pts[0].i ? "M" : "L"}${xAt(i).toFixed(1)} ${yScale(center(p) + k * p.sd).toFixed(1)}`).join("");
  const bot = pts.slice().reverse().map(({ i, p }) => `L${xAt(i).toFixed(1)} ${yScale(center(p) - k * p.sd).toFixed(1)}`).join("");
  return `${top}${bot}Z`;
}

export default function TimelineChart({ frame, range, onRange, ranges, unit = "kg", showBalance = false, rho = 8000 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const n = frame.length;

  const W = 640, padL = 46, padR = 14;
  const px0 = padL, px1 = W - padR;
  const wTop = 12, wH = 74;
  const eTop = wTop + wH + 30, eH = 96;
  const bTop = eTop + eH + 30, bH = 74;
  const xAxisY = showBalance ? bTop + bH : eTop + eH;
  const H = xAxisY + 22;

  const hasExp = frame.some((p) => p.e != null);
  const xAt = (i) => (n <= 1 ? (px0 + px1) / 2 : px0 + (i / (n - 1)) * (px1 - px0));
  const wOf = (p) => (p.w == null ? null : toDisplayWeight(p.w, unit));
  const defOf = (p) => (p.kin != null && p.e != null ? p.kin - p.e : null);

  if (n < 2) {
    return (
      <div>
        <RangeRow range={range} onRange={onRange} ranges={ranges} />
        <div style={{ color: C.faint, borderColor: C.line }} className="border border-dashed rounded-xl text-xs text-center py-10 mt-2">
          Not enough logged data to chart yet — add a couple weeks of weigh-ins.
        </div>
      </div>
    );
  }

  // weight scale
  const [wLo, wHi] = extent(frame.map(wOf));
  const wPad = (wHi - wLo) * 0.1 || 0.1;
  const wTicks = niceTicks(wLo - wPad, wHi + wPad, 4);
  const wY = linScale([wTicks[0], wTicks[wTicks.length - 1]], [wTop + wH, wTop]);

  // energy scale — to the lines, not the band (see the band comment below)
  const [eLo, eHi] = extent(frame.flatMap((p) => [p.kin, p.e]));
  const eTicks = niceTicks(eLo, eHi, 4);
  const eY = linScale([eTicks[0], eTicks[eTicks.length - 1]], [eTop + eH, eTop]);

  // balance scale (includes 0 so the reference line is on-chart)
  const bVals = frame.map(defOf).concat([0]);
  const [bLo, bHi] = extent(bVals);
  const bTicks = niceTicks(bLo, bHi, 4);
  const bY = linScale([bTicks[0], bTicks[bTicks.length - 1]], [bTop + bH, bTop]);

  const nLabels = Math.min(5, n);
  const xLabels = Array.from({ length: nLabels }, (_, k) => Math.round((k / (nLabels - 1)) * (n - 1)));

  const onMove = (ev) => {
    const rect = ref.current.getBoundingClientRect();
    setHover(clamp(Math.round(((ev.clientX - rect.left) / rect.width) * (n - 1)), 0, n - 1));
  };

  const hp = hover != null ? frame[hover] : null;
  const hx = hover != null ? xAt(hover) : 0;
  const last = frame[n - 1];
  const hDef = hp ? defOf(hp) : null;
  const hRate = hDef != null ? weeklyRate((hDef / rho) * 7, unit) : null;

  const gridAxis = (ticks, yScale, unitLbl, panelTop) => (
    <g>
      {ticks.map((tv) => (
        <g key={tv}>
          <line x1={px0} x2={px1} y1={yScale(tv)} y2={yScale(tv)} stroke={C.line} strokeWidth="1" />
          <text x={px0 - 6} y={yScale(tv) + 3} textAnchor="end" fontSize="9" fontFamily="monospace" fill={C.faint}>{fmtTick(tv)}</text>
        </g>
      ))}
      <text x={px0 - 6} y={panelTop - 3} textAnchor="end" fontSize="8" fontFamily="monospace" fill={C.faint}>{unitLbl}</text>
    </g>
  );

  return (
    <div>
      <RangeRow range={range} onRange={onRange} ranges={ranges} />
      <div style={{ position: "relative" }} className="mt-2">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", touchAction: "none" }}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <clipPath id="eClip"><rect x={px0} y={eTop} width={px1 - px0} height={eH} /></clipPath>
            <clipPath id="bClip"><rect x={px0} y={bTop} width={px1 - px0} height={bH} /></clipPath>
          </defs>

          <text x={px0} y={wTop - 3} fontSize="9" fontFamily="monospace" fill={C.sub}>Weight · {weightLabel(unit)}</text>
          <text x={px0} y={eTop - 8} fontSize="9" fontFamily="monospace" fill={C.sub}>Energy · kcal/day</text>
          {gridAxis(wTicks, wY, weightLabel(unit), wTop)}
          {gridAxis(eTicks, eY, "kcal", eTop)}

          {/* weight */}
          <path d={linePath(frame, wOf, xAt, wY)} fill="none" stroke={CHART.weight} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* energy (band + two lines, clipped) */}
          <g clipPath="url(#eClip)">
            <path d={bandPolygon(frame, (p) => p.e, xAt, eY)} fill={CHART.expenditure} opacity="0.12" />
            <path d={linePath(frame, (p) => p.kin, xAt, eY)} fill="none" stroke={CHART.intake} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {hasExp && <path d={linePath(frame, (p) => p.e, xAt, eY)} fill="none" stroke={CHART.expenditure} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          </g>

          {/* balance panel (optional) */}
          {showBalance && (
            <>
              <text x={px0} y={bTop - 8} fontSize="9" fontFamily="monospace" fill={C.sub}>Balance · kcal/day (deficit −)</text>
              {gridAxis(bTicks, bY, "kcal", bTop)}
              <g clipPath="url(#bClip)">
                <path d={bandPolygon(frame, defOf, xAt, bY)} fill={C.ink} opacity="0.08" />
                <path d={linePath(frame, defOf, xAt, bY)} fill="none" stroke={C.ink} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
              <line x1={px0} x2={px1} y1={bY(0)} y2={bY(0)} stroke={C.sub} strokeWidth="1" strokeDasharray="2 2" />
            </>
          )}

          {/* end-of-line direct labels */}
          <EndDot x={xAt(n - 1)} y={wY(wOf(last))} color={CHART.weight} label={`${r1(wOf(last))} ${weightLabel(unit)}`} />
          {hasExp && last.e != null && <EndDot x={xAt(n - 1)} y={eY(last.e)} color={CHART.expenditure} label={`${r0(last.e)}`} />}

          {/* x-axis */}
          {xLabels.map((i) => (
            <text key={i} x={clamp(xAt(i), px0 + 8, px1 - 8)} y={xAxisY + 14} textAnchor="middle" fontSize="9" fontFamily="monospace" fill={C.faint}>{fmtDate(frame[i].date)}</text>
          ))}

          {/* hover crosshair */}
          {hp && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={wTop} y2={xAxisY} stroke={C.sub} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              {wOf(hp) != null && <circle cx={hx} cy={wY(wOf(hp))} r="3.5" fill={CHART.weight} stroke="#fff" strokeWidth="1.5" />}
              {hp.kin != null && <circle cx={hx} cy={eY(hp.kin)} r="3.5" fill={CHART.intake} stroke="#fff" strokeWidth="1.5" />}
              {hasExp && hp.e != null && <circle cx={hx} cy={eY(hp.e)} r="3.5" fill={CHART.expenditure} stroke="#fff" strokeWidth="1.5" />}
              {showBalance && hDef != null && <circle cx={hx} cy={bY(hDef)} r="3.5" fill={C.ink} stroke="#fff" strokeWidth="1.5" />}
            </g>
          )}
        </svg>

        {hp && (
          <div style={{ position: "absolute", top: 0, left: `${clamp((hover / (n - 1)) * 100, 0, 100)}%`,
            transform: `translateX(${hover / (n - 1) > 0.6 ? "-105%" : "8px"})`, background: C.card, borderColor: C.line, pointerEvents: "none" }}
            className="border rounded-lg px-2 py-1.5 text-xs shadow-sm font-mono whitespace-nowrap">
            <div style={{ color: C.sub }} className="mb-0.5">{fmtDate(hp.date)}</div>
            <TipRow color={CHART.weight} label="weight" value={wOf(hp) != null ? `${r1(wOf(hp))} ${weightLabel(unit)}` : "—"} />
            <TipRow color={CHART.intake} label="in" value={hp.kin != null ? `${r0(hp.kin)} kcal` : "—"} />
            {hasExp && <TipRow color={CHART.expenditure} label="burns" value={hp.e != null ? `${r0(hp.e)} kcal` : "—"} />}
            {showBalance && <TipRow color={C.ink} label="balance" value={hDef != null ? `${hDef > 0 ? "+" : ""}${r0(hDef)} kcal · ${r0(hRate.value)} ${hRate.unit}` : "—"} />}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: C.sub }}>
        <LegendChip color={CHART.weight} label="weight" />
        <LegendChip color={CHART.intake} label="calories in" />
        {hasExp && <LegendChip color={CHART.expenditure} label="est. expenditure" band />}
        {showBalance && <LegendChip color={C.ink} label="balance (in − burns)" />}
      </div>
    </div>
  );
}

function RangeRow({ range, onRange, ranges }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: C.sub }} className="text-xs">Timeline</span>
      <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: C.line }}>
        {ranges.map((r) => (
          <button key={r.key} onClick={() => onRange(r.key)} style={{ background: range === r.key ? C.spruce : "transparent", color: range === r.key ? "#fff" : C.sub }} className="text-xs px-2.5 py-1 font-mono">{r.label}</button>
        ))}
      </div>
    </div>
  );
}

function EndDot({ x, y, color, label }) {
  return (
    <g>
      <circle cx={x} cy={y} r="3" fill={color} stroke="#fff" strokeWidth="1.5" />
      <text x={x - 6} y={y - 6} textAnchor="end" fontSize="9" fontFamily="monospace" fill={color} fontWeight="600">{label}</text>
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

function LegendChip({ color, label, band }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ background: color, opacity: band ? 0.5 : 1 }} className="inline-block w-4 h-[3px] rounded-full" />
      {label}
    </span>
  );
}
