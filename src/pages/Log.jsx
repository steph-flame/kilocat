import { useState, useEffect } from "react";
import { ChevronLeft, ChevronDown, ChevronRight, Scale, Activity, NotebookPen, Plus, X } from "lucide-react";
import { C } from "../theme.js";
import { num, r0, r1 } from "../lib/util.js";
import { kcalPerG } from "../lib/foods.js";
import { groupByDay, median } from "../lib/series.js";
import { WEIGH_METHODS, DEFAULT_METHOD, WEIGH_SOURCES } from "../lib/expenditure.js";
import { toDisplayWeight, fromDisplayWeight, weightLabel } from "../lib/units.js";
import { useApp } from "../state/AppState.jsx";
import FoodSearch from "../components/FoodSearch.jsx";
import { Field, NumInput, Note } from "../components/primitives.jsx";
import CatMark from "../components/CatMark.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const methodLabel = (m) => (WEIGH_METHODS[m] || WEIGH_METHODS[DEFAULT_METHOD]).label;
const INITIAL_DAYS = 5;

export default function Log() {
  const { p, weightLog, intakeLog, library, expSettings, setExpSettings, unit } = useApp();

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

        <WeightLog log={weightLog} unit={unit} lastMethod={expSettings.lastMethod || DEFAULT_METHOD} onMethod={(m) => setExpSettings({ lastMethod: m })} />
        <IntakeLog log={intakeLog} library={library} />
      </div>
    </div>
  );
}

// A collapsible list of day-groups: shows INITIAL_DAYS, then a "show more" for the rest.
function DayList({ days, renderDay }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? days : days.slice(0, INITIAL_DAYS);
  return (
    <div className="mt-3 space-y-1.5">
      {shown.map(renderDay)}
      {days.length > INITIAL_DAYS && (
        <button onClick={() => setShowAll((s) => !s)} style={{ color: C.spruce }} className="text-xs font-mono inline-flex items-center gap-1 pt-1">
          {showAll ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{showAll ? "show less" : `show ${days.length - INITIAL_DAYS} more day${days.length - INITIAL_DAYS === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

/* ---------- weight log ---------- */
function WeightLog({ log, unit, lastMethod, onMethod }) {
  const [date, setDate] = useState(today);
  const [val, setVal] = useState("");
  const [method, setMethod] = useState(lastMethod || DEFAULT_METHOD);
  const chooseMethod = (m) => { setMethod(m); onMethod?.(m); }; // remember last-used across sessions
  const [open, setOpen] = useState(() => new Set()); // expanded day → shows individual reads
  const days = groupByDay(log.items);
  const addEntry = () => {
    if (num(val) > 0) { log.add({ date, kg: fromDisplayWeight(num(val), unit), method, source: WEIGH_SOURCES.manual }); setVal(""); }
  };
  const methodsUsed = new Set(log.items.map((e) => e.method).filter(Boolean));
  const toggleDay = (d) => setOpen((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });

  const renderDay = ({ date: d, items }) => {
    const dayKg = median(items.map((e) => num(e.kg)));
    const isOpen = open.has(d);
    return (
      <div key={d}>
        <button onClick={() => toggleDay(d)} className="w-full flex items-center justify-between text-sm font-mono py-1 border-b" style={{ borderColor: C.line }}>
          <span style={{ color: C.sub }} className="inline-flex items-center gap-1">
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{d}
            <span style={{ color: C.faint }} className="text-xs">· {items.length} read{items.length === 1 ? "" : "s"}{items.some((e) => e.source === WEIGH_SOURCES.litterRobot) ? " · auto" : ""}</span>
          </span>
          <span style={{ color: C.ink }} className="tabular-nums">{r1(toDisplayWeight(dayKg, unit))} {weightLabel(unit)}<span style={{ color: C.faint }} className="text-xs"> avg</span></span>
        </button>
        {isOpen && (
          <div className="pl-4 py-1 space-y-0.5">
            {items.map((en) => (
              <div key={en.id} className="flex items-center justify-between text-xs font-mono">
                <span style={{ color: C.faint }}>{en.method ? methodLabel(en.method) : "—"}{en.source === WEIGH_SOURCES.litterRobot ? " · auto" : ""}</span>
                <span className="flex items-center gap-2"><span style={{ color: C.sub }} className="tabular-nums">{r1(toDisplayWeight(num(en.kg), unit))} {weightLabel(unit)}</span>
                  <button onClick={() => log.remove(en.id)} style={{ color: C.faint }}><X size={12} /></button></span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <h2 className="font-medium mb-1">Weight log</h2>
      <p style={{ color: C.faint }} className="text-xs mb-3">One or more weigh-ins per day — the day's reads are median-averaged. Log manually below, or connect a Litter-Robot in Settings to have it appended automatically (tagged "auto").</p>

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
        <label className="block flex-1"><div style={{ color: C.sub }} className="text-xs mb-1">Date</div>
          <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} style={{ borderColor: C.line, color: C.ink }} className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-sm font-mono outline-none" /></label>
        <div className="w-24"><Field label="Weight" suffix={weightLabel(unit)}><NumInput value={val} onChange={setVal} step={unit === "lb" ? "0.05" : "0.01"} /></Field></div>
        <button onClick={addEntry} style={{ background: C.spruce }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
      </div>

      {methodsUsed.size > 1 && (
        <Note>This log mixes measurement methods ({[...methodsUsed].map(methodLabel).join(", ")}). Different methods can sit a bit apart, which reads as a jump in the trend — prefer sticking to one where you can.</Note>
      )}
      {days.length > 0 && <DayList days={days} renderDay={renderDay} />}
    </section>
  );
}

/* ---------- intake log ---------- */
function IntakeLog({ log, library }) {
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [kcalG, setKcalG] = useState(0);
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const computed = num(grams) > 0 && kcalG > 0 ? num(grams) * kcalG : null;
  // Auto-fill kcal from food × grams, but let the user override it afterward (they can edit
  // the field; it only re-fills when the food or grams change).
  useEffect(() => { if (computed != null) setKcal(String(r0(computed))); }, [computed]);
  const effectiveKcal = num(kcal);
  const days = groupByDay(log.items);
  const addEntry = () => {
    if (effectiveKcal > 0) {
      log.add({ date, kcal: r0(effectiveKcal), grams: num(grams) || null, name: name || null });
      setGrams(""); setKcal("");
    }
  };
  const toggleDay = (d) => setOpen((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });

  const renderDay = ({ date: d, items }) => {
    const total = items.reduce((s, en) => s + num(en.kcal), 0);
    const isOpen = open.has(d);
    return (
      <div key={d}>
        <button onClick={() => toggleDay(d)} className="w-full flex items-center justify-between text-sm font-mono py-1 border-b" style={{ borderColor: C.line }}>
          <span style={{ color: C.sub }} className="inline-flex items-center gap-1">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{d}
            <span style={{ color: C.faint }} className="text-xs">· {items.length} item{items.length === 1 ? "" : "s"}</span></span>
          <span style={{ color: C.ink }} className="tabular-nums">{r0(total)} kcal</span>
        </button>
        {isOpen && (
          <div className="pl-4 py-1 space-y-0.5">
            {items.map((en) => (
              <div key={en.id} className="flex items-center justify-between text-xs font-mono">
                <span style={{ color: C.faint }}>{en.name ? en.name.split(" ").slice(0, 2).join(" ") : "—"}{en.grams ? ` · ${r0(en.grams)}g` : ""}</span>
                <span className="flex items-center gap-2"><span style={{ color: C.sub }} className="tabular-nums">{r0(en.kcal)} kcal</span>
                  <button onClick={() => log.remove(en.id)} style={{ color: C.faint }}><X size={12} /></button></span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <h2 className="font-medium mb-1">Intake log</h2>
      <p style={{ color: C.faint }} className="text-xs mb-3">What you dispensed. Pick a saved food and enter grams, or enter kcal directly. Multiple entries per day sum.</p>
      <div className="space-y-2">
        <div className="flex items-center gap-2 border rounded-xl p-2" style={{ borderColor: C.line }}>
          <FoodSearch value={name} search={library.search}
            onChangeName={(v) => { setName(v); setKcalG(0); }}
            onPick={(food) => { setName(food.name); setKcalG(kcalPerG(food)); }} />
        </div>
        <div className="flex items-end gap-2">
          <label className="block flex-1"><div style={{ color: C.sub }} className="text-xs mb-1">Date</div>
            <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} style={{ borderColor: C.line, color: C.ink }} className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-sm font-mono outline-none" /></label>
          <div className="w-20"><Field label="Grams" suffix="g"><NumInput value={grams} onChange={setGrams} step="1" /></Field></div>
          <div className="w-24"><Field label="kcal" suffix="kcal">
            <NumInput value={kcal} onChange={setKcal} step="1" /></Field></div>
          <button onClick={addEntry} style={{ background: C.spruce }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
        </div>
        {kcalG > 0 && <p style={{ color: C.faint }} className="text-xs">{name} ≈ {r0(kcalG * 1000)} kcal/kg — grams × that fills kcal automatically.</p>}
      </div>
      {days.length > 0 && <DayList days={days} renderDay={renderDay} />}
    </section>
  );
}
