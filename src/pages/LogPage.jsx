import { useState, useEffect, useMemo } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { groupByDay, median, localDateOf, manualWeighInStamp, manualEntryStamp } from "../lib/series.js";
import { earliestLoggedDay, clampDay, canGoPrev, canGoNext, shiftDay, formatDayLabel } from "../lib/dayPager.js";
import { foodSummary, macroBreakdown, trailingWindow, itemsInRange } from "../lib/foodStats.js";
import { kcalPerG, foodType } from "../lib/foods.js";
import { distributeBowl } from "../lib/bowl.js";
import { WEIGH_METHODS, DEFAULT_METHOD, WEIGH_SOURCES } from "../lib/expenditure.js";
import { toDisplayWeight, fromDisplayWeight, weightLabel, fmtWeight } from "../lib/units.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import FoodSearch from "../components/FoodSearch.jsx";
import { DistributionBody, Toggle } from "../components/FoodDistribution.jsx";

const r0 = (n) => Math.round(n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const g1 = (g) => (g == null ? "—" : `${Number(Number(g).toFixed(1))} g`);
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const Em = ({ children }) => <strong style={{ fontWeight: 500, boxShadow: `inset 0 -7px 0 ${A.underline}` }}>{children}</strong>;
const stepAmount = (s) => (s.splitMode === "fixed" && s.type === "treat" && num(s.treatCount) ? `${Number(num(s.treatCount).toFixed(1))} treat${num(s.treatCount) === 1 ? "" : "s"}` : g1(s.grams));
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
  const { p, intent, ration, intakeLog: liveIntake, weightLog: liveWeight, library, unit, intakeDayStatus, setIntakeDayFlag, activeCatId, expSettings, setExpSettings } = useApp();
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
          ? <FoodTab {...{ intakeLog, ration, library, viewedDate, todayStr, target, isDemo, isToday, intakeDayStatus, setIntakeDayFlag, selectDay }} />
          : <WeightTab {...{ weightLog, viewedDate, isDemo, isToday, unit, expSettings, setExpSettings }} />}
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
function FoodTab({ intakeLog, ration, library, viewedDate, todayStr, target, isDemo, isToday, intakeDayStatus, setIntakeDayFlag, selectDay }) {
  const [name, setName] = useState("");
  const [kcalG, setKcalG] = useState(0);
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const computed = num(grams) > 0 && kcalG > 0 ? num(grams) * kcalG : null;
  useEffect(() => { if (computed != null) setKcal(String(r0(computed))); }, [computed]);

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
  const steps = useMemo(() => {
    const dist = distributeBowl(ration.items, target);
    return dist.rows.filter((s) => s.kcal > 0).map((s) => {
      const f = ration.items.find((x) => x.id === s.id) || {};
      return { ...s, type: foodType(f), treatCount: f.treatCount };
    }).sort((a, b) => (a.splitMode === "remainder" ? 1 : 0) - (b.splitMode === "remainder" ? 1 : 0));
  }, [ration.items, target]);
  const showTonight = isToday && steps.length > 0 && dayItems.length === 0;
  const logTonight = () => steps.forEach((s) => intakeLog.add({ ...manualEntryStamp(viewedDate), kcal: r0(s.kcal), grams: s.grams != null ? Number(s.grams.toFixed(1)) : null, name: s.name || null, kcalPerG: s.grams > 0 ? s.kcal / s.grams : null }));

  const add = () => {
    if (num(kcal) > 0) {
      intakeLog.add({ ...manualEntryStamp(viewedDate), kcal: r0(num(kcal)), grams: num(grams) || null, name: name || null, kcalPerG: kcalG > 0 ? kcalG : null });
      setGrams(""); setKcal("");
    }
  };

  return (
    <>
      {showTonight && (
        <Card className="span-all">
          <div style={label({ marginBottom: 6 })}>Tonight's bowl · {target} kcal</div>
          <p style={{ fontFamily: TYPE.serif, fontSize: 19, lineHeight: 1.36, margin: 0, color: A.ink }}>
            Feed {steps.map((s, i) => <span key={s.id}><Em>{stepAmount(s)}</Em> of {s.name || "food"}{i < steps.length - 1 ? (i === steps.length - 2 ? ", and " : ", ") : "."}</span>)}
          </p>
          <button onClick={logTonight} style={{ marginTop: 12, width: "100%", background: A.ink, color: A.card, border: "none", borderRadius: 12, padding: "11px 0", fontFamily: TYPE.sans, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Log it ✓</button>
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
            <FoodSearch value={name} search={library.search} onChangeName={(v) => { setName(v); setKcalG(0); }} onPick={(f) => { setName(f.name); setKcalG(kcalPerG(f)); }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <NumBox label="Grams" suf="g" value={grams} onChange={setGrams} />
            <NumBox label="kcal" suf="kcal" value={kcal} onChange={setKcal} />
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
          <div key={en.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
            <span style={{ color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{en.name || "—"}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flex: "none" }}>
              {en.ts != null && <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{new Date(en.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
              <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.body }}>{en.grams != null ? `${Number(Number(en.grams).toFixed(1))} g · ` : ""}{r0(num(en.kcal))} kcal</span>
              {<button onClick={() => intakeLog.remove(en.id)} aria-label="Remove" style={{ background: "none", border: "none", color: A.muted, cursor: "pointer" }}>×</button>}
            </span>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ---------- weight tab ---------- */
function WeightTab({ weightLog, viewedDate, isDemo, isToday, unit, expSettings, setExpSettings }) {
  const [val, setVal] = useState("");
  const [method, setMethod] = useState(expSettings.lastMethod || DEFAULT_METHOD);
  const dayItems = weightLog.items.filter((e) => e.date === viewedDate);
  const dayKg = dayItems.length ? median(dayItems.map((e) => num(e.kg))) : null;
  const add = () => {
    if (num(val) > 0) {
      weightLog.add({ ...manualWeighInStamp(viewedDate), kg: fromDisplayWeight(num(val), unit), method, source: WEIGH_SOURCES.manual });
      setExpSettings({ lastMethod: method }); setVal("");
    }
  };
  return (
    <>
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
