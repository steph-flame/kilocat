import { useState } from "react";
import { ChevronDown, ChevronRight, X, FlaskConical } from "lucide-react";
import { C } from "../theme.js";
import { Field, NumInput } from "./primitives.jsx";
import { macroProfile } from "../lib/foods.js";

// The five guaranteed-analysis fields off a standard cat-food label (as-fed %). Carbs (NFE) and
// the caloric split are derived from these — see macroProfile — so they aren't entered directly.
const GA_FIELDS = [
  ["protein", "Protein"],
  ["fat", "Fat"],
  ["fiber", "Fiber"],
  ["moisture", "Moisture"],
  ["ash", "Ash"],
];

// The library manager: foods you explicitly save (the bookmark on a food row) live here,
// starter foods included, and every field stays editable. Editing a saved food changes what
// future searches prefill; it doesn't retroactively touch rations you've already built.
export default function SavedFoods({ library }) {
  const [open, setOpen] = useState(false);
  const foods = library.foods;

  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <button onClick={() => setOpen((s) => !s)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} style={{ color: C.spruce }} /> : <ChevronRight size={16} style={{ color: C.spruce }} />}
          <h2 className="font-medium">Saved foods</h2>
        </div>
        <span style={{ color: C.faint }} className="text-xs font-mono">{foods.length}</span>
      </button>
      {!open && (
        <p style={{ color: C.faint }} className="text-xs mt-1">Save a food with the bookmark on its row; saved foods are offered when you search. Open to edit macros, moisture, or remove them.</p>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {foods.length === 0 && (
            <p style={{ color: C.faint }} className="text-xs">No saved foods yet. Add a food to the ration and it'll show up here.</p>
          )}
          {foods.map((f) => <SavedFoodCard key={f.id} f={f} library={library} />)}
          <button onClick={() => { if (window.confirm("Replace your saved foods with the built-in starter list? Foods you added or edited will be lost.")) library.reset(); }} style={{ borderColor: C.line, color: C.sub }} className="w-full border border-dashed rounded-xl py-2 text-xs hover:bg-white">
            Reset library to the built-in starter foods
          </button>
        </div>
      )}
    </section>
  );
}

function SavedFoodCard({ f, library }) {
  const [showGA, setShowGA] = useState(false);
  const energyFields = f.mode === "perKg"
    ? [["kcalPerKg", "Energy", "kcal/kg", "10"], ["gramsPerCup", "Grams per cup", "g (opt)", "1"]]
    : [["kcalPerUnit", "Energy per can", "kcal", "1"], ["gramsPerUnit", "Grams per can", "g", "1"]];
  const prof = macroProfile(f);

  return (
    <div style={{ borderColor: C.line }} className="border rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <input
          value={f.name}
          onChange={(e) => library.edit(f.id, { name: e.target.value })}
          placeholder="Food name"
          className="flex-1 text-sm font-medium bg-transparent outline-none"
          aria-label="Saved food name"
        />
        <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
          {[["perKg", "dry"], ["perUnit", "wet"]].map(([m, lbl]) => (
            <button key={m} onClick={() => library.edit(f.id, { mode: m })} style={{ background: f.mode === m ? C.spruce : "transparent", color: f.mode === m ? "#fff" : C.sub }} className="text-xs px-2 py-1 font-mono">{lbl}</button>
          ))}
        </div>
        <button onClick={() => library.remove(f.id)} style={{ color: C.faint }} className="p-1" aria-label="Remove saved food"><X size={15} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {energyFields.map(([k, lbl, suf, step]) => (
          <Field key={k} label={lbl} suffix={suf}>
            <NumInput value={f[k] ?? ""} onChange={(v) => library.edit(f.id, { [k]: v })} step={step} />
          </Field>
        ))}
      </div>

      <button onClick={() => setShowGA((s) => !s)} style={{ color: showGA ? C.spruce : C.sub }} className="mt-2 inline-flex items-center gap-1 text-xs font-mono">
        <FlaskConical size={12} /> Nutrition (guaranteed analysis){prof ? "" : " — add"} {showGA ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {showGA && (
        <div className="mt-2">
          <div className="grid grid-cols-3 gap-2">
            {GA_FIELDS.map(([k, lbl]) => (
              <Field key={k} label={lbl} suffix="%">
                <NumInput value={f[k] ?? ""} onChange={(v) => library.edit(f.id, { [k]: v })} step="0.1" />
              </Field>
            ))}
          </div>
          {prof ? (
            <div style={{ color: C.sub }} className="text-xs mt-2 leading-relaxed">
              <span className="font-mono">Carbs (NFE) ≈ {prof.carb}%</span> as-fed.{" "}
              Calories: <b style={{ color: C.ink }}>{prof.caloric.protein}%</b> protein · <b style={{ color: C.ink }}>{prof.caloric.fat}%</b> fat · <b style={{ color: C.ink }}>{prof.caloric.carb}%</b> carb.
              <div style={{ color: C.faint }} className="mt-0.5">Dry-matter: {prof.dryMatter.protein}% protein · {prof.dryMatter.fat}% fat · {prof.dryMatter.carb}% carb.</div>
            </div>
          ) : (
            <p style={{ color: C.faint }} className="text-xs mt-2">Enter at least protein and fat to see carbs and the caloric split. Values are the as-fed percentages off the label.</p>
          )}
        </div>
      )}
    </div>
  );
}
