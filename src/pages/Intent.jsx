import { useState, useEffect } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { computeIntent, recommendedZone } from "../lib/intent.js";
import { bcsToPct, pctToBcs } from "../lib/nutrition.js";
import { toDisplayWeight, weightLabel } from "../lib/units.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";

// Ration — Step 1 of 2: Intent. Owns the basis and the signed rate, and nothing else. Everything
// downstream (tonight's target, the safety floor, the Trend headline) follows from these two.
// See lib/intent.js for the math (one ρ=7800, shared with the estimator).

const r0 = (n) => Math.round(n);
const fmtRate = (r) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}`;
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });

// Short, plain descriptions of what each body-condition score looks like (WSAVA 1–9 scale).
const BCS_DESC = {
  1: "Ribs, spine and hip bones stand out with no fat. A severe waist and tucked belly. Emaciated.",
  2: "Bones easily felt with minimal fat. Obvious waist from above; belly clearly tucked.",
  3: "Ribs felt with a little fat over them. Waist visible from above; slight belly tuck. Lean.",
  4: "Ribs easily felt under a thin layer. A clear waist and a slight abdominal tuck. Trim.",
  5: "Ribs felt without excess fat. Waist visible behind the ribs, belly flat. Ideal.",
  6: "Ribs still findable under a little extra fat. The waist is there from above but soft, with a noticeable belly pad.",
  7: "Ribs hard to feel under fat. The waist is barely there; a rounding belly and some back fat.",
  8: "Ribs not felt under heavy fat. No waist; an obvious belly and fat over the lower back.",
  9: "Heavy fat over the ribs, spine and tail base. A distended belly and no waist. Obese.",
};

function Card({ children, style, inverted }) {
  return (
    <div style={{
      background: inverted ? A.inverted.bg : A.card,
      border: inverted ? "none" : `1px solid ${A.cardBorder}`,
      borderRadius: 20, padding: "16px 18px", margin: "0 18px 14px", ...style,
    }}>{children}</div>
  );
}

export default function Intent() {
  const { p, t, expenditure, expSettings, setExpSettings, currentWeight, unit, setBcs, activeCatId, today } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;

  const measuredKcal = expenditure.enoughData ? r0(expenditure.kcal) : null;
  const formulaKcal = r0(t.refs.maintain);
  const defaultBasis = measuredKcal == null ? "formula" : expSettings.energyBasis === "formula" ? "formula" : "measured";

  // Local override so the controls respond instantly (and the demo cat, whose writes no-op, is
  // still interactive). Reset when the active cat changes. Write-through persists for real cats.
  const [ov, setOv] = useState({});
  useEffect(() => setOv({}), [activeCatId]);

  // Body condition is the PRIMARY input here (the redesign drops the old pct/goal machinery), so
  // derive a BCS consistent with the cat's actual condition and snap the % + ideal weight to the
  // 1-9 grid — otherwise an off-grid stored pctOver (e.g. the demo's 12%) would show "BCS 5, 12%
  // over", which is the contradiction you spotted. Everything downstream uses these snapped values.
  const bcs = ov.bcs ?? pctToBcs(t.pctOver);
  const pctOver = bcsToPct(bcs);
  const idealWeight = currentWeight.kg > 0 ? currentWeight.kg / (1 + pctOver / 100) : currentWeight.kg;
  const setBcsValue = (n) => { setOv((o) => ({ ...o, bcs: n })); if (!isDemo) setBcs(n); };

  const zone = recommendedZone(pctOver);
  const zoneMid = zone ? Math.round(((zone.lo + zone.hi) / 2) * 10) / 10 : 0;
  const defaultRate = expSettings.ratePctPerWeek != null ? expSettings.ratePctPerWeek : zoneMid;
  const basis = ov.basis ?? defaultBasis;
  const rate = ov.rate ?? defaultRate;
  const setBasis = (b) => { setOv((o) => ({ ...o, basis: b })); setExpSettings({ energyBasis: b }); };
  const setRate = (v) => { const rr = Math.round(v * 10) / 10; setOv((o) => ({ ...o, rate: rr })); setExpSettings({ ratePctPerWeek: rr }); };

  const intent = computeIntent({ basis, ratePctPerWeek: rate, measuredKcal, formulaKcal, currentKg: currentWeight.kg, idealKg: idealWeight, pctOver });
  const showW = (kg) => `${(toDisplayWeight(kg, unit)).toFixed(2)} ${weightLabel(unit)}`;

  // rate slider geometry: −2…+2 mapped to 0…100%
  const pos = (v) => ((v + 2) / 4) * 100;

  // consequence lines
  const weeklyG = r0(Math.abs(intent.resultingWeeklyChangeKg) * 1000);
  const consequence = intent.rate === 0
    ? "holds steady"
    : `${intent.rate < 0 ? "loses" : "gains"} ${weeklyG} g/wk`;
  const weeksLine = intent.weeksToIdeal ? `ideal in ${r0(intent.weeksToIdeal)} weeks` : "not moving toward ideal";

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        {/* kicker + heading */}
        <div style={{ padding: "18px 24px 0" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>Step 1 of 2 · intent</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 16px", color: A.ink }}>
            What are we asking of {p.name || "your cat"}?
          </h1>
        </div>

        {/* 1 — maintenance basis */}
        <Card style={{ padding: "14px 16px 14px" }}>
          <div style={label()}>Maintenance comes from</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            <BasisOption
              selected={basis === "measured"} disabled={measuredKcal == null}
              onClick={() => measuredKcal != null && setBasis("measured")}
              title="Her own logs" value={measuredKcal ?? "—"} unit={measuredKcal != null ? `±${r0(expenditure.kcal - expenditure.low)}` : ""}
              sub={measuredKcal != null ? `${expenditure.nDays} days logged · unobserved-components` : "not enough logged days yet"} />
            <BasisOption
              selected={basis === "formula"}
              onClick={() => setBasis("formula")}
              title="The vet formula" value={formulaKcal}
              sub={`70 × kg^0.75 · ${p.neutered ? "neutered" : "intact"} ${t.stage}`} />
          </div>
          <p style={{ fontSize: 12, color: A.bodyOnFill, marginTop: 12, lineHeight: 1.4 }}>
            Everything else follows this choice: tonight's target, the safety floor, and the estimate on Trend.
          </p>
        </Card>

        {/* 2 — body condition */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={label()}>Body condition</div>
            <div style={label({ color: A.muted })}>as of {p.bcAsOf || today}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
            <div style={{ fontFamily: TYPE.mono, fontSize: 22, color: A.ink }}>
              BCS {bcs}<span style={{ fontSize: 12, color: A.body }}>/9</span>
            </div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.bodyOnFill, textAlign: "right" }}>
              {pctOver > 0 ? `${r0(pctOver)}% over` : pctOver < 0 ? `${r0(-pctOver)}% under` : "at ideal"} · ideal {showW(idealWeight)}
            </div>
          </div>

          {/* reference image slot (licensed BCS chart goes here) */}
          <div style={{ height: 168, borderRadius: 12, border: `1px dashed ${A.cardBorder}`, background: "#F3EFE2", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 12 }}>
            <span style={label({ color: A.muted })}>BCS {bcs} reference image</span>
          </div>
          <p style={{ fontSize: 12, color: A.bodyOnFill, marginTop: 10, lineHeight: 1.45 }}>{BCS_DESC[bcs]}</p>

          {/* 9-cell selector */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4, marginTop: 12 }}>
            {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => {
              const on = n === bcs;
              return (
                <button key={n} onClick={() => setBcsValue(n)} aria-pressed={on} aria-label={`Body condition ${n} of 9`}
                  style={{ fontFamily: TYPE.mono, fontSize: 12, padding: "8px 0", borderRadius: 7, border: "none",
                    background: on ? A.cellSel.bg : A.cellUnsel.bg, color: on ? A.cellSel.text : A.cellUnsel.text, fontWeight: on ? 700 : 400, cursor: "pointer" }}>
                  {n}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
            <span style={label({ fontSize: 10, letterSpacing: ".1em" })}>thin</span>
            <span style={label({ fontSize: 10, letterSpacing: ".1em" })}>heavy</span>
          </div>
        </Card>

        {/* 3 — rate of change */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={label()}>Rate of change</div>
            <div style={label({ color: A.muted })}>snaps to 0.1</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
            <div style={{ fontFamily: TYPE.mono, fontSize: 34, fontWeight: 600, letterSpacing: "-.02em", color: A.ink }}>
              {fmtRate(intent.rate)}<span style={{ fontSize: 13, fontWeight: 400, color: A.body }}> %/wk</span>
            </div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.bodyOnFill, textAlign: "right", lineHeight: 1.5 }}>
              <div>{consequence}</div>
              <div>{weeksLine}</div>
            </div>
          </div>

          {/* slider with recommended zone drawn inside the track */}
          <div style={{ position: "relative", height: 30, marginTop: 12 }}>
            <div style={{ position: "absolute", top: 11, left: 0, right: 0, height: 8, borderRadius: 4, background: A.track }} />
            {zone && (
              <div style={{ position: "absolute", top: 11, height: 8, borderRadius: 4, background: A.recZone, left: `${pos(zone.lo)}%`, width: `${pos(zone.hi) - pos(zone.lo)}%` }} />
            )}
            <div style={{ position: "absolute", top: 8, left: "50%", width: 2, height: 14, background: "#B8B29C" }} />
            <input type="range" className="rate-slider" min={-2} max={2} step={0.1} value={intent.rate}
              onChange={(e) => setRate(Number(e.target.value))}
              aria-label="Rate of weight change, percent per week"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 30, margin: 0 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={label({ fontSize: 10, letterSpacing: ".1em" })}>−2.0 lose</span>
            <span style={label({ fontSize: 10, letterSpacing: ".1em" })}>0 hold</span>
            <span style={label({ fontSize: 10, letterSpacing: ".1em" })}>+2.0 gain</span>
          </div>
          {zone && (
            <div style={{ fontFamily: TYPE.mono, fontSize: 10, color: A.good, fontWeight: 600, marginTop: 8 }}>
              shaded zone = recommended for BCS {bcs} · {fmtRate(zone.lo)} to {fmtRate(zone.hi)}
            </div>
          )}

          {(intent.contraIndicated || (zone && !intent.inZone)) && (
            <div style={{ background: A.caution.bg, border: `1px solid ${A.caution.border}`, borderRadius: 12, padding: "11px 13px", marginTop: 11, display: "flex", gap: 8 }}>
              <span style={{ fontFamily: TYPE.mono, color: A.caution.text, fontWeight: 700 }}>!</span>
              <span style={{ fontSize: 12, color: A.caution.text, lineHeight: 1.4 }}>
                {intent.contraIndicated
                  ? `${p.name || "This cat"} is ${pctOver > 0 ? `${r0(pctOver)}% over` : `${r0(-pctOver)}% under`} ideal, so the shaded zone recommends a ${pctOver > 0 ? "loss" : "gain"}. The slider still runs the full range — set the other direction if you mean to, and Kilocat will ask you to confirm.`
                  : `That rate is outside the recommended zone for BCS ${bcs}. It's allowed — just gentler or faster than the usual advice.`}
              </span>
            </div>
          )}
        </Card>

        {/* 4 — target */}
        <Card inverted style={{ borderRadius: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={label({ color: A.inverted.sub })}>Daily target</div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.inverted.sub }}>
              {r0(intent.maintenance)} {intent.dailyDelta < 0 ? "−" : intent.dailyDelta > 0 ? "+" : ""} {intent.dailyDelta !== 0 ? Math.abs(r0(intent.dailyDelta)) : ""}
            </div>
          </div>
          <div style={{ fontFamily: TYPE.mono, fontSize: 40, fontWeight: 600, color: A.inverted.text, marginTop: 6 }}>
            {r0(intent.target)} <span style={{ fontSize: 16, fontWeight: 400 }}>kcal</span>
          </div>
          <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.inverted.sub, marginTop: 6 }}>
            {intent.belowFloor
              ? `held at the ${r0(intent.floorKcal)} kcal safety floor`
              : `${r0(intent.aboveFloorBy)} kcal above the ${r0(intent.floorKcal)} safety floor`}
          </div>
        </Card>

        {/* advance */}
        <div style={{ padding: "4px 18px 0" }}>
          <a href="#/ration" style={{ display: "block", textAlign: "center", background: A.good, color: A.card, fontFamily: TYPE.sans, fontSize: 13.5, fontWeight: 600, borderRadius: 14, padding: "13px 0", textDecoration: "none" }}>
            Next — split it into food ›
          </a>
        </div>
      </div>
    </div>
  );
}

function BasisOption({ selected, disabled, onClick, title, value, unit, sub }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={selected}
      style={{ textAlign: "left", width: "100%", borderRadius: 14, padding: "12px 14px", cursor: disabled ? "default" : "pointer",
        background: selected ? A.inverted.bg : "transparent",
        border: selected ? "none" : `1px solid ${A.cardBorder}`, opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: TYPE.sans, fontSize: 14, fontWeight: 600, color: selected ? A.inverted.text : A.body }}>{title}</span>
        <span style={{ fontFamily: TYPE.mono, fontSize: 19, color: selected ? A.inverted.text : A.body }}>
          {value}{unit ? <span style={{ fontSize: 11, color: selected ? A.inverted.sub : A.muted }}> {unit}</span> : null}
        </span>
      </div>
      <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: selected ? A.inverted.sub : A.muted, marginTop: 4 }}>{sub}</div>
    </button>
  );
}
