import { useState, useMemo } from "react";
import { ChevronLeft, Scale, NotebookPen, Info, TrendingDown, BarChart3 } from "lucide-react";
import { C, CHART } from "../theme.js";
import { r0, r1 } from "../lib/util.js";
import { planWeightLoss, RATE } from "../lib/weightPlan.js";
import { buildDailyFrame, RANGES } from "../lib/timeline.js";
import { toDisplayWeight, weightLabel, weeklyRate, round5 } from "../lib/units.js";
import { useApp } from "../state/AppState.jsx";
import TimelineChart from "../components/TimelineChart.jsx";
import { Note } from "../components/primitives.jsx";

const fmtKcal = (n) => (n == null ? "—" : r0(n));

export default function Expenditure() {
  const { p, t, expenditure, intakeLog, expSettings, setExpSettings } = useApp();
  const e = expenditure;
  const unit = expSettings.unit || "kg";
  const kitten = t.age > 0 && t.age < 12;
  const algoName = { v3: "unobserved-components", v2: "Kalman filter", v1: "EWMA + regression" }[expSettings.algo];
  const wLbl = weightLabel(unit);
  const showW = (kg, d = 1) => `${(d === 1 ? r1 : r0)(toDisplayWeight(kg, unit))} ${wLbl}`;

  const maintenance = e.enoughData ? e.kcal : t.refs.maintain;
  const plan = planWeightLoss({ maintenanceKcal: maintenance, currentKg: t.w, idealKg: t.idealWeight, pctPerWeek: expSettings.pctPerWeek });
  const planTarget = round5(plan.targetKcal); // snap to a round number
  const lossRate = weeklyRate(plan.resultingWeeklyLossKg, unit);

  const [range, setRange] = useState("3m");
  const [showBalance, setShowBalance] = useState(false);
  const rangeDays = RANGES.find((r) => r.key === range)?.days;
  const frame = useMemo(
    () => buildDailyFrame(e.trend, intakeLog.items.map((x) => ({ date: x.date, value: x.kcal })), rangeDays),
    [e.trend, intakeLog.items, rangeDays],
  );

  const rate = weeklyRate(e.rateKgPerWeek, unit);

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="flex items-center justify-between mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
          <span className="flex items-center gap-3">
            <a href="#/log" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><NotebookPen size={12} /> log</a>
            <a href="#/ration" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><Scale size={12} /> ration</a>
          </span>
        </nav>

        <div className="mb-6">
          <div style={{ color: C.spruce }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><BarChart3 size={13} /> energy expenditure</div>
          <h1 className="text-2xl font-semibold leading-tight" style={{ letterSpacing: "-0.01em" }}>What {p.name} actually burns</h1>
          <p style={{ color: C.sub }} className="text-sm mt-1">Back-calculated from her weight trend and what you fed. <a href="#/log" style={{ color: C.spruce }} className="underline">Log weigh-ins and food →</a></p>
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
                <Stat label="Trend weight" value={showW(e.trendWeightKg)} />
                <Stat label={e.rateKgPerWeek <= 0 ? "Losing" : "Gaining"} value={`${r0(rate.value)} ${rate.unit}`} />
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
              <Note>Not enough logged data yet ({e.nDays} day{e.nDays === 1 ? "" : "s"} of weight). <a href="#/log" style={{ color: C.spruce }} className="underline">Log weight + food</a> for ~2 weeks and a measured estimate replaces the formula here, with a confidence band that tightens as data builds.</Note>
            </>
          )}
        </section>

        {/* timeline */}
        {e.trend.length >= 2 && (
          <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
            <TimelineChart frame={frame} range={range} onRange={setRange} ranges={RANGES} unit={unit} showBalance={showBalance} />
            <div className="flex items-center justify-between mt-2 gap-3">
              <p style={{ color: C.faint }} className="text-xs leading-snug flex-1">Where <span style={{ color: CHART.intake }}>calories in</span> sits below <span style={{ color: CHART.expenditure }}>expenditure</span>, she's in a deficit and the weight above trends down. Shaded = 95% confidence.</p>
              <button onClick={() => setShowBalance((s) => !s)} style={{ borderColor: C.line, color: showBalance ? C.spruce : C.sub, background: showBalance ? C.spruceSoft : "transparent" }} className="text-xs font-mono border rounded-lg px-2 py-1 shrink-0">± balance</button>
            </div>
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
            <input type="range" min={RATE.min} max={RATE.max} step="0.05" value={expSettings.pctPerWeek}
              onChange={(ev) => setExpSettings({ pctPerWeek: Number(ev.target.value) })}
              className="w-full block" style={{ accentColor: C.amber }} />
            <div style={{ color: C.faint }} className="flex justify-between text-xs font-mono mt-0.5"><span>{RATE.min}% gentle</span><span>{RATE.max}% max safe</span></div>

            <div style={{ background: C.spruceSoft }} className="mt-4 rounded-xl p-3">
              <div className="flex items-baseline justify-between">
                <span style={{ color: C.spruce }} className="text-3xl font-mono font-semibold tabular-nums">{planTarget}<span className="text-sm font-normal"> kcal/day</span></span>
                <span style={{ color: C.sub }} className="text-xs font-mono text-right">−{r0(maintenance - planTarget)} kcal deficit<br />loses ~{r0(lossRate.value)} {lossRate.unit} ({r1(plan.resultingRatePctPerWeek)}%)</span>
              </div>
              {plan.weeksToIdeal != null && (
                <div style={{ color: C.faint }} className="text-xs font-mono mt-2">~{Math.ceil(plan.weeksToIdeal)} weeks to reach ideal ({showW(t.idealWeight)}), re-measuring as you go</div>
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

        <div style={{ color: C.faint }} className="text-xs leading-relaxed space-y-2 px-1 pb-4">
          <p className="flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /><span>Log the grams you <em>dispense</em> — a steady grazing-leftover habit cancels out, since the estimate calibrates dispensed calories against her weight response.</span></p>
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
