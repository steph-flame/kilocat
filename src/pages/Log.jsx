import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, Scale, Activity, NotebookPen, Plus, X, PieChart } from "lucide-react";
import { C, MACRO } from "../theme.js";
import { num, r0, r1 } from "../lib/util.js";
import { kcalPerG, kcalFromGrams, isValidQty } from "../lib/foods.js";
import { foodSummary, macroBreakdown, trailingWindow, itemsInRange } from "../lib/foodStats.js";
import { groupByDay, median, localDateOf, manualWeighInStamp } from "../lib/series.js";
import { earliestLoggedDay, clampDay, canGoPrev, canGoNext, shiftDay, dayStripWindow, formatDayLabel } from "../lib/dayPager.js";
import { WEIGH_METHODS, DEFAULT_METHOD, WEIGH_SOURCES } from "../lib/expenditure.js";
import { toDisplayWeight, fromDisplayWeight, weightLabel } from "../lib/units.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import { useApp } from "../state/AppState.jsx";
import FoodSearch from "../components/FoodSearch.jsx";
import { Field, NumInput, Note } from "../components/primitives.jsx";
import CatMark from "../components/CatMark.jsx";
import DayStrip from "../components/DayStrip.jsx";

// LOCAL date (see lib/series.js localDateOf) — "today" means the owner's today, not whatever
// day it already is in UTC (which flips early near midnight in a western timezone).
const today = () => localDateOf(Date.now());
const methodLabel = (m) => (WEIGH_METHODS[m] || WEIGH_METHODS[DEFAULT_METHOD]).label;
// Swipe-to-page threshold, px — below this (or when the gesture reads as mostly-vertical) it's
// left alone so ordinary scrolling on the day panel is never hijacked.
const SWIPE_PX = 40;

export default function Log() {
  const { p, weightLog, intakeLog, library, expSettings, setExpSettings, unit, intakeDayStatus, setIntakeDayFlag, activeCatId } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID; // Biscuit's data is regenerated fresh every time — every mutation seam no-ops, so hide the controls rather than show a dead button

  // The day pager's whole state: which single day is being viewed. Bounds are derived, not
  // stored — `todayStr` is read live every render (so it advances if the tab is left open past
  // midnight) and `minDate` is the earliest day either log has ANY entry on (empty days within
  // that span are still visitable — backfill). New cats with zero history get a [today, today]
  // range (see earliestLoggedDay's fallback).
  const todayStr = today();
  const minDate = useMemo(() => earliestLoggedDay(weightLog.items, intakeLog.items, todayStr), [weightLog.items, intakeLog.items, todayStr]);
  const [viewedDate, setViewedDate] = useState(todayStr);
  // Food is the tab the owner actually touches day to day (a connected Litter-Robot logs the
  // weight for them), so it leads. Weight is one tap away. Both tabs share the day pager/strip
  // above — paging a day keeps whichever tab you're on.
  const [tab, setTab] = useState("food");
  // Re-clamp if the range shifts under the viewed day (data cleared, or a new day rolled over
  // while today's the viewed day) rather than leaving it pointing outside [minDate, todayStr].
  useEffect(() => { setViewedDate((d) => clampDay(d, minDate, todayStr)); }, [minDate, todayStr]);
  const isToday = viewedDate === todayStr;

  const goPrev = () => setViewedDate((d) => shiftDay(d, -1, minDate, todayStr));
  const goNext = () => setViewedDate((d) => shiftDay(d, 1, minDate, todayStr));
  const jumpTo = (d) => setViewedDate(clampDay(d, minDate, todayStr));

  // Keyboard ←/→, ignored while any input/textarea/select is focused so typing a weight or
  // food name never accidentally pages the day out from under the form.
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (ev.key === "ArrowLeft") setViewedDate((d) => shiftDay(d, -1, minDate, todayStr));
      else setViewedDate((d) => shiftDay(d, 1, minDate, todayStr));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minDate, todayStr]);

  // Touch swipe on the day panel (not the strip, which has its own per-column tap target).
  const touchStart = useRef(null);
  const onTouchStart = (ev) => { const t = ev.touches[0]; touchStart.current = t ? { x: t.clientX, y: t.clientY } : null; };
  const onTouchEnd = (ev) => {
    if (!touchStart.current) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touchStart.current.x, dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return; // too short, or mostly vertical scroll
    if (dx < 0) goNext(); else goPrev();
  };

  // Strip data: EVERY logged day (dayStripWindow's default is now unbounded — see
  // lib/dayPager.js), each day's total intake kcal + whether it's flagged incomplete, and its
  // median weigh-in. DayStrip itself decides how much of this to show at once (the range pill
  // sets the zoom level) and renders it as a horizontally-scrollable strip.
  const stripDays = useMemo(() => dayStripWindow(minDate, todayStr), [minDate, todayStr]);
  const stripData = useMemo(() => {
    const intakeByDay = new Map(groupByDay(intakeLog.items).map((g) => [g.date, g.items]));
    const weightByDay = new Map(groupByDay(weightLog.items).map((g) => [g.date, g.items]));
    const out = {};
    for (const d of stripDays) {
      const iItems = intakeByDay.get(d);
      const wItems = weightByDay.get(d);
      out[d] = {
        kcal: iItems ? iItems.reduce((s, en) => s + num(en.kcal), 0) : null,
        imputed: intakeDayStatus[d] === "incomplete",
        weightKg: wItems ? median(wItems.map((e) => num(e.kg))) : null,
      };
    }
    return out;
  }, [stripDays, intakeLog.items, weightLog.items, intakeDayStatus]);

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="flex items-center justify-between mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
          <span className="flex items-center gap-3">
            <a href="#/expenditure" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><Activity size={12} /> expenditure</a>
            <a href="#/ration" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><Scale size={12} /> ration</a>
          </span>
        </nav>

        <div className="flex items-end gap-4 mb-6">
          <CatMark size={60} />
          <div className="min-w-0">
            <div style={{ color: C.amber }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><NotebookPen size={13} /> log</div>
            <h1 className="text-[26px] font-extrabold leading-tight" style={{ letterSpacing: "-0.02em" }}>Track {p.name}</h1>
            <p style={{ color: C.sub }} className="text-sm mt-1">Weigh-ins and what you dispensed. These feed the expenditure estimate.</p>
          </div>
        </div>

        <LogTabs tab={tab} onTab={setTab} />

        <DayStrip days={stripDays} data={stripData} selected={viewedDate} onSelect={jumpTo} unit={unit}
          mode={tab === "food" ? "intake" : "weight"} />

        <DayPagerHeader date={viewedDate} todayStr={todayStr} onPrev={goPrev} onNext={goNext}
          canPrev={canGoPrev(viewedDate, minDate)} canNext={canGoNext(viewedDate, todayStr)} />

        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {tab === "food" ? (
            <>
              <IntakeLog log={intakeLog} library={library} dayStatus={intakeDayStatus} setDayFlag={setIntakeDayFlag} isDemo={isDemo}
                viewedDate={viewedDate} isToday={isToday} />
              <FoodSummary items={intakeLog.items} library={library.foods} viewedDate={viewedDate} />
            </>
          ) : (
            <WeightLog log={weightLog} unit={unit} lastMethod={expSettings.lastMethod || DEFAULT_METHOD} onMethod={(m) => setExpSettings({ lastMethod: m })}
              viewedDate={viewedDate} isToday={isToday} isDemo={isDemo} />
          )}
        </div>
      </div>
    </div>
  );
}

// The pager's header row: ‹ arrow, the day label ("Today"/"Yesterday"/else a short date), ›
// arrow (disabled past today). Real ~40px buttons with a visible card background + border —
// they read as unmistakably clickable even on a laptop trackpad, not just an icon floating on
// the page background. Arrow-key nav is documented here via aria-label; the visible way to
// discover it is the disabled state at the future edge.
function DayPagerHeader({ date, todayStr, onPrev, onNext, canPrev, canNext }) {
  const label = formatDayLabel(date, todayStr);
  return (
    <div className="flex items-center justify-between mb-4">
      <PagerArrow dir="prev" onClick={onPrev} disabled={!canPrev} ariaLabel="Previous day" />
      <div className="text-center leading-tight">
        <div className="font-semibold text-base">{label}</div>
        {label !== date && <div style={{ color: C.faint }} className="text-xs font-mono">{date}</div>}
      </div>
      <PagerArrow dir="next" onClick={onNext} disabled={!canNext} ariaLabel="Next day (use the right arrow key, or swipe left)" />
    </div>
  );
}

// A single pager arrow: card background + a real border (not just a faint icon), ~40px
// square so it reads as an unmistakable button target. Hover/focus swaps the border to the
// accent color, the same "you're about to click something" cue the rest of the app uses on
// its other interactive controls (e.g. WeightLog's method-select buttons below).
function PagerArrow({ dir, onClick, disabled, ariaLabel }) {
  const [hot, setHot] = useState(false);
  const active = hot && !disabled;
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)} onBlur={() => setHot(false)}
      style={{ background: C.card, borderColor: active ? C.spruce : C.line, color: C.ink, width: 40, height: 40, opacity: disabled ? 0.35 : 1 }}
      className="border-2 rounded-xl flex items-center justify-center shrink-0 disabled:cursor-not-allowed focus-visible:ring-2"
    >
      <Icon size={20} />
    </button>
  );
}

// A quantity that's inline-editable in place — typing doesn't commit until blur or Enter
// (Escape reverts), so a typo mid-edit never briefly writes a bad value. Local text state
// only; `onCommit` gets a validated number and decides what to do with it (or nothing, if
// the guard there rejects it — the display then reverts to `value` on the next render).
function InlineQty({ value, suffix, onCommit }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(n);
    setText(String(value)); // reverts if onCommit rejected it (value didn't change) or accepted (value now matches)
  };
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <input
        type="number" value={text} inputMode="decimal"
        onChange={(ev) => setText(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.blur();
          else if (ev.key === "Escape") { setText(String(value)); ev.currentTarget.blur(); }
        }}
        style={{ color: C.ink, borderColor: C.line }}
        className="w-12 text-right bg-transparent outline-none font-mono text-xs tabular-nums border-b border-dotted"
      />
      <span style={{ color: C.faint }}>{suffix}</span>
    </span>
  );
}

/* ---------- tabs ---------- */
function LogTabs({ tab, onTab }) {
  const tabs = [
    { key: "food", label: "Food", Icon: NotebookPen },
    { key: "weight", label: "Weight", Icon: Scale },
  ];
  return (
    <div role="tablist" aria-label="Log type" className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
      {tabs.map(({ key, label, Icon }) => {
        const active = tab === key;
        return (
          <button key={key} role="tab" aria-selected={active} onClick={() => onTab(key)}
            style={{ background: active ? C.card : "transparent", color: active ? C.ink : C.sub, borderColor: active ? C.line : "transparent" }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-medium py-2 rounded-lg border">
            <Icon size={15} /> {label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- food-source summary ---------- */
// Wet/dry is conveyed by the legend TEXT (label + %), not color alone — the colored bars/dots
// are supplemental, so this stays legible regardless of palette contrast.
const WET_COLOR = C.spruce;
const DRY_COLOR = C.amber;
const UNK_COLOR = C.faint;
const typeColor = (t) => (t === "wet" ? WET_COLOR : t === "dry" ? DRY_COLOR : UNK_COLOR);

function Seg({ pct, color }) {
  if (!(pct > 0)) return null;
  return <div style={{ width: `${pct}%`, background: color }} />;
}
function Legend({ color, label, pct }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} /> {label} {r0(pct)}%
    </span>
  );
}

// Where the viewed day's (or trailing week's) calories and grams actually came from: the wet/dry
// split and the per-food shares, computed from the intake log (see lib/foodStats.js). Read-only —
// a lens on what's already logged, so it shows for the demo cat too.
const MACRO_COLORS = MACRO; // protein/fat/carb — see theme.js MACRO (fixed distinct triad)

function FoodSummary({ items, library, viewedDate }) {
  const [range, setRange] = useState("day"); // "day" | "week"
  const [basis, setBasis] = useState("calories"); // "calories" | "weight" — flips the whole card
  const windowItems = useMemo(() => {
    if (range === "day") return { list: items.filter((e) => e.date === viewedDate), days: 1 };
    const { start, end } = trailingWindow(viewedDate, 7);
    return { list: itemsInRange(items, start, end), days: 7 };
  }, [items, viewedDate, range]);
  const summary = useMemo(() => foodSummary(windowItems.list, library, windowItems.days), [windowItems, library]);
  const macros = useMemo(() => macroBreakdown(windowItems.list, library, windowItems.days), [windowItems, library]);

  const { totals, byType, byFood, wetPctKcal, dryPctKcal, wetPctGrams, dryPctGrams, perDay, isEmpty } = summary;
  const byKcal = basis === "calories";
  const week = range === "week";
  const val = (o) => (byKcal ? o.kcal : o.grams); // pick the active metric off any {kcal,grams}
  const basisTotal = val(totals);
  const pctOf = (part) => (basisTotal > 0 ? r0((part / basisTotal) * 100) : 0);

  const wetPct = byKcal ? wetPctKcal : wetPctGrams;
  const dryPct = byKcal ? dryPctKcal : dryPctGrams;
  const unkPct = pctOf(val(byType.unknown));
  const totalLabel = byKcal
    ? `${r0(totals.kcal)} kcal${week ? ` · ≈${r0(perDay.kcal)}/day` : ""}`
    : `${r0(totals.grams)} g${week ? ` · ≈${r0(perDay.grams)}/day` : ""}`;
  const basisWord = byKcal ? "calories" : "weight";
  const foods = useMemo(
    () => [...byFood].sort((a, b) => (byKcal ? b.kcal - a.kcal : b.grams - a.grams)),
    [byFood, byKcal]
  );

  // Macro section: caloric split (%) on the calories basis, absolute macro GRAMS on the weight
  // basis (per-day when averaging a week, matching the header's ≈/day framing).
  const mg = macros.grams; // window totals: { protein, fat, carb, moisture }
  const macroSum = mg.protein + mg.fat + mg.carb;
  const gPct = (x) => (macroSum > 0 ? (x / macroSum) * 100 : 0);
  const perDayG = (x) => r1(x / macros.nDays);
  const gShown = (x) => (week ? perDayG(x) : r1(x));

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="font-medium inline-flex items-center gap-1.5"><PieChart size={15} style={{ color: C.amber }} /> Where it came from</h2>
        <div role="tablist" aria-label="Summary window" className="flex gap-1 text-xs font-mono shrink-0">
          {[["day", "day"], ["week", "7-day avg"]].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={range === key} onClick={() => setRange(key)}
              style={{ borderColor: range === key ? C.spruce : C.line, background: range === key ? C.spruceSoft : "transparent", color: range === key ? C.spruce : C.sub }}
              className="border rounded-lg px-2 py-1">{label}</button>
          ))}
        </div>
      </div>

      {/* Basis flip — drives every section below (calories vs weight/grams). */}
      <div role="tablist" aria-label="Measure by" className="flex gap-1 mb-3 text-xs font-mono">
        {[["calories", "calories"], ["weight", "weight"]].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={basis === key} onClick={() => setBasis(key)}
            style={{ borderColor: basis === key ? C.amber : C.line, background: basis === key ? C.amberSoft : "transparent", color: basis === key ? C.amber : C.sub }}
            className="border rounded-lg px-3 py-1">{label}</button>
        ))}
      </div>

      {isEmpty ? (
        <p style={{ color: C.faint }} className="text-xs py-2">Nothing logged {range === "day" ? "this day" : "in the last 7 days"} to summarize.</p>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs mb-1 gap-2">
            <span style={{ color: C.sub }} className="font-mono uppercase tracking-wide">Wet vs dry · {basisWord}</span>
            <span style={{ color: C.faint }} className="tabular-nums shrink-0">{totalLabel}</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden mb-1.5" style={{ background: C.line }}>
            <Seg pct={wetPct} color={WET_COLOR} />
            <Seg pct={dryPct} color={DRY_COLOR} />
            <Seg pct={unkPct} color={UNK_COLOR} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs mb-3" style={{ color: C.sub }}>
            <Legend color={WET_COLOR} label="Wet" pct={wetPct} />
            <Legend color={DRY_COLOR} label="Dry" pct={dryPct} />
            {unkPct > 0 && <Legend color={UNK_COLOR} label="Other" pct={unkPct} />}
          </div>

          <div style={{ color: C.sub }} className="text-xs font-mono uppercase tracking-wide mb-1.5">By food · {basisWord}</div>
          <div className="space-y-1.5">
            {foods.map((f) => {
              const pct = byKcal ? f.kcalPct : f.gramsPct;
              return (
                <div key={f.name}>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: typeColor(f.type) }} />
                      <span style={{ color: C.ink }} className="truncate" title={f.name}>{f.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums" style={{ color: C.sub }}>
                      {r0(pct)}%<span style={{ color: C.faint }}> · {byKcal ? `${r0(f.kcal)} kcal` : `${r0(f.grams)} g`}</span>
                    </span>
                  </div>
                  <div className="flex h-1.5 rounded-full overflow-hidden mt-0.5" style={{ background: C.line }}>
                    <Seg pct={pct} color={typeColor(f.type)} />
                  </div>
                </div>
              );
            })}
          </div>

          {macros.hasData && (
            <div className="mt-4 pt-3 border-t" style={{ borderColor: C.line }}>
              <div className="flex items-center justify-between text-xs mb-1 gap-2">
                <span style={{ color: C.sub }} className="font-mono uppercase tracking-wide">Macros · {basisWord}</span>
                <span style={{ color: C.faint }} className="tabular-nums shrink-0">
                  {byKcal ? `${r0(macros.moisturePctByWeight)}% water by wt` : `${gShown(mg.moisture)} g water${week ? "/day" : ""}`}
                </span>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden mb-1.5" style={{ background: C.line }}>
                <Seg pct={byKcal ? macros.caloric.protein : gPct(mg.protein)} color={MACRO_COLORS.protein} />
                <Seg pct={byKcal ? macros.caloric.fat : gPct(mg.fat)} color={MACRO_COLORS.fat} />
                <Seg pct={byKcal ? macros.caloric.carb : gPct(mg.carb)} color={MACRO_COLORS.carb} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: C.sub }}>
                {byKcal ? (
                  <>
                    <Legend color={MACRO_COLORS.protein} label="Protein" pct={macros.caloric.protein} />
                    <Legend color={MACRO_COLORS.fat} label="Fat" pct={macros.caloric.fat} />
                    <Legend color={MACRO_COLORS.carb} label="Carb" pct={macros.caloric.carb} />
                  </>
                ) : (
                  <>
                    <MacroGram color={MACRO_COLORS.protein} label="Protein" grams={gShown(mg.protein)} />
                    <MacroGram color={MACRO_COLORS.fat} label="Fat" grams={gShown(mg.fat)} />
                    <MacroGram color={MACRO_COLORS.carb} label="Carb" grams={gShown(mg.carb)} />
                    {week && <span style={{ color: C.faint }}>per day</span>}
                  </>
                )}
              </div>
              {macros.coverageKcalPct < 99 && (
                <p style={{ color: C.faint }} className="text-xs mt-1.5">
                  Based on {r0(macros.coverageKcalPct)}% of logged calories — add guaranteed-analysis to more foods (Ration → Saved foods) to complete the picture.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MacroGram({ color, label, grams }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} /> {label} {grams} g
    </span>
  );
}

/* ---------- weight log ---------- */
function WeightLog({ log, unit, lastMethod, onMethod, viewedDate, isToday, isDemo }) {
  const [val, setVal] = useState("");
  const [method, setMethod] = useState(lastMethod || DEFAULT_METHOD);
  const chooseMethod = (m) => { setMethod(m); onMethod?.(m); }; // remember last-used across sessions
  const dayItems = useMemo(() => log.items.filter((e) => e.date === viewedDate), [log.items, viewedDate]);
  const dayKg = dayItems.length ? median(dayItems.map((e) => num(e.kg))) : null;
  // manualWeighInStamp stamps a real time-of-day `ts` only when the VIEWED day IS today (a
  // live "log now") — a backfilled entry for a past day has no actual time behind it, so it
  // stays untimed (see the per-entry time display below: entries without `ts` show nothing
  // extra, no dash clutter).
  const addEntry = () => {
    if (num(val) > 0) {
      log.add({ ...manualWeighInStamp(viewedDate), kg: fromDisplayWeight(num(val), unit), method, source: WEIGH_SOURCES.manual });
      setVal("");
    }
  };
  const methodsUsed = new Set(log.items.map((e) => e.method).filter(Boolean));

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <h2 className="font-medium mb-1">Weight log</h2>
      <p style={{ color: C.faint }} className="text-xs mb-3">One or more weigh-ins per day — the day's reads are median-averaged. Log manually below, or connect a Litter-Robot in Settings to have it appended automatically (tagged "auto").</p>

      {!isDemo && (
        <>
          <div className="mb-2">
            <div style={{ color: C.sub }} className="text-xs mb-1">Measured with</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(WEIGH_METHODS).map(([key, m]) => (
                <button key={key} onClick={() => chooseMethod(key)} aria-pressed={method === key}
                  style={{ borderColor: method === key ? C.spruce : C.line, background: method === key ? C.spruceSoft : "transparent", color: method === key ? C.spruce : C.sub }}
                  className="text-xs border rounded-lg px-2 py-1 font-mono">{m.label}</button>
              ))}
            </div>
            {WEIGH_METHODS[method].hint && <p style={{ color: C.faint }} className="text-xs mt-1">{WEIGH_METHODS[method].hint}{method === "difference" && " — noisiest; the app leans on the median of several reads"}</p>}
          </div>

          <div className="flex items-end gap-2">
            <div className="w-24"><Field label="Weight" suffix={weightLabel(unit)}><NumInput value={val} onChange={setVal} step={unit === "lb" ? "0.05" : "0.01"} /></Field></div>
            <button onClick={addEntry} style={{ background: C.spruce }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
          </div>

          {methodsUsed.size > 1 && (
            <Note>This log mixes measurement methods ({[...methodsUsed].map(methodLabel).join(", ")}). Different methods can sit a bit apart, which reads as a jump in the trend — prefer sticking to one where you can.</Note>
          )}
        </>
      )}

      <div className="mt-3">
        {dayItems.length > 0 ? (
          <>
            <div className="flex items-center justify-between text-sm font-mono py-1 border-b" style={{ borderColor: C.line }}>
              <span style={{ color: C.sub }} className="inline-flex items-center gap-1">
                {dayItems.length} read{dayItems.length === 1 ? "" : "s"}
                {dayItems.some((e) => e.source === WEIGH_SOURCES.litterRobot) && <span style={{ color: C.faint }} className="text-xs">· auto</span>}
              </span>
              <span style={{ color: C.ink }} className="tabular-nums">{r1(toDisplayWeight(dayKg, unit))} {weightLabel(unit)}<span style={{ color: C.faint }} className="text-xs"> avg</span></span>
            </div>
            <div className="pl-1 py-1 space-y-0.5">
              {dayItems.map((en) => (
                <div key={en.id} className="flex items-center justify-between text-xs font-mono">
                  <span style={{ color: C.faint }}>
                    {en.method ? methodLabel(en.method) : "—"}{en.source === WEIGH_SOURCES.litterRobot ? " · auto" : ""}
                    {en.ts != null && <span style={{ color: C.faint }}> · {new Date(en.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                  </span>
                  <span className="flex items-center gap-2"><span style={{ color: C.sub }} className="tabular-nums">{r1(toDisplayWeight(num(en.kg), unit))} {weightLabel(unit)}</span>
                    {!isDemo && <button onClick={() => log.remove(en.id)} style={{ color: C.faint }} aria-label="Remove this weigh-in"><X size={12} /></button>}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p style={{ color: C.faint }} className="text-xs py-2">No weigh-ins logged {isToday ? "today" : "this day"}.</p>
        )}
      </div>
    </section>
  );
}

/* ---------- intake log ---------- */
function IntakeLog({ log, library, dayStatus = {}, setDayFlag, isDemo = false, viewedDate, isToday }) {
  const [name, setName] = useState("");
  const [kcalG, setKcalG] = useState(0);
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const computed = num(grams) > 0 && kcalG > 0 ? num(grams) * kcalG : null;
  // Auto-fill kcal from food × grams, but let the user override it afterward (they can edit
  // the field; it only re-fills when the food or grams change).
  useEffect(() => { if (computed != null) setKcal(String(r0(computed))); }, [computed]);
  const effectiveKcal = num(kcal);
  const dayItems = useMemo(() => log.items.filter((e) => e.date === viewedDate), [log.items, viewedDate]);
  const total = dayItems.reduce((s, en) => s + num(en.kcal), 0);
  const flagged = dayStatus[viewedDate] === "incomplete";
  const addEntry = () => {
    if (effectiveKcal > 0) {
      // kcalPerG: the food's energy density at the moment this entry was made, so a later
      // grams edit can re-derive kcal the SAME way this entry's kcal was computed (see
      // computed above, and the inline edit below). Only stored when a food was actually
      // picked (kcalG > 0) — a hand-typed kcal with no food has nothing to convert from.
      log.add({ date: viewedDate, kcal: r0(effectiveKcal), grams: num(grams) || null, name: name || null, kcalPerG: kcalG > 0 ? kcalG : null });
      setGrams(""); setKcal("");
    }
  };
  // A true zero day (fasted/refused food) — an explicit 0-kcal entry, so the estimator reads
  // it as real data, not a missing/imputed day (see lib/expenditure.js's buildIntakeDayMap).
  // Always the VIEWED day, so a missed day can be logged retroactively via the pager.
  const addNothingEaten = () => log.add({ date: viewedDate, kcal: 0, grams: null, name: "nothing eaten" });

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <h2 className="font-medium mb-1">Intake log</h2>
      <p style={{ color: C.faint }} className="text-xs mb-3">What you dispensed. Pick a saved food and enter grams, or enter kcal directly. Multiple entries per day sum.</p>
      {!isDemo && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 border rounded-xl p-2" style={{ borderColor: C.line }}>
            <FoodSearch value={name} search={library.search}
              onChangeName={(v) => { setName(v); setKcalG(0); }}
              onPick={(food) => { setName(food.name); setKcalG(kcalPerG(food)); }} />
          </div>
          <div className="flex items-end gap-2">
            <div className="w-20"><Field label="Grams" suffix="g"><NumInput value={grams} onChange={setGrams} step="1" /></Field></div>
            <div className="w-24"><Field label="kcal" suffix="kcal">
              <NumInput value={kcal} onChange={setKcal} step="1" /></Field></div>
            <button onClick={addEntry} style={{ background: C.spruce }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
          </div>
          {kcalG > 0 && <p style={{ color: C.faint }} className="text-xs">{name} ≈ {r0(kcalG * 1000)} kcal/kg — grams × that fills kcal automatically.</p>}
          <button onClick={addNothingEaten} style={{ color: C.sub }} className="text-xs font-mono inline-flex items-center gap-1 underline decoration-dotted">
            nothing eaten {isToday ? "today" : "this day"}
          </button>
        </div>
      )}

      <div className="mt-3">
        <div className="w-full flex items-center justify-between text-sm font-mono py-1 border-b" style={{ borderColor: C.line }}>
          <span style={{ color: C.sub }} className="inline-flex items-center gap-1">
            {dayItems.length} item{dayItems.length === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {!isDemo && dayItems.length > 0 && (
              <button onClick={() => setDayFlag(viewedDate, !flagged)} aria-pressed={flagged}
                style={{ color: flagged ? C.amber : C.faint }} className="text-[11px] font-mono underline decoration-dotted">
                {flagged ? "incomplete — excluded from estimate" : "mark incomplete"}
              </button>
            )}
            <span style={{ color: C.ink }} className="tabular-nums">{r0(total)} kcal</span>
          </span>
        </div>
        {dayItems.length > 0 ? (
          <div className="pl-1 py-1 space-y-0.5">
            {dayItems.map((en) => {
              // The dedicated "nothing eaten" 0-kcal marker (see addNothingEaten above) isn't
              // editable through this path — 0 stays that action's job, not a typo to fix.
              const nothingEaten = en.kcal === 0;
              const editable = !isDemo && !nothingEaten;
              // Grams are only re-derivable to kcal when this entry recorded the food's energy
              // density at creation (kcalPerG — see addEntry above); older entries and
              // hand-typed-kcal entries lack it, so kcal is edited directly instead.
              const canEditGrams = en.grams != null && num(en.kcalPerG) > 0;
              return (
                <div key={en.id} className="flex items-center justify-between text-xs font-mono gap-2">
                  {/* Full stored name, CSS-truncated with a hover title rather than sliced —
                      the quantity controls below live OUTSIDE this span so a long name's
                      ellipsis can never clip an editable field into invisibility. */}
                  <span style={{ color: C.faint }} className="truncate min-w-0" title={en.name || undefined}>{en.name || "—"}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {en.grams != null && (editable && canEditGrams
                      ? <InlineQty value={r0(en.grams)} suffix="g"
                          onCommit={(n) => { if (isValidQty(n)) log.edit(en.id, { grams: n, kcal: kcalFromGrams(en, n) }); }} />
                      : <span style={{ color: C.faint }} className="tabular-nums">{r0(en.grams)}g</span>)}
                    {editable && !canEditGrams
                      ? <InlineQty value={r0(en.kcal)} suffix="kcal"
                          onCommit={(n) => { if (isValidQty(n)) log.edit(en.id, { kcal: r0(n) }); }} />
                      : <span style={{ color: C.sub }} className="tabular-nums">{r0(en.kcal)} kcal</span>}
                    {!isDemo && <button onClick={() => log.remove(en.id)} style={{ color: C.faint }} aria-label="Remove this entry"><X size={12} /></button>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ color: C.faint }} className="text-xs py-2">No intake logged {isToday ? "today" : "this day"}.</p>
        )}
      </div>
    </section>
  );
}
