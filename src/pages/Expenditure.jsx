import { useState, useMemo } from "react";
import { ChevronLeft, Scale, Activity, Plus, X, Info, TrendingDown } from "lucide-react";
import { C, CHART } from "../theme.js";
import { num, r0, r1 } from "../lib/util.js";
import { kcalPerG } from "../lib/foods.js";
import { groupByDay } from "../lib/series.js";
import { planWeightLoss, RATE } from "../lib/weightPlan.js";
import { WEIGH_METHODS, DEFAULT_METHOD, WEIGH_SOURCES } from "../lib/expenditure.js";
import { buildDailyFrame, RANGES } from "../lib/timeline.js";
import { useApp } from "../state/AppState.jsx";
import FoodSearch from "../components/FoodSearch.jsx";
import TimelineChart from "../components/TimelineChart.jsx";
import { Field, NumInput, Note } from "../components/primitives.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const fmtKcal = (n) => (n == null ? "—" : r0(n));

export default function Expenditure() {
  const { p, t, expenditure, weightLog, intakeLog, library, expSettings, setExpSettings } = useApp();
  const e = expenditure;
  const kitten = t.age > 0 && t.age < 12;
  const algoName = { v3: "unobserved-components", v2: "Kalman filter", v1: "EWMA + regression" }[expSettings.algo];

  // Maintenance: measured if we have enough data, else the vet-formula fallback.
  const maintenance = e.enoughData ? e.kcal : t.refs.maintain;
  const plan = planWeightLoss({ maintenanceKcal: maintenance, currentKg: t.w, idealKg: t.idealWeight, pctPerWeek: expSettings.pctPerWeek });

  const [range, setRange] = useState("3m");
  const rangeDays = RANGES.find((r) => r.key === range)?.days;
  const frame = useMemo(
    () => buildDailyFrame(e.trend, intakeLog.items.map((x) => ({ date: x.date, value: x.kcal })), rangeDays),
    [e.trend, intakeLog.items, rangeDays],
  );

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="flex items-center justify-between mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
          <a href="#/ration" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><Scale size={12} /> ration planner</a>
        </nav>

        <div className="mb-6">
          <div style={{ color: C.spruce }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><Activity size={13} /> energy expenditure</div>
          <h1 className="text-2xl font-semibold leading-tight" style={{ letterSpacing: "-0.01em" }}>What {p.name} actually burns</h1>
          <p style={{ color: C.sub }} className="text-sm mt-1">Back-calculated from her weight trend and what you fed — the maintenance number the formula can only guess. Log a few weeks to sharpen it.</p>
        </div>

        {kitten && (
          <Note tone="warn">{p.name} is still growing ({r0(t.age)} mo). This tool is built for <strong>adult weight management</strong> — in a kitten, growth is added tissue, so a rising weight doesn't mean over-feeding and the energy-balance estimate is confounded. Use the ration planner's growth-aware targets instead until ~12 months.</Note>
        )}

        {/* estimate */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between">
            <div style={{ color: C.sub }} className="text-xs uppercase tracking-widest font-mono">Measured maintenance</div>
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: C.line }} title="v3 = unobserved-components (separates gut-fill transients). v2 = Kalman. v1 = EWMA + regression.">
              {[["v3", "v3"], ["v2", "v2"], ["v1", "v1"]].map(([a, lbl]) => (
                <button key={a} onClick={() => setExpSettings({ algo: a })} style={{ background: expSettings.algo === a ? C.spruce : "transparent", color: expSettings.algo === a ? "#fff" : C.sub }} className="text-xs px-2 py-1 font-mono">{lbl}</button>
              ))}
            </div>
          </div>
          {e.enoughData ? (
            <>
              <div className="flex items-baseline gap-2 mt-1">
                <span style={{ color: C.spruce }} className="text-5xl font-mono font-semibold tabular-nums">{fmtKcal(e.kcal)}</span>
                <span style={{ color: C.sub }} className="text-lg font-mono">kcal/day</span>
                <span style={{ color: C.faint }} className="text-xs font-mono ml-1">± {r0(1.96 * e.sd)} (95%)</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs font-mono">
                <Stat label="Trend weight" value={`${r1(e.trendWeightKg)} kg`} />
                <Stat label={e.rateKgPerWeek <= 0 ? "Losing" : "Gaining"} value={`${r0(Math.abs(e.rateKgPerWeek) * 1000)} g/wk`} />
                <Stat label="Rate" value={`${e.ratePctPerWeek > 0 ? "+" : ""}${r1(e.ratePctPerWeek)} %/wk`} />
              </div>
              <p style={{ color: C.faint }} className="text-xs mt-3 leading-snug">
                vs. the vet formula's {r0(t.refs.maintain)} kcal maintenance. {algoName}, {e.nDays} days
                {e.missingIntake > 0 && `, ${r0(e.missingIntake * 100)}% of intake days imputed`}.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mt-1">
                <span style={{ color: C.faint }} className="text-4xl font-mono font-semibold tabular-nums">{r0(t.refs.maintain)}</span>
                <span style={{ color: C.sub }} className="text-lg font-mono">kcal/day</span>
                <span style={{ color: C.faint }} className="text-xs font-mono ml-1">vet formula</span>
              </div>
              <Note>Not enough logged data yet ({e.nDays} day{e.nDays === 1 ? "" : "s"} of weight). Log daily weight and what you feed for ~2 weeks and a measured estimate replaces the formula here, with a confidence band that tightens as data builds.</Note>
            </>
          )}
        </section>

        {/* timeline */}
        {e.trend.length >= 2 && (
          <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
            <TimelineChart frame={frame} range={range} onRange={setRange} ranges={RANGES} />
            <p style={{ color: C.faint }} className="text-xs mt-2 leading-snug">Where <span style={{ color: CHART.intake }}>calories in</span> sits below <span style={{ color: CHART.expenditure }}>estimated expenditure</span>, she's in a deficit and the weight above trends down. The shaded band is the estimate's 95% confidence, narrowing as data builds.</p>
          </section>
        )}

        {/* safe deficit planner — adults only; kittens grow into their frame instead */}
        {t.pctOver > 0 && !kitten && (
          <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-1"><TrendingDown size={16} style={{ color: C.amber }} /><h2 className="font-medium">Safe weight-loss plan</h2></div>
            <p style={{ color: C.faint }} className="text-xs mb-3">A calorie deficit off {e.enoughData ? "measured" : "formula"} maintenance ({r0(maintenance)} kcal), sized to a vet-safe rate. Cats slim slowly — too fast risks hepatic lipidosis.</p>

            <div className="flex items-center justify-between mb-1">
              <span style={{ color: C.sub }} className="text-xs">Target loss rate</span>
              <span style={{ color: C.amber }} className="text-sm font-mono tabular-nums">{r1(expSettings.pctPerWeek)} %/week</span>
            </div>
            <input type="range" min={RATE.min} max={RATE.max} step="0.1" value={expSettings.pctPerWeek}
              onChange={(ev) => setExpSettings({ pctPerWeek: Number(ev.target.value) })}
              className="w-full block" style={{ accentColor: C.amber }} />
            <div style={{ color: C.faint }} className="flex justify-between text-xs font-mono mt-0.5"><span>{RATE.min}% gentle</span><span>{RATE.max}% max safe</span></div>

            <div style={{ background: C.spruceSoft }} className="mt-4 rounded-xl p-3">
              <div className="flex items-baseline justify-between">
                <span style={{ color: C.spruce }} className="text-3xl font-mono font-semibold tabular-nums">{r0(plan.targetKcal)}<span className="text-sm font-normal"> kcal/day</span></span>
                <span style={{ color: C.sub }} className="text-xs font-mono text-right">−{r0(maintenance - plan.targetKcal)} kcal deficit<br />loses ~{r0(plan.resultingWeeklyLossKg * 1000)} g/wk ({r1(plan.resultingRatePctPerWeek)}%)</span>
              </div>
              {plan.weeksToIdeal != null && (
                <div style={{ color: C.faint }} className="text-xs font-mono mt-2">~{Math.ceil(plan.weeksToIdeal)} weeks to reach ideal ({r1(t.idealWeight)} kg), re-measuring as you go</div>
              )}
            </div>
            {plan.warnings.map((w, i) => (<Note key={i} tone="warn">{w}</Note>))}

            <a href="#/ration" onClick={() => setExpSettings({ energyBasis: "measured" })}
              style={{ borderColor: C.line, color: C.spruce }}
              className="mt-3 w-full border rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white">
              Use as the ration target <Scale size={14} />
            </a>
            {!e.enoughData && <p style={{ color: C.faint }} className="text-xs mt-1.5">Uses formula maintenance until enough data is logged, then switches to measured automatically.</p>}
          </section>
        )}

        <WeightLog log={weightLog} />
        <IntakeLog log={intakeLog} library={library} />

        <div style={{ color: C.faint }} className="text-xs leading-relaxed space-y-2 px-1 pb-4">
          <p className="flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /><span>Log the grams you <em>dispense</em> — a steady grazing-leftover habit cancels out, since the estimate calibrates dispensed calories against her weight response. Weigh back leftovers occasionally to confirm it's steady.</span></p>
          <p>Method: expenditure ≈ mean intake − ρ × weight-change rate (ρ ≈ 8000 kcal/kg for a cat losing fat), over a trailing window. Safe loss rate 0.5–2%/week (AAHA / APOP); floor ~0.8 × RER at ideal weight. Not veterinary advice.</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: C.spruceSoft }} className="rounded-lg px-2.5 py-2">
      <div style={{ color: C.faint }} className="text-[10px] uppercase tracking-wide">{label}</div>
      <div style={{ color: C.ink }} className="tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

/* ---------- weight log ---------- */
const methodLabel = (m) => (WEIGH_METHODS[m] || WEIGH_METHODS[DEFAULT_METHOD]).label;

function WeightLog({ log }) {
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState("");
  const [method, setMethod] = useState(DEFAULT_METHOD);
  const recent = [...log.items].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  const addEntry = () => {
    if (num(kg) > 0) { log.add({ date, kg: num(kg), method, source: WEIGH_SOURCES.manual }); setKg(""); }
  };
  // Mixing measurement methods introduces a between-method offset that reads as a weight jump.
  const methodsUsed = new Set(log.items.map((e) => e.method).filter(Boolean));

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <h2 className="font-medium mb-1">Weight log</h2>
      <p style={{ color: C.faint }} className="text-xs mb-3">One or more weigh-ins per day (multiple readings get median-averaged). Manual entry now; Litter-Robot sync appends to the same log later.</p>

      {/* how it was measured */}
      <div className="mb-2">
        <div style={{ color: C.sub }} className="text-xs mb-1">Measured with</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(WEIGH_METHODS).map(([key, m]) => (
            <button key={key} onClick={() => setMethod(key)}
              style={{ borderColor: method === key ? C.spruce : C.line, background: method === key ? C.spruceSoft : "transparent", color: method === key ? C.spruce : C.sub }}
              className="text-xs border rounded-lg px-2 py-1 font-mono">{m.label}</button>
          ))}
        </div>
        {WEIGH_METHODS[method].hint && <p style={{ color: C.faint }} className="text-xs mt-1">{WEIGH_METHODS[method].hint}{method === "difference" && " — noisiest; the app leans on the median of several reads"}</p>}
      </div>

      <div className="flex items-end gap-2">
        <label className="block flex-1"><div style={{ color: C.sub }} className="text-xs mb-1">Date</div>
          <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} style={{ borderColor: C.line, color: C.ink }} className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-sm font-mono outline-none" /></label>
        <div className="w-24"><Field label="Weight" suffix="kg"><NumInput value={kg} onChange={setKg} step="0.01" /></Field></div>
        <button onClick={addEntry} style={{ background: C.spruce }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
      </div>

      {methodsUsed.size > 1 && (
        <Note>This log mixes measurement methods ({[...methodsUsed].map(methodLabel).join(", ")}). Different methods can sit a bit apart, which reads as a jump in the trend — prefer sticking to one where you can.</Note>
      )}

      {recent.length > 0 && (
        <div className="mt-3 space-y-1">
          {recent.map((en) => (
            <div key={en.id} className="flex items-center justify-between text-sm font-mono py-1 border-b last:border-0" style={{ borderColor: C.line }}>
              <span style={{ color: C.sub }}>{en.date} {en.method && <span style={{ color: C.faint }} className="text-xs">· {methodLabel(en.method)}</span>}{en.source === WEIGH_SOURCES.litterRobot && <span style={{ color: C.spruce }} className="text-xs"> · auto</span>}</span>
              <span className="flex items-center gap-3"><span style={{ color: C.ink }} className="tabular-nums">{r1(en.kg)} kg</span>
                <button onClick={() => log.remove(en.id)} style={{ color: C.faint }}><X size={14} /></button></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- intake log ---------- */
function IntakeLog({ log, library }) {
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [kcalG, setKcalG] = useState(0);   // kcal per gram of the picked food
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const computed = num(grams) > 0 && kcalG > 0 ? num(grams) * kcalG : null;
  const effectiveKcal = computed != null ? computed : num(kcal);
  const days = groupByDay(log.items).slice(0, 10); // grouped by day, newest first
  const addEntry = () => {
    if (effectiveKcal > 0) {
      log.add({ date, kcal: r0(effectiveKcal), grams: num(grams) || null, name: name || null });
      setGrams(""); setKcal("");
    }
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
          <div className="w-24"><Field label={computed != null ? "kcal (auto)" : "kcal"} suffix="kcal">
            <NumInput value={computed != null ? r0(computed) : kcal} onChange={setKcal} step="1" /></Field></div>
          <button onClick={addEntry} style={{ background: C.spruce }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
        </div>
        {kcalG > 0 && <p style={{ color: C.faint }} className="text-xs">{name} ≈ {r0(kcalG * 1000)} kcal/kg — grams × that fills kcal automatically.</p>}
      </div>
      {days.length > 0 && (
        <div className="mt-3 space-y-3">
          {days.map(({ date: d, items }) => {
            const total = items.reduce((s, en) => s + num(en.kcal), 0);
            return (
              <div key={d}>
                <div className="flex items-baseline justify-between border-b pb-1 mb-1" style={{ borderColor: C.line }}>
                  <span style={{ color: C.ink }} className="text-xs font-mono font-medium">{d}</span>
                  <span style={{ color: C.spruce }} className="text-xs font-mono tabular-nums">{r0(total)} kcal · {items.length} item{items.length === 1 ? "" : "s"}</span>
                </div>
                <div className="space-y-0.5">
                  {items.map((en) => (
                    <div key={en.id} className="flex items-center justify-between text-sm font-mono pl-2">
                      <span style={{ color: C.sub }}>{en.name ? en.name.split(" ").slice(0, 2).join(" ") : "—"}<span style={{ color: C.faint }}>{en.grams ? ` · ${r0(en.grams)}g` : ""}</span></span>
                      <span className="flex items-center gap-3"><span style={{ color: C.ink }} className="tabular-nums">{r0(en.kcal)} kcal</span>
                        <button onClick={() => log.remove(en.id)} style={{ color: C.faint }}><X size={14} /></button></span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
