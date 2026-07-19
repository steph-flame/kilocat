import { useState, useRef, useEffect, useMemo } from "react";
import { C, CHART } from "../theme.js";
import { extent, linScale } from "../lib/scale.js";
import { r0, r1 } from "../lib/util.js";
import { toDisplayWeight, weightLabel } from "../lib/units.js";
import { formatDayLabel, STRIP_RANGES, DEFAULT_STRIP_RANGE, stripRangeWindow, stripColumnWidth, stripPeakKcal } from "../lib/dayPager.js";

// The Log page's archive-navigation strip: one column per day EVER logged (see Log.jsx's
// `days`, built from dayPager.js's dayStripWindow with no cap), rendered inside a native
// horizontally-scrollable container — no custom drag code, so trackpad panning and touch
// swipe come for free. The selected range pill (2W/1M/3M/All) is the zoom level: it sets a
// fixed per-day column width (see lib/dayPager.js's stripColumnWidth) so that many days fill
// the visible strip, NOT which days are rendered — every logged day is always in the DOM,
// just wider or narrower. The strip opens scrolled fully right (today) and re-centers on the
// viewed day (scrollIntoView) whenever the pager's arrows/keyboard move it, so it stays in
// sync with the day panel below without the caller needing to know anything about scrolling.
//
// Split cleanly into two stacked mini-rows, each its own implicit y-scale, rather than
// overlaying both series on one shared axis (that read as two charts pretending to be one —
// see WEIGHT_ROW_H/INTAKE_ROW_H below): weight's dot-line on top, intake's bars on the bottom,
// a faint divider between them. Both rows share the same day columns, the same horizontal
// scroller, and one selection/hover pill that spans the full height of both rows — visually
// still one scrubber, just two honest scales instead of one implicit one. Intake kcal draws as
// a small vertical bar (hollow for a day flagged incomplete — the same "don't trust this one"
// convention TimelineChart uses for imputed points); daily median weight draws as a thin
// dot-line. The viewed day gets a soft highlight pill; hover/focus gets a lighter one, so the
// strip visibly reads as clickable, not just decorative.
//
// Real per-day <button>s (in a flex row) sit on top of a purely decorative, aria-hidden SVG —
// clicking/tapping/keyboard-activating any column calls onSelect(date). That split is what
// gets both a continuous cross-column weight line (needs one shared SVG) AND per-column
// keyboard focus + aria-labels (needs real focusable elements), rather than picking one at the
// expense of the other.
const WEIGHT_ROW_H = 30; // top mini-row: weight dot-line, its own implicit scale
const ROW_GAP = 6; // faint divider sits centered in this gap
const INTAKE_ROW_H = 40; // bottom mini-row: intake bars, its own implicit scale
const STRIP_H = WEIGHT_ROW_H + ROW_GAP + INTAKE_ROW_H;

export default function DayStrip({ days, data = {}, selected, onSelect, unit = "kg" }) {
  const [range, setRange] = useState(DEFAULT_STRIP_RANGE); // session-only zoom level, not persisted
  const [hoverDay, setHoverDay] = useState(null);
  const [showHint, setShowHint] = useState(true);

  const scrollerRef = useRef(null);
  const colRefs = useRef(new Map());
  const didInit = useRef(false);

  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!scrollerRef.current) return;
    const ro = new ResizeObserver((e) => setContainerWidth(e[0].contentRect.width));
    ro.observe(scrollerRef.current);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(days.length, 1);
  const colW = stripColumnWidth(range, days.length, containerWidth);
  const totalW = colW * n;
  const barW = Math.max(2, colW * 0.42);
  const xAt = (i) => i * colW + colW / 2;

  const windowDays = useMemo(() => stripRangeWindow(days, range), [days, range]);
  const peakKcal = useMemo(() => stripPeakKcal(windowDays, data), [windowDays, data]);

  // Intake row geometry (bottom): bars grow up from the row's own floor.
  const iPadTop = 4, iPadBottom = 3;
  const intakeTop = WEIGHT_ROW_H + ROW_GAP;
  const barAreaH = INTAKE_ROW_H - iPadTop - iPadBottom;
  const kcalVals = days.map((d) => data[d]?.kcal).filter((v) => v != null && v > 0);
  const kcalHi = kcalVals.length ? Math.max(...kcalVals) : 0;
  const barH = (kcal) => (kcalHi > 0 ? (kcal / kcalHi) * barAreaH : 0);

  // Weight row geometry (top): its own scale, confined entirely to the top row's pixels.
  const wPadTop = 3, wPadBottom = 3;
  const wVals = days.map((d) => data[d]?.weightKg).filter((v) => v != null);
  const [wLoRaw, wHiRaw] = wVals.length ? extent(wVals) : [0, 1];
  const wPad = (wHiRaw - wLoRaw) * 0.25 || 0.1;
  const wY = linScale([wLoRaw - wPad, wHiRaw + wPad], [WEIGHT_ROW_H - wPadBottom, wPadTop]);

  const linePts = days
    .map((d, i) => (data[d]?.weightKg != null ? `${xAt(i).toFixed(1)},${wY(data[d].weightKg).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ");

  const label = (d) => {
    const kcal = data[d]?.kcal;
    const w = data[d]?.weightKg;
    const bits = [formatDayLabel(d, days[days.length - 1])];
    bits.push(kcal != null ? `${r0(kcal)} kcal${data[d]?.imputed ? " (incomplete)" : ""}` : "no intake logged");
    if (w != null) bits.push(`${r1(toDisplayWeight(w, unit))} ${weightLabel(unit)}`);
    return bits.join(", ");
  };

  // Initial mount: jump straight to today, no animation. Afterward, whenever the VIEWED day
  // changes (pager arrows/keyboard) or the zoom level changes (column width shifts under the
  // already-scrolled strip), bring that column back into view — smoothly, unless the user has
  // asked for reduced motion. `scrollIntoView({ inline: "nearest" })` is a no-op if the column
  // is already visible, so this never yanks the view out from under a column the user just
  // clicked (already in view) or is mid-scroll past.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || totalW <= 0) return;
    if (!didInit.current) {
      el.scrollLeft = el.scrollWidth;
      didInit.current = true;
      return;
    }
    const node = colRefs.current.get(selected);
    if (!node) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "nearest", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range, totalW]);

  const dismissHint = () => setShowHint(false);
  const select = (d) => { dismissHint(); onSelect(d); };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1">
        <span style={{ color: C.sub }} className="text-xs font-mono">History</span>
        <div className="flex rounded-full overflow-hidden border shrink-0" style={{ borderColor: C.line }}>
          {STRIP_RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key}
              style={{ background: range === r.key ? C.spruce : "transparent", color: range === r.key ? "#fff" : C.sub }}
              className="text-xs px-2.5 py-1 font-mono">{r.label}</button>
          ))}
        </div>
      </div>
      {showHint && <p style={{ color: C.faint }} className="text-[11px] mt-0.5">tap a day to view it</p>}

      {/* One legend line per mini-row, in the same top-to-bottom order as the rows themselves
          (weight row above intake row below) — each chip reads as "above" its own row even
          though both sit outside the scroller (so they stay visible while the strip scrolls). */}
      <div className="mt-1 text-xs" style={{ color: C.sub }}>
        <StripChip shape="line" color={CHART.weight} label={`weight · ${weightLabel(unit)}`} />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1 mt-0.5">
        <StripChip shape="bar" color={CHART.intake} label="intake · kcal" />
        {peakKcal > 0 && <span style={{ color: C.faint }} className="text-xs font-mono">peak {r0(peakKcal)} kcal</span>}
      </div>

      <div
        ref={scrollerRef}
        role="group"
        aria-label="Day history — scroll to browse, click or tap a day to view it"
        className="relative overflow-x-auto mt-1"
        style={{ height: STRIP_H }}
      >
        <div style={{ position: "relative", width: totalW, height: STRIP_H }}>
          <svg width={totalW} height={STRIP_H} viewBox={`0 0 ${totalW} ${STRIP_H}`} aria-hidden="true" style={{ display: "block" }}>
            {days.map((d, i) => d === selected && (
              <rect key={`sel-${d}`} x={i * colW + 1} y={0} width={Math.max(colW - 2, 0)} height={STRIP_H} rx={5} fill={C.spruceSoft} />
            ))}
            {days.map((d, i) => d === hoverDay && d !== selected && (
              <rect key={`hov-${d}`} x={i * colW + 1} y={0} width={Math.max(colW - 2, 0)} height={STRIP_H} rx={5} fill={C.spruceSoft} opacity="0.5" />
            ))}
            {/* faint divider between the two rows — the "split cleanly" seam */}
            <line x1={0} y1={WEIGHT_ROW_H + ROW_GAP / 2} x2={totalW} y2={WEIGHT_ROW_H + ROW_GAP / 2} stroke={C.line} strokeWidth="1" />
            {days.map((d, i) => {
              const kcal = data[d]?.kcal;
              if (kcal == null || kcal <= 0) return null;
              const h = Math.max(barH(kcal), 1.5);
              const y = intakeTop + INTAKE_ROW_H - iPadBottom - h;
              const imputed = !!data[d]?.imputed;
              return imputed
                ? <rect key={d} x={xAt(i) - barW / 2} y={y} width={barW} height={h} fill="none" stroke={CHART.intake} strokeWidth="1" rx="1" />
                : <rect key={d} x={xAt(i) - barW / 2} y={y} width={barW} height={h} fill={CHART.intake} rx="1" />;
            })}
            {wVals.length > 1 && <polyline points={linePts} fill="none" stroke={CHART.weight} strokeWidth="1" strokeDasharray="1.5 2" opacity="0.75" />}
            {wVals.length > 0 && days.map((d, i) => data[d]?.weightKg != null && (
              <circle key={`w-${d}`} cx={xAt(i)} cy={wY(data[d].weightKg)} r="1.6" fill={CHART.weight} />
            ))}
          </svg>
          <div className="absolute inset-0 flex">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                ref={(el) => { if (el) colRefs.current.set(d, el); else colRefs.current.delete(d); }}
                onClick={() => select(d)}
                onMouseEnter={() => { setHoverDay(d); dismissHint(); }}
                onMouseLeave={() => setHoverDay((h) => (h === d ? null : h))}
                onFocus={() => { setHoverDay(d); dismissHint(); }}
                onBlur={() => setHoverDay((h) => (h === d ? null : h))}
                aria-label={label(d)}
                aria-pressed={d === selected}
                title={label(d)}
                style={{ width: colW, flexShrink: 0 }}
                className="h-full outline-none rounded cursor-pointer focus-visible:ring-2"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StripChip({ shape, color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {shape === "bar"
        ? <span style={{ background: color }} className="inline-block w-1.5 h-2.5 rounded-[1px]" />
        : <span style={{ background: color }} className="inline-block w-4 h-[3px] rounded-full" />}
      {label}
    </span>
  );
}
