import { useState, useEffect } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { distributeBowl } from "../lib/bowl.js";
import { foodType, kcalPerG, libEntry, blankFood, isCompleteFood, rationMacroProfile, aafcoCheck } from "../lib/foods.js";
import { hasRotation, isRotating, foodFieldsOf, upcomingFlavors, packLabel } from "../lib/rotation.js";
import { makeSlotKeyer } from "../lib/transition.js";
import { resolveRotationsWithFridge, activeMemberWithFridge } from "../lib/fridge.js";
import { num, uid } from "../lib/util.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import { BookmarkPlus, BookmarkCheck } from "lucide-react";
import FoodSearch from "../components/FoodSearch.jsx";
import { TypePicker, EnergyFields } from "../components/FoodTypeFields.jsx";
import GuaranteedAnalysis from "../components/GuaranteedAnalysis.jsx";
import { DistributionBody, Toggle } from "../components/FoodDistribution.jsx";
import { foodSummary, macroBreakdown } from "../lib/foodStats.js";

// Ration — Step 2 of 2: The bowl. Split the Intent target across N foods, each fixed / share /
// remainder. One basis for everything: % of the full target (see lib/bowl.js).

const r0 = (n) => Math.round(n);
const g1 = (g) => (g == null ? "—" : `${Number(Number(g).toFixed(1))} g`); // grams to 1 decimal, trimmed
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const MODES = [["fixed", "fixed"], ["share", "share"], ["remainder", "rest"]];
const dotColor = (f) => { const ty = foodType(f); return ty === "treat" ? A.food.treat : ty === "supplement" ? A.food.supplement : ty === "wet" ? A.food.wet : A.food.dry; };
// energy fields per food type (all accept decimals). treats are priced per treat.

function Card({ children, style, className }) {
  return <div className={className} style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

// Biscuit the demo cat is never a stored cat, so real ration writes no-op on her — which made
// every control on this screen feel dead. Give the demo a session-local, editable copy so the
// whole screen is clickable (nothing persists, same as every other demo edit). Real cats use the
// live ration unchanged.
function useEditableRation(ration, isDemo, activeCatId) {
  const [localItems, setLocalItems] = useState(null);
  useEffect(() => { setLocalItems(isDemo ? ration.items : null); /* reset on cat switch */ }, [activeCatId, isDemo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isDemo) return ration;
  const items = localItems ?? ration.items;
  const setItems = (u) => setLocalItems((prev) => { const base = prev ?? ration.items; return typeof u === "function" ? u(base) : u; });
  return {
    items, setItems,
    setField: (id, k, v) => setItems((fs) => fs.map((f) => (f.id === id ? { ...f, [k]: v } : f))),
    add: () => setItems((fs) => [...fs, blankFood()]),
    remove: (id) => setItems((fs) => fs.filter((f) => f.id !== id)),
    patch: (id, obj) => setItems((fs) => fs.map((f) => (f.id === id ? { ...f, ...obj } : f))),
  };
}

export default function Bowl() {
  const { p, intent, ration: liveRation, start: liveStart, library, t, tr, setTr, activeCatId, saveFood, today, fridge, fridgeDays, cupboard } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;
  const ration = useEditableRation(liveRation, isDemo, activeCatId);
  const start = useEditableRation(liveStart, isDemo, activeCatId);
  const target = r0(intent.target);
  // Resolve any variety-pack rotation slot to today's active flavor before splitting, so grams,
  // macros and the distribution all reflect what actually goes in the bowl today — finishing an
  // open can before starting a new flavor (falls back to the calendar cycle when nothing's open).
  const resolvedItems = resolveRotationsWithFridge(ration.items, today, fridge, fridgeDays, cupboard);
  const dist = distributeBowl(resolvedItems, target);
  const byId = Object.fromEntries(dist.rows.map((r) => [r.id, r]));
  const savedNames = new Set((library.foods || []).map((x) => x.name.trim().toLowerCase()));

  // exactly one remainder — promoting one demotes any other. NB: writes `splitMode`, NOT `mode`
  // (that's the food's energy mode — perKg/perUnit — which kcalPerG reads; they must stay separate).
  const makeSetSplitMode = (list) => (id, splitMode) => list.setItems((fs) => fs.map((f) => {
    if (f.id === id) return { ...f, splitMode };
    if (splitMode === "remainder" && f.splitMode === "remainder") return { ...f, splitMode: "share" };
    return f;
  }));
  const setSplitMode = makeSetSplitMode(ration);
  const setStartSplitMode = makeSetSplitMode(start);

  // The demo cat isn't stored, so setTr no-ops on her — give the switching-foods toggle a
  // session-local copy so the demo stays clickable. Real cats persist through setTr unchanged.
  const [demoTr, setDemoTr] = useState(null);
  useEffect(() => { setDemoTr(null); }, [activeCatId]);
  const trEff = isDemo ? (demoTr ?? tr) : tr;
  const setTrEff = isDemo ? (u) => setDemoTr((prev) => (typeof u === "function" ? u(prev ?? tr) : u)) : setTr;

  const prof = rationMacroProfile(resolvedItems);
  const aafco = prof ? aafcoCheck(prof.dryMatter, t.stage) : null;

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div className="alm-page alm-grid">
        <div className="span-all" style={{ padding: "18px 24px 0" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>the ration</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 6px" }}>
            How should {target} kcal be split?
          </h1>
          <p style={{ fontSize: 12.5, color: A.bodyOnFill, margin: "0 0 6px", lineHeight: 1.45 }}>
            Any number of foods. Each takes a <b style={{ fontWeight: 600 }}>share</b>, a <b style={{ fontWeight: 600 }}>fixed amount</b>, or <b style={{ fontWeight: 600 }}>whatever is left</b>.
          </p>
          <a href="#/calories" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textDecoration: "none", border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: "9px 13px", marginBottom: 14, background: A.card }}>
            <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>Daily target <b style={{ color: A.ink, fontSize: 13, fontWeight: 600 }}>{target} kcal</b> · from the calorie plan</span>
            <span style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.good, fontWeight: 600, flex: "none", marginLeft: 8 }}>edit ›</span>
          </a>
        </div>

        <Card style={{ padding: "4px 16px 14px" }}>
          {ration.items.length === 0 && (
            <p style={{ fontSize: 12, color: A.muted, padding: "14px 0" }}>No foods yet — add one below.</p>
          )}
          {ration.items.map((f, i) => (
            <BowlRow key={f.id} f={f} row={byId[f.id] || { kcal: 0, grams: null, pct: 0 }} target={target}
              first={i === 0} library={library} ration={ration} setSplitMode={setSplitMode}
              saveFood={saveFood} saved={savedNames.has((f.name || "").trim().toLowerCase())} />
          ))}

          <button onClick={() => ration.add()} style={{ width: "100%", marginTop: 6, border: `1px dashed ${A.cardBorder}`, borderRadius: 12, background: "transparent", color: A.body, fontFamily: TYPE.sans, fontSize: 12.5, padding: "10px 0", cursor: "pointer" }}>
            + Add a food
          </button>

          {/* balance line */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: TYPE.mono, fontSize: 12 }}>
            <span style={{ color: A.muted }}>{dist.hasRemainder ? "wet + dry + rest" : "allocated"}</span>
            {dist.overAllocated ? (
              <span style={{ color: A.danger.bg, fontWeight: 600 }}>{r0(dist.fixedKcal + dist.shareKcal)} / {target} — over by {r0(dist.fixedKcal + dist.shareKcal - target)}</span>
            ) : dist.balances ? (
              <span style={{ color: A.good, fontWeight: 600 }}>{r0(dist.totalKcal)} / {target} kcal ✓</span>
            ) : (
              <span style={{ color: A.body }}>{r0(dist.totalKcal)} / {target} · {r0(dist.unallocated)} left — add a rest food</span>
            )}
          </div>
        </Card>

        {/* where the planned calories come from — same visualization as the Log's day summary */}
        <RationDistribution rows={dist.rows} foods={resolvedItems} prof={prof} aafco={aafco} />

        {/* switching foods — the gradual ramp from the current blend to this ration */}
        <Transition name={p?.name} start={start} setStartSplitMode={setStartSplitMode} rationItems={resolvedItems}
          newRows={dist.rows} target={target} tr={trEff} setTr={setTrEff} library={library} saveFood={saveFood} savedNames={savedNames} />

        {/* footer — the ration saves live as you edit; this just leaves the page. Go to the Log, where
            tonight's bowl is built from this ration and can be logged — the natural next step. */}
        <div className="span-all" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "4px 24px 0" }}>
          <a href="#/log" style={{ background: A.good, color: A.card, fontFamily: TYPE.sans, fontSize: 13, fontWeight: 600, borderRadius: 14, padding: "12px 20px", textDecoration: "none" }}>
            Done · to the log ›
          </a>
        </div>
      </div>
    </div>
  );
}

// Switching foods: the gradual old→new ramp. Both blends are split with the same distributeBowl
// engine as the ration, so each day is just the full-target distribution scaled by that day's
// share — the old blend fading from 100%→0 while the new one rises 0→100%, total energy held at
// target throughout. Migrated here from the classic planner so nothing lives on #/ration-classic.
function Transition({ name, start, setStartSplitMode, rationItems, newRows, target, tr, setTr, library, saveFood, savedNames }) {
  const on = !!tr.on;
  const days = Math.max(1, Math.min(30, num(tr.days) || 7));
  const unit = tr.timelineUnit || "g";
  const startDist = distributeBowl(start.items, target);
  const startById = Object.fromEntries(startDist.rows.map((r) => [r.id, r]));
  const suf = unit === "kcal" ? "" : "g";
  const firstWord = (nm, fallback) => (nm || fallback).split(" ")[0];

  // ONE column per unique food across both blends, so a food that's in both — the usual case, since
  // only one food tends to change — isn't shown twice. Each day nets the fading old share and the
  // rising new share: a shared food at the same amount stays flat, a dropped food fades to nothing,
  // an added food grows in. New-ration foods lead the order; dropped foods follow.
  //
  // Matched by SLOT, not by name. "Currently feeding" is a copy of the ration with `rotation`
  // stripped (foodFieldsOf) and whatever flavor was active frozen into its name — so a variety pack
  // otherwise reads as one flavor being dropped and another added, and the same pack gets two
  // columns that ramp against each other. makeSlotKeyer maps every member name (and the active
  // flavor) to one key; it's the same keyer lib/transition.js uses to build the Log plan, so the
  // schedule and what Log actually asks you to feed can't drift apart.
  const key = (n) => (n || "").trim().toLowerCase();
  const { keyOfName } = makeSlotKeyer(start.items, rationItems);
  // A rotating slot is headed by its PACK, not by whichever can is open today — over 14 days you'll
  // feed several flavors from that one column, so naming it after the current can would be wrong on
  // most of the rows. Display only; matching and logging still use the real food names.
  const packBySlot = new Map();
  [...(rationItems || []), ...start.items].forEach((it) => {
    if (it?.rotation?.length) packBySlot.set(keyOfName(it.name), packLabel(it));
  });
  const colName = (k, fallback) => packBySlot.get(k) || fallback;
  const cols = [];
  const seen = new Map();
  newRows.forEach((r) => { if (!key(r.name)) return; const k = keyOfName(r.name); if (!seen.has(k)) { seen.set(k, cols.length); cols.push({ name: colName(k, r.name), nu: r, old: null }); } });
  startDist.rows.forEach((r) => { if (!key(r.name)) return; const k = keyOfName(r.name); if (seen.has(k)) cols[seen.get(k)].old = r; else { seen.set(k, cols.length); cols.push({ name: colName(k, r.name), nu: null, old: r }); } });
  const amountOf = (row) => (row ? (unit === "kcal" ? num(row.kcal) : (row.grams != null ? num(row.grams) : num(row.kcal))) : 0);
  const colCell = (col, toNew) => {
    const v = (1 - toNew) * amountOf(col.old) + toNew * amountOf(col.nu);
    return unit === "kcal" ? `${r0(v)}` : `${Number(v.toFixed(1))}`;
  };
  const colTone = (col) => (col.nu && col.old ? A.ink : col.nu ? A.good : A.muted); // shared / added / dropping
  const hasStart = start.items.length > 0;
  // Copy the current ration into "currently feeding" (fresh ids + the row's split), so switching
  // starts from today's mix — usually only one food differs, so you just change that line.
  const rationCopy = () => (rationItems || []).filter((f) => (f.name || "").trim()).map((f) => ({ ...foodFieldsOf(f), id: uid(), splitMode: f.splitMode || "share", pct: f.pct, fixedKcal: f.fixedKcal, treatCount: f.treatCount }));
  // "Empty" = nothing entered yet (the blank default a fresh cat starts with) — safe to auto-fill.
  const startIsBlank = start.items.length === 0 || (start.items.length === 1 && !(start.items[0].name || "").trim());
  const seedFromRation = () => { const copy = rationCopy(); if (copy.length) start.setItems(() => copy); };
  const toggle = () => {
    const turningOn = !tr.on;
    setTr((s) => ({ ...s, on: !s.on }));
    if (turningOn && startIsBlank) seedFromRation(); // first time on → mirror the ration
  };

  return (
    <Card className="span-all">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={label()}>Switching foods</div>
          <p style={{ fontSize: 12.5, color: A.bodyOnFill, margin: "5px 0 0", lineHeight: 1.45 }}>
            Ramp from what {name || "she"}'s eating now to this ration over several days to avoid stomach upset.
          </p>
        </div>
        <button onClick={toggle} aria-pressed={on} role="switch" aria-label="Enable food transition"
          style={{ flex: "none", width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: on ? A.good : A.track, position: "relative", transition: "background .15s" }}>
          <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 999, background: A.card, transition: "left .15s" }} />
        </button>
      </div>

      {on && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2, gap: 8 }}>
            <div style={label({ color: A.labelOnFill })}>Currently feeding</div>
            <button onClick={seedFromRation} title="Copy the current ration here to tweak" style={{ fontFamily: TYPE.mono, fontSize: 10.5, border: "none", background: "none", cursor: "pointer", color: A.good, padding: 0 }}>match the ration</button>
          </div>
          {!hasStart && <p style={{ fontSize: 12, color: A.muted, padding: "6px 0" }}>Add what {name || "she"}'s eating now — or “match the ration” and change what differs.</p>}
          {start.items.map((f, i) => (
            <BowlRow key={f.id} f={f} row={startById[f.id] || { kcal: 0, grams: null, pct: 0 }} target={target}
              first={i === 0} library={library} ration={start} setSplitMode={setStartSplitMode}
              saveFood={saveFood} saved={savedNames.has((f.name || "").trim().toLowerCase())} />
          ))}
          <button onClick={() => start.add()} style={{ width: "100%", marginTop: 6, border: `1px dashed ${A.cardBorder}`, borderRadius: 12, background: "transparent", color: A.body, fontFamily: TYPE.sans, fontSize: 12.5, padding: "10px 0", cursor: "pointer" }}>
            + Add a current food
          </button>

          {hasStart && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 8px", flexWrap: "wrap", gap: 8 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: A.body }}>
                  Over
                  <input type="number" min={1} max={30} step={1} value={days}
                    onChange={(e) => setTr((s) => ({ ...s, days: Math.max(1, Math.min(30, Number(e.target.value) || 1)) }))}
                    style={{ width: 46, fontFamily: TYPE.mono, fontSize: 13, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "center", padding: "1px 2px" }} />
                  days
                </label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[["g", "grams"], ["kcal", "kcal"]].map(([u, lbl]) => (
                    <button key={u} onClick={() => setTr((s) => ({ ...s, timelineUnit: u }))} aria-pressed={unit === u}
                      style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "3px 10px", cursor: "pointer", border: unit === u ? "none" : `1px solid ${A.cardBorder}`, background: unit === u ? A.ink : "transparent", color: unit === u ? A.card : A.muted }}>{lbl}</button>
                  ))}
                </div>
              </div>

              <div style={{ overflowX: "auto", border: `1px solid ${A.hairline}`, borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: TYPE.mono, fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${A.hairline}` }}>
                      <th style={{ textAlign: "left", padding: "8px 10px", color: A.muted, fontWeight: 500, whiteSpace: "nowrap" }}>Day</th>
                      {cols.map((col, i) => <th key={i} title={col.nu && col.old ? "" : col.nu ? "new food" : "dropping"} style={{ textAlign: "right", padding: "8px 10px", color: colTone(col), fontWeight: col.nu ? 600 : 500, whiteSpace: "nowrap" }}>{firstWord(col.name, "food")}{!col.nu ? " ↓" : !col.old ? " ↑" : ""}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
                      const toNew = day / days, last = day === days;
                      return (
                        <tr key={day} style={{ borderBottom: `1px solid ${A.hairline}`, background: last ? "rgba(31,81,48,0.07)" : "transparent" }}>
                          <td style={{ padding: "7px 10px", color: A.ink, whiteSpace: "nowrap" }}>{day} <span style={{ color: A.muted }}>· {r0(toNew * 100)}%</span></td>
                          {cols.map((col, i) => { const v = colCell(col, toNew); return <td key={i} style={{ padding: "7px 10px", textAlign: "right", color: Number(v) < 0.05 ? A.muted : A.body }}>{Number(v) < 0.05 ? "—" : `${v}${suf}`}</td>; })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11.5, color: A.bodyOnFill, margin: "8px 0 0", lineHeight: 1.45 }}>
                Even ramp: the new ration's share rises ~{r0(100 / days)}% a day to 100% on day {days}, holding total energy at {target} kcal throughout. If stool loosens, repeat a day before advancing.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// Where the planned calories (and grams) come from — the same wet/dry, per-food and macro
// breakdown the Log shows for a logged day, but computed over the ration's distribution instead of
// intake entries. Feeds foodSummary/macroBreakdown a pseudo-intake list built from the split, with
// the ration's own foods as the classifying library. Keeps the dry-matter/AAFCO line the old card
// carried, since the shared DistributionBody doesn't cover it.
function RationDistribution({ rows, foods, prof, aafco }) {
  const [basis, setBasis] = useState("calories");
  const items = (rows || [])
    .filter((r) => r.kcal > 0 || (r.grams || 0) > 0)
    .map((r) => ({ name: r.name, kcal: r.kcal, grams: r.grams ?? 0 }));
  const s = foodSummary(items, foods, 1);
  const m = macroBreakdown(items, foods, 1);
  if (s.isEmpty) return null;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <span style={label()}>Where the calories come from</span>
        <Toggle options={[["calories", "cal"], ["weight", "g"]]} value={basis} onChange={setBasis} accent={A.gold} />
      </div>
      <DistributionBody s={s} m={m} byKcal={basis === "calories"} coverageNoun="the blend" />
      {prof && (
        <div style={{ borderTop: `1px solid ${A.hairline}`, marginTop: 12, paddingTop: 10, fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>
          Dry-matter protein {r0(prof.dryMatter.protein)}%{aafco && aafco.protein === "below" ? ` · below the AAFCO ${aafco.stage} minimum` : aafco && aafco.protein === "ok" ? " · clears AAFCO" : ""}
        </div>
      )}
    </Card>
  );
}

const numInline = { width: 46, fontFamily: TYPE.mono, fontSize: 13, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "right", padding: "1px 2px" };

function AmountRow({ left, grams }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
      <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body }}>{left}</span>
      <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{g1(grams)}</span>
    </div>
  );
}

function BowlRow({ f, row, target, first, library, ration, setSplitMode, saveFood, saved }) {
  const { today, fridge, fridgeDays, cupboard } = useApp();
  const [showDetails, setShowDetails] = useState(false);
  // The flavor list is an EDITOR, not a readout — a 6-flavor pack pushed the rest of the ration off
  // the screen for the sake of a list that's right for weeks at a time. Collapsed by default; the
  // row's own header still names today's flavor and the count, and "next up" stays visible below.
  const [showFlavors, setShowFlavors] = useState(false);
  const [dragIdx, setDragIdx] = useState(null); // flavor being dragged to reorder
  const [gEdit, setGEdit] = useState(null); // grams being typed for a fixed food (kcal follows)
  const splitMode = f.splitMode || "share";
  // A rotation slot has no top-level food of its own — its energy/type/name come from whichever
  // flavor is active today (fridge-aware: finish an open can before starting a new flavor). `af`
  // is the food we display and price against.
  const isRot = hasRotation(f);
  const rotating = isRotating(f); // has ≥2 flavors and not paused
  const af = isRot ? (activeMemberWithFridge(f, today, fridge, fridgeDays, cupboard) || {}) : f;
  const activeIdx = isRot ? f.rotation.findIndex((m) => m === af || (m.name || "") === (af.name || "")) : -1;
  const type = foodType(af);
  const color = dotColor(af);
  const kpg = kcalPerG(af); // energy density — lets a fixed amount be entered as grams, not just kcal
  const setFixedKcal = (v) => { setGEdit(null); ration.setField(f.id, "fixedKcal", v === "" ? "" : Number(v)); };
  const setFixedGrams = (v) => { setGEdit(v); ration.setField(f.id, "fixedKcal", v === "" ? "" : Math.round(Number(v) * kpg * 100) / 100); };
  const gramsShown = gEdit != null ? gEdit : (row.grams != null ? String(Number(row.grams.toFixed(1))) : "");
  const patch = (obj) => ration.setItems((fs) => fs.map((x) => (x.id === f.id ? { ...x, ...obj } : x)));
  // A treat is given by count; its fixed kcal follows the per-treat energy.
  const setTreatCount = (c) => patch({ treatCount: c, fixedKcal: c === "" ? "" : num(c) * num(af.kcalPerUnit) });

  // ---- rotation (variety-pack) editing ----
  // Editing the flavor list. Dropping to ONE flavor collapses the slot back to a plain single food
  // (that flavor) — the non-destructive way to "un-rotate": nothing is silently discarded, the food
  // you kept stays. The ↻ button never deletes the list; it only pauses/resumes (rotateOff).
  const setMembers = (updater) => ration.setItems((fs) => fs.map((x) => {
    if (x.id !== f.id) return x;
    const cur = Array.isArray(x.rotation) ? x.rotation : [];
    const next = typeof updater === "function" ? updater(cur) : updater;
    if (!next || next.length <= 1) { const { rotation, rotateOff, ...rest } = x; return { ...rest, ...(next && next[0] ? foodFieldsOf(next[0]) : {}) }; }
    return { ...x, rotation: next };
  }));
  // Seed with the current food + one empty slot, and OPEN the editor: the new slot is blank and
  // needs filling in, so collapsing here would make ↻ look like it did nothing.
  const startRotation = () => { setMembers([foodFieldsOf(f), foodFieldsOf(blankFood())]); setShowFlavors(true); };
  const togglePause = () => patch({ rotateOff: !f.rotateOff }); // non-destructive: keeps every flavor
  const addFlavor = () => setMembers((cur) => [...cur, foodFieldsOf(blankFood())]);
  const removeFlavor = (idx) => setMembers((cur) => cur.filter((_, i) => i !== idx));
  const setFlavorName = (idx, name) => setMembers((cur) => cur.map((m, i) => (i === idx ? { ...m, name } : m)));
  const pickFlavor = (idx, food) => setMembers((cur) => cur.map((m, i) => (i === idx ? foodFieldsOf(libEntry(food)) : m)));
  const moveFlavor = (from, to) => setMembers((cur) => {
    if (to < 0 || to >= cur.length || from === to) return cur;
    const next = cur.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m); return next;
  });

  return (
    <div style={{ borderTop: first ? "none" : `1px solid ${A.hairline}`, padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: color, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isRot ? (
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: A.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {af.name || "Pick flavors below"} {rotating && <span style={{ fontFamily: TYPE.mono, fontSize: 9.5, color: A.good, fontWeight: 600 }}>· today</span>}
              </div>
              <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted }}>
                {rotating ? `↻ variety pack · ${f.rotation.length} flavors, one per day` : "rotation paused"}
              </div>
            </div>
          ) : (
            <FoodSearch value={f.name} search={library.search}
              onChangeName={(v) => ration.setField(f.id, "name", v)}
              onPick={(food) => ration.patch(f.id, libEntry(food))} />
          )}
        </div>
        <button onClick={() => (isRot ? togglePause() : startRotation())} aria-pressed={rotating}
          title={!isRot ? "Rotate flavors (variety pack)" : rotating ? "Pause rotation (keeps all flavors)" : "Resume rotation"} aria-label="Rotate flavors"
          style={{ color: rotating ? A.good : A.muted, border: "none", background: "none", cursor: "pointer", padding: 0, display: "inline-flex", fontSize: 16, lineHeight: 1 }}>↻</button>
        {!isRot && (
          <button onClick={() => isCompleteFood(f) && saveFood?.(f)} disabled={!isCompleteFood(f)}
            title={saved ? "Saved to your foods" : isCompleteFood(f) ? "Save to your foods (with its type, energy & analysis)" : "Add a name and energy first"}
            aria-label="Save food to your library"
            style={{ color: saved ? A.good : isCompleteFood(f) ? A.muted : A.cardBorder, border: "none", background: "none", cursor: isCompleteFood(f) ? "pointer" : "default", padding: 0, display: "inline-flex" }}>
            {saved ? <BookmarkCheck size={16} /> : <BookmarkPlus size={16} />}
          </button>
        )}
        <button onClick={() => ration.remove(f.id)} aria-label="Remove food" style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 15 }}>×</button>
      </div>

      <div style={{ display: "flex", gap: 5, marginTop: 8, alignItems: "center" }}>
        {MODES.map(([m, lbl]) => {
          const on = splitMode === m; const c = A.mode[m];
          return (
            <button key={m} onClick={() => setSplitMode(f.id, m)} aria-pressed={on}
              style={{ fontFamily: TYPE.mono, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", borderRadius: 6, padding: "4px 8px",
                border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? c.bg : "transparent", color: on ? c.text : A.muted, cursor: "pointer" }}>{lbl}</button>
          );
        })}
        {!isRot ? (
          <button onClick={() => setShowDetails((s) => !s)} style={{ marginLeft: "auto", fontFamily: TYPE.mono, fontSize: 10, color: showDetails ? A.ink : A.muted, background: "none", border: "none", cursor: "pointer" }}>
            {showDetails ? "details ▾" : "details ▸"}
          </button>
        ) : (
          <button onClick={() => setShowFlavors((s) => !s)} aria-expanded={showFlavors} aria-label="Show or hide the flavor list"
            style={{ marginLeft: "auto", fontFamily: TYPE.mono, fontSize: 10, color: showFlavors ? A.ink : A.muted, background: "none", border: "none", cursor: "pointer" }}>
            {showFlavors ? "flavors ▾" : `flavors (${f.rotation.length}) ▸`}
          </button>
        )}
      </div>

      {splitMode === "share" && (
        <>
          <input type="range" min={0} max={100} step={1} value={r0(f.pct) || 0}
            onChange={(e) => ration.setField(f.id, "pct", Number(e.target.value))}
            aria-label={`${f.name || "food"} share`} style={{ width: "100%", marginTop: 8, accentColor: color }} />
          <AmountRow left={`${r0(row.pct)}% of ${target} · ${r0(row.kcal)} kcal`} grams={row.grams} />
        </>
      )}
      {splitMode === "fixed" && type === "treat" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
          <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body, display: "inline-flex", alignItems: "baseline", gap: 5 }}>
            <input type="number" step="any" min="0" value={f.treatCount ?? ""} onChange={(e) => setTreatCount(e.target.value === "" ? "" : Number(e.target.value))} aria-label="number of treats" style={numInline} />
            treats · {r0(row.kcal)} kcal · {r0(row.pct)}%
          </span>
          <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{g1(row.grams)}</span>
        </div>
      )}
      {splitMode === "fixed" && type !== "treat" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
          <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body, display: "inline-flex", alignItems: "baseline", gap: 5 }}>
            off the top ·
            <input type="number" step="any" min="0" value={f.fixedKcal ?? ""} onChange={(e) => setFixedKcal(e.target.value)} aria-label="fixed kcal" style={numInline} /> kcal
            · {r0(row.pct)}%
          </span>
          {kpg > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }} title="Type grams to set the amount — kcal follows">
              <input type="number" step="any" min="0" value={gramsShown} onChange={(e) => setFixedGrams(e.target.value)} onBlur={() => setGEdit(null)} aria-label="fixed grams"
                style={{ width: 60, fontFamily: TYPE.mono, fontSize: 16, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "right", padding: "1px 2px" }} />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>g</span>
            </span>
          ) : (
            <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{g1(row.grams)}</span>
          )}
        </div>
      )}
      {splitMode === "remainder" && (
        <AmountRow left={`absorbs what's left · ${r0(row.pct)}% · ${r0(row.kcal)} kcal`} grams={row.grams} />
      )}

      {/* Collapsed, this keeps just the one line worth glancing at — what's coming — and drops the
          editor. A paused pack with the editor shut has nothing to say, so the panel goes entirely. */}
      {isRot && (showFlavors || rotating) && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${A.cardBorder}` }}>
          {showFlavors && <div style={label({ fontSize: 9, marginBottom: 4 })}>Flavors · fed in this order</div>}
          {showFlavors && f.rotation.map((m, idx) => (
            <div key={idx}
              onDragOver={(e) => { if (dragIdx != null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragIdx != null) moveFlavor(dragIdx, idx); setDragIdx(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", opacity: dragIdx === idx ? 0.4 : 1, borderTop: dragIdx != null && dragIdx !== idx ? `1px dashed ${A.hairline}` : "1px solid transparent" }}>
              <span draggable onDragStart={() => setDragIdx(idx)} onDragEnd={() => setDragIdx(null)} aria-label="Drag to reorder" title="Drag to reorder"
                style={{ flex: "none", cursor: "grab", color: A.cardBorder, fontSize: 13, lineHeight: 1, userSelect: "none", padding: "0 2px" }}>⠿</span>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor(m), flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <FoodSearch value={m.name} search={library.search} onChangeName={(v) => setFlavorName(idx, v)} onPick={(food) => pickFlavor(idx, food)} />
              </div>
              {idx === activeIdx && <span style={{ fontFamily: TYPE.mono, fontSize: 9, color: A.good, border: `1px solid ${A.good}`, borderRadius: 999, padding: "1px 6px", flex: "none" }}>next</span>}
              <span style={{ display: "inline-flex", flexDirection: "column", flex: "none", lineHeight: 0.8 }}>
                <button onClick={() => moveFlavor(idx, idx - 1)} disabled={idx === 0} aria-label="Move up" style={{ border: "none", background: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? A.cardBorder : A.muted, fontSize: 9, padding: 0 }}>▲</button>
                <button onClick={() => moveFlavor(idx, idx + 1)} disabled={idx === f.rotation.length - 1} aria-label="Move down" style={{ border: "none", background: "none", cursor: idx === f.rotation.length - 1 ? "default" : "pointer", color: idx === f.rotation.length - 1 ? A.cardBorder : A.muted, fontSize: 9, padding: 0 }}>▼</button>
              </span>
              <button onClick={() => removeFlavor(idx)} aria-label="Remove flavor" style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          ))}
          {showFlavors && (
            <button onClick={addFlavor} style={{ marginTop: 4, fontFamily: TYPE.mono, fontSize: 11, color: A.good, background: "none", border: "none", cursor: "pointer" }}>+ add flavor</button>
          )}
          {rotating && (
            <p style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.body, marginTop: showFlavors ? 8 : 0, lineHeight: 1.5 }}>
              Next up: <b style={{ color: A.ink }}>{upcomingFlavors(f, activeIdx < 0 ? 0 : activeIdx, 3).join(" → ")}</b>{f.rotation.length > 3 ? " → …" : ""}
            </p>
          )}
          {showFlavors && (
            <p style={{ fontSize: 10.5, color: A.muted, marginTop: 6, lineHeight: 1.45 }}>
              Each flavor pulls its energy &amp; analysis from your saved foods — pick from the list; drag the ⠿ handle to reorder. The bowl works through the pack <b>in order, by the can</b>: it feeds the open can until it's empty, then opens the next flavor — so a day may finish one can and open the next. <b>Tonight's bowl on the Log</b> shows exactly which can(s) to use. Drop to one flavor to stop rotating; the ↻ button pauses without losing the list.
            </p>
          )}
        </div>
      )}

      {showDetails && !isRot && <FoodDetails f={f} patch={patch} />}
    </div>
  );
}

function FoodDetails({ f, patch }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${A.cardBorder}` }}>
      <div style={label({ marginBottom: 6 })}>Type</div>
      <TypePicker food={f} onPatch={patch} />
      <EnergyFields food={f} onPatch={patch} />
      <GuaranteedAnalysis food={f} onEditField={(k, v) => patch({ [k]: v })} />
    </div>
  );
}
