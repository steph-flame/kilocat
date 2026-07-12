import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { C } from "../theme.js";
import { Field, NumInput } from "./primitives.jsx";

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
        <p style={{ color: C.faint }} className="text-xs mt-1">Save a food with the bookmark on its row; saved foods are offered when you search. Open to edit or remove them.</p>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {foods.length === 0 && (
            <p style={{ color: C.faint }} className="text-xs">No saved foods yet. Add a food to the ration and it'll show up here.</p>
          )}
          {foods.map((f) => {
            const macroFields = f.mode === "perKg"
              ? [["kcalPerKg", "Energy", "kcal/kg", "10"], ["gramsPerCup", "Grams per cup", "g (opt)", "1"]]
              : [["kcalPerUnit", "Energy per can", "kcal", "1"], ["gramsPerUnit", "Grams per can", "g", "1"]];
            return (
              <div key={f.id} style={{ borderColor: C.line }} className="border rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={f.name}
                    onChange={(e) => library.edit(f.id, { name: e.target.value })}
                    placeholder="Food name"
                    className="flex-1 text-sm font-medium bg-transparent outline-none"
                    aria-label="Saved food name"
                  />
                  <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: C.line }}>
                    {[["perKg", "dry"], ["perUnit", "wet"]].map(([m, lbl]) => (
                      <button key={m} onClick={() => library.edit(f.id, { mode: m })} style={{ background: f.mode === m ? C.spruce : "transparent", color: f.mode === m ? "#fff" : C.sub }} className="text-xs px-2 py-1 font-mono">{lbl}</button>
                    ))}
                  </div>
                  <button onClick={() => library.remove(f.id)} style={{ color: C.faint }} className="p-1" aria-label="Remove saved food"><X size={15} /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {macroFields.map(([k, lbl, suf, step]) => (
                    <Field key={k} label={lbl} suffix={suf}>
                      <NumInput value={f[k] ?? ""} onChange={(v) => library.edit(f.id, { [k]: v })} step={step} />
                    </Field>
                  ))}
                </div>
              </div>
            );
          })}
          <button onClick={() => { if (window.confirm("Replace your saved foods with the built-in starter list? Foods you added or edited will be lost.")) library.reset(); }} style={{ borderColor: C.line, color: C.sub }} className="w-full border border-dashed rounded-xl py-2 text-xs hover:bg-white">
            Reset library to the built-in starter foods
          </button>
        </div>
      )}
    </section>
  );
}
