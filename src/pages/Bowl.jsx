import { useState, useEffect } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { distributeBowl } from "../lib/bowl.js";
import { foodType, kcalPerG, libEntry, blankFood, isCompleteFood, treatEnergy, rationMacroProfile, aafcoCheck } from "../lib/foods.js";
import { hasRotation, isRotating, foodFieldsOf, upcomingFlavors } from "../lib/rotation.js";
import { resolveRotationsWithFridge, activeMemberWithFridge } from "../lib/fridge.js";
import { num } from "../lib/util.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import { BookmarkPlus, BookmarkCheck } from "lucide-react";
import FoodSearch from "../components/FoodSearch.jsx";
import GuaranteedAnalysis from "../components/GuaranteedAnalysis.jsx";
import { DistributionBody, Toggle } from "../components/FoodDistribution.jsx";
import { foodSummary, macroBreakdown } from "../lib/foodStats.js";

// Ration — Step 2 of 2: The bowl. Split the Intent target across N foods, each fixed / share /
// remainder. One basis for everything: % of the full target (see lib/bowl.js).

const r0 = (n) => Math.round(n);
const g1 = (g) => (g == null ? "—" : `${Number(Number(g).toFixed(1))} g`); // grams to 1 decimal, trimmed
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const MODES = [["fixed", "fixed"], ["share", "share"], ["remainder", "rest"]];
const TYPES = [["wet", "wet"], ["dry", "dry"], ["treat", "treat"]];
const dotColor = (f) => { const ty = foodType(f); return ty === "treat" ? A.food.treat : ty === "wet" ? A.food.wet : A.food.dry; };
// energy fields per food type (all accept decimals). treats are priced per treat.
const ENERGY_FIELDS = {
  dry: [["kcalPerKg", "Energy", "kcal/kg"], ["gramsPerCup", "Grams / cup", "g"]],
  wet: [["kcalPerUnit", "Energy / can", "kcal"], ["gramsPerUnit", "Grams / can", "g"]],
  // Treats: enter exactly what's on the package — calories per treat AND calories per kg. The
  // treat's weight (gramsPerUnit) is derived from those, not entered.
  treat: [["kcalPerUnit", "Calories / treat", "kcal"], ["kcalPerKg", "Calories / kg", "kcal/kg"]],
};

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
  const { p, intent, ration: liveRation, start: liveStart, library, t, tr, setTr, activeCatId, saveFood, today, fridge, fridgeDays } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;
  const ration = useEditableRation(liveRation, isDemo, activeCatId);
  const start = useEditableRation(liveStart, isDemo, activeCatId);
  const target = r0(intent.target);
  // Resolve any variety-pack rotation slot to today's active flavor before splitting, so grams,
  // macros and the distribution all reflect what actually goes in the bowl today — finishing an
  // open can before starting a new flavor (falls back to the calendar cycle when nothing's open).
  const resolvedItems = resolveRotationsWithFridge(ration.items, today, fridge, fridgeDays);
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
        <Transition name={p?.name} start={start} setStartSplitMode={setStartSplitMode}
          newRows={dist.rows} target={target} tr={trEff} setTr={setTrEff} library={library} saveFood={saveFood} savedNames={savedNames} />

        {/* footer — the ration saves live as you edit; this just leaves the page */}
        <div className="span-all" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "4px 24px 0" }}>
          <a href="#/" style={{ background: A.good, color: A.card, fontFamily: TYPE.sans, fontSize: 13, fontWeight: 600, borderRadius: 14, padding: "12px 20px", textDecoration: "none" }}>
            Done ›
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
function Transition({ name, start, setStartSplitMode, newRows, target, tr, setTr, library, saveFood, savedNames }) {
  const on = !!tr.on;
  const days = Math.max(1, Math.min(30, num(tr.days) || 7));
  const unit = tr.timelineUnit || "g";
  const startDist = distributeBowl(start.items, target);
  const startById = Object.fromEntries(startDist.rows.map((r) => [r.id, r]));
  const newById = Object.fromEntries(newRows.map((r) => [r.id, r]));
  const suf = unit === "kcal" ? "" : "g";
  const cell = (row, frac) => {
    if (!row) return "—";
    if (unit === "kcal") return `${r0(row.kcal * frac)}`;
    return row.grams != null ? `${Number((row.grams * frac).toFixed(1))}` : `${r0(row.kcal * frac)}`;
  };
  const firstWord = (nm, fallback) => (nm || fallback).split(" ")[0];
  const hasStart = start.items.length > 0;

  return (
    <Card className="span-all">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={label()}>Switching foods</div>
          <p style={{ fontSize: 12.5, color: A.bodyOnFill, margin: "5px 0 0", lineHeight: 1.45 }}>
            Ramp from what {name || "she"}'s eating now to this ration over several days to avoid stomach upset.
          </p>
        </div>
        <button onClick={() => setTr((s) => ({ ...s, on: !s.on }))} aria-pressed={on} role="switch" aria-label="Enable food transition"
          style={{ flex: "none", width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: on ? A.good : A.track, position: "relative", transition: "background .15s" }}>
          <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 999, background: A.card, transition: "left .15s" }} />
        </button>
      </div>

      {on && (
        <div style={{ marginTop: 14 }}>
          <div style={label({ color: A.labelOnFill, marginBottom: 2 })}>Currently feeding</div>
          {!hasStart && <p style={{ fontSize: 12, color: A.muted, padding: "6px 0" }}>Add what {name || "she"}'s eating now to see the day-by-day ramp.</p>}
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
                      {start.items.map((f) => <th key={f.id} style={{ textAlign: "right", padding: "8px 10px", color: A.muted, fontWeight: 500, whiteSpace: "nowrap" }}>{firstWord(f.name, "old")}</th>)}
                      {newRows.map((r) => <th key={r.id} style={{ textAlign: "right", padding: "8px 10px", color: A.good, fontWeight: 600, whiteSpace: "nowrap" }}>{firstWord(r.name, "new")}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
                      const toNew = day / days, last = day === days;
                      return (
                        <tr key={day} style={{ borderBottom: `1px solid ${A.hairline}`, background: last ? "rgba(31,81,48,0.07)" : "transparent" }}>
                          <td style={{ padding: "7px 10px", color: A.ink, whiteSpace: "nowrap" }}>{day} <span style={{ color: A.muted }}>· {r0(toNew * 100)}%</span></td>
                          {start.items.map((f) => { const frac = 1 - toNew; return <td key={f.id} style={{ padding: "7px 10px", textAlign: "right", color: frac < 0.001 ? A.muted : A.body }}>{frac < 0.001 ? "—" : `${cell(startById[f.id], frac)}${suf}`}</td>; })}
                          {newRows.map((r) => <td key={r.id} style={{ padding: "7px 10px", textAlign: "right", color: A.good }}>{`${cell(newById[r.id], toNew)}${suf}`}</td>)}
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
  const { today, fridge, fridgeDays } = useApp();
  const [showDetails, setShowDetails] = useState(false);
  const [gEdit, setGEdit] = useState(null); // grams being typed for a fixed food (kcal follows)
  const splitMode = f.splitMode || "share";
  // A rotation slot has no top-level food of its own — its energy/type/name come from whichever
  // flavor is active today (fridge-aware: finish an open can before starting a new flavor). `af`
  // is the food we display and price against.
  const isRot = hasRotation(f);
  const rotating = isRotating(f); // has ≥2 flavors and not paused
  const af = isRot ? (activeMemberWithFridge(f, today, fridge, fridgeDays) || {}) : f;
  const activeIdx = isRot ? f.rotation.findIndex((m) => m === af || (m.name || "") === (af.name || "")) : -1;
  const type = foodType(af);
  const color = dotColor(af);
  const kpg = kcalPerG(af); // energy density — lets a fixed amount be entered as grams, not just kcal
  const setFixedKcal = (v) => { setGEdit(null); ration.setField(f.id, "fixedKcal", v === "" ? "" : Number(v)); };
  const setFixedGrams = (v) => { setGEdit(v); ration.setField(f.id, "fixedKcal", v === "" ? "" : Math.round(Number(v) * kpg * 100) / 100); };
  const gramsShown = gEdit != null ? gEdit : (row.grams != null ? String(Number(row.grams.toFixed(1))) : "");
  const patch = (obj) => ration.setItems((fs) => fs.map((x) => (x.id === f.id ? { ...x, ...obj } : x)));
  const setType = (ty) => patch({ type: ty, mode: ty === "dry" ? "perKg" : "perUnit" });
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
  const startRotation = () => setMembers([foodFieldsOf(f), foodFieldsOf(blankFood())]); // seed with the current food + one empty slot
  const togglePause = () => patch({ rotateOff: !f.rotateOff }); // non-destructive: keeps every flavor
  const addFlavor = () => setMembers((cur) => [...cur, foodFieldsOf(blankFood())]);
  const removeFlavor = (idx) => setMembers((cur) => cur.filter((_, i) => i !== idx));
  const setFlavorName = (idx, name) => setMembers((cur) => cur.map((m, i) => (i === idx ? { ...m, name } : m)));
  const pickFlavor = (idx, food) => setMembers((cur) => cur.map((m, i) => (i === idx ? foodFieldsOf(libEntry(food)) : m)));

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
        {!isRot && (
          <button onClick={() => setShowDetails((s) => !s)} style={{ marginLeft: "auto", fontFamily: TYPE.mono, fontSize: 10, color: showDetails ? A.ink : A.muted, background: "none", border: "none", cursor: "pointer" }}>
            {showDetails ? "details ▾" : "details ▸"}
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

      {isRot && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${A.cardBorder}` }}>
          <div style={label({ fontSize: 9, marginBottom: 4 })}>Flavors · one per day</div>
          {f.rotation.map((m, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor(m), flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <FoodSearch value={m.name} search={library.search} onChangeName={(v) => setFlavorName(idx, v)} onPick={(food) => pickFlavor(idx, food)} />
              </div>
              {idx === activeIdx && <span style={{ fontFamily: TYPE.mono, fontSize: 9, color: A.good, border: `1px solid ${A.good}`, borderRadius: 999, padding: "1px 6px", flex: "none" }}>today</span>}
              <button onClick={() => removeFlavor(idx)} aria-label="Remove flavor" style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          ))}
          <button onClick={addFlavor} style={{ marginTop: 4, fontFamily: TYPE.mono, fontSize: 11, color: A.good, background: "none", border: "none", cursor: "pointer" }}>+ add flavor</button>
          {rotating && (
            <p style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.body, marginTop: 8, lineHeight: 1.5 }}>
              Next up: <b style={{ color: A.ink }}>{upcomingFlavors(f, today, 3).join(" → ")}</b>{f.rotation.length > 3 ? " → …" : ""}
            </p>
          )}
          <p style={{ fontSize: 10.5, color: A.muted, marginTop: 6, lineHeight: 1.45 }}>
            Each flavor pulls its energy &amp; analysis from your saved foods — pick from the list. The bowl advances one flavor per day, so <b>tonight's bowl on the Log</b> and this ration's grams show today's flavor automatically. If you track cans, it feeds whatever's open before starting the next flavor. Drop to one flavor to stop rotating; the ↻ button pauses without losing the list.
          </p>
        </div>
      )}

      {showDetails && !isRot && <FoodDetails f={f} type={type} patch={patch} setType={setType} ration={ration} />}
    </div>
  );
}

function FoodDetails({ f, type, patch, setType, ration }) {
  // For treats, changing calories/treat or calories/kg re-derives the treat's weight (gramsPerUnit)
  // so grams throughout the app still work — the owner only ever types what's on the package.
  const changeEnergy = (k, v) => {
    if (type !== "treat") return patch({ [k]: v });
    const next = { ...f, [k]: v };
    patch({ [k]: v, gramsPerUnit: treatEnergy({ kcalPerTreat: next.kcalPerUnit, kcalPerKg: next.kcalPerKg }).gramsPerUnit });
  };
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${A.cardBorder}` }}>
      <div style={label({ marginBottom: 6 })}>Type</div>
      <div style={{ display: "flex", gap: 5 }}>
        {TYPES.map(([ty, lbl]) => {
          const on = type === ty;
          return (
            <button key={ty} onClick={() => setType(ty)} aria-pressed={on}
              style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "4px 12px", cursor: "pointer",
                border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? A.ink : "transparent", color: on ? A.card : A.body }}>{lbl}</button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        {ENERGY_FIELDS[type].map(([k, lbl, suf]) => (
          <label key={k} style={{ display: "block" }}>
            <span style={label({ fontSize: 10 })}>{lbl}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 3 }}>
              <input type="number" step="any" min="0" value={f[k] ?? ""} onChange={(e) => changeEnergy(k, e.target.value === "" ? "" : Number(e.target.value))}
                aria-label={lbl} style={{ width: "100%", fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, padding: "2px 0" }} />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{suf}</span>
            </div>
          </label>
        ))}
      </div>
      {type === "treat" && kcalPerG(f) > 0 && (
        <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 8 }}>≈ {Number((f.gramsPerUnit || 0).toFixed(2))} g per treat · worked out from the label</div>
      )}

      <GuaranteedAnalysis food={f} onEditField={(k, v) => patch({ [k]: v })} />
    </div>
  );
}
