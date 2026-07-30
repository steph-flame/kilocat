import { useState, useEffect } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { distributeBowl } from "../lib/bowl.js";
import { foodType, kcalPerG, libEntry, blankFood, isCompleteFood, rationMacroProfile, aafcoCheck } from "../lib/foods.js";
import { num } from "../lib/util.js";
import { DEMO_CAT_ID } from "../lib/catStore.js";
import { BookmarkPlus, BookmarkCheck } from "lucide-react";
import FoodSearch from "../components/FoodSearch.jsx";
import GuaranteedAnalysis from "../components/GuaranteedAnalysis.jsx";

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
  treat: [["kcalPerUnit", "Energy / treat", "kcal"], ["gramsPerUnit", "Weight / treat", "g"]],
};

function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
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
  const { intent, ration: liveRation, library, t, tr, activeCatId, saveFood } = useApp();
  const isDemo = activeCatId === DEMO_CAT_ID;
  const ration = useEditableRation(liveRation, isDemo, activeCatId);
  const target = r0(intent.target);
  const dist = distributeBowl(ration.items, target);
  const byId = Object.fromEntries(dist.rows.map((r) => [r.id, r]));
  const savedNames = new Set((library.foods || []).map((x) => x.name.trim().toLowerCase()));

  // exactly one remainder — promoting one demotes any other.
  const setMode = (id, mode) => ration.setItems((fs) => fs.map((f) => {
    if (f.id === id) return { ...f, mode };
    if (mode === "remainder" && f.mode === "remainder") return { ...f, mode: "share" };
    return f;
  }));

  const prof = rationMacroProfile(ration.items);
  const aafco = prof ? aafcoCheck(prof.dryMatter, t.stage) : null;

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        <div style={{ padding: "18px 24px 0" }}>
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
              first={i === 0} library={library} ration={ration} setMode={setMode}
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

        {/* folded nutrition detail */}
        {prof && (
          <Card>
            <div style={label()}>This blend delivers</div>
            <div style={{ fontSize: 13, color: A.body, marginTop: 8, lineHeight: 1.5 }}>
              <div><b style={{ color: A.ink }}>{prof.caloric.protein}%</b> protein · <b style={{ color: A.ink }}>{prof.caloric.fat}%</b> fat · <b style={{ color: A.ink }}>{prof.caloric.carb}%</b> carb of calories</div>
              <div style={{ color: A.muted, marginTop: 3 }}>
                Dry-matter protein {r0(prof.dryMatter.protein)}%{aafco && aafco.protein === "below" ? ` · below the AAFCO ${aafco.stage} minimum` : aafco && aafco.protein === "ok" ? " · clears AAFCO" : ""} · {r0(prof.moisture)}% moisture
              </div>
              {prof.coverageKcalPct < 99 && (
                <div style={{ color: A.muted, marginTop: 3 }}>Based on {r0(prof.coverageKcalPct)}% of the blend — add guaranteed-analysis to the rest.</div>
              )}
            </div>
          </Card>
        )}

        {/* footer — the ration saves live as you edit; this just leaves the page */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "4px 24px 0" }}>
          <a href="#/" style={{ background: A.good, color: A.card, fontFamily: TYPE.sans, fontSize: 13, fontWeight: 600, borderRadius: 14, padding: "12px 20px", textDecoration: "none" }}>
            Done ›
          </a>
        </div>
      </div>
    </div>
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

function BowlRow({ f, row, target, first, library, ration, setMode, saveFood, saved }) {
  const [showDetails, setShowDetails] = useState(false);
  const mode = f.mode || "share";
  const type = foodType(f);
  const color = dotColor(f);
  const patch = (obj) => ration.setItems((fs) => fs.map((x) => (x.id === f.id ? { ...x, ...obj } : x)));
  const setType = (ty) => patch({ type: ty, mode: ty === "dry" ? "perKg" : "perUnit" });
  // A treat is given by count; its fixed kcal follows the per-treat energy.
  const setTreatCount = (c) => patch({ treatCount: c, fixedKcal: c === "" ? "" : num(c) * num(f.kcalPerUnit) });

  return (
    <div style={{ borderTop: first ? "none" : `1px solid ${A.hairline}`, padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: color, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <FoodSearch value={f.name} search={library.search}
            onChangeName={(v) => ration.setField(f.id, "name", v)}
            onPick={(food) => ration.patch(f.id, libEntry(food))} />
        </div>
        <button onClick={() => isCompleteFood(f) && saveFood?.(f)} disabled={!isCompleteFood(f)}
          title={saved ? "Saved to your foods" : isCompleteFood(f) ? "Save to your foods (with its type, energy & analysis)" : "Add a name and energy first"}
          aria-label="Save food to your library"
          style={{ color: saved ? A.good : isCompleteFood(f) ? A.muted : A.cardBorder, border: "none", background: "none", cursor: isCompleteFood(f) ? "pointer" : "default", padding: 0, display: "inline-flex" }}>
          {saved ? <BookmarkCheck size={16} /> : <BookmarkPlus size={16} />}
        </button>
        <button onClick={() => ration.remove(f.id)} aria-label="Remove food" style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 15 }}>×</button>
      </div>

      <div style={{ display: "flex", gap: 5, marginTop: 8, alignItems: "center" }}>
        {MODES.map(([m, lbl]) => {
          const on = mode === m; const c = A.mode[m];
          return (
            <button key={m} onClick={() => setMode(f.id, m)} aria-pressed={on}
              style={{ fontFamily: TYPE.mono, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", borderRadius: 6, padding: "4px 8px",
                border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? c.bg : "transparent", color: on ? c.text : A.muted, cursor: "pointer" }}>{lbl}</button>
          );
        })}
        <button onClick={() => setShowDetails((s) => !s)} style={{ marginLeft: "auto", fontFamily: TYPE.mono, fontSize: 10, color: showDetails ? A.ink : A.muted, background: "none", border: "none", cursor: "pointer" }}>
          {showDetails ? "details ▾" : "details ▸"}
        </button>
      </div>

      {mode === "share" && (
        <>
          <input type="range" min={0} max={100} step={1} value={r0(f.pct) || 0}
            onChange={(e) => ration.setField(f.id, "pct", Number(e.target.value))}
            aria-label={`${f.name || "food"} share`} style={{ width: "100%", marginTop: 8, accentColor: color }} />
          <AmountRow left={`${r0(row.pct)}% of ${target} · ${r0(row.kcal)} kcal`} grams={row.grams} />
        </>
      )}
      {mode === "fixed" && type === "treat" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
          <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body, display: "inline-flex", alignItems: "baseline", gap: 5 }}>
            <input type="number" step="any" min="0" value={f.treatCount ?? ""} onChange={(e) => setTreatCount(e.target.value === "" ? "" : Number(e.target.value))} aria-label="number of treats" style={numInline} />
            treats · {r0(row.kcal)} kcal
          </span>
          <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{g1(row.grams)}</span>
        </div>
      )}
      {mode === "fixed" && type !== "treat" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
          <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body, display: "inline-flex", alignItems: "baseline", gap: 5 }}>
            off the top ·
            <input type="number" step="any" min="0" value={f.fixedKcal ?? ""} onChange={(e) => ration.setField(f.id, "fixedKcal", e.target.value === "" ? "" : Number(e.target.value))} aria-label="fixed kcal" style={numInline} /> kcal
          </span>
          <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{g1(row.grams)}</span>
        </div>
      )}
      {mode === "remainder" && (
        <AmountRow left={`absorbs what's left · ${r0(row.pct)}% · ${r0(row.kcal)} kcal`} grams={row.grams} />
      )}

      {showDetails && <FoodDetails f={f} type={type} patch={patch} setType={setType} ration={ration} />}
    </div>
  );
}

function FoodDetails({ f, type, patch, setType, ration }) {
  const perKg = kcalPerG(f) * 1000;
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
              <input type="number" step="any" min="0" value={f[k] ?? ""} onChange={(e) => patch({ [k]: e.target.value === "" ? "" : Number(e.target.value) })}
                aria-label={lbl} style={{ width: "100%", fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, padding: "2px 0" }} />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{suf}</span>
            </div>
          </label>
        ))}
      </div>
      {type === "treat" && perKg > 0 && (
        <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 8 }}>≈ {r0(perKg)} kcal/kg</div>
      )}

      <GuaranteedAnalysis food={f} onEditField={(k, v) => patch({ [k]: v })} />
    </div>
  );
}
