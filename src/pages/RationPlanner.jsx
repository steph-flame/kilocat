import { useState } from "react";
import { Plus, Scale, Info, ChevronDown, ChevronRight, ChevronLeft, ArrowRight, Activity, NotebookPen } from "lucide-react";
import { C } from "../theme.js";
import { num, r0, r1 } from "../lib/util.js";
import { transitionAmount, isCompleteFood } from "../lib/foods.js";
import { resolveTarget } from "../lib/targeting.js";
import { toDisplayWeight, fromDisplayWeight, weightLabel } from "../lib/units.js";
import { useApp } from "../state/AppState.jsx";
import RationRow from "../components/RationRow.jsx";
import SavedFoods from "../components/SavedFoods.jsx";
import { Field, NumInput, Toggle, Row, RefRow, Note } from "../components/primitives.jsx";
import CatMark from "../components/CatMark.jsx";

export default function RationPlanner() {
  const {
    p, set, setFactor, ageUnit, ageDisplay, dobMissing, setBcs, setPct,
    today, currentWeight, logWeight,
    t, ration, start, library, saveFood, tr, setTr, fridgeDays, setFridgeDays,
    expenditure, expSettings, setExpSettings, unit,
  } = useApp();
  const savedNames = new Set(library.foods.map((x) => x.name.trim().toLowerCase()));
  const [showMath, setShowMath] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [wInput, setWInput] = useState("");

  const { age, w: wkg, goalId } = t;
  const wLbl = weightLabel(unit);
  const showW = (kg) => `${r1(toDisplayWeight(kg, unit))} ${wLbl}`;
  const submitWeight = () => { if (num(wInput) > 0) { logWeight({ kg: fromDisplayWeight(num(wInput), unit) }); setWInput(""); } };

  // Energy basis: the vet formula (default) or the measured expenditure. When "measured" is
  // selected and there's enough data, the working target comes from the estimate — and if the
  // cat is overweight, from the safe-deficit plan built on it.
  const { target, measured: useMeasured, dir: measuredDir, plan: measuredPlan, maintenance: measured } = resolveTarget({ t, expenditure, expSettings });
  const measuredWord = measuredDir === "gain" ? "surplus over" : measuredDir === "lose" ? "deficit off" : "at";

  const goalText = {
    grow: `feeding for growth at ${showW(wkg)}`,
    maintain: `holding steady at ${showW(wkg)}`,
    gentle: age < 12 ? `a gentle deficit — resting needs at current weight, so a growing cat fills out its frame rather than stripping fat mid-development` : `a gentle deficit, a little under maintenance, to ease weight down slowly`,
    loss: `resting needs at a goal weight of ${showW(t.idealWeight)}`,
    gain: `above maintenance, to build toward a goal weight of ${showW(t.idealWeight)}`,
    custom: `a custom target of ${r0(t.target)} kcal you set`,
  }[goalId];

  const warnings = [];
  if (t.stage !== "adult" && goalId === "loss") warnings.push(`Still growing (${r0(age)} mo). Active fat-loss on a developing cat isn't usually advised — Gentle trim lets added frame dilute the fat instead.`);
  if (t.pctOver <= 0 && goalId === "loss") warnings.push(`At or below ideal weight, so a weight-loss target doesn't apply — it would aim above the current weight. Choose Maintain instead.`);
  if (t.pctOver < 0 && goalId === "gentle") warnings.push(`Under ideal weight — a deficit may not be wanted here. Consider Maintain or Support growth.`);
  if (t.pctOver >= 0 && goalId === "gain") warnings.push(`At or above ideal weight — a weight-gain target would add unwanted weight. Choose Maintain or a loss plan.`);

  const noteFor = { grow: `× ${t.growthFactor.toFixed(2)} RER`, maintain: `× ${t.statusFactor.toFixed(2)} RER`, gentle: t.gentleBasis === "ideal" ? `× ${t.growthFactor.toFixed(2)} RER·ideal` : `× ${p.factors.moderation.toFixed(2)} RER·cur`, loss: `× ${p.factors.loss.toFixed(2)} RER·ideal`, gain: `× ${p.factors.gain.toFixed(2)} RER·ideal` };
  const showIdeal = ["loss", "gentle", "gain"].includes(goalId);
  const tlUnit = tr.timelineUnit || "g";
  const tlSuffix = tlUnit === "kcal" ? "" : "g";

  const foodList = (list, opts = {}) => (
    <>
      <div className="space-y-3">
        {list.items.map((f) => (
          <RationRow key={f.id} f={f} target={target} fridgeDays={fridgeDays}
            searchFoods={library.search}
            onSet={list.setField} onSlidePct={list.slide} onPrefill={list.patch}
            onSave={saveFood} saved={savedNames.has(f.name.trim().toLowerCase())} canSave={isCompleteFood(f)}
            onRemove={opts.keepOne && list.items.length <= 1 ? null : list.remove} />
        ))}
      </div>
      <button onClick={list.add} style={{ borderColor: C.line, color: C.spruce }} className="mt-3 w-full border border-dashed rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white"><Plus size={15} /> {opts.addLabel || "add a food"}</button>
    </>
  );

  const pctBadge = (list) => (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span style={{ color: Math.abs(list.sum - 100) < 0.5 ? C.spruce : C.amber }}>{r1(list.sum)}%</span>
      {Math.abs(list.sum - 100) >= 0.5 && (<button onClick={list.normalize} style={{ borderColor: C.line, color: C.spruce }} className="border rounded-full px-2 py-0.5">→ 100%</button>)}
    </div>
  );

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="flex items-center justify-between mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
          <span className="flex items-center gap-3">
            <a href="#/expenditure" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><Activity size={12} /> expenditure</a>
            <a href="#/log" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><NotebookPen size={12} /> log</a>
          </span>
        </nav>

        <div className="flex items-end gap-4 mb-6">
          <CatMark size={60} />
          <div className="min-w-0">
            <div style={{ color: C.amber }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><Scale size={13} /> ration planner</div>
            <h1 className="text-[26px] font-extrabold leading-tight" style={{ letterSpacing: "-0.02em" }}>How much to feed</h1>
            <p style={{ color: C.sub }} className="text-sm mt-1">Target energy from the animal, grams from the split, and a transition schedule. It shows its work.</p>
          </div>
        </div>

        {/* the animal */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-medium">The cat</h2>
            <input value={p.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" style={{ color: C.spruce }} className="text-right text-sm font-mono bg-transparent outline-none w-32" aria-label="Cat's name" />
          </div>
          {/* permanent attributes — set once */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth">
              <input type="date" value={p.dob || ""} max={today} onChange={(e) => set("dob", e.target.value)} className="w-full bg-transparent outline-none font-mono text-sm tabular-nums" style={{ color: C.ink }} aria-label="Date of birth" />
            </Field>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span style={{ color: C.sub }} className="text-xs">Age</span>
                <button onClick={() => set("ageUnit", ageUnit === "years" ? "months" : "years")} title="Switch unit" style={{ color: C.spruce }} className="text-xs font-mono underline decoration-dotted underline-offset-2">{ageUnit}</button>
              </div>
              <div style={{ borderColor: C.line }} className="flex items-baseline border rounded-lg px-2.5 py-1.5 bg-white">
                {dobMissing ? (
                  <span style={{ color: C.warn }} className="text-xs font-mono">set date of birth ↑ — age unknown</span>
                ) : (
                  <><span className="font-mono text-sm tabular-nums" style={{ color: C.ink }}>{ageDisplay}</span><span style={{ color: C.faint }} className="text-xs font-mono ml-1 shrink-0">{ageUnit === "years" ? "yr" : "mo"} · from birthday</span></>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2"><span style={{ color: C.sub }} className="text-xs w-28">Spayed / neutered</span><Toggle value={p.neutered} onChange={(v) => set("neutered", v)} /></div>

          {/* current state — read from the weight log */}
          <div style={{ borderColor: C.line }} className="mt-4 border-t pt-4">
            <div className="mb-2"><span style={{ color: C.sub }} className="text-xs">Current weight</span></div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-mono font-semibold tabular-nums" style={{ color: C.ink }}>{showW(currentWeight.kg)}</span>
              <span style={{ color: currentWeight.fromLog ? C.faint : C.warn }} className="text-xs font-mono">{currentWeight.fromLog ? `latest weigh-in · ${currentWeight.date}` : "starting estimate — no weigh-ins yet, log one ↓"}</span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <div className="w-28"><Field label="New weigh-in" suffix={wLbl}><NumInput value={wInput} onChange={setWInput} step={unit === "lb" ? "0.05" : "0.01"} /></Field></div>
              <button onClick={submitWeight} disabled={!(num(wInput) > 0)} title="Log this weigh-in" aria-label="Log this weigh-in" style={{ background: num(wInput) > 0 ? C.spruce : C.line }} className="rounded-lg p-2 text-white shrink-0 mb-0.5"><Plus size={16} /></button>
              <a href="#/log" style={{ color: C.spruce }} className="text-xs font-mono underline decoration-dotted underline-offset-2 mb-2 ml-auto">full log →</a>
            </div>
          </div>

          {/* body condition */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: C.sub }} className="text-xs">Body condition{p.bcAsOf && <span style={{ color: C.faint }}> · assessed {p.bcAsOf}</span>}</span>
              <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
                {["pct", "bcs"].map((m) => (<button key={m} onClick={() => set("bcMode", m)} aria-pressed={p.bcMode === m} style={{ background: p.bcMode === m ? C.spruce : "transparent", color: p.bcMode === m ? "#fff" : C.sub }} className="text-xs px-2.5 py-1 font-mono">{m === "pct" ? "%" : "BCS"}</button>))}
              </div>
            </div>
            {p.bcMode === "pct" ? (
              <Field label="Weight vs ideal" suffix="% (+over / −under)"><NumInput value={p.pctOver} onChange={setPct} step="1" /></Field>
            ) : (
              <div>
                <input type="range" min="1" max="9" step="1" value={p.bcs} onChange={(e) => setBcs(Number(e.target.value))} aria-label="Body condition score, 1 to 9" aria-valuetext={`${p.bcs}${p.bcs === 5 ? ", ideal" : ""}`} className="w-full" style={{ accentColor: C.spruce }} />
                <div style={{ color: C.faint }} className="flex justify-between text-xs font-mono mt-0.5"><span>1 emaciated</span><span style={{ color: C.spruce }}>{p.bcs} · {(p.bcs - 5) * 10 > 0 ? "+" : ""}{(p.bcs - 5) * 10}% {p.bcs === 5 ? "(ideal)" : ""}</span><span>9 obese</span></div>
              </div>
            )}
          </div>
          <div className="mt-4">
            <span style={{ color: C.sub }} className="text-xs">Direction <span style={{ color: C.faint }}>· {t.stage}</span></span>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {t.stageGoals.map((go) => { const on = goalId === go.id; return (
                <button key={go.id} onClick={() => { if (go.id === "custom" && !num(p.customTarget)) set("customTarget", r0(t.target)); set("goal", go.id); }} aria-pressed={on} style={{ borderColor: on ? C.spruce : C.line, background: on ? C.spruceSoft : "transparent" }} className="text-left border rounded-xl px-3 py-2">
                  <div className="text-sm font-medium" style={{ color: on ? C.spruce : C.ink }}>{go.label}</div>
                  <div style={{ color: C.faint }} className="text-xs leading-snug mt-0.5">{go.hint}</div>
                </button>); })}
            </div>
          </div>
          {warnings.map((wtext, i) => (<Note key={i} tone="warn">{wtext}</Note>))}
        </section>

        {/* target */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-5 mb-4">
          {/* energy basis */}
          <div className="flex items-center justify-between mb-3">
            <span style={{ color: C.sub }} className="text-xs">Energy basis</span>
            <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
              {[["formula", "Vet formula"], ["measured", "Measured"]].map(([m, lbl]) => (
                <button key={m} onClick={() => setExpSettings({ energyBasis: m })} aria-pressed={expSettings.energyBasis === m} style={{ background: expSettings.energyBasis === m ? C.spruce : "transparent", color: expSettings.energyBasis === m ? "#fff" : C.sub }} className="text-xs px-2.5 py-1 font-mono">{lbl}</button>
              ))}
            </div>
          </div>
          {expSettings.energyBasis === "measured" && !measured && (
            <Note>Not enough logged data yet for a measured estimate — using the vet formula. <a href="#/expenditure" style={{ color: C.spruce }} className="underline">Log weight + intake →</a></Note>
          )}

          <div className="flex items-end justify-between">
            <div>
              <div style={{ color: C.sub }} className="text-xs uppercase tracking-widest font-mono">Feed per day</div>
              <div className="flex items-baseline gap-2 mt-1"><span style={{ color: C.amber }} className="text-5xl font-mono font-semibold tabular-nums">{r0(target)}</span><span style={{ color: C.sub }} className="text-lg font-mono">kcal</span></div>
              <div style={{ color: C.faint }} className="text-xs font-mono mt-1">
                {useMeasured ? (measuredDir === "maintain" ? "measured maintenance" : `measured ${measuredDir === "gain" ? "+ surplus" : "− deficit"} (${r1(measuredPlan.resultingRatePctPerWeek)}%/wk)`) : "from vet formula"}
              </div>
            </div>
            <div style={{ color: C.faint }} className="text-xs text-right font-mono">{t.stage}<br />{showIdeal ? `ideal ${showW(t.idealWeight)}` : `RER ${r0(t.rerCur)}`}</div>
          </div>
          <p style={{ color: C.sub }} className="text-sm mt-3 leading-snug">{p.name} is <span style={{ color: C.ink }}>{t.pctOver > 0 ? `${r0(t.pctOver)}% over ideal` : t.pctOver < 0 ? `${r0(-t.pctOver)}% under ideal` : "at ideal weight"}</span> — {useMeasured ? (measuredDir === "maintain" ? `measured maintenance of ${r0(measured)} kcal` : `a safe ${measuredWord} measured maintenance (${r0(measured)} kcal), ${measuredDir === "gain" ? "gaining" : "losing"} ~${r1(measuredPlan.resultingRatePctPerWeek)}%/week`) : goalText}.</p>
          {measuredPlan && measuredPlan.warnings.map((wtext, i) => (<Note key={i} tone="warn">{wtext}</Note>))}

          {!useMeasured && goalId === "custom" && (() => {
            const refVals = t.stageGoals.filter((gg) => gg.id !== "custom").map((gg) => t.refs[gg.id]);
            const lo = r0(Math.min(...refVals) * 0.6), hi = r0(Math.max(...refVals) * 1.3);
            const val = num(p.customTarget) || r0(t.refs[t.stageGoals[0].id]);
            const ticks = t.stageGoals.filter((gg) => gg.id !== "custom").sort((a, b) => t.refs[a.id] - t.refs[b.id]);
            const posOf = (v) => Math.max(1, Math.min(99, ((v - lo) / (hi - lo)) * 100));
            return (
              <div style={{ borderColor: C.line }} className="mt-3 border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span style={{ color: C.sub }} className="text-xs">Custom target — slide between the presets</span>
                  <div style={{ borderColor: C.line }} className="flex items-baseline border rounded-lg px-2 py-1 bg-white">
                    <input type="number" value={val} step="5" onChange={(e) => set("customTarget", Number(e.target.value) || 0)} className="w-14 text-right bg-transparent outline-none font-mono text-sm tabular-nums" style={{ color: C.ink }} />
                    <span style={{ color: C.faint }} className="text-xs font-mono ml-1">kcal</span>
                  </div>
                </div>
                <input type="range" min={lo} max={hi} step="5" value={val} onChange={(e) => set("customTarget", Number(e.target.value))} aria-label="Custom daily energy target, kcal" aria-valuetext={`${val} kcal`} className="w-full block" style={{ accentColor: C.amber }} />
                <div className="relative h-6 mt-1">
                  {ticks.map((gg) => (
                    <div key={gg.id} className="absolute top-0 flex flex-col items-center" style={{ left: `${posOf(t.refs[gg.id])}%`, transform: "translateX(-50%)" }}>
                      <div style={{ background: C.line }} className="w-px h-1.5" />
                      <div style={{ color: C.faint }} className="text-[9px] font-mono whitespace-nowrap mt-0.5">{gg.label.split(" ")[0]} {r0(t.refs[gg.id])}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {!useMeasured && goalId === "gentle" && (
            <div style={{ borderColor: C.line }} className="mt-3 border-t pt-3">
              <div style={{ color: C.sub }} className="text-xs mb-2">"Grow into it" basis</div>
              <div className="grid grid-cols-2 gap-2">
                {[["current", "Resting × current wt", t.gentleCurrent], ["ideal", (age < 12 ? "Growth" : "Maint.") + " × ideal wt", t.gentleIdeal]].map(([id, lbl, v]) => {
                  const on = t.gentleBasis === id;
                  return (
                    <button key={id} onClick={() => set("gentleBasis", id)} aria-pressed={on} style={{ borderColor: on ? C.spruce : C.line, background: on ? C.spruceSoft : "transparent" }} className="text-left border rounded-xl px-3 py-2">
                      <div className="text-base font-mono font-semibold tabular-nums" style={{ color: on ? C.spruce : C.ink }}>{r0(v)}<span className="text-xs font-normal"> kcal</span></div>
                      <div style={{ color: C.faint }} className="text-xs mt-0.5">{lbl}</div>
                    </button>
                  );
                })}
              </div>
              <p style={{ color: C.faint }} className="text-xs mt-1.5 leading-snug">Resting-at-current (the default) is the firmer, more reliable hold on intake. Growth-at-ideal is gentler — it funds development at the target size and lets frame growth dilute the fat — but it assumes the kitten will actually grow into that frame, which you can't confirm from a single weigh-in. Start with resting-at-current and re-weigh before loosening to growth-at-ideal.</p>
            </div>
          )}
          <button onClick={() => setShowMath((s) => !s)} style={{ color: C.spruce }} className="mt-3 inline-flex items-center gap-1 text-xs font-mono">{showMath ? <ChevronDown size={13} /> : <ChevronRight size={13} />} show the math</button>
          {showMath && (
            <div style={{ borderColor: C.line }} className="mt-2 border-t pt-3 font-mono text-xs space-y-1.5">
              <Row k={`RER (current, ${r1(wkg)} kg)`} v={`70 x ${r1(wkg)}^0.75 = ${r0(t.rerCur)}`} />
              <Row k={`RER (ideal, ${r1(t.idealWeight)} kg)`} v={`70 x ${r1(t.idealWeight)}^0.75 = ${r0(t.rerIdeal)}`} />
              <div style={{ borderColor: C.line }} className="border-t pt-2 mt-1" />
              {t.stageGoals.filter((go) => go.id !== "custom").map((go) => (<RefRow key={go.id} label={go.label} val={t.refs[go.id]} on={goalId === go.id} note={noteFor[go.id]} />))}
              {goalId === "custom" && <RefRow label="Custom" val={t.target} on note="manual" />}
              {useMeasured && <RefRow label="Measured maintenance" val={measured} on note="from weight trend" />}
            </div>
          )}
          <button onClick={() => setShowAdvanced((s) => !s)} style={{ color: C.faint }} className="mt-3 inline-flex items-center gap-1 text-xs font-mono">{showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />} energy factors</button>
          {showAdvanced && (
            <div className="mt-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[["neutered", "Neutered", "× RER"], ["intact", "Intact", "× RER"], ["kittenPeak", "Kitten peak", "× RER"], ["moderation", "Gentle", "× cur"], ["loss", "Loss", "× ideal"], ["gain", "Gain", "× ideal"]].map(([k, lbl, suf]) => (
                  <Field key={k} label={lbl} suffix={suf}><NumInput value={p.factors[k]} onChange={(v) => setFactor(k, v)} step="0.05" /></Field>
                ))}
              </div>
              <p style={{ color: C.faint }} className="text-xs mt-2 leading-snug">Feline defaults (AAHA / Pet Nutrition Alliance). The kitten factor tapers from its peak down to the adult factor by 12 months.</p>
            </div>
          )}
        </section>

        {/* the ration */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-medium">The ration</h2>
            {pctBadge(ration)}
          </div>
          <p style={{ color: C.faint }} className="text-xs mb-3">The target end-state. Set what share of the daily calories each food covers.</p>
          {foodList(ration)}
          {Math.abs(ration.sum - 100) >= 0.5 && (
            <p style={{ color: C.warn }} className="text-xs mt-2">This split adds up to {r1(ration.sum)}%, so it delivers ~{r0(target * ration.sum / 100)} of {r0(target)} kcal/day. Use → 100% to fill the target.</p>
          )}
          <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: C.sub }}>
            <span>Opened wet cans keep</span>
            <div style={{ borderColor: C.line }} className="inline-flex items-baseline border rounded-lg px-2 py-1 bg-white">
              <input type="number" value={fridgeDays} step="1" onChange={(e) => setFridgeDays(Math.max(1, Number(e.target.value) || 1))} className="w-8 bg-transparent outline-none font-mono text-sm tabular-nums text-right" style={{ color: C.ink }} />
              <span style={{ color: C.faint }} className="text-xs font-mono ml-1">days</span>
            </div>
            <span style={{ color: C.faint }}>refrigerated (most brands ~3)</span>
          </div>
        </section>

        {/* saved foods */}
        <SavedFoods library={library} />

        {/* transition */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between">
            <div><h2 className="font-medium">Switching foods</h2><p style={{ color: C.faint }} className="text-xs mt-0.5">Ramp from the current blend to the new ration to avoid stomach upset.</p></div>
            <Toggle value={tr.on} onChange={(v) => setTr((s) => ({ ...s, on: v }))} />
          </div>
          {tr.on && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span style={{ color: C.sub }} className="text-xs">Currently feeding</span>
                {pctBadge(start)}
              </div>
              {foodList(start, { keepOne: true, addLabel: "add a current food" })}
              <div className="flex items-center justify-center gap-2 my-3 text-xs" style={{ color: C.faint }}><span>current blend</span><ArrowRight size={14} /><span style={{ color: C.spruce }}>new ration ({ration.items.length} food{ration.items.length === 1 ? "" : "s"})</span></div>
              <div className="w-32 mx-auto mb-4"><Field label="Transition length" suffix="days"><NumInput value={tr.days} onChange={(v) => setTr((s) => ({ ...s, days: Math.max(1, Math.min(30, Number(v) || 1)) }))} step="1" /></Field></div>
              <div className="flex items-center justify-end gap-2 mb-2">
                <span style={{ color: C.sub }} className="text-xs">Timeline in</span>
                <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
                  {[["g", "grams"], ["kcal", "kcal"]].map(([u, lbl]) => (<button key={u} onClick={() => setTr((s) => ({ ...s, timelineUnit: u }))} aria-pressed={tlUnit === u} style={{ background: tlUnit === u ? C.spruce : "transparent", color: tlUnit === u ? "#fff" : C.sub }} className="text-xs px-2.5 py-1 font-mono">{lbl}</button>))}
                </div>
              </div>
              <div style={{ borderColor: C.line }} className="border rounded-xl overflow-x-auto">
                <table className="w-full text-xs font-mono" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: C.sub, borderColor: C.line }} className="border-b">
                      <th className="text-left font-medium px-2 py-2 whitespace-nowrap">Day</th>
                      {start.items.map((f) => (<th key={f.id} className="text-right font-medium px-2 py-2 whitespace-nowrap" style={{ color: C.faint }}>{(f.name || "old").split(" ")[0]}</th>))}
                      {ration.items.map((f) => (<th key={f.id} className="text-right font-medium px-2 py-2 whitespace-nowrap" style={{ color: C.spruce }}>{(f.name || "new").split(" ")[0]}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: tr.days }, (_, i) => i + 1).map((day) => {
                      const toNew = day / tr.days, last = day === tr.days;
                      const cellFor = (f, blendFrac, sum) => r0(transitionAmount(f, blendFrac, sum, target, tlUnit));
                      return (
                        <tr key={day} style={{ borderColor: C.line, background: last ? C.spruceSoft : "transparent" }} className="border-b last:border-0">
                          <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: C.ink }}>{day} <span style={{ color: C.faint }}>· {r0(toNew * 100)}%</span></td>
                          {start.items.map((f) => { const v = cellFor(f, 1 - toNew, start.sum); return (<td key={f.id} className="px-2 py-1.5 text-right tabular-nums" style={{ color: (1 - toNew) < 0.001 ? C.faint : C.ink }}>{(1 - toNew) < 0.001 ? "—" : `${v}${tlSuffix}`}</td>); })}
                          {ration.items.map((f) => { const v = cellFor(f, toNew, ration.sum); return (<td key={f.id} className="px-2 py-1.5 text-right tabular-nums" style={{ color: C.spruce }}>{`${v}${tlSuffix}`}</td>); })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ color: C.faint }} className="text-xs mt-2 leading-snug">Even ramp: the new blend's share rises ~{r0(100 / tr.days)}% a day to 100% on day {tr.days}, holding total energy at {r0(target)} kcal throughout. If stool loosens, repeat a day before advancing.</p>
            </div>
          )}
        </section>

        <div style={{ color: C.faint }} className="text-xs leading-relaxed space-y-2 px-1 pb-4">
          <p className="flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /><span>Volume readouts (cups, cans) are approximate — kibble density drifts as a hopper empties, so weigh a few dispenses and divide to calibrate. Grams are the honest unit.</span></p>
          <p>Formula: RER = 70 × kg^0.75 (ACVN-endorsed); MER = feline factor × RER (AAHA / Pet Nutrition Alliance). Goal options and factors adapt to life stage. Opened-can life ~3 days is a conservative default; check your food's label.</p>
          <p>A planning aid, not veterinary advice. Re-weigh every 3–4 weeks and adjust — for a growing kitten, holding steady while gaining frame is a win.</p>
        </div>
      </div>
    </div>
  );
}
