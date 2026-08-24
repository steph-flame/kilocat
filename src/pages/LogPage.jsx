import { useState, useEffect, useMemo, useRef } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { groupByDay, median, localDateOf, manualWeighInStamp, manualEntryStamp, addDays } from "../lib/series.js";
import { earliestLoggedDay, clampDay, canGoPrev, canGoNext, shiftDay, formatDayLabel } from "../lib/dayPager.js";
import { foodSummary, macroBreakdown, trailingWindow, itemsInRange, rebalanceRemaining } from "../lib/foodStats.js";
import { kcalPerG, foodType } from "../lib/foods.js";
import { distributeBowl } from "../lib/bowl.js";
import { isCanned, resolveRotationsWithFridge, availableCansOf, planSlotDraw, emptiedCansOf } from "../lib/fridge.js";
import { isRotating } from "../lib/rotation.js";
import { transitionSteps, inferTransitionDay, clampDays, shareOfNew } from "../lib/transition.js";
import { WEIGH_METHODS, DEFAULT_METHOD, WEIGH_SOURCES } from "../lib/expenditure.js";
import { toDisplayWeight, fromDisplayWeight, weightLabel, fmtWeight } from "../lib/units.js";
import { hasCollar, collarWorn } from "../lib/collar.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import FoodSearch from "../components/FoodSearch.jsx";
import { DistributionBody, Toggle } from "../components/FoodDistribution.jsx";

const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10; // store kcal to 0.1 so a 3.7 kcal sachet keeps its value
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const g1 = (g) => (g == null ? "—" : `${Number(Number(g).toFixed(1))} g`);
const kc = (n) => { const v = num(n); return v > 0 && v < 10 ? String(Number(v.toFixed(1))) : String(Math.round(v)); }; // small kcal show 1 decimal
// Keep in step with Trend.jsx's METHOD_COLOR so a method is the same colour on both screens.
const WEIGH_METHOD_COLOR = { litterRobot: A.chart.weighDot, petScale: A.good, difference: A.caution.text, other: A.muted };
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
function Card({ children, style, className }) {
  return <div className={className} style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

// The demo cat's logs are regenerated each render, so real add/remove no-op — which made the demo
// Log un-loggable. Give it a session-local overlay: added entries live in `extra`, and removing a
// generated entry just hides it. Nothing persists (same as every demo edit); real cats pass through.
function useEditableLog(log, isDemo, activeCatId) {
  const [extra, setExtra] = useState([]);
  const [hidden, setHidden] = useState([]);
  useEffect(() => { setExtra([]); setHidden([]); }, [activeCatId, isDemo]);
  if (!isDemo) return log;
  return {
    items: [...log.items.filter((e) => !hidden.includes(e.id)), ...extra],
    add: (entry) => setExtra((xs) => [...xs, { id: `demo-${xs.length}-${entry.date}-${Math.round(num(entry.kcal))}-${xs.length}`, ...entry }]),
    edit: (id, patch) => setExtra((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    remove: (id) => setExtra((xs) => xs.some((e) => e.id === id) ? xs.filter((e) => e.id !== id) : (setHidden((h) => [...h, id]), xs)),
  };
}

export default function LogPage() {
  const { p, intent, ration, tr, start, intakeLog: liveIntake, weightLog: liveWeight, library, unit, collar, intakeDayStatus, setIntakeDayFlag, activeCatId, expSettings, setExpSettings, fridge, fridgeDays, cupboard, consumeFridge, reconcileFridge, consumeRotationSlot, openSlotCan, finishSlotCan, setCanRemaining } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;
  const intakeLog = useEditableLog(liveIntake, isDemo, activeCatId);
  const weightLog = useEditableLog(liveWeight, isDemo, activeCatId);
  const todayStr = localDateOf(Date.now());
  const minDate = useMemo(() => earliestLoggedDay(weightLog.items, intakeLog.items, todayStr), [weightLog.items, intakeLog.items, todayStr]);
  const [viewedDate, setViewedDate] = useState(todayStr);
  const [tab, setTab] = useState("food");
  useEffect(() => { setViewedDate((d) => clampDay(d, minDate, todayStr)); }, [minDate, todayStr]);
  const isToday = viewedDate === todayStr;
  const target = r0(intent.target);

  const go = (delta) => setViewedDate((d) => shiftDay(d, delta, minDate, todayStr));
  const selectDay = (d) => setViewedDate(clampDay(d, minDate, todayStr));
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      go(ev.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minDate, todayStr]);

  const label2 = formatDayLabel(viewedDate, todayStr);

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div className="alm-page alm-grid">
        {/* day navigator */}
        <div className="span-all" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 8px" }}>
          <NavArrow dir="prev" onClick={() => go(-1)} disabled={!canGoPrev(viewedDate, minDate)} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{label2}</div>
            {label2 !== viewedDate && <div style={label({ color: A.labelOnFill, fontSize: 10 })}>{viewedDate}</div>}
          </div>
          <NavArrow dir="next" onClick={() => go(1)} disabled={!canGoNext(viewedDate, todayStr)} />
        </div>

        {/* sub-tabs */}
        <div className="span-all" style={{ display: "flex", gap: 8, padding: "0 18px 12px" }}>
          {[["food", "Food"], ["weight", "Weight"]].map(([k, l]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} aria-pressed={on}
                style={{ flex: 1, borderRadius: 11, padding: "9px 0", fontFamily: TYPE.sans, fontSize: 13, fontWeight: on ? 600 : 400, cursor: "pointer",
                  border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? A.ink : "transparent", color: on ? A.card : A.bodyOnFill }}>{l}</button>
            );
          })}
        </div>

        {tab === "food"
          ? <FoodTab {...{ intakeLog, ration, tr, startItems: start.items, library, viewedDate, todayStr, target, isDemo, isToday, intakeDayStatus, setIntakeDayFlag, selectDay, fridge, fridgeDays, cupboard, consumeFridge, reconcileFridge, consumeRotationSlot, openSlotCan, finishSlotCan, setCanRemaining }} />
          : <WeightTab {...{ weightLog, viewedDate, isDemo, isToday, unit, collar, expSettings, setExpSettings, selectDay }} />}
      </div>
    </div>
  );
}

function NavArrow({ dir, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={dir === "prev" ? "Previous day" : "Next day"}
      style={{ width: 38, height: 38, borderRadius: 12, border: `1.5px solid ${disabled ? A.cardBorder : A.ink}`, background: "transparent", color: disabled ? A.cardBorder : A.ink, cursor: disabled ? "default" : "pointer", fontSize: 16 }}>
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}

/* ---------- kcal-per-day chart ---------- */
function KcalChart({ intakeItems, days, selected, onSelect, target, dayStatus, todayStr }) {
  const byDay = useMemo(() => new Map(groupByDay(intakeItems).map((g) => [g.date, g.items.reduce((s, e) => s + num(e.kcal), 0)])), [intakeItems]);
  const peak = Math.max(target * 1.1, ...days.map((d) => byDay.get(d) || 0), 1);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={label()}>Kcal eaten per day</span>
        <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>target {target}</span>
      </div>
      <div style={{ position: "relative", height: 74, display: "flex", alignItems: "flex-end", gap: 4 }}>
        {/* target line */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(target / peak) * 74}px`, borderTop: `1px dashed ${A.chart.zeroLine}` }} />
        {days.map((d) => {
          const v = byDay.get(d);
          const h = v ? Math.max(2, (v / peak) * 74) : 0;
          const incomplete = dayStatus?.[d] === "incomplete";
          const isSel = d === selected;
          const isTdy = d === todayStr;
          const fill = isSel ? A.good : incomplete ? "transparent" : isTdy ? A.track : A.chart.neutralBar;
          return (
            <button key={d} onClick={() => onSelect(d)} aria-label={`${d}${v ? `, ${r0(v)} kcal` : ", nothing logged"}`}
              style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              <div style={{ height: `${h}px`, borderRadius: 4, background: fill, border: incomplete ? `1px dashed ${A.cardBorder}` : "none" }} />
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
        {days.map((d) => (
          <span key={d} style={{ flex: 1, textAlign: "center", fontFamily: TYPE.mono, fontSize: 8.5, color: d === selected ? A.ink : A.muted, fontWeight: d === selected ? 700 : 400 }}>
            {d.slice(8)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- food tab ---------- */
function FoodTab({ intakeLog, ration, tr, startItems, library, viewedDate, todayStr, target, isDemo, isToday, intakeDayStatus, setIntakeDayFlag, selectDay, fridge, fridgeDays, cupboard, consumeFridge, reconcileFridge, consumeRotationSlot, openSlotCan, finishSlotCan, setCanRemaining }) {
  const [name, setName] = useState("");
  const [kcalG, setKcalG] = useState(0);
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const [picked, setPicked] = useState(null); // the chosen library food (for by-the-each entry)
  const [treats, setTreats] = useState("");
  const [treatUnit, setTreatUnit] = useState("count"); // unit foods: enter by count (×) or by grams
  // Treats and supplements are given by the each (a treat, a sachet), so they can be logged by count.
  const isTreat = foodType(picked) === "treat" || foodType(picked) === "supplement";
  const unitWord = foodType(picked) === "supplement" ? "sachet" : "treat";
  const derived = kcalG > 0; // we know the energy density → kcal is computed, not typed
  const computed = num(grams) > 0 && kcalG > 0 ? num(grams) * kcalG : null;
  useEffect(() => { if (computed != null) setKcal(String(r1(computed))); }, [computed]);
  // Treats are given by the each, not weighed: entering a count derives the grams (which then
  // drives kcal through the effect above) from the food's per-treat weight/energy.
  const onTreats = (v) => {
    setTreats(v);
    const n = num(v);
    const gpt = num(picked?.gramsPerUnit), kpt = num(picked?.kcalPerUnit);
    setGrams(v !== "" && gpt > 0 ? String(Number((n * gpt).toFixed(2))) : "");
    if (!(gpt > 0)) setKcal(v !== "" && kpt > 0 ? String(r1(n * kpt)) : ""); // fallback if no derived weight
  };

  const days = useMemo(() => {
    const out = [];
    for (let i = 9; i >= 0; i--) out.push(shiftDay(viewedDate, -i, "0000-01-01", viewedDate));
    return out;
  }, [viewedDate]);
  const dayItems = intakeLog.items.filter((e) => e.date === viewedDate);
  const total = dayItems.reduce((s, e) => s + num(e.kcal), 0);
  const flagged = intakeDayStatus[viewedDate] === "incomplete";

  // Tonight's bowl (the old Today screen, folded in): shown on today's view before anything's
  // logged. "Log it" fills the day from the ration split in one tap.
  // Mid-switch, the plan is the RAMP's mix for today — not the final ration. `tr` records that a
  // switch is on and its length but never which day you're on, so the day is inferred from what
  // was actually fed yesterday (see lib/transition.js for why that beats counting calendar days).
  const ramp = useMemo(() => {
    if (!tr?.on || !(startItems || []).length) return null;
    const resolved = resolveRotationsWithFridge(ration.items, viewedDate, fridge, fridgeDays, cupboard);
    // The most recent PRIOR day that actually has entries (up to a week back) — missing a day of
    // logging shouldn't rewind the ramp to day 1; it advances by however many days have passed.
    let prior = [], gapDays = 1;
    for (let back = 1; back <= 7; back++) {
      const d = addDays(viewedDate, -back);
      const hits = intakeLog.items.filter((e) => e.date === d);
      if (hits.length) { prior = hits; gapDays = back; break; }
    }
    const { day, basis, matchedPrior } = inferTransitionDay({ startItems, resolvedRationItems: resolved, target, days: tr.days, priorEntries: prior, gapDays });
    return { day, basis, matchedPrior, gapDays, days: clampDays(tr.days), resolved };
  }, [tr?.on, tr?.days, startItems, ration.items, target, viewedDate, fridge, fridgeDays, intakeLog.items]);

  const steps = useMemo(() => {
    const resolved = ramp ? ramp.resolved : resolveRotationsWithFridge(ration.items, viewedDate, fridge, fridgeDays, cupboard); // rotation slot → the flavor to feed (open can first)
    // Mid-ramp: blend today's share of the new ration with what's fading out. Otherwise: the ration.
    const rows = ramp
      ? transitionSteps({ startItems, resolvedRationItems: resolved, target, day: ramp.day, days: ramp.days })
      : distributeBowl(resolved, target).rows;
    return rows.filter((s) => s.kcal > 0).map((s) => {
      // a food on its way OUT isn't in the ration, so look it up on the "currently feeding" side
      const f = resolved.find((x) => x.id === s.id) || (startItems || []).find((x) => x.id === s.id) || {};
      return { ...s, type: foodType(f), treatCount: f.treatCount, food: f, rot: isRotating(f) };
    }).sort((a, b) => (a.splitMode === "remainder" ? 1 : 0) - (b.splitMode === "remainder" ? 1 : 0));
  }, [ramp, ration.items, startItems, target, viewedDate, fridge, fridgeDays]);
  const showPlan = steps.length > 0; // the day's plan persists all day, showing what's left to feed

  // How much of each plan slot is still to feed, so logging in small meals doesn't make the plan
  // vanish. Match logged entries to a slot by name — for a rotation, by ANY of its flavor names, so
  // grams fed across the pack count toward the one slot. Remaining = planned − fed.
  const slotNames = (s) => (s.rot && Array.isArray(s.food?.rotation)
    ? s.food.rotation.map((m) => (m.name || "").trim().toLowerCase())
    : [(s.name || "").trim().toLowerCase()]);
  const fedByName = useMemo(() => {
    const m = new Map();
    dayItems.forEach((e) => { const k = (e.name || "").trim().toLowerCase(); const c = m.get(k) || { grams: 0, kcal: 0 }; m.set(k, { grams: c.grams + num(e.grams), kcal: c.kcal + num(e.kcal) }); });
    return m;
  }, [dayItems]);
  // What's left to feed, REBALANCED to still hit the target. Each food's own plan−fed is the naive
  // remainder; but if you over/under-fed something, the flex foods (the main meal — share/remainder)
  // scale so the day still lands on target. Fixed amounts and supplements are protected: they stay
  // put (you don't skip the probiotic because of a bonus treat), and can push the day over target.
  const planRows = useMemo(() => {
    const rows = steps.map((s) => {
      let fedG = 0, fedK = 0;
      for (const k of slotNames(s)) { const f = fedByName.get(k); if (f) { fedG += f.grams; fedK += f.kcal; } }
      const kpg = num(s.food?.kcalPerG) || (num(s.grams) > 0 ? s.kcal / s.grams : 0);
      return { s, kpg, protectedRow: s.splitMode === "fixed" || s.type === "supplement", naiveG: Math.max(0, num(s.grams) - fedG), fedK };
    });
    const remKs = rebalanceRemaining(rows.map((r) => ({ plannedK: r.s.kcal, fedK: r.fedK, protected: r.protectedRow })), target, total);
    return rows.map((r, i) => {
      const remK = remKs[i];
      const remG = r.protectedRow || !(r.kpg > 0) ? r.naiveG : remK / r.kpg;
      const done = num(r.s.grams) > 0 ? remG < 0.5 : remK < 1;
      return { s: r.s, remG, remK, done };
    });
  }, [steps, fedByName, target, total]); // eslint-disable-line react-hooks/exhaustive-deps
  const remainingRows = planRows.filter((r) => !r.done);
  const remainingKcal = Math.max(0, target - total);

  // Log a portion of a slot: one intake entry for the grams fed (under the current flavor's name),
  // then draw the fridge — a rotation walks the pack (finish the open can, then the next flavor); a
  // plain food draws its own can. The fridge is forgiving of small over/under vs its estimate.
  const logSlotPortion = (s, grams) => {
    if (!(grams > 0)) return;
    const f = s.food || {};
    const kpg = num(f.kcalPerG) || (num(s.grams) > 0 ? s.kcal / s.grams : 0);
    const entry = { ...manualEntryStamp(viewedDate), grams: Number(grams.toFixed(1)), name: s.name || null, kcalPerG: kpg > 0 ? kpg : null, kcal: r1(grams * kpg) };
    // treats/supplements are given by the each — record the count so the log reads "2 treats", not grams
    if ((s.type === "treat" || s.type === "supplement") && num(f.gramsPerUnit) > 0) {
      const cnt = grams / num(f.gramsPerUnit);
      entry.treatCount = Number(cnt.toFixed(2));
      entry.kcalPerTreat = num(f.kcalPerUnit);
      entry.gramsPerTreat = num(f.gramsPerUnit);
      entry.unitLabel = s.type === "supplement" ? "sachet" : "treat";
      entry.kcal = r1(cnt * num(f.kcalPerUnit));
    }
    intakeLog.add(entry);
    if (!isToday) return;
    if (s.rot) consumeRotationSlot(s.id, grams);
    else if (s.food && isCanned(s.food)) consumeFridge(s.food, grams);
  };
  const logAllRemaining = () => remainingRows.forEach((r) => logSlotPortion(r.s, r.remG));

  // When a logged wet meal's grams are edited, move the difference in/out of the fridge (only for
  // today's entries and foods we can size from the library).
  const reconcileEntry = (en, deltaGrams) => {
    if (!isToday || !(Math.abs(deltaGrams) > 0.01)) return;
    const food = library.foods.find((f) => (f.name || "").trim().toLowerCase() === (en.name || "").trim().toLowerCase());
    if (food && isCanned(food)) reconcileFridge(food, deltaGrams);
  };
  // Deleting a logged wet meal must give its grams BACK to the fridge — the mirror of logging
  // drawing them down (only for today's entries and library-known canned foods).
  const removeEntry = (en) => {
    reconcileEntry(en, -num(en.grams));
    intakeLog.remove(en.id);
  };

  const add = () => {
    if (num(kcal) > 0) {
      const treatFields = isTreat && treatUnit === "count" && num(treats) > 0
        ? { treatCount: num(treats), kcalPerTreat: num(picked.kcalPerUnit), gramsPerTreat: num(picked.gramsPerUnit), unitLabel: unitWord }
        : {};
      intakeLog.add({ ...manualEntryStamp(viewedDate), kcal: r1(num(kcal)), grams: num(grams) || null, name: name || null, kcalPerG: kcalG > 0 ? kcalG : null, ...treatFields });
      // Hybrid fridge: logging a wet meal today draws its open can down, and opens one if none of
      // that food is open — the same as "Log tonight's bowl" does. Match the typed/picked name to a
      // saved food for the can size; deduct grams (derived from kcal when only kcal was entered).
      // No-op for dry/unknown.
      if (isToday) {
        const food = library.foods.find((f) => (f.name || "").trim().toLowerCase() === (name || "").trim().toLowerCase());
        const g = num(grams) > 0 ? num(grams) : (kcalG > 0 ? num(kcal) / kcalG : 0);
        if (food && isCanned(food) && g > 0) consumeFridge(food, g);
      }
      setGrams(""); setKcal(""); setTreats("");
    }
  };

  const allFed = showPlan && remainingRows.length === 0;

  return (
    <>
      {showPlan && isToday && (
        <Card className="span-all">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={label()}>Still to feed today</div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 11, color: allFed ? A.good : A.body }}>{allFed ? "all fed ✓" : `${r0(remainingKcal)} kcal to go`}</div>
          </div>
          {/* Mid-switch these amounts are the RAMP's mix for today, not the final ration — say so,
              or the numbers look like they disagree with the ration page. */}
          {ramp && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: A.good, fontWeight: 600 }}>
                switching · day {ramp.day} of {ramp.days}
              </span>
              <span style={{ fontSize: 11.5, color: A.muted }}>
                {ramp.basis === "attarget"
                  ? "What you fed yesterday already matches this ration, so the switch is done — you can turn it off on the ration page."
                  : ramp.day >= ramp.days
                  ? "last day — this is the full new ration."
                  : `${r0(shareOfNew(ramp.day, ramp.days) * 100)}% new ration today.`}
                {ramp.basis === "start" ? " Starting the ramp (nothing logged yesterday)." : ""}
                {/* say WHERE the day came from: a wrong day is otherwise unfalsifiable from the UI */}
                {ramp.basis === "inferred" && <span style={{ color: A.muted }}>{" "}Read from {ramp.gapDays === 1 ? "yesterday" : `${ramp.gapDays} days ago`}, which matched day {ramp.matchedPrior}.</span>}
              </span>
              <a href="#/ration" style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.good, textDecoration: "none" }}>schedule ›</a>
            </div>
          )}
          {allFed ? (
            <p style={{ fontSize: 12.5, color: A.muted, marginTop: 8, lineHeight: 1.45 }}>The whole plan's logged for today. Anything extra goes below.</p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
                {planRows.map((r) => {
                  const s = r.s;
                  const isUnit = s.type === "treat" || s.type === "supplement";
                  const perU = num(s.food?.kcalPerUnit);
                  const unitWord = s.type === "supplement" ? "sachet" : "treat";
                  const remCount = isUnit && perU > 0 ? r.remK / perU : null;
                  const amt = remCount != null
                    ? `${Number(remCount.toFixed(remCount % 1 ? 1 : 0))} ${unitWord}${Math.abs(remCount - 1) < 1e-9 ? "" : "s"}`
                    : num(s.grams) > 0 ? `${Number(r.remG.toFixed(1))} g` : `${kc(r.remK)} kcal`;
                  const wet = s.rot || isCanned(s.food);
                  const openC = wet ? (availableCansOf(fridge, s.name, todayStr, fridgeDays)[0] || null) : null;
                  // reads-empty but not yet confirmed finished — ask rather than assume
                  const emptyC = wet && !openC ? (emptiedCansOf(fridge, s.name)[0] || null) : null;
                  // What's left of a wet slot may not fit in the open can — and the rest comes from
                  // the NEXT flavor, at ITS density. So plan the draw across cans/flavors; when it
                  // takes more than one, grams stop being a single number and the headline shows
                  // kcal with the per-can split below it.
                  const draw = wet && isToday && !r.done ? planSlotDraw(s.food, r.remK, todayStr, fridge, fridgeDays, 12, cupboard) : null;
                  const split = draw && draw.segs.length > 1 ? draw.segs : null;
                  const canBtn = { fontFamily: TYPE.mono, fontSize: 11, border: "none", background: "none", cursor: "pointer", color: A.good, padding: 0, textDecoration: "underline" };
                  return (
                    <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: s.type === "wet" ? A.food.wet : s.type === "treat" ? A.food.treat : A.food.dry, flex: "none" }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: r.done ? A.muted : A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.name}{s.rot ? <span style={{ fontFamily: TYPE.mono, fontSize: 10, color: A.muted }}> · pack</span> : ""}
                        </span>
                        {r.done ? (
                          <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.good, flex: "none" }}>fed ✓</span>
                        ) : (
                          <>
                            <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.body, flex: "none" }}>{split ? `${kc(r.remK)} kcal` : amt} left</span>
                            <button onClick={() => logSlotPortion(s, num(s.grams) > 0 ? r.remG : 0)} disabled={!(r.remG > 0)}
                              style={{ flex: "none", fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "3px 10px", cursor: r.remG > 0 ? "pointer" : "default", border: `1px solid ${A.cardBorder}`, background: "transparent", color: r.remG > 0 ? A.good : A.cardBorder }}>log it</button>
                          </>
                        )}
                      </div>
                      {/* The open can can't cover what's left, so say what actually comes out of
                          which can — "finish the 3.4 g that's open, then 49.9 g of the next flavor"
                          — instead of one gram figure priced at the open can's density. */}
                      {split && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 16 }}>
                          {split.map((seg, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6, fontFamily: TYPE.mono, fontSize: 11 }}>
                              <span style={{ color: A.ink, minWidth: 52 }}>{Number(seg.grams.toFixed(1))} g</span>
                              <span style={{ color: A.body, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seg.name}</span>
                              <span style={{ color: A.muted, flex: "none" }}>{seg.kind === "open" ? "finishes this can" : "new can"}</span>
                            </div>
                          ))}
                          {draw.shortfall > 1 && <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.caution.text }}>{kc(draw.shortfall)} kcal unplaced — add another flavor to the pack</div>}
                        </div>
                      )}
                      {wet && isToday && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 16, flexWrap: "wrap", fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>
                          {openC ? (
                            <>
                              <span>open can · {Number(num(openC.remainingGrams).toFixed(1))} g left</span>
                              <button onClick={() => finishSlotCan(s.id)} style={canBtn}>finish can</button>
                            </>
                          ) : emptyC ? (
                            // Tracked-zero is a PROMPT, not a fact: a "80 g" can varies both ways, so
                            // ask instead of quietly discarding a can that may still have food in it.
                            <>
                              <span style={{ color: A.caution.text }}>this can should be about empty</span>
                              <button onClick={() => finishSlotCan(s.id)} style={canBtn}>finished it</button>
                              <span>· still has</span>
                              <input type="number" min="0" step="0.1" inputMode="decimal" placeholder="g"
                                onKeyDown={(e) => { if (e.key === "Enter") { const v = Number(e.currentTarget.value); if (v > 0) { setCanRemaining(emptyC.id, v); e.currentTarget.value = ""; } } }}
                                onBlur={(e) => { const v = Number(e.currentTarget.value); if (v > 0) { setCanRemaining(emptyC.id, v); e.currentTarget.value = ""; } }}
                                style={{ width: 52, fontFamily: TYPE.mono, fontSize: 11, padding: "2px 5px", borderRadius: 7, border: `1px solid ${A.cardBorder}`, background: "transparent", color: A.ink }} />
                              <span>g left</span>
                            </>
                          ) : (
                            <>
                              <span>no can open</span>
                              <button onClick={() => openSlotCan(s.id)} style={canBtn}>open can</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button onClick={logAllRemaining} style={{ marginTop: 12, width: "100%", background: A.ink, color: A.card, border: "none", borderRadius: 12, padding: "11px 0", fontFamily: TYPE.sans, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Log everything remaining ✓</button>
              <p style={{ fontSize: 11, color: A.muted, marginTop: 8, lineHeight: 1.4 }}>Feeding in bits? Tap “log it” as you dispense, or add a portion below. Feed extra of one and the main meal adjusts to still hit {target} kcal; supplements and fixed amounts stay put.</p>
            </>
          )}
        </Card>
      )}

      <Card className="span-all" style={{ padding: "12px 16px" }}>
        <KcalChart intakeItems={intakeLog.items} days={days} selected={viewedDate} onSelect={selectDay} target={target} dayStatus={intakeDayStatus} todayStr={todayStr} />
      </Card>

      {/* eaten */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: TYPE.mono, fontSize: 30, fontWeight: 600 }}>{r0(total)}<span style={{ fontSize: 13, color: A.body }}> of {target} kcal</span></div>
          {dayItems.length > 0 && <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: flagged ? A.caution.text : A.good, fontWeight: 600 }}>{flagged ? "incomplete" : "complete day"}</span>}
        </div>
        <a href="#/calories" style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.good, textDecoration: "none", marginTop: 4, display: "inline-block" }}>calorie plan · set the target ›</a>
      </Card>

      {/* where it came from — the full summary (calories/weight flip, per-food, macros) */}
      <DaySummary items={intakeLog.items} library={library.foods} viewedDate={viewedDate} />

      {/* add a meal */}
      {(
        <Card>
          <div style={label({ marginBottom: 8 })}>Add a meal</div>
          <div style={{ border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: 8, marginBottom: 8 }}>
            <FoodSearch value={name} search={library.search} onChangeName={(v) => { setName(v); setKcalG(0); setPicked(null); setTreats(""); }} onPick={(f) => { setName(f.name); setKcalG(kcalPerG(f)); setPicked(f); }} />
          </div>
          {isTreat && (
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              {[["count", `by ${unitWord}`], ["g", "by grams"]].map(([u, lbl]) => (
                <button key={u} onClick={() => setTreatUnit(u)} aria-pressed={treatUnit === u}
                  style={{ fontFamily: TYPE.mono, fontSize: 10.5, borderRadius: 999, padding: "3px 10px", cursor: "pointer", border: treatUnit === u ? "none" : `1px solid ${A.cardBorder}`, background: treatUnit === u ? A.ink : "transparent", color: treatUnit === u ? A.card : A.muted }}>{lbl}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            {isTreat && treatUnit === "count"
              ? <NumBox label={unitWord === "sachet" ? "Sachets" : "Treats"} suf="×" value={treats} onChange={onTreats} />
              : <NumBox label="Grams" suf="g" value={grams} onChange={setGrams} />}
            {derived
              ? (
                <label style={{ display: "block" }}>
                  <span style={label({ fontSize: 9 })}>kcal</span>
                  <div style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.body, padding: "2px 0", minWidth: 56 }} aria-label="kcal (computed)">{num(kcal) > 0 ? `${kc(num(kcal))} kcal` : "—"}</div>
                </label>
              )
              : <NumBox label="kcal" suf="kcal" value={kcal} onChange={setKcal} />}
            <button onClick={add} style={{ background: A.good, color: A.card, border: "none", borderRadius: 12, padding: "10px 16px", fontSize: 18, cursor: "pointer" }}>+</button>
          </div>
          <button onClick={() => intakeLog.add({ ...manualEntryStamp(viewedDate), kcal: 0, grams: null, name: "nothing eaten" })}
            style={{ marginTop: 8, background: "none", border: "none", color: A.muted, fontFamily: TYPE.mono, fontSize: 11, textDecoration: "underline", cursor: "pointer" }}>
            nothing eaten {isToday ? "today" : "this day"}
          </button>
        </Card>
      )}

      {/* entries */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: dayItems.length ? 8 : 0 }}>
          <span style={label()}>{dayItems.length} item{dayItems.length === 1 ? "" : "s"}</span>
          {!isDemo && dayItems.length > 0 && (
            <button onClick={() => setIntakeDayFlag(viewedDate, !flagged)} style={{ background: "none", border: "none", color: flagged ? A.caution.text : A.muted, fontFamily: TYPE.mono, fontSize: 10.5, textDecoration: "underline", cursor: "pointer" }}>
              {flagged ? "incomplete — excluded" : "mark incomplete"}
            </button>
          )}
        </div>
        {dayItems.length === 0 ? (
          <p style={{ fontSize: 12, color: A.muted }}>No meals logged {isToday ? "today" : "this day"}.</p>
        ) : dayItems.map((en) => (
          <EntryRow key={en.id} en={en} onEdit={intakeLog.edit} onRemove={removeEntry} onReconcile={reconcileEntry} />
        ))}
      </Card>
    </>
  );
}

// A logged meal, with its grams and kcal editable in place (not just deletable). Typing grams
// updates kcal via the food's energy density (and vice versa) when it's known; otherwise each is
// edited on its own. Local state holds the value being typed so the caret doesn't jump on each
// keystroke; it resyncs to the stored value on blur.
const entryNum = { fontFamily: TYPE.mono, fontSize: 12.5, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "right", padding: "1px 2px" };
function EntryRow({ en, onEdit, onRemove, onReconcile }) {
  const [gEdit, setGEdit] = useState(null);
  const [kEdit, setKEdit] = useState(null);
  const [tEdit, setTEdit] = useState(null);
  const kpg = num(en.kcalPerG);
  // A treat entry is logged by count, not weight: edit the count and kcal/grams follow from the
  // per-treat values recorded at log time (falling back to the logged ratios for older entries).
  const isTreatEntry = en.treatCount != null;
  const kpt = num(en.kcalPerTreat) || (en.treatCount > 0 ? num(en.kcal) / en.treatCount : 0);
  const gpt = num(en.gramsPerTreat) || (en.treatCount > 0 ? num(en.grams) / en.treatCount : 0);
  const tShown = tEdit != null ? tEdit : String(Number(num(en.treatCount).toFixed(2)));
  const commitT = (v) => {
    setTEdit(v);
    const n = v === "" ? 0 : num(v);
    onEdit(en.id, { treatCount: n, kcal: r0(n * kpt), grams: gpt > 0 ? Number((n * gpt).toFixed(2)) : en.grams });
  };
  // Capture the grams at the start of an edit; on blur, hand the NET change to the fridge once
  // (rather than per keystroke, which would churn cans on intermediate values).
  const baseGrams = useRef(null);
  const onFieldFocus = () => { baseGrams.current = num(en.grams); };
  const onFieldBlur = (clearEdit) => {
    clearEdit();
    const base = baseGrams.current;
    baseGrams.current = null;
    if (base != null) onReconcile?.(en, num(en.grams) - base);
  };
  const isNothing = (en.name || "").trim().toLowerCase() === "nothing eaten";
  const gShown = gEdit != null ? gEdit : (en.grams != null ? String(Number(num(en.grams).toFixed(1))) : "");
  const kShown = kEdit != null ? kEdit : kc(num(en.kcal));
  const commitG = (v) => {
    setGEdit(v);
    const grams = v === "" ? null : num(v);
    const patch = { grams };
    if (kpg > 0 && grams != null) patch.kcal = r1(grams * kpg); // kcal follows grams when we know the density
    onEdit(en.id, patch);
  };
  const commitK = (v) => {
    setKEdit(v);
    const kcal = v === "" ? 0 : r1(num(v));
    const patch = { kcal };
    if (kpg > 0) patch.grams = Number((kcal / kpg).toFixed(1)); // and grams follows kcal
    onEdit(en.id, patch);
  };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
      <span style={{ color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{en.name || "—"}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "none" }}>
        {en.ts != null && <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{new Date(en.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        {isNothing ? (
          <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.body }}>0 kcal</span>
        ) : isTreatEntry ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
              <input type="number" step="any" min="0" value={tShown} onChange={(e) => commitT(e.target.value)} onBlur={() => setTEdit(null)} aria-label="treats" style={{ ...entryNum, width: 34 }} />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{en.unitLabel || "treat"}{num(en.treatCount) === 1 ? "" : "s"}</span>
            </span>
            <span style={{ color: A.muted, fontFamily: TYPE.mono, fontSize: 11 }}>·</span>
            <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.body }}>{kc(num(en.kcal))} kcal</span>
          </>
        ) : (
          <>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
              <input type="number" step="any" min="0" value={gShown} onFocus={onFieldFocus} onChange={(e) => commitG(e.target.value)} onBlur={() => onFieldBlur(() => setGEdit(null))} aria-label="grams" style={{ ...entryNum, width: 42 }} />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>g</span>
            </span>
            <span style={{ color: A.muted, fontFamily: TYPE.mono, fontSize: 11 }}>·</span>
            {kpg > 0 ? (
              // energy density known → kcal follows the grams, so it's a read-only readout, not an input
              <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.body }}>{kc(num(en.kcal))} kcal</span>
            ) : (
              // no density (a hand-typed food) → kcal must be entered directly
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
                <input type="number" step="any" min="0" value={kShown} onChange={(e) => commitK(e.target.value)} onBlur={() => setKEdit(null)} aria-label="kcal" style={{ ...entryNum, width: 40 }} />
                <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>kcal</span>
              </span>
            )}
          </>
        )}
        <button onClick={() => onRemove(en)} aria-label="Remove" style={{ background: "none", border: "none", color: A.muted, cursor: "pointer" }}>×</button>
      </span>
    </div>
  );
}


/* ---------- weight-over-time chart (weight tab) ---------- */
// The counterpart to KcalChart above: the calories tab has always shown a 10-day history, while the
// weight tab showed only the selected day's reads — so the shape of the thing you're actually
// tracking was invisible from the page where you record it. Daily medians as a line, every
// individual reading as a dot COLOURED BY METHOD, so a reading that sits off the trend and a
// reading taken a different way are visible as the same glance.
function WeightHistoryChart({ items, days, selected, onSelect, unit, disp }) {
  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of items) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(num(e.kg)); }
    return m;
  }, [items]);
  const pts = days.map((d, i) => ({ i, date: d, kg: byDay.has(d) ? median(byDay.get(d)) : null }));
  const vals = pts.map((p) => p.kg).filter((v) => v != null).map(disp);
  const reads = items.filter((e) => days.includes(e.date));
  if (vals.length < 1) return <p style={{ fontSize: 12, color: A.muted }}>No weigh-ins in the last {days.length} days.</p>;
  const lo = Math.min(...vals, ...reads.map((r) => disp(num(r.kg))));
  const hi = Math.max(...vals, ...reads.map((r) => disp(num(r.kg))));
  const pad = (hi - lo) * 0.25 || 0.05;
  const H = 84, W = 320, PADL = 4;
  const x = (i) => PADL + (days.length <= 1 ? (W - PADL) / 2 : (i / (days.length - 1)) * (W - PADL * 2));
  const y = (v) => H - 8 - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - 16);
  const line = pts.filter((p) => p.kg != null).map((p) => [x(p.i), y(disp(p.kg))]);
  const idxOf = (d) => days.indexOf(d);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={label()}>Weight · last {days.length} days</span>
        <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{Number(lo.toFixed(2))}–{Number(hi.toFixed(2))} {weightLabel(unit)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        {line.length > 1 && <path d={line.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
          fill="none" stroke={A.chart.trend} strokeWidth="1.8" opacity="0.85" />}
        {reads.map((r, k) => (
          <circle key={k} cx={x(idxOf(r.date))} cy={y(disp(num(r.kg)))} r={r.date === selected ? 3.6 : 2.4}
            fill={WEIGH_METHOD_COLOR[r.method] || A.muted} opacity={r.date === selected ? 1 : 0.6} />
        ))}
        {days.map((d, i) => (
          <rect key={d} x={x(i) - 6} y={0} width={12} height={H} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onSelect(d)} />
        ))}
        {selected && idxOf(selected) >= 0 && <line x1={x(idxOf(selected))} x2={x(idxOf(selected))} y1={0} y2={H} stroke={A.cardBorder} strokeWidth="1" />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: TYPE.mono, fontSize: 9, color: A.muted, padding: "2px 2px 0" }}>
        <span>{days[0]?.slice(5)}</span><span>{days[days.length - 1]?.slice(5)}</span>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6, fontFamily: TYPE.mono, fontSize: 10, color: A.muted }}>
        {[...new Set(reads.map((r) => r.method || "other"))].map((m) => (
          <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: WEIGH_METHOD_COLOR[m] || A.muted }} />
            {(WEIGH_METHODS[m] || {}).label || "unknown"}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- weight tab ---------- */
function WeightTab({ weightLog, viewedDate, isDemo, isToday, unit, collar, expSettings, setExpSettings, selectDay }) {
  const [val, setVal] = useState("");
  const [method, setMethod] = useState(expSettings.lastMethod || DEFAULT_METHOD);
  // Whether the collar was on for the weigh-in being entered. Starts at the cat's usual answer FOR
  // THE DAY ON SCREEN — backfilling a day from before she had a collar defaults to unchecked, same
  // as the readings already logged then. So the common case is one number and a "+"; the checkbox
  // is only ever touched for the exception.
  const wearsCollar = hasCollar(collar);
  const usualForDay = collarWorn({ date: viewedDate }, collar);
  const [collarOn, setCollarOn] = useState(usualForDay);
  useEffect(() => { setCollarOn(usualForDay); }, [usualForDay]);
  const dayItems = weightLog.items.filter((e) => e.date === viewedDate);
  // Every kg here is already the CAT, not the scale — the collar came off in AppState's weightLog
  // view (see lib/collar.js). `rawKg` is what the scale read, kept for the rows to show.
  const dayKg = dayItems.length ? median(dayItems.map((e) => num(e.kg))) : null;
  const add = () => {
    if (num(val) > 0) {
      weightLog.add({
        ...manualWeighInStamp(viewedDate), kg: fromDisplayWeight(num(val), unit), method, source: WEIGH_SOURCES.manual,
        // Stored only when there IS a collar, and always explicitly: the owner has just answered
        // for this reading, so it shouldn't drift later if the cat's default changes.
        ...(wearsCollar ? { collarOn } : {}),
      });
      setExpSettings({ lastMethod: method }); setVal("");
    }
  };
  const histDays = useMemo(() => {
    const out = [];
    for (let i = 29; i >= 0; i--) out.push(shiftDay(viewedDate, -i, "0000-01-01", viewedDate));
    return out;
  }, [viewedDate]);
  return (
    <>
      <Card className="span-all">
        <WeightHistoryChart items={weightLog.items} days={histDays} selected={viewedDate}
          onSelect={selectDay} unit={unit} disp={(kg) => toDisplayWeight(kg, unit)} />
      </Card>
      {(
        <Card className="span-all">
          <div style={label({ marginBottom: 8 })}>Add a weigh-in</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {Object.entries(WEIGH_METHODS).map(([k, m]) => (
              <button key={k} onClick={() => setMethod(k)} aria-pressed={method === k}
                style={{ fontFamily: TYPE.mono, fontSize: 10.5, borderRadius: 8, padding: "4px 9px", cursor: "pointer",
                  border: method === k ? "none" : `1px solid ${A.cardBorder}`, background: method === k ? A.ink : "transparent", color: method === k ? A.card : A.muted }}>{m.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <NumBox label="Weight" suf={weightLabel(unit)} value={val} onChange={setVal} step="0.01" />
            <button onClick={add} style={{ background: A.good, color: A.card, border: "none", borderRadius: 12, padding: "10px 16px", fontSize: 18, cursor: "pointer" }}>+</button>
          </div>
          {/* Enter what the scale said; this says whether the collar was in that number. */}
          {wearsCollar && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, fontFamily: TYPE.mono, fontSize: 11.5, color: A.muted, cursor: "pointer" }}>
              <input type="checkbox" checked={collarOn} onChange={(e) => setCollarOn(e.target.checked)} style={{ accentColor: A.good, width: 15, height: 15 }} />
              Collar on ({Number(num(collar.grams).toFixed(1))} g comes off)
            </label>
          )}
        </Card>
      )}
      <Card className="span-all">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: dayItems.length ? 8 : 0 }}>
          <span style={label()}>{dayItems.length} read{dayItems.length === 1 ? "" : "s"}</span>
          {dayKg != null && <span style={{ fontFamily: TYPE.mono, fontSize: 14, color: A.ink }}>{fmtWeight(dayKg, unit)} {weightLabel(unit)} avg</span>}
        </div>
        {dayItems.length === 0 ? (
          <p style={{ fontSize: 12, color: A.muted }}>No weigh-ins {isToday ? "today" : "this day"}.</p>
        ) : dayItems.map((en) => (
          <div key={en.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontFamily: TYPE.mono, fontSize: 12 }}>
            <span style={{ color: A.muted }}>{(WEIGH_METHODS[en.method] || WEIGH_METHODS[DEFAULT_METHOD]).label}{en.source === WEIGH_SOURCES.litterRobot ? " · auto" : ""}{en.ts != null ? ` · ${new Date(en.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {/* Correcting a reading after the fact: the chip writes an EXPLICIT collarOn, so this
                  entry stops following the cat's default from here on. The stored reading never
                  changes — only what we believe was on the cat when the scale took it. */}
              {wearsCollar && (
                <button onClick={() => weightLog.edit(en.id, { collarOn: !en.collarOn })}
                  aria-pressed={en.collarOn} title={en.collarOn ? `scale read ${fmtWeight(num(en.rawKg), unit)} ${weightLabel(unit)} with the collar on` : "collar was off"}
                  style={{ fontFamily: TYPE.mono, fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", borderRadius: 999, padding: "2px 7px", cursor: "pointer",
                    border: en.collarOn ? "none" : `1px solid ${A.cardBorder}`, background: en.collarOn ? A.track : "transparent", color: A.muted }}>
                  collar {en.collarOn ? "on" : "off"}
                </button>
              )}
              <span style={{ color: A.body }}>{fmtWeight(num(en.kg), unit)} {weightLabel(unit)}</span>
              {<button onClick={() => weightLog.remove(en.id)} aria-label="Remove" style={{ background: "none", border: "none", color: A.muted, cursor: "pointer" }}>×</button>}
            </span>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ---------- day/week food summary: calories | weight flip, per-food, macros ---------- */
function DaySummary({ items, library, viewedDate }) {
  const [range, setRange] = useState("day");
  const [basis, setBasis] = useState("calories");
  const win = useMemo(() => {
    if (range === "day") return { list: items.filter((e) => e.date === viewedDate), days: 1 };
    const { start, end } = trailingWindow(viewedDate, 7);
    return { list: itemsInRange(items, start, end), days: 7 };
  }, [items, viewedDate, range]);
  const s = useMemo(() => foodSummary(win.list, library, win.days), [win, library]);
  const m = useMemo(() => macroBreakdown(win.list, library, win.days), [win, library]);
  const byKcal = basis === "calories";
  const week = range === "week";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <span style={label()}>Where it came from</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Toggle options={[["day", "day"], ["week", "7-day"]]} value={range} onChange={setRange} accent={A.good} />
          <Toggle options={[["calories", "cal"], ["weight", "g"]]} value={basis} onChange={setBasis} accent={A.gold} />
        </div>
      </div>
      {s.isEmpty ? (
        <p style={{ fontSize: 12, color: A.muted }}>Nothing logged {week ? "in the last 7 days" : "this day"}.</p>
      ) : (
        <DistributionBody s={s} m={m} byKcal={byKcal} week={week} />
      )}
    </Card>
  );
}
function NumBox({ label: lbl, suf, value, onChange, step = "any" }) {
  return (
    <label style={{ display: "block" }}>
      <span style={label({ fontSize: 9 })}>{lbl}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, borderBottom: `1px solid ${A.cardBorder}`, marginTop: 2 }}>
        <input type="number" step={step} min="0" value={value} onChange={(e) => onChange(e.target.value)} aria-label={lbl}
          style={{ width: 56, fontFamily: TYPE.mono, fontSize: 16, color: A.ink, background: "transparent", border: "none", padding: "2px 0" }} />
        <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{suf}</span>
      </div>
    </label>
  );
}
