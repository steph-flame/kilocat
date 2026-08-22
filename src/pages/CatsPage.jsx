import { useState, useEffect } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { num } from "../lib/util.js";

const catLabel = (c) => c.name || "unnamed cat";
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const dateBox = { fontFamily: TYPE.mono, fontSize: 13, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, padding: "3px 0" };

function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "12px 14px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

export default function CatsPage() {
  const { today, fridgeDays, catsSummary, activeCatId, switchCat, addCat, updateCatProfile, deleteCat, clearCatHistory } = useApp();
  const [expandedId, setExpandedId] = useState(null);
  const realCats = catsSummary.filter((c) => !c.demo);
  const demoRow = catsSummary.find((c) => c.demo);

  const clearHistory = (c) => { if (window.confirm(`Erase ${catLabel(c)}'s weigh-in and intake history? Profile, ration, and saved foods stay. This can't be undone.`)) clearCatHistory(c.id); };
  const removeCat = (c) => {
    const tail = realCats.length === 1 ? " Since every cat needs a home, Biscuit (the demo cat) becomes active." : "";
    if (window.confirm(`Delete ${catLabel(c)} — profile, ration, and all history? This can't be undone.${tail}`)) deleteCat(c.id);
  };

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        <div style={{ padding: "18px 24px 12px" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>cats</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 4px" }}>Your cats</h1>
          <p style={{ fontSize: 12.5, color: A.bodyOnFill, margin: 0, lineHeight: 1.45 }}>Each cat has its own profile, ration and history; they share one food library and the {fridgeDays}-day fridge setting.</p>
        </div>

        <Card>
          {realCats.map((c) => {
            const on = c.id === activeCatId;
            const expanded = c.id === expandedId;
            return (
              <div key={c.id} style={{ border: `1px solid ${on ? A.good : A.cardBorder}`, borderRadius: 14, overflow: "hidden", marginBottom: 8, background: on ? "rgba(31,81,48,0.05)" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                  <input type="radio" name="activeCat" checked={on} onChange={() => switchCat(c.id)} style={{ accentColor: A.good }} aria-label={`Make ${catLabel(c)} the active cat`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CatNameField cat={c} onChange={(name) => updateCatProfile(c.id, { name })} active={on} />
                    <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 1 }}>
                      {c.ageDisplay || "age unknown"} · {c.weighIns} weigh-in{c.weighIns === 1 ? "" : "s"} · {c.meals} meal{c.meals === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button onClick={() => setExpandedId(expanded ? null : c.id)} aria-expanded={expanded}
                    style={{ flex: "none", fontFamily: TYPE.mono, fontSize: 11, color: A.muted, background: "none", border: "none", cursor: "pointer" }}>
                    profile {expanded ? "▾" : "▸"}
                  </button>
                </div>
                {expanded && (
                  <div style={{ borderTop: `1px solid ${A.hairline}`, padding: "12px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <label style={{ display: "block" }}>
                      <span style={label({ fontSize: 9 })}>Date of birth</span>
                      <input type="date" value={c.dob} max={today} onChange={(e) => updateCatProfile(c.id, { dob: e.target.value })}
                        style={{ width: "100%", fontFamily: TYPE.mono, fontSize: 14, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, padding: "3px 0", marginTop: 3 }} aria-label={`${catLabel(c)}'s date of birth`} />
                    </label>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, color: A.ink }}>Spayed / neutered</span>
                      <Toggle value={c.neutered} onChange={(v) => updateCatProfile(c.id, { neutered: v })} label={`${catLabel(c)} is spayed or neutered`} />
                    </div>
                    <CollarFields cat={c} today={today} onChange={(collar) => updateCatProfile(c.id, { collar })} />
                    <div style={{ borderTop: `1px solid ${A.hairline}`, paddingTop: 12, display: "flex", gap: 8 }}>
                      <button onClick={() => clearHistory(c)} style={{ border: `1px solid ${A.caution.border}`, color: A.caution.text, background: "transparent", borderRadius: 8, padding: "5px 10px", fontFamily: TYPE.mono, fontSize: 11, cursor: "pointer" }}>clear history…</button>
                      <button onClick={() => removeCat(c)} style={{ background: A.danger.bg, color: A.danger.text, border: "none", borderRadius: 8, padding: "5px 10px", fontFamily: TYPE.mono, fontSize: 11, cursor: "pointer" }}>delete cat…</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={addCat} style={{ width: "100%", border: `1px dashed ${A.cardBorder}`, borderRadius: 12, padding: "10px 0", background: "transparent", color: A.good, fontFamily: TYPE.sans, fontSize: 13, cursor: "pointer" }}>+ Add a cat</button>

          {demoRow && (
            <div style={{ border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: "9px 12px", marginTop: 8, opacity: 0.7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: A.ink }}>{demoRow.name}</span>
                <span style={{ fontFamily: TYPE.mono, fontSize: 9, background: A.track, color: A.muted, borderRadius: 999, padding: "2px 7px", textTransform: "uppercase", letterSpacing: ".1em" }}>demo</span>
              </div>
              <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 2 }}>
                {demoRow.ageDisplay || "age unknown"} · {demoRow.weighIns} weigh-ins · {demoRow.meals} meals · sample data, no controls
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Toggle({ value, onChange, label: aria }) {
  return (
    <button onClick={() => onChange(!value)} aria-checked={value} aria-label={aria} role="switch"
      style={{ width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: value ? A.good : A.track, position: "relative", flex: "none" }}>
      <span style={{ position: "absolute", top: 3, left: value ? 21 : 3, width: 20, height: 20, borderRadius: 999, background: A.card, transition: "left .12s" }} />
    </button>
  );
}

// What to take off a weigh-in when the collar was on. ALWAYS GRAMS, whatever the household weighs
// the cat in: small masses in this app are food, and food is logged in grams for everyone. The
// weight unit is about the cat, and a collar is not the cat.
//
// There's no "does this cat wear a collar" checkbox on purpose: a weight of nothing IS no collar,
// and two controls that can disagree about the same fact is one control too many. Blank leaves the
// per-weigh-in checkbox out of the Log page entirely.
function CollarFields({ cat, today, onChange }) {
  const stored = cat.collar || { grams: 0, defaultOn: true, since: "", until: "" };
  const asDisplay = (g) => (num(g) > 0 ? String(Number(num(g).toFixed(1))) : "");
  const [value, setValue] = useState(asDisplay(stored.grams));
  useEffect(() => { setValue(asDisplay(stored.grams)); }, [cat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = num(stored.grams) > 0;
  // Setting up a collar almost always means one is going ON, now — so the start date defaults to
  // today the moment a weight first appears. The alternative default (no date) would silently
  // restate every weigh-in the cat ever had as collared, which is the opposite of what anyone
  // typing a number here is asking for. It stays editable for the owner who sets this up late.
  const setGrams = (raw) => {
    const grams = raw === "" ? "" : num(raw);
    onChange({ ...stored, grams, since: num(grams) > 0 && !stored.since ? today : stored.since });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 13, color: A.ink }}>Collar weight<span style={{ color: A.muted, fontSize: 11.5 }}> · with tracker, if any</span></span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, flex: "none" }}>
          <input type="number" inputMode="decimal" min="0" step="1" value={value} placeholder="—"
            onChange={(e) => { setValue(e.target.value); setGrams(e.target.value); }}
            aria-label={`${catLabel(cat)}'s collar weight in grams`}
            style={{ width: 58, textAlign: "right", fontFamily: TYPE.mono, fontSize: 14, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, padding: "3px 0" }} />
          <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>g</span>
        </span>
      </label>
      {on && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 13, color: A.ink }}>Still wearing it</span>
          {/* Turning this off is how a collar comes OFF, which is why it stamps an end date rather
              than just switching the correction away: the months she DID wear it have to stay
              corrected. Turning it back on reopens the period. */}
          <Toggle value={stored.defaultOn} onChange={(v) => onChange({ ...stored, defaultOn: v, until: v ? "" : (stored.until || today) })}
            label={`${catLabel(cat)} is still wearing the collar`} />
        </div>
      )}
      {on && (
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 13, color: A.ink }}>Wearing it since</span>
          <input type="date" value={stored.since || ""} max={today}
            onChange={(e) => onChange({ ...stored, since: e.target.value })}
            aria-label={`the day ${catLabel(cat)} started wearing the collar`}
            style={dateBox} />
        </label>
      )}
      {on && !stored.defaultOn && (
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 13, color: A.ink }}>Last worn</span>
          <input type="date" value={stored.until || ""} min={stored.since || undefined} max={today}
            onChange={(e) => onChange({ ...stored, until: e.target.value })}
            aria-label={`the last day ${catLabel(cat)} wore the collar`}
            style={dateBox} />
        </label>
      )}
      {on && (
        <p style={{ fontSize: 11.5, color: A.muted, margin: 0, lineHeight: 1.45 }}>
          {stored.defaultOn
            ? "Taken off weigh-ins from that day on, so the weight shown is the cat. Earlier weigh-ins are left exactly as they were logged, and any single weigh-in can say otherwise in the log."
            : "Weigh-ins between those two days stay corrected; ones before and after are left exactly as they were logged."}
        </p>
      )}
    </div>
  );
}

function CatNameField({ cat, onChange, active }) {
  const [value, setValue] = useState(cat.name);
  useEffect(() => { setValue(cat.name); }, [cat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="text" value={value} placeholder="unnamed cat"
      onChange={(e) => { setValue(e.target.value); onChange(e.target.value); }}
      autoComplete="off" data-1p-ignore aria-label={`${catLabel(cat)}'s name`}
      style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontFamily: TYPE.sans, fontSize: 14, fontWeight: 500, color: active ? A.good : A.ink }} />
  );
}
