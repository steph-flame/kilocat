import { A, TYPE } from "../almanac.js";

// The shared "where the calories come from" visualization: the wet/dry/treat split, per-food bars,
// and the macro split — each readable by energy (calories) or by weight (grams). Fed the SAME
// foodSummary + macroBreakdown shapes whether the source is a day/week of the intake log (Log page)
// or a planned ration blend (Ration page), so the two surfaces always look and read identically.

const r0 = (n) => Math.round(n);
export const distLabel = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const TYPE_COLOR = { wet: A.food.wet, dry: A.food.dry, treat: A.food.treat, unknown: A.muted };

export function Dot({ c }) { return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: c, marginRight: 4 }} />; }
export function Seg({ pct, color }) { return pct > 0 ? <span style={{ width: `${pct}%`, background: color, display: "block" }} /> : null; }
export function Toggle({ options, value, onChange, accent }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map(([k, l]) => {
        const on = value === k;
        return <button key={k} onClick={() => onChange(k)} aria-pressed={on}
          style={{ fontFamily: TYPE.mono, fontSize: 10.5, borderRadius: 999, padding: "3px 9px", cursor: "pointer", border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? accent : "transparent", color: on ? A.card : A.muted }}>{l}</button>;
      })}
    </div>
  );
}

// s = foodSummary(...), m = macroBreakdown(...). `week` only affects the per-day averaging labels.
export function DistributionBody({ s, m, byKcal, week = false, coverageNoun = "logged calories" }) {
  const val = (o) => (byKcal ? o.kcal : o.grams);
  const totalV = val(s.totals);
  const pctOf = (part) => (totalV > 0 ? r0((part / totalV) * 100) : 0);
  const foods = [...s.byFood].sort((a, b) => (byKcal ? b.kcal - a.kcal : b.grams - a.grams));
  const mg = m.grams;
  const macroSum = mg.protein + mg.fat + mg.carb;
  const gShown = (x) => (week ? Number((x / m.nDays).toFixed(1)) : Number(x.toFixed(1)));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginBottom: 4 }}>
        <span>Wet vs dry · {byKcal ? "calories" : "weight"}</span>
        <span>{byKcal ? `${r0(s.totals.kcal)} kcal` : `${r0(s.totals.grams)} g`}{week ? "/wk" : ""}</span>
      </div>
      <div style={{ display: "flex", height: 11, borderRadius: 999, overflow: "hidden", background: A.track, marginBottom: 5 }}>
        <Seg pct={pctOf(val(s.byType.wet))} color={A.food.wet} />
        <Seg pct={pctOf(val(s.byType.dry))} color={A.food.dry} />
        <Seg pct={pctOf(val(s.byType.treat))} color={A.food.treat} />
        <Seg pct={pctOf(val(s.byType.unknown))} color={A.muted} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontFamily: TYPE.mono, fontSize: 11, color: A.muted, marginBottom: 12 }}>
        {[["wet", "Wet"], ["dry", "Dry"], ["treat", "Treat"]].map(([k, l]) => pctOf(val(s.byType[k])) > 0 && <span key={k}><Dot c={A.food[k]} />{l} {pctOf(val(s.byType[k]))}%</span>)}
      </div>

      <div style={distLabel({ marginBottom: 6 })}>By food · {byKcal ? "calories" : "weight"}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: m.hasData ? 12 : 0 }}>
        {foods.map((f) => {
          const pp = byKcal ? f.kcalPct : f.gramsPct;
          return (
            <div key={f.name}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: A.ink }}><Dot c={TYPE_COLOR[f.type]} />{f.name}</span>
                <span style={{ fontFamily: TYPE.mono, color: A.body, flex: "none" }}>{r0(pp)}% · {byKcal ? `${r0(f.kcal)} kcal` : `${Number(f.grams.toFixed(1))} g`}</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: A.track, overflow: "hidden", marginTop: 2, display: "flex" }}><Seg pct={pp} color={TYPE_COLOR[f.type]} /></div>
            </div>
          );
        })}
      </div>

      {m.hasData && (
        <div style={{ borderTop: `1px solid ${A.hairline}`, paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginBottom: 4 }}>
            <span>Macros · {byKcal ? "calories" : "weight"}</span>
            <span>{byKcal ? `${r0(m.moisturePctByWeight)}% water` : `${gShown(mg.moisture)} g water${week ? "/day" : ""}`}</span>
          </div>
          <div style={{ display: "flex", height: 11, borderRadius: 999, overflow: "hidden", background: A.track, marginBottom: 5 }}>
            <Seg pct={byKcal ? m.caloric.protein : (macroSum > 0 ? (mg.protein / macroSum) * 100 : 0)} color={A.macro.protein} />
            <Seg pct={byKcal ? m.caloric.fat : (macroSum > 0 ? (mg.fat / macroSum) * 100 : 0)} color={A.macro.fat} />
            <Seg pct={byKcal ? m.caloric.carb : (macroSum > 0 ? (mg.carb / macroSum) * 100 : 0)} color={A.macro.carb} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>
            {byKcal ? (
              <>
                <span><Dot c={A.macro.protein} />Protein {m.caloric.protein}%</span>
                <span><Dot c={A.macro.fat} />Fat {m.caloric.fat}%</span>
                <span><Dot c={A.macro.carb} />Carb {m.caloric.carb}%</span>
              </>
            ) : (
              <>
                <span><Dot c={A.macro.protein} />Protein {gShown(mg.protein)} g</span>
                <span><Dot c={A.macro.fat} />Fat {gShown(mg.fat)} g</span>
                <span><Dot c={A.macro.carb} />Carb {gShown(mg.carb)} g{week ? "/day" : ""}</span>
              </>
            )}
          </div>
          {m.coverageKcalPct < 99 && <p style={{ fontSize: 11, color: A.muted, marginTop: 6 }}>Based on {r0(m.coverageKcalPct)}% of {coverageNoun} — add guaranteed-analysis to more foods.</p>}
        </div>
      )}
    </>
  );
}
