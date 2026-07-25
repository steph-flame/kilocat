import { useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { C } from "../theme.js";
import { r1 } from "../lib/util.js";
import { macroProfile } from "../lib/foods.js";

// The five guaranteed-analysis lines exactly as they read off a cat-food label, with their
// min/max qualifiers. Carbs (NFE) and the caloric split are DERIVED (see macroProfile), so they
// aren't entered — they show in the footer as you fill the label in.
const GA_ROWS = [
  ["protein", "Crude Protein", "min"],
  ["fat", "Crude Fat", "min"],
  ["fiber", "Crude Fiber", "max"],
  ["moisture", "Moisture", "max"],
  ["ash", "Ash", "max"],
];

// Compact right-aligned numeric cell — sits at the end of a label "leader" line.
function GANum({ value, onChange, label }) {
  return (
    <input
      type="number" step="0.1" value={value ?? ""} aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className="w-10 text-right bg-transparent outline-none font-mono text-xs tabular-nums"
      style={{ color: C.ink }}
    />
  );
}

// A guaranteed-analysis editor styled like the panel printed on a cat-food bag/can, so filling
// it in feels like copying the label. `onEditField(key, value)` writes one field; the caller
// decides where it lands (library.edit, ration onSet, …). The derived footer (carbs/caloric
// split/dry-matter) updates live from macroProfile.
export default function GuaranteedAnalysis({ food, onEditField, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const prof = macroProfile(food);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} style={{ color: open ? C.spruce : C.sub }} className="inline-flex items-center gap-1 text-xs font-mono">
        <FlaskConical size={12} /> Guaranteed analysis{prof ? "" : " — add"} {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {open && (
        <div style={{ borderColor: C.line }} className="mt-2 border rounded-lg overflow-hidden">
          <div style={{ background: C.paper, color: C.sub, borderColor: C.line }} className="text-[10px] font-mono uppercase tracking-[0.15em] px-3 py-1.5 border-b">
            Guaranteed Analysis
          </div>
          <div className="px-3 py-2 space-y-1">
            {GA_ROWS.map(([k, label, qual]) => (
              <div key={k} className="flex items-baseline gap-2 text-xs">
                <span style={{ color: C.ink }} className="whitespace-nowrap">{label} <span style={{ color: C.faint }}>({qual})</span></span>
                <span className="flex-1 border-b border-dotted mb-0.5" style={{ borderColor: C.line }} aria-hidden="true" />
                <span className="flex items-baseline shrink-0">
                  <GANum value={food[k]} onChange={(v) => onEditField(k, v)} label={`${label} percent`} />
                  <span style={{ color: C.faint }} className="font-mono ml-0.5">%</span>
                </span>
              </div>
            ))}
          </div>
          <div style={{ background: C.paper, borderColor: C.line }} className="border-t px-3 py-2 text-xs">
            {prof ? (
              <div style={{ color: C.sub }} className="leading-relaxed">
                <span className="font-mono">Carbs (NFE) ≈ {r1(prof.carb)}%</span>{" "}
                · Calories <b style={{ color: C.ink }}>{prof.caloric.protein}%</b> protein · <b style={{ color: C.ink }}>{prof.caloric.fat}%</b> fat · <b style={{ color: C.ink }}>{prof.caloric.carb}%</b> carb
                <div style={{ color: C.faint }} className="mt-0.5">Dry-matter: {prof.dryMatter.protein}% protein · {prof.dryMatter.fat}% fat · {prof.dryMatter.carb}% carb</div>
              </div>
            ) : (
              <span style={{ color: C.faint }}>Enter at least protein and fat to see carbs and the caloric split. Values are the as-fed percentages off the label.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
