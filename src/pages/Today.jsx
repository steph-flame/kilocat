import { useState } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { distributeBowl } from "../lib/bowl.js";
import { foodType } from "../lib/foods.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";

// Today — the one screen opened most days: what goes in the bowl tonight, in a plain sentence,
// then the steps, then log it. This is v1: the bowl is the ration split for the target. The
// open-can draw list (finish this can, open that one, part-can to the fridge) arrives with the
// fridge model — until then the steps are the whole-ration amounts, which is honest.

const r0 = (n) => Math.round(n);
const g1 = (g) => (g == null ? null : Number(Number(g).toFixed(1)));
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
// The prose emphasis: a solid gold underline behind a number, keeping the digit black (never a
// colour change or tint) — see the handoff's Design Tokens.
const Em = ({ children }) => <strong style={{ fontWeight: 500, boxShadow: `inset 0 -8px 0 ${A.underline}` }}>{children}</strong>;

function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

const weightDir = (e) => {
  const r = e?.ratePctPerWeek;
  if (r == null) return "Not enough weigh-ins yet to read a trend.";
  return r < -0.1 ? "Weight is falling." : r > 0.1 ? "Weight is rising." : "Weight is holding steady.";
};
const ratePctText = (e) => {
  const r = e?.ratePctPerWeek;
  return r == null ? "" : `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toFixed(1)} %/wk`;
};

export default function Today() {
  const { p, intent, ration, expenditure, today, activeCatId, intakeLog } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;
  const target = r0(intent.target);
  const dist = distributeBowl(ration.items, target);

  // draw steps: every food with real energy, remainder last.
  const steps = dist.rows
    .filter((s) => s.kcal > 0)
    .map((s) => {
      const f = ration.items.find((x) => x.id === s.id) || {};
      return { ...s, type: foodType(f), mode: f.mode || "share", treatCount: f.treatCount };
    })
    .sort((a, b) => (a.mode === "remainder" ? 1 : 0) - (b.mode === "remainder" ? 1 : 0));

  const byType = { wet: 0, dry: 0, treat: 0 };
  steps.forEach((s) => { byType[s.type] = (byType[s.type] || 0) + s.kcal; });

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const amount = (s) => (s.mode === "fixed" && s.type === "treat" && num(s.treatCount) ? `${g1(s.treatCount)} treat${num(s.treatCount) === 1 ? "" : "s"}` : `${g1(s.grams)} g`);

  const [logged, setLogged] = useState(false);
  const logBowl = () => {
    steps.forEach((s) => intakeLog.add({ date: today, kcal: r0(s.kcal), grams: s.grams != null ? g1(s.grams) : null, name: s.name || null, kcalPerG: s.grams > 0 ? s.kcal / s.grams : null }));
    setLogged(true);
  };

  const rate = intent.rate;
  const rateLine = rate < 0 ? `Losing ${Math.abs(rate).toFixed(1)}% a week, as planned.` : rate > 0 ? `Gaining ${rate.toFixed(1)}% a week, as planned.` : "Holding steady, as planned.";

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        <div style={{ padding: "18px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={label({ color: A.labelOnFill })}>{today}</span>
          <a href="#/cats" style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.good, fontWeight: 600, textDecoration: "none" }}>{p.name || "your cat"} ▾</a>
        </div>

        {/* the sentence */}
        <div style={{ padding: "12px 24px 18px" }}>
          <p style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 26, lineHeight: 1.28, letterSpacing: "-.012em", color: A.ink, margin: 0 }}>
            {steps.length ? (
              <>Tonight: {steps.map((s, i) => (
                <span key={s.id}><Em>{amount(s)}</Em> of {s.name || "food"}{i < steps.length - 1 ? (i === steps.length - 2 ? ", and " : ", ") : "."}</span>
              ))}</>
            ) : (
              <>Set up a ration and {p.name || "your cat"}'s bowl for tonight will show here.</>
            )}
          </p>
          <p style={{ fontSize: 12.5, color: A.bodyOnFill, marginTop: 10 }}>{rateLine}</p>
        </div>

        {steps.length > 0 && (
          <Card style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={label()}>Tonight · {target} kcal</span>
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: dist.balances ? A.good : A.body, fontWeight: 600 }}>{dist.balances ? "balances ✓" : `${r0(dist.totalKcal)} / ${target}`}</span>
            </div>
            {steps.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: i === 0 ? "none" : `1px solid ${A.hairline}` }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: TYPE.mono, fontSize: 11,
                  ...(s.mode === "remainder" ? { border: `1.5px solid ${A.gold}`, color: "#4A3A08" } : { background: A.good, color: A.card }) }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: A.ink }}>{s.name || "food"}</div>
                  <div style={label({ fontSize: 10, letterSpacing: ".08em", marginTop: 1, textTransform: "none" })}>
                    {s.mode === "remainder" ? "remainder · absorbs the slack" : s.mode === "fixed" ? "fixed amount" : `${r0(s.pct)}% of target`} · {r0(s.kcal)} kcal
                  </div>
                </div>
                <span style={{ fontFamily: TYPE.mono, fontSize: 17, color: A.ink }}>{amount(s)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${A.hairline}`, fontFamily: TYPE.mono, fontSize: 12 }}>
              <span style={{ color: A.muted }}>wet {r0(byType.wet)} · dry {r0(byType.dry)}{byType.treat > 0 ? ` · treats ${r0(byType.treat)}` : ""}</span>
              <span style={{ color: A.ink, fontWeight: 600 }}>{r0(dist.totalKcal)} / {target} kcal</span>
            </div>
          </Card>
        )}

        {/* trend row */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 14, color: A.ink }}>{weightDir(expenditure)}</span>
            <span style={{ fontFamily: TYPE.mono, fontSize: 13, color: A.good, fontWeight: 600 }}>{ratePctText(expenditure)}</span>
          </div>
          <a href="#/expenditure" style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted, textDecoration: "none" }}>see the trend ›</a>
        </Card>

        {/* actions */}
        <div style={{ display: "flex", gap: 10, padding: "4px 18px 0" }}>
          <button onClick={logBowl} disabled={!steps.length || logged}
            style={{ flex: 1, background: logged ? A.muted : A.ink, color: A.card, border: "none", borderRadius: 14, padding: "13px 0", fontFamily: TYPE.sans, fontSize: 13.5, fontWeight: 500, cursor: steps.length && !logged ? "pointer" : "default" }}>
            {logged ? "Logged ✓" : isDemo ? "Log this bowl (demo)" : "Log this bowl"}
          </button>
          <a href="#/ration" style={{ border: `1.5px solid ${A.ink}`, color: A.ink, borderRadius: 14, padding: "13px 18px", fontFamily: TYPE.sans, fontSize: 13.5, fontWeight: 500, textDecoration: "none" }}>Adjust</a>
        </div>
      </div>
    </div>
  );
}
