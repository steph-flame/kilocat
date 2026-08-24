import { useState } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { foodType } from "../lib/foods.js";
import { canStatus, isCanned, cansOf } from "../lib/fridge.js";
import { stockOf, packStock } from "../lib/cupboard.js";
import { hasRotation } from "../lib/rotation.js";
import FoodSearch from "../components/FoodSearch.jsx";

// Cans — everything wet, in the two states it can be in.
//
// CUPBOARD: unopened, counted per flavor. Nothing perishes here, so it's just numbers — but those
// numbers are what let a variety pack finish evenly instead of ending on four of whatever came
// four-to-a-box, because the rotation opens whichever flavor there's most of (lib/cupboard.js).
// Both ways of buying are here: ± on a flavor for singles, and a saved case mix you can add by the
// box. Several cases can be saved, each with its own mix.
//
// FRIDGE: open and perishing, with how much is left and a use-by date (opened + fridgeDays).
// Logging a wet meal draws these down and opens new cans as needed (see Log); this screen lets you
// open, adjust, or toss by hand. A can that leaves the cupboard arrives here — one move, recorded
// in AppState's setFridge, which is the only writer either side has.
//
// Dry kibble and treats aren't tracked on this page (bag / non-perishable).

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
  const { p, ration, library, fridge, fridgeDays, openFridgeCan, tossCan, setCanRemaining, today,
    cupboard, setStockOf, bumpStock, cases, addCase, removeCase, setCaseLabel, setCaseItem, stockCase } = useApp();
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
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>cans</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 26, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 6px" }}>Cupboard &amp; fridge</h1>
          <p style={{ ...cap, margin: 0 }}>What {name} has left unopened, and what's open and ticking. Counting the cupboard is optional — but it's what lets a variety pack open the flavour you have most of, so a case finishes evenly instead of ending on four of the same.</p>
        </div>

        <CupboardCard {...{ options, cupboard, setStockOf, bumpStock, cases, addCase, removeCase, setCaseLabel, setCaseItem, stockCase, ration, library, openFridgeCan }} />

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
// The unopened half. One row per wet flavour the ration knows about, with its count — plus any
// flavour that has stock but has since left the ration, so cans can't go invisible just because
// the plan changed.
function CupboardCard({ options, cupboard, setStockOf, bumpStock, cases, addCase, removeCase, setCaseLabel, setCaseItem, stockCase, ration, library, openFridgeCan }) {
  const [editing, setEditing] = useState(null); // case id whose mix is open for editing
  // Every flavour worth showing: the ration's, then anything stocked that isn't in it any more.
  const rows = [...options];
  const known = new Set(options.map((f) => (f.name || "").trim().toLowerCase()));
  for (const r of cupboard) {
    const k = (r.name || "").trim().toLowerCase();
    if (k && !known.has(k)) { known.add(k); rows.push({ name: r.name, type: "wet", orphan: true }); }
  }
  const total = rows.reduce((n, f) => n + (stockOf(cupboard, f.name) || 0), 0);
  // Which flavour the rotation will reach for next — the tallest pile. Shown so the rule is
  // visible rather than something the app does behind your back.
  const most = rows.reduce((best, f) => {
    const n = stockOf(cupboard, f.name) || 0;
    return n > (best.n || 0) ? { name: f.name, n } : best;
  }, {});

  return (
    <Card className="span-all">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: rows.length ? 10 : 0 }}>
        <span style={label()}>cupboard · unopened</span>
        {total > 0 && <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.ink }}>{total} can{total === 1 ? "" : "s"}</span>}
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: A.muted }}>Add a wet food to the ration and its flavours show up here to count.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rows.map((f) => {
            const n = stockOf(cupboard, f.name);
            const isNext = most.n > 0 && most.name === f.name;
            return (
              <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor(f), flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: f.orphan ? A.muted : A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  {(isNext || n === 0) && (
                    <div style={{ fontFamily: TYPE.mono, fontSize: 9.5, color: n === 0 ? A.caution.text : A.good }}>
                      {n === 0 ? "none left" : "opens next"}
                    </div>
                  )}
                </div>
                <button onClick={() => bumpStock(f.name, -1)} disabled={!n} aria-label={`One fewer ${f.name}`}
                  style={{ ...stepBtn, color: n ? A.muted : A.cardBorder, cursor: n ? "pointer" : "default" }}>−</button>
                <input type="number" min="0" step="1" value={n == null ? "" : n} placeholder="—"
                  onChange={(e) => setStockOf(f.name, e.target.value === "" ? 0 : Number(e.target.value))}
                  aria-label={`cans of ${f.name} in the cupboard`}
                  style={{ width: 40, fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "center", padding: "1px 2px", flex: "none" }} />
                <button onClick={() => bumpStock(f.name, 1)} aria-label={`One more ${f.name}`} style={{ ...stepBtn, color: A.muted }}>+</button>
              </div>
            );
          })}
        </div>
      )}

      {/* cases: a mix you buy by the box, added to the pool above */}
      <div style={{ borderTop: `1px dashed ${A.cardBorder}`, marginTop: 12, paddingTop: 10 }}>
        <div style={label({ fontSize: 9, marginBottom: 6 })}>cases · buy by the box</div>
        {cases.length === 0 && (
          <p style={{ fontSize: 11.5, color: A.muted, margin: "0 0 8px" }}>If a case always comes with the same mix, save it once and restocking is one tap. Buying singles? Just use ± above.</p>
        )}
        {cases.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: "8px 10px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input value={c.label} placeholder="case name" onChange={(e) => setCaseLabel(c.id, e.target.value)} aria-label="case name"
                style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 500, color: A.ink }} />
              <button onClick={() => stockCase(c.id)} disabled={!c.items.length} title="Add this mix to the cupboard"
                style={{ fontFamily: TYPE.mono, fontSize: 10.5, borderRadius: 8, padding: "4px 9px", border: "none", flex: "none",
                  background: c.items.length ? A.good : A.track, color: c.items.length ? A.card : A.muted, cursor: c.items.length ? "pointer" : "default" }}>+ 1 case</button>
              <button onClick={() => setEditing(editing === c.id ? null : c.id)} aria-expanded={editing === c.id} aria-label={`Edit the mix in ${c.label || "this case"}`}
                style={{ fontFamily: TYPE.mono, fontSize: 10, color: A.muted, background: "none", border: "none", cursor: "pointer", flex: "none" }}>
                {editing === c.id ? "mix ▾" : "mix ▸"}
              </button>
              <button onClick={() => removeCase(c.id)} aria-label={`Remove ${c.label || "this case"}`} style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 14, flex: "none" }}>×</button>
            </div>
            <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 2 }}>
              {c.items.length ? `${c.items.reduce((n, i) => n + i.count, 0)} cans · ${c.items.filter((i) => i.count > 0).map((i) => `${i.count}× ${firstWord(i.name)}`).join(", ")}` : "no mix set — open the mix and say what's in the box"}
            </div>
            {editing === c.id && (
              <div style={{ marginTop: 8, borderTop: `1px solid ${A.hairline}`, paddingTop: 8 }}>
                {options.length === 0 && <p style={{ fontSize: 11.5, color: A.muted, margin: 0 }}>Add the flavours to the ration first.</p>}
                {options.map((f) => (
                  <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: dotColor(f), flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: A.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <input type="number" min="0" step="1" value={stockOf(c.items, f.name) ?? ""} placeholder="0"
                      onChange={(e) => setCaseItem(c.id, f.name, e.target.value === "" ? 0 : Number(e.target.value))}
                      aria-label={`${f.name} per case`}
                      style={{ width: 38, fontFamily: TYPE.mono, fontSize: 14, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "center", padding: "1px 2px", flex: "none" }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <button onClick={() => addCase("")} style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.good, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ save a case mix</button>
      </div>
    </Card>
  );
}

const stepBtn = { width: 26, height: 26, borderRadius: 8, border: `1px solid ${A.cardBorder}`, background: "transparent", fontSize: 14, lineHeight: 1, flex: "none" };
const firstWord = (n) => String(n || "").trim().split(/[\s—·,]+/).slice(-1)[0] || n;
