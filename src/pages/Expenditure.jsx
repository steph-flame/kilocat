import { useState, useMemo } from "react";
import { ChevronLeft, Scale, NotebookPen, Info, Target, Activity } from "lucide-react";
import { C, CHART } from "../theme.js";
import { r0, r1 } from "../lib/util.js";
import { planWeightChange, autoDirection, DIRECTIONS, RATE } from "../lib/weightPlan.js";
import { buildDailyFrame, RANGES } from "../lib/timeline.js";
import { toDisplayWeight, weightLabel, weeklyRate, round5 } from "../lib/units.js";
import { floorSdKcal } from "../lib/expenditure.js";
import { dailyReduce, median } from "../lib/series.js";
import { useApp } from "../state/AppState.jsx";
import TimelineChart from "../components/TimelineChart.jsx";
import { Note } from "../components/primitives.jsx";
import CatMark from "../components/CatMark.jsx";

const fmtKcal = (n) => (n == null ? "—" : r0(n));

export default function Expenditure() {
  const { p, t, expenditure, intakeLog, weightLog, intakeDayStatus, expSettings, setExpSettings, unit } = useApp();
  const e = expenditure;
  const kitten = t.stage !== "adult"; // stage, not a raw age check — catches a newborn (dob = today, age 0) too
  const algoName = { v3: "unobserved-components", v2: "Kalman filter", v1: "EWMA + regression" }[expSettings.algo];
  const wLbl = weightLabel(unit);
  const showW = (kg, d = 1) => `${(d === 1 ? r1 : r0)(toDisplayWeight(kg, unit))} ${wLbl}`;

  const maintenance = e.enoughData ? e.kcal : t.refs.maintain;
  const dir = expSettings.direction && expSettings.direction !== "auto" ? expSettings.direction : autoDirection(t.pctOver);
  const plan = planWeightChange({ direction: dir, maintenanceKcal: maintenance, currentKg: t.w, idealKg: t.idealWeight, pctPerWeek: expSettings.pctPerWeek });
  const planTarget = round5(plan.targetKcal); // snap to a round number
  const delta = planTarget - maintenance; // signed: − deficit, + surplus
  const changeRate = weeklyRate(plan.resultingWeeklyChangeKg, unit);
  const dirLabel = { lose: "Lose", maintain: "Maintain", gain: "Gain" };

  const [showAlgo, setShowAlgo] = useState(false);
  const [range, setRange] = useState("3m");
  const [analysis, setAnalysis] = useState("none"); // 'none' | 'rate' | 'kcal'
  const rangeDays = RANGES.find((r) => r.key === range)?.days;

  // Before enoughData the estimate is still worth showing — the filters return null (never
  // ±0) below 2 weigh-ins, and even once they return a number the band is honestly wide (see
  // floorSdKcal). displayKcal/displaySd are ONLY for what this page renders; resolveTarget
  // (shared with Home/Ration) still gates the actual feeding target on e.enoughData untouched.
  const priorKcal = t.refs.maintain;
  const displayKcal = e.kcal ?? priorKcal;
  const displaySd = e.enoughData ? e.sd : Math.max(e.sd || 0, floorSdKcal(e.nDays, priorKcal));

  // The estimator's own `trend` needs ≥2 weigh-in days before it produces anything (that's
  // what powers the confidence-band math). With just one logged weigh-in, fall back to the raw
  // point(s) so the timeline can still plot "whatever exists" — flatted onto the same
  // display estimate + floored band shown in the module above, so the two never disagree.
  const rawTrend = useMemo(() => {
    if (e.trend.length) return e.trend;
    const raw = dailyReduce(weightLog.items.map((w) => ({ date: w.date, value: w.kg })), median);
    return raw.map((d) => ({ date: d.date, kg: d.value, e: displayKcal, sd: displaySd }));
  }, [e.trend, weightLog.items, displayKcal, displaySd]);

  const frame = useMemo(
    () => buildDailyFrame(rawTrend, intakeLog.items.map((x) => ({ date: x.date, value: x.kcal })), rangeDays, intakeDayStatus),
    [rawTrend, intakeLog.items, rangeDays, intakeDayStatus],
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

        <div className="flex items-end gap-4 mb-6">
          <CatMark size={60} />
          <div className="min-w-0">
            <div style={{ color: C.amber }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><Activity size={13} /> energy expenditure</div>
            <h1 className="text-[26px] font-extrabold leading-tight" style={{ letterSpacing: "-0.02em" }}>What {p.name} actually burns</h1>
            <p style={{ color: C.sub }} className="text-sm mt-1">Measured from weight trend and what you fed — not a formula's guess. <a href="#/log" style={{ color: C.spruce }} className="underline">Log weigh-ins and food →</a></p>
          </div>
        </div>

        {kitten && (
          <Note tone="warn">{p.name} is still growing ({r0(t.age)} mo). This tool is built for <strong>adult weight management</strong> — in a kitten, growth is added tissue, so a rising weight doesn't mean over-feeding and the energy-balance estimate is confounded. Use the ration planner's growth-aware targets instead until ~12 months.</Note>
        )}

        {/* estimate */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between">
            <div style={{ color: C.sub }} className="text-xs uppercase tracking-widest font-mono">Measured maintenance</div>
            <button onClick={() => setShowAlgo((s) => !s)} aria-expanded={showAlgo} style={{ color: C.faint }} className="text-xs font-mono">estimator {expSettings.algo} {showAlgo ? "▾" : "▸"}</button>
          </div>
          {showAlgo && (
            <div className="flex items-center justify-between mt-2 mb-1">
              <span style={{ color: C.faint }} className="text-[11px] leading-snug">v3 unobserved-components · v2 Kalman · v1 EWMA. v3 is best for almost everyone.</span>
              <div className="flex rounded-full overflow-hidden border shrink-0 ml-2" style={{ borderColor: C.line }}>
                {[["v3", "v3"], ["v2", "v2"], ["v1", "v1"]].map(([a, lbl]) => (
                  <button key={a} onClick={() => setExpSettings({ algo: a })} aria-pressed={expSettings.algo === a} style={{ background: expSettings.algo === a ? C.spruce : "transparent", color: expSettings.algo === a ? "#fff" : C.sub }} className="text-xs px-2 py-1 font-mono">{lbl}</button>
                ))}
              </div>
            </div>
          )}
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
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <span style={{ color: C.amber }} className="text-4xl font-mono font-semibold tabular-nums">{fmtKcal(displayKcal)}</span>
                <span style={{ color: C.sub }} className="text-lg font-mono">kcal/day</span>
                <span style={{ color: C.faint }} className="text-xs font-mono ml-1">± {r0(1.96 * displaySd)} (95%)</span>
                <span style={{ color: C.faint }} className="text-xs font-mono">{e.kcal == null ? "vet formula" : "early estimate"}</span>
              </div>
              {e.trendWeightKg != null && (
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs font-mono">
                  <Stat label="Trend weight" value={showW(e.trendWeightKg)} />
                  <Stat label={e.rateKgPerWeek == null ? "Rate" : e.rateKgPerWeek <= 0 ? "Losing" : "Gaining"} value={e.rateKgPerWeek == null ? "—" : `${r0(rate.value)} ${rate.unit}`} />
                  <Stat label="Rate" value={e.ratePctPerWeek == null ? "—" : `${e.ratePctPerWeek > 0 ? "+" : ""}${r1(e.ratePctPerWeek)} %/wk`} />
                </div>
              )}
              <Note>
                {e.nDays > 0 ? `${e.nDays} day${e.nDays === 1 ? "" : "s"} logged — mostly` : "Mostly"} the vet formula's guess until ~2 weeks of logs — that's why the band above is wide. <a href="#/log" style={{ color: C.spruce }} className="underline">Log weight + food</a> and it tightens into a real measured estimate.
              </Note>
            </>
          )}
        </section>

        {/* timeline — always shown once there's any logged weigh-in, however sparse; a truly
            empty log gets a friendly prompt instead of an empty chart. */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          {rawTrend.length > 0 ? (
            <>
              <TimelineChart frame={frame} range={range} onRange={setRange} ranges={RANGES} unit={unit} analysisMode={analysis === "none" ? null : analysis} planDirection={dir} />
              <div className="flex items-center justify-between mt-2 gap-3">
                <p style={{ color: C.faint }} className="text-xs leading-snug flex-1">Where <span style={{ color: CHART.intake }}>calories in</span> sits below <span style={{ color: CHART.expenditure }}>expenditure</span>, the cat runs a deficit and the weight above trends down. Shaded = 95% confidence{!e.enoughData && " (wide until ~2 weeks of logs)"}.</p>
                <div className="flex items-center gap-1 shrink-0">
                  {analysis !== "none" && (
                    <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
                      {[["rate", "%/wk"], ["kcal", "± kcal"]].map(([m, l]) => (
                        <button key={m} onClick={() => setAnalysis(m)} aria-pressed={analysis === m} style={{ background: analysis === m ? C.spruce : "transparent", color: analysis === m ? "#fff" : C.sub }} className="text-xs px-1.5 py-1 font-mono">{l}</button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setAnalysis((a) => (a === "none" ? "rate" : "none"))} aria-pressed={analysis !== "none"} style={{ borderColor: C.line, color: analysis !== "none" ? C.spruce : C.sub, background: analysis !== "none" ? C.spruceSoft : "transparent" }} className="text-xs font-mono border rounded-lg px-2 py-1">analysis</button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: C.faint, borderColor: C.line }} className="border border-dashed rounded-xl text-xs text-center py-10">
              No weigh-ins yet — <a href="#/log" style={{ color: C.spruce }} className="underline">log {p.name}'s weight</a> and this fills in, starting from your very first entry.
            </div>
          )}
        </section>

        {/* feeding plan — adults only; kittens grow into their frame instead */}
        {!kitten && (
          <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><Target size={16} style={{ color: C.amber }} /><h2 className="font-medium">Feeding plan</h2></div>
              <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
                {DIRECTIONS.map((d) => (
                  <button key={d} onClick={() => setExpSettings({ direction: d })} aria-pressed={dir === d} style={{ background: dir === d ? C.spruce : "transparent", color: dir === d ? "#fff" : C.sub }} className="text-xs px-2.5 py-1 font-mono">{dirLabel[d]}</button>
                ))}
              </div>
            </div>
            <p style={{ color: C.faint }} className="text-xs mb-3">
              {dir === "maintain"
                ? `Feed to hold ${p.name} at ${showW(t.w)}, off ${e.enoughData ? "measured" : "formula"} maintenance.`
                : `A calorie ${dir === "gain" ? "surplus over" : "deficit off"} ${e.enoughData ? "measured" : "formula"} maintenance (${r0(maintenance)} kcal), sized to a vet-safe rate. ${dir === "gain" ? "Underweight cats should fill out gradually." : "Cats slim slowly — too fast risks hepatic lipidosis."}`}
            </p>

            {dir === "maintain" ? (
              <div style={{ background: C.spruceSoft }} className="rounded-xl p-3">
                <span style={{ color: C.spruce }} className="text-3xl font-mono font-semibold tabular-nums">{round5(maintenance)}<span className="text-sm font-normal"> kcal/day</span></span>
                <span style={{ color: C.faint }} className="text-xs font-mono ml-2">holds current weight</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span style={{ color: C.sub }} className="text-xs">Target {dir === "gain" ? "gain" : "loss"} rate</span>
                  <span style={{ color: C.amber }} className="text-sm font-mono tabular-nums">{r1(expSettings.pctPerWeek)} %/week</span>
                </div>
                <input type="range" min={RATE.min} max={RATE.max} step="0.05" value={expSettings.pctPerWeek}
                  onChange={(ev) => setExpSettings({ pctPerWeek: Number(ev.target.value) })}
                  aria-label={`Target ${dir === "gain" ? "gain" : "loss"} rate, percent of body weight per week`} aria-valuetext={`${r1(expSettings.pctPerWeek)} percent per week`}
                  className="w-full block" style={{ accentColor: C.amber }} />
                <div style={{ color: C.faint }} className="flex justify-between text-xs font-mono mt-0.5"><span>{RATE.min}% gentle</span><span>{RATE.max}% max safe</span></div>

                <div style={{ background: C.spruceSoft }} className="mt-4 rounded-xl p-3">
                  <div className="flex items-baseline justify-between">
                    <span style={{ color: C.spruce }} className="text-3xl font-mono font-semibold tabular-nums">{planTarget}<span className="text-sm font-normal"> kcal/day</span></span>
                    <span style={{ color: C.sub }} className="text-xs font-mono text-right">{delta >= 0 ? "+" : "−"}{r0(Math.abs(delta))} kcal {delta >= 0 ? "surplus" : "deficit"}<br />{dir === "gain" ? "gains" : "loses"} ~{r0(changeRate.value)} {changeRate.unit} ({r1(plan.resultingRatePctPerWeek)}%)</span>
                  </div>
                  {plan.weeksToIdeal != null && (
                    <div style={{ color: C.faint }} className="text-xs font-mono mt-2">~{Math.ceil(plan.weeksToIdeal)} weeks to reach ideal ({showW(t.idealWeight)}), re-measuring as you go</div>
                  )}
                </div>
                {plan.warnings.map((w, i) => (<Note key={i} tone="warn">{w}</Note>))}
              </>
            )}

            <a href="#/ration" onClick={() => setExpSettings({ energyBasis: "measured" })}
              style={{ borderColor: C.line, color: C.spruce }}
              className="mt-3 w-full border rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white">
              Use as the ration target <Scale size={14} />
            </a>
            {!e.enoughData && <p style={{ color: C.faint }} className="text-xs mt-1.5">Uses formula maintenance until enough data is logged, then switches to measured automatically.</p>}
          </section>
        )}

        <div style={{ color: C.faint }} className="text-xs leading-relaxed space-y-2 px-1 pb-4">
          <p className="flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /><span>Log the grams you <em>dispense</em> — a steady grazing-leftover habit cancels out, since the estimate calibrates dispensed calories against the weight response.</span></p>
          <p>Method: expenditure ≈ mean intake − ρ × weight-change rate (ρ ≈ 7800 kcal/kg, inferred from feline body-composition studies — see README), over a trailing window. Safe change rate 0.5–2%/week (AAHA / APOP); loss floor ~0.8 × RER at ideal weight. Not veterinary advice.</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: C.spruceSoft }} className="rounded-lg px-2.5 py-2">
      <div style={{ color: C.sub }} className="text-[11px] uppercase tracking-wide">{label}</div>
      <div style={{ color: C.ink }} className="tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
