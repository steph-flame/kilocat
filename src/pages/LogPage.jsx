import { useState, useEffect, useMemo } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { groupByDay, median, localDateOf, manualWeighInStamp } from "../lib/series.js";
import { earliestLoggedDay, clampDay, canGoPrev, canGoNext, shiftDay, formatDayLabel } from "../lib/dayPager.js";
import { foodSummary } from "../lib/foodStats.js";
import { kcalPerG } from "../lib/foods.js";
import { WEIGH_METHODS, DEFAULT_METHOD, WEIGH_SOURCES } from "../lib/expenditure.js";
import { toDisplayWeight, fromDisplayWeight, weightLabel, fmtWeight } from "../lib/units.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import FoodSearch from "../components/FoodSearch.jsx";

const r0 = (n) => Math.round(n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

export default function LogPage() {
  const { p, intent, intakeLog, weightLog, library, unit, intakeDayStatus, setIntakeDayFlag, activeCatId, expSettings, setExpSettings } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;
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
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        {/* day navigator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 8px" }}>
          <NavArrow dir="prev" onClick={() => go(-1)} disabled={!canGoPrev(viewedDate, minDate)} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{label2}</div>
            {label2 !== viewedDate && <div style={label({ color: A.labelOnFill, fontSize: 10 })}>{viewedDate}</div>}
          </div>
          <NavArrow dir="next" onClick={() => go(1)} disabled={!canGoNext(viewedDate, todayStr)} />
        </div>

        {/* sub-tabs */}
        <div style={{ display: "flex", gap: 8, padding: "0 18px 12px" }}>
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
          ? <FoodTab {...{ intakeLog, library, viewedDate, todayStr, target, isDemo, isToday, intakeDayStatus, setIntakeDayFlag, selectDay }} />
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
function FoodTab({ intakeLog, library, viewedDate, todayStr, target, isDemo, isToday, intakeDayStatus, setIntakeDayFlag, selectDay }) {
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
  const sum = foodSummary(dayItems, library.foods, 1);

  const add = () => {
    if (num(kcal) > 0) {
      intakeLog.add({ date: viewedDate, kcal: r0(num(kcal)), grams: num(grams) || null, name: name || null, kcalPerG: kcalG > 0 ? kcalG : null });
      setGrams(""); setKcal("");
    }
  };
  const pct = (part) => (total > 0 ? (part / total) * 100 : 0);

  return (
    <>
      <Card style={{ padding: "12px 16px" }}>
        <KcalChart intakeItems={intakeLog.items} days={days} selected={viewedDate} onSelect={selectDay} target={target} dayStatus={intakeDayStatus} todayStr={todayStr} />
      </Card>

      {/* eaten */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: TYPE.mono, fontSize: 30, fontWeight: 600 }}>{r0(total)}<span style={{ fontSize: 13, color: A.body }}> of {target} kcal</span></div>
          {dayItems.length > 0 && <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: flagged ? A.caution.text : A.good, fontWeight: 600 }}>{flagged ? "incomplete" : "complete day"}</span>}
        </div>
        {total > 0 && (
          <>
            <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", marginTop: 10, background: A.track }}>
              <span style={{ width: `${pct(sum.byType.wet.kcal)}%`, background: A.food.wet }} />
              <span style={{ width: `${pct(sum.byType.dry.kcal)}%`, background: A.food.dry }} />
              <span style={{ width: `${pct(sum.byType.treat.kcal)}%`, background: A.food.treat }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 6, fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>
              <Dot c={A.food.wet} /> wet {r0(sum.byType.wet.kcal)}
              <Dot c={A.food.dry} /> dry {r0(sum.byType.dry.kcal)}
              {sum.byType.treat.kcal > 0 && <><Dot c={A.food.treat} /> treats {r0(sum.byType.treat.kcal)}</>}
            </div>
          </>
        )}
      </Card>

      {/* add a meal */}
      {!isDemo && (
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
          <button onClick={() => intakeLog.add({ date: viewedDate, kcal: 0, grams: null, name: "nothing eaten" })}
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
              <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.body }}>{en.grams != null ? `${Number(Number(en.grams).toFixed(1))} g · ` : ""}{r0(num(en.kcal))} kcal</span>
              {!isDemo && <button onClick={() => intakeLog.remove(en.id)} aria-label="Remove" style={{ background: "none", border: "none", color: A.muted, cursor: "pointer" }}>×</button>}
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
      {!isDemo && (
        <Card>
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
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: dayItems.length ? 8 : 0 }}>
          <span style={label()}>{dayItems.length} read{dayItems.length === 1 ? "" : "s"}</span>
          {dayKg != null && <span style={{ fontFamily: TYPE.mono, fontSize: 14, color: A.ink }}>{fmtWeight(dayKg, unit)} {weightLabel(unit)} avg</span>}
        </div>
        {dayItems.length === 0 ? (
          <p style={{ fontSize: 12, color: A.muted }}>No weigh-ins {isToday ? "today" : "this day"}.</p>
        ) : dayItems.map((en) => (
          <div key={en.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontFamily: TYPE.mono, fontSize: 12 }}>
            <span style={{ color: A.muted }}>{(WEIGH_METHODS[en.method] || WEIGH_METHODS[DEFAULT_METHOD]).label}{en.source === WEIGH_SOURCES.litterRobot ? " · auto" : ""}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: A.body }}>{fmtWeight(num(en.kg), unit)} {weightLabel(unit)}</span>
              {!isDemo && <button onClick={() => weightLog.remove(en.id)} aria-label="Remove" style={{ background: "none", border: "none", color: A.muted, cursor: "pointer" }}>×</button>}
            </span>
          </div>
        ))}
      </Card>
    </>
  );
}

function Dot({ c }) { return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: c, marginRight: -8 }} />; }
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
