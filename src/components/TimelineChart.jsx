import { useRef, useState } from "react";
import { C, CHART } from "../theme.js";
import { r0, r1 } from "../lib/util.js";
import { extent, niceTicks, linScale } from "../lib/scale.js";

// Two x-aligned panels sharing one time axis: weight (kg) on top, energy (kcal — calories
// in vs. estimated expenditure) below. NOT a dual-axis overlay — two units get two panels,
// so the intake↔expenditure gap sits right above the weight it drives.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d) => { const t = new Date(`${d}T00:00:00Z`); return `${MON[t.getUTCMonth()]} ${t.getUTCDate()}`; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtTick = (v) => String(+v.toFixed(3)); // strip float noise (5.8000001 → "5.8")

// Build an SVG path from a value accessor, breaking the line at null gaps.
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

export default function TimelineChart({ frame, range, onRange, ranges }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const n = frame.length;

  const W = 640, padL = 44, padR = 14;
  const px0 = padL, px1 = W - padR;
  const wTop = 12, wH = 78;
  const eTop = wTop + wH + 30, eH = 104;
  const xAxisY = eTop + eH;
  const H = xAxisY + 22;

  const hasExp = frame.some((p) => p.e != null);
  const xAt = (i) => (n <= 1 ? (px0 + px1) / 2 : px0 + (i / (n - 1)) * (px1 - px0));

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

  // scales (nice ticks define the domain so gridlines land on round numbers)
  const wPad = 0.05;
  const [wLo, wHi] = extent(frame.map((p) => p.w));
  const wTicks = niceTicks(wLo - wPad, wHi + wPad, 4);
  const wY = linScale([wTicks[0], wTicks[wTicks.length - 1]], [wTop + wH, wTop]);

  // Scale the energy axis to the LINES (intake + expenditure), not the confidence band —
  // the early band is prior-dominated and huge, and would otherwise crush the real signal.
  // The band is drawn but clipped to the panel.
  const [eLo, eHi] = extent(frame.flatMap((p) => [p.kin, p.e]));
  const eTicks = niceTicks(eLo, eHi, 4);
  const eY = linScale([eTicks[0], eTicks[eTicks.length - 1]], [eTop + eH, eTop]);

  // expenditure confidence band (top edge L→R, bottom edge R→L)
  let bandPath = "";
  const bandPts = frame.map((p, i) => ({ i, p })).filter(({ p }) => p.e != null && p.sd != null);
  if (bandPts.length > 1) {
    bandPath = bandPts.map(({ i, p }) => `${i === bandPts[0].i ? "M" : "L"}${xAt(i).toFixed(1)} ${eY(p.e + 1.96 * p.sd).toFixed(1)}`).join("")
      + bandPts.slice().reverse().map(({ i, p }) => `L${xAt(i).toFixed(1)} ${eY(p.e - 1.96 * p.sd).toFixed(1)}`).join("") + "Z";
  }

  // x-axis date labels (≤5 evenly spaced)
  const nLabels = Math.min(5, n);
  const xLabels = Array.from({ length: nLabels }, (_, k) => Math.round((k / (nLabels - 1)) * (n - 1)));

  const onMove = (ev) => {
    const rect = ref.current.getBoundingClientRect();
    const frac = (ev.clientX - rect.left) / rect.width;
    setHover(clamp(Math.round(frac * (n - 1)), 0, n - 1));
  };

  const hp = hover != null ? frame[hover] : null;
  const hx = hover != null ? xAt(hover) : 0;
  const lastW = frame[n - 1];

  const gridAxis = (ticks, yScale, unit, panelTop, panelH) => (
    <g>
      {ticks.map((tv) => (
        <g key={tv}>
          <line x1={px0} x2={px1} y1={yScale(tv)} y2={yScale(tv)} stroke={C.line} strokeWidth="1" />
          <text x={px0 - 6} y={yScale(tv) + 3} textAnchor="end" fontSize="9" fontFamily="monospace" fill={C.faint}>{fmtTick(tv)}</text>
        </g>
      ))}
      <text x={px0 - 6} y={panelTop - 3} textAnchor="end" fontSize="8" fontFamily="monospace" fill={C.faint}>{unit}</text>
    </g>
  );

  return (
    <div>
      <RangeRow range={range} onRange={onRange} ranges={ranges} />
      <div style={{ position: "relative" }} className="mt-2">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", touchAction: "none" }}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <clipPath id="energyClip"><rect x={px0} y={eTop} width={px1 - px0} height={eH} /></clipPath>
          </defs>
          {/* panel titles */}
          <text x={px0} y={wTop - 3} fontSize="9" fontFamily="monospace" fill={C.sub}>Weight · kg</text>
          <text x={px0} y={eTop - 8} fontSize="9" fontFamily="monospace" fill={C.sub}>Energy · kcal/day</text>

          {gridAxis(wTicks, wY, "kg", wTop)}
          {gridAxis(eTicks, eY, "kcal", eTop)}

          {/* weight line */}
          <path d={linePath(frame, (p) => p.w, xAt, wY)} fill="none" stroke={CHART.weight} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* energy: band, then the two lines (clipped to the panel) */}
          <g clipPath="url(#energyClip)">
            {bandPath && <path d={bandPath} fill={CHART.expenditure} opacity="0.12" />}
            <path d={linePath(frame, (p) => p.kin, xAt, eY)} fill="none" stroke={CHART.intake} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {hasExp && <path d={linePath(frame, (p) => p.e, xAt, eY)} fill="none" stroke={CHART.expenditure} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          </g>

          {/* data-end markers (selective direct labels: last value only) */}
          <EndDot x={xAt(n - 1)} y={wY(lastW.w)} color={CHART.weight} label={`${r1(lastW.w)} kg`} />
          {hasExp && lastW.e != null && <EndDot x={xAt(n - 1)} y={eY(lastW.e)} color={CHART.expenditure} label={`${r0(lastW.e)}`} />}

          {/* x-axis date labels */}
          {xLabels.map((i) => (
            <text key={i} x={clamp(xAt(i), px0 + 8, px1 - 8)} y={xAxisY + 14} textAnchor="middle" fontSize="9" fontFamily="monospace" fill={C.faint}>{fmtDate(frame[i].date)}</text>
          ))}

          {/* hover crosshair */}
          {hp && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={wTop} y2={xAxisY} stroke={C.sub} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              {hp.w != null && <circle cx={hx} cy={wY(hp.w)} r="3.5" fill={CHART.weight} stroke="#fff" strokeWidth="1.5" />}
              {hp.kin != null && <circle cx={hx} cy={eY(hp.kin)} r="3.5" fill={CHART.intake} stroke="#fff" strokeWidth="1.5" />}
              {hasExp && hp.e != null && <circle cx={hx} cy={eY(hp.e)} r="3.5" fill={CHART.expenditure} stroke="#fff" strokeWidth="1.5" />}
            </g>
          )}
        </svg>

        {hp && (
          <div style={{ position: "absolute", top: 0, left: `${clamp((hover / (n - 1)) * 100, 0, 100)}%`,
            transform: `translateX(${hover / (n - 1) > 0.6 ? "-105%" : "8px"})`, background: C.card, borderColor: C.line, pointerEvents: "none" }}
            className="border rounded-lg px-2 py-1.5 text-xs shadow-sm font-mono whitespace-nowrap">
            <div style={{ color: C.sub }} className="mb-0.5">{fmtDate(hp.date)}</div>
            <TipRow color={CHART.weight} label="weight" value={hp.w != null ? `${r1(hp.w)} kg` : "—"} />
            <TipRow color={CHART.intake} label="in" value={hp.kin != null ? `${r0(hp.kin)} kcal` : "—"} />
            {hasExp && <TipRow color={CHART.expenditure} label="burns" value={hp.e != null ? `${r0(hp.e)} kcal` : "—"} />}
          </div>
        )}
      </div>

      {/* legend (energy panel has 2 series) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: C.sub }}>
        <LegendChip color={CHART.weight} label="weight" />
        <LegendChip color={CHART.intake} label="calories in" />
        {hasExp && <LegendChip color={CHART.expenditure} label="est. expenditure" band />}
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
