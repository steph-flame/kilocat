import { useState, useMemo } from "react";
import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { blankFood, foodType, kcalPerG } from "../lib/foods.js";
import { hashParam } from "../hooks/useHashRoute.js";
import GuaranteedAnalysis from "../components/GuaranteedAnalysis.jsx";

// Foods — the saved-food library, as a place of its own.
//
// It was always real, editable state (see hooks/useFoodLibrary.js); it just had nowhere to live.
// The only way to create a food was to type it into a ration row and press the bookmark, which
// made "add a food" a side effect of planning a meal — so a can you'd bought but weren't feeding
// yet, or a flavour you wanted stocked in the cupboard, had to be smuggled in through a plan it
// didn't belong to. A library is a catalogue of what exists; the ration is a plan about some of
// it. Those are different jobs, and this is the first one.
//
// Everything here is shared across cats, like the library always was — two cats can eat the same
// food, and its label doesn't change per animal.

const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const cap = { fontSize: 12.5, color: A.bodyOnFill, lineHeight: 1.45, margin: "6px 0 0" };
const dotColor = (f) => (foodType(f) === "wet" ? A.food.wet : foodType(f) === "treat" ? A.food.treat : A.food.dry);
const numBox = { width: 78, fontFamily: TYPE.mono, fontSize: 14, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "right", padding: "2px 2px" };

function Card({ children, style, className }) {
  return <div className={className} style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "16px 18px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

// A food is fed by the KILO (kibble from a bag) or by the UNIT (a can, pouch, or treat). That one
// choice decides which two energy fields make sense, which is why it's a control and not a guess.
const MODES = [["perKg", "by weight", "kibble from a bag"], ["perUnit", "by the can", "cans, pouches, treats"]];

function EnergyFields({ f, onField }) {
  const rows = f.mode === "perUnit"
    ? [["kcalPerUnit", "Energy per can", "kcal"], ["gramsPerUnit", "Grams per can", "g"]]
    : [["kcalPerKg", "Energy", "kcal/kg"], ["gramsPerCup", "Grams per cup", "g (optional)"]];
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
      {rows.map(([k, lbl, suf]) => (
        <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={label({ fontSize: 9 })}>{lbl}</span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
            <input type="number" step="any" min="0" value={f[k] ?? ""} onChange={(e) => onField(k, e.target.value)}
              aria-label={`${f.name || "food"} ${lbl}`} style={numBox} />
            <span style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted }}>{suf}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function ModePicker({ mode, onChange, name }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {MODES.map(([m, lbl, hint]) => (
        <button key={m} onClick={() => onChange(m)} aria-pressed={mode === m} title={hint}
          aria-label={`${name || "food"} measured ${lbl}`}
          style={{ fontFamily: TYPE.mono, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", borderRadius: 7, padding: "4px 9px", cursor: "pointer",
            border: mode === m ? "none" : `1px solid ${A.cardBorder}`, background: mode === m ? A.ink : "transparent", color: mode === m ? A.card : A.muted }}>{lbl}</button>
      ))}
    </div>
  );
}

// Creating one. Deliberately its own form rather than "add a blank row and edit it": a half-typed
// food in the library is offered in every search on every screen, so nothing is saved until the
// two things that make a food usable — a name and an energy — are actually filled in.
function NewFood({ onSave, prefillName }) {
  const [f, setF] = useState(() => ({ ...blankFood(), name: prefillName, mode: "perKg" }));
  const [open, setOpen] = useState(!!prefillName);
  const set = (k, v) => setF((cur) => ({ ...cur, [k]: v }));
  const usable = f.name.trim() && kcalPerG(f) > 0;
  const save = () => { if (usable) { onSave({ ...f, type: f.mode === "perUnit" ? "wet" : "dry" }); setF({ ...blankFood(), mode: f.mode }); setOpen(false); } };

  if (!open) {
    return (
      <Card className="span-all">
        <button onClick={() => setOpen(true)} style={{ width: "100%", border: `1px dashed ${A.cardBorder}`, borderRadius: 12, padding: "11px 0", background: "transparent", color: A.good, fontFamily: TYPE.sans, fontSize: 13, cursor: "pointer" }}>
          + Add a food
        </button>
      </Card>
    );
  }
  return (
    <Card className="span-all">
      <div style={label({ marginBottom: 8 })}>New food</div>
      <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Name as it reads on the tin" autoFocus
        aria-label="New food name"
        style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, outline: "none", fontFamily: TYPE.sans, fontSize: 15, color: A.ink, padding: "3px 0" }} />
      <div style={{ marginTop: 10 }}><ModePicker mode={f.mode} onChange={(m) => set("mode", m)} name={f.name} /></div>
      <EnergyFields f={f} onField={set} />
      <GuaranteedAnalysis food={f} onEditField={set} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button onClick={save} disabled={!usable}
          style={{ fontFamily: TYPE.sans, fontSize: 13, borderRadius: 10, padding: "8px 16px", border: "none", cursor: usable ? "pointer" : "default",
            background: usable ? A.good : A.track, color: usable ? A.card : A.muted }}>Save food</button>
        <button onClick={() => setOpen(false)} style={{ fontFamily: TYPE.mono, fontSize: 11.5, color: A.muted, background: "none", border: "none", cursor: "pointer" }}>cancel</button>
        {!usable && <span style={{ fontSize: 11.5, color: A.muted }}>Needs a name and an energy figure.</span>}
      </div>
    </Card>
  );
}

function FoodCard({ f, library }) {
  const [open, setOpen] = useState(false);
  const edit = (k, v) => library.edit(f.id, { [k]: v });
  const density = kcalPerG(f);
  return (
    <div style={{ borderTop: `1px solid ${A.hairline}`, padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: dotColor(f), flex: "none" }} />
        <input value={f.name} onChange={(e) => edit("name", e.target.value)} aria-label={`${f.name} name`}
          style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontFamily: TYPE.sans, fontSize: 13.5, color: A.ink }} />
        <button onClick={() => setOpen((s) => !s)} aria-expanded={open} aria-label={`Edit ${f.name}`}
          style={{ fontFamily: TYPE.mono, fontSize: 10, color: open ? A.ink : A.muted, background: "none", border: "none", cursor: "pointer", flex: "none" }}>
          {open ? "edit ▾" : "edit ▸"}
        </button>
        <button onClick={() => { if (window.confirm(`Remove ${f.name || "this food"} from your saved foods? Rations already using it keep their own copy.`)) library.remove(f.id); }}
          aria-label={`Remove ${f.name}`} style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 15, flex: "none" }}>×</button>
      </div>
      <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, paddingLeft: 17 }}>
        {f.mode === "perUnit"
          ? `${f.kcalPerUnit || "?"} kcal / ${f.gramsPerUnit || "?"} g can`
          : `${f.kcalPerKg || "?"} kcal/kg`}
        {density > 0 ? ` · ${Number((density * 1000).toFixed(0))} kcal/kg` : ""}
      </div>
      {open && (
        <div style={{ paddingLeft: 17, marginTop: 8 }}>
          <ModePicker mode={f.mode} onChange={(m) => edit("mode", m)} name={f.name} />
          <EnergyFields f={f} onField={edit} />
          <GuaranteedAnalysis food={f} onEditField={edit} />
          <p style={{ fontSize: 11, color: A.muted, marginTop: 8, lineHeight: 1.45 }}>
            Editing a saved food changes what future searches fill in. Rations you've already built keep the numbers they were built with.
          </p>
        </div>
      )}
    </div>
  );
}

export default function FoodsPage() {
  const { library } = useApp();
  const [q, setQ] = useState("");
  const [prefill] = useState(() => hashParam("new")); // a name handed over from the cupboard
  // Search to find a food, then fix its name — which is the moment a live filter turns against you,
  // because the row stops matching halfway through the word and vanishes from under the cursor. So
  // the filter decides WHICH foods are on screen only when the query changes (or one is added or
  // removed), never on an edit. Typing in a row can't evict it; touching the search box re-filters.
  const shownIds = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? library.foods.filter((f) => (f.name || "").toLowerCase().includes(s)) : library.foods;
    return new Set(list.map((f) => f.id));
  }, [q, library.foods.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(
    () => library.foods.filter((f) => shownIds.has(f.id)).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [library.foods, shownIds]
  );

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div className="alm-page alm-grid">
        <div className="span-all" style={{ padding: "18px 24px 2px" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>foods</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 26, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 6px" }}>Your foods</h1>
          <p style={{ ...cap, margin: 0 }}>Everything the app can offer you when you build a ration or stock the cupboard. Shared by all your cats — a tin's label doesn't change per animal.</p>
        </div>

        <NewFood prefillName={prefill} onSave={(f) => library.upsert(f)} />

        <Card className="span-all">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span style={label()}>{library.foods.length} saved</span>
            {q && <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{shown.length} shown</span>}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your foods" aria-label="Search your foods"
            style={{ width: "100%", background: "transparent", border: `1px solid ${A.cardBorder}`, borderRadius: 10, outline: "none", fontFamily: TYPE.sans, fontSize: 13, color: A.ink, padding: "8px 10px", marginBottom: 4 }} />
          {shown.length === 0 && (
            <p style={{ fontSize: 12.5, color: A.muted, marginTop: 10 }}>{q ? "Nothing matches that." : "No foods yet — add one above."}</p>
          )}
          {shown.map((f) => <FoodCard key={f.id} f={f} library={library} />)}
        </Card>

        <Card className="span-all">
          <button onClick={() => { if (window.confirm("Replace your saved foods with the built-in starter list? Foods you added or edited will be lost.")) library.reset(); }}
            style={{ width: "100%", border: `1px solid ${A.caution.border}`, color: A.caution.text, background: "transparent", borderRadius: 10, padding: "9px 0", fontFamily: TYPE.mono, fontSize: 11.5, cursor: "pointer" }}>
            reset to the built-in starter foods
          </button>
        </Card>
      </div>
    </div>
  );
}
