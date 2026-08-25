import { useState } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { foodType, foodKey } from "../lib/foods.js";
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
    cupboard, setStockOf, bumpStock, forgetFlavor, cases, addCase, removeCase, setCaseLabel, setCaseItem, removeCaseItem, stockCase } = useApp();
  const name = p?.name || "your cat";

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
          <p style={{ ...cap, margin: 0 }}>What {name} has left unopened, and what's open and ticking. Open a can from its cupboard row; counting the cupboard is optional — but it's what lets a variety pack open the flavour you have most of, so a case finishes evenly instead of ending on four of the same.</p>
        </div>

        {/* Side by side on a wide screen — the cupboard IS one column and the fridge the other,
            which is also just what the page is: unopened on the left, open on the right. Phones
            keep the stack (the grid, and .alm-col with it, only exist at >=900px). */}
        <CupboardCard {...{ options, cupboard, setStockOf, bumpStock, forgetFlavor, cases, addCase, removeCase, setCaseLabel, setCaseItem, removeCaseItem, stockCase, ration, library, openFridgeCan }} />

        <div className="alm-col">
        {/* Opening happens ON the cupboard row now — a can leaves the shelf, so the button lives
            where the shelf is. The old separate "Open a can" card was pill buttons for the ration's
            own flavours (a subset of the cupboard's list, shown twice) plus a search; opening
            something brand new is now: add it to the cupboard, tap open. */}
        {/* the open cans */}
        <Card>
          <div style={label({ marginBottom: cans.length ? 10 : 0 })}>{cans.length} open{cans.length === 1 ? " can" : " cans"}</div>
          {cans.length === 0 ? (
            <p style={{ fontSize: 12.5, color: A.muted }}>Nothing open right now. Tap open on a cupboard row, or log a wet meal and it'll appear here.</p>
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
    </div>
  );
}
// The unopened half. One row per wet flavour the ration knows about, with its count — plus any
// flavour that has stock but has since left the ration, so cans can't go invisible just because
// the plan changed.
function CupboardCard({ options, cupboard, setStockOf, bumpStock, forgetFlavor, cases, addCase, removeCase, setCaseLabel, setCaseItem, removeCaseItem, stockCase, ration, library, openFridgeCan }) {
  const [editing, setEditing] = useState(null); // case id whose mix is open for editing
  const [pick, setPick] = useState("");         // a flavour being added that isn't on the list yet
  // Every flavour worth showing: the ration's, then anything stocked that isn't in it any more.
  // `usable` = the app knows enough about this to feed it — either it's a flavour of the ration
  // (which carries its own energy and can size) or it's in the saved foods. A cupboard row that is
  // neither is just a name with a number beside it: countable, but not feedable.
  const inLibrary = new Set((library.foods || []).map((f) => (f.name || "").trim().toLowerCase()));
  const rows = [...options].map((f) => ({ ...f, usable: true }));
  const known = new Set(options.map((f) => (f.name || "").trim().toLowerCase()));
  for (const r of cupboard) {
    const k = (r.name || "").trim().toLowerCase();
    if (k && !known.has(k)) { known.add(k); rows.push({ name: r.name, type: "wet", orphan: true, usable: inLibrary.has(k) }); }
  }
  const total = rows.reduce((n, f) => n + (stockOf(cupboard, f.name) || 0), 0);
  // Which flavour the rotation will reach for next — the tallest pile. Shown so the rule is
  // visible rather than something the app does behind your back.
  const most = rows.reduce((best, f) => {
    const n = stockOf(cupboard, f.name) || 0;
    return n > (best.n || 0) ? { name: f.name, n } : best;
  }, {});

  return (
    <Card>
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
            // The full food behind this row — the ration flavour itself, or the saved food for a
            // row that only exists as a count. A bare typed name has nothing to open a can OF
            // (no can size, no energy), so it gets no button; it already links to Foods instead.
            const food = f.orphan ? library.foods.find((x) => foodKey(x.name) === foodKey(f.name)) : f;
            const openable = food && isCanned(food);
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
                  {/* A name typed in here is only a name. It counts fine, but nothing can be fed or
                      rationed until it's a real food with an energy on it — so say so, and hand the
                      name to the page that does that rather than making it be retyped. */}
                  {!f.usable && (
                    <a href={`#/foods?new=${encodeURIComponent(f.name)}`} style={{ fontFamily: TYPE.mono, fontSize: 9.5, color: A.caution.text, textDecoration: "none" }}>
                      not in your foods · add it ›
                    </a>
                  )}
                </div>
                {openable && (
                  <button onClick={() => openFridgeCan(food)} aria-label={`Open a can of ${f.name}`} title="Open a can (moves it to the fridge)"
                    style={{ fontFamily: TYPE.mono, fontSize: 10, borderRadius: 999, padding: "3px 9px", border: `1px solid ${A.good}`, background: "transparent", color: A.good, cursor: "pointer", flex: "none" }}>open</button>
                )}
                <button onClick={() => bumpStock(f.name, -1)} disabled={!n} aria-label={`One fewer ${f.name}`}
                  style={{ ...stepBtn, color: n ? A.muted : A.cardBorder, cursor: n ? "pointer" : "default" }}>−</button>
                <input type="number" min="0" step="1" value={n == null ? "" : n} placeholder="—"
                  onChange={(e) => setStockOf(f.name, e.target.value === "" ? 0 : Number(e.target.value))}
                  aria-label={`cans of ${f.name} in the cupboard`}
                  style={{ width: 40, fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "center", padding: "1px 2px", flex: "none" }} />
                <button onClick={() => bumpStock(f.name, 1)} aria-label={`One more ${f.name}`} style={{ ...stepBtn, color: A.muted }}>+</button>
                {/* A count of 0 is a real answer — "I'm out, keep watching this" — so it can't
                    double as "forget it". Removing the row needs its own control. */}
                <button onClick={() => forgetFlavor(f.name)} aria-label={`Stop tracking ${f.name}`} title="Remove from the cupboard"
                  style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 15, flex: "none", padding: "0 0 0 2px" }}>×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* A can of something that has never been in the ration and has never been stocked can't
          appear on the list above, because the list is built FROM those two things. Buying one
          single can of a new flavour is completely ordinary, so it needs its own way in — the same
          way "Open a can" below takes any wet food. A typed name that isn't in your saved foods
          still works: the cupboard stores a name and a count, and needs nothing else. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0, border: `1px solid ${A.cardBorder}`, borderRadius: 10, padding: "4px 8px" }}>
          <FoodSearch value={pick} search={library.search} ariaLabel="Add a flavour to the cupboard"
            onChangeName={setPick}
            onPick={(food) => { bumpStock(food.name, 1); setPick(""); }} />
        </div>
        <button onClick={() => { if (pick.trim()) { bumpStock(pick.trim(), 1); setPick(""); } }} disabled={!pick.trim()}
          aria-label="Add a can of this flavour"
          style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 8, padding: "6px 10px", border: "none", flex: "none",
            background: pick.trim() ? A.good : A.track, color: pick.trim() ? A.card : A.muted, cursor: pick.trim() ? "pointer" : "default" }}>+ can</button>
      </div>
      <p style={{ fontSize: 11, color: A.muted, margin: "4px 0 0" }}>Bought a single can of something new? Add it here — it doesn't have to be in the ration yet.</p>

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
              <CaseMixEditor c={c} library={library} setCaseItem={setCaseItem} removeCaseItem={removeCaseItem} />
            )}
          </div>
        ))}
        <button onClick={() => addCase("")} style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.good, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ save a case mix</button>
      </div>
    </Card>
  );
}

// A case's mix is ITS OWN list, edited the way it reads on the box: it starts empty and grows one
// food at a time from your saved foods. The first version instead projected the whole cupboard's
// flavour list into the editor with a counter each — backwards on both ends: a case has no reason
// to mention foods that aren't in it, and every reason to be able to contain a food the cupboard's
// list didn't happen to know yet.
function CaseMixEditor({ c, library, setCaseItem, removeCaseItem }) {
  const [pick, setPick] = useState("");
  const items = c.items; // shown exactly as stored — a 0 row stays visible and editable
  const add = (name) => {
    if (!String(name || "").trim()) return;
    setCaseItem(c.id, String(name).trim(), (stockOf(c.items, name) || 0) + 1);
    setPick("");
  };
  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${A.hairline}`, paddingTop: 8 }}>
      {items.length === 0 && <p style={{ fontSize: 11.5, color: A.muted, margin: "0 0 6px" }}>Empty box so far — add what's in it below.</p>}
      {items.map((it) => (
        <div key={it.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: A.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
          <input type="number" min="0" step="1" value={it.count}
            onChange={(e) => setCaseItem(c.id, it.name, e.target.value === "" ? 0 : Number(e.target.value))}
            aria-label={`${it.name} per case`}
            style={{ width: 38, fontFamily: TYPE.mono, fontSize: 14, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "center", padding: "1px 2px", flex: "none" }} />
          <button onClick={() => removeCaseItem(c.id, it.name)} aria-label={`Remove ${it.name} from this case`}
            style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 13, flex: "none" }}>×</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
        <div style={{ flex: 1, minWidth: 0, border: `1px solid ${A.cardBorder}`, borderRadius: 10, padding: "4px 8px" }}>
          <FoodSearch value={pick} search={library.search} ariaLabel={`Add a food to ${c.label || "this case"}`}
            onChangeName={setPick} onPick={(food) => add(food.name)} />
        </div>
        <button onClick={() => add(pick)} disabled={!pick.trim()} aria-label="Add this food to the case"
          style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 8, padding: "6px 10px", border: "none", flex: "none",
            background: pick.trim() ? A.good : A.track, color: pick.trim() ? A.card : A.muted, cursor: pick.trim() ? "pointer" : "default" }}>+ add</button>
      </div>
    </div>
  );
}

const stepBtn = { width: 26, height: 26, borderRadius: 8, border: `1px solid ${A.cardBorder}`, background: "transparent", fontSize: 14, lineHeight: 1, flex: "none" };
const firstWord = (n) => String(n || "").trim().split(/[\s—·,]+/).slice(-1)[0] || n;
