import { useState } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { foodType } from "../lib/foods.js";
import { canStatus, isCanned, cansOf } from "../lib/fridge.js";
import { hasRotation } from "../lib/rotation.js";
import FoodSearch from "../components/FoodSearch.jsx";

// Fridge — the open-can inventory (tier B). Wet cans opened but not finished live here with how
// much is left and a use-by date (opened + fridgeDays). Hybrid: logging a wet meal draws these
// down and opens new cans automatically (see Log), while this screen lets you open, adjust, or
// toss by hand. Dry kibble and treats aren't tracked (bag / non-perishable).

const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const cap = { fontSize: 12.5, color: A.bodyOnFill, lineHeight: 1.45, margin: "6px 0 0" };
const dotColor = (f) => (foodType(f) === "wet" ? A.food.wet : foodType(f) === "treat" ? A.food.treat : A.food.dry);
const mmdd = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "");

function Card({ children, style, className }) {
  return <div className={className} style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "16px 18px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

// Wet foods from the ration (including every rotation flavor) that can be opened, deduped by name.
function rationCanOptions(items) {
  const seen = new Set();
  const out = [];
  for (const f of items || []) {
    const flavors = hasRotation(f) ? f.rotation : [f];
    for (const fl of flavors) {
      const k = (fl.name || "").trim().toLowerCase();
      if (!k || seen.has(k) || !isCanned(fl)) continue;
      seen.add(k);
      out.push(fl);
    }
  }
  return out;
}

export default function FridgePage() {
  const { p, ration, library, fridge, fridgeDays, openFridgeCan, tossCan, setCanRemaining, today } = useApp();
  const name = p?.name || "your cat";
  const [pick, setPick] = useState("");

  // Sort soonest-to-expire first; expired cans float to the very top (they need attention).
  const cans = [...(fridge || [])]
    .map((c) => ({ c, s: canStatus(c, today, fridgeDays) }))
    .sort((a, b) => a.s.daysLeft - b.s.daysLeft);
  const options = rationCanOptions(ration.items);

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div className="alm-page alm-grid">
        <div className="span-all" style={{ padding: "18px 24px 2px" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>fridge</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 26, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 6px" }}>Open cans</h1>
          <p style={{ ...cap, margin: 0 }}>What's open in {name}'s fridge and how long it keeps. Logging a wet meal draws these down and opens new cans on its own — adjust or toss here anytime.</p>
        </div>

        {/* open a can */}
        <Card className="span-all">
          <div style={label({ marginBottom: 8 })}>Open a can</div>
          {options.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {options.map((f) => (
                <button key={f.name} onClick={() => openFridgeCan(f)}
                  style={{ fontFamily: TYPE.sans, fontSize: 12.5, borderRadius: 999, padding: "6px 12px", cursor: "pointer", border: `1px solid ${A.cardBorder}`, background: "transparent", color: A.ink, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor(f) }} /> + {f.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: 8 }}>
            <FoodSearch value={pick} search={library.search}
              onChangeName={setPick}
              onPick={(food) => { if (isCanned(food)) { openFridgeCan(food); setPick(""); } }} />
          </div>
          <p style={{ ...cap, fontSize: 11 }}>Pick any wet food from your saved foods, or tap one from the ration above. Dry food and treats aren't tracked here.</p>
        </Card>

        {/* the open cans */}
        <Card className="span-all">
          <div style={label({ marginBottom: cans.length ? 10 : 0 })}>{cans.length} open{cans.length === 1 ? " can" : " cans"}</div>
          {cans.length === 0 ? (
            <p style={{ fontSize: 12.5, color: A.muted }}>Nothing open right now. Open a can above, or log a wet meal and it'll appear here.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {cans.map(({ c, s }) => {
                const tone = s.expired ? A.danger.bg : s.expiringSoon ? A.caution.text : A.muted;
                const useByText = s.expired ? "past its window — toss" : s.expiringToday ? "use up today" : s.daysLeft === 1 ? "good thru tomorrow" : `good thru ${mmdd(s.goodThru)}`;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: dotColor(c), flex: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                      <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: tone }}>{useByText} · opened {mmdd(c.openedDate)}</div>
                    </div>
                    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, flex: "none" }}>
                      <input type="number" step="any" min="0" value={Number(Number(c.remainingGrams).toFixed(1))}
                        onChange={(e) => setCanRemaining(c.id, e.target.value)} aria-label={`grams left of ${c.name}`}
                        style={{ width: 54, fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "right", padding: "1px 2px" }} />
                      <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>g left</span>
                    </span>
                    <button onClick={() => tossCan(c.id)} aria-label={`Toss ${c.name}`} title="Toss this can"
                      style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 15, flex: "none" }}>🗑</button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
