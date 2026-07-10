import { Info, X } from "lucide-react";
import { C } from "../theme.js";
import { num } from "../lib/util.js";
import { kcalPerG, libEntry } from "../lib/foods.js";
import { Field, NumInput } from "./primitives.jsx";
import FoodSearch from "./FoodSearch.jsx";

/* ---------- one food row, used by every list ---------- */
export default function RationRow({ f, target, onSet, onSlidePct, onPrefill, onRemove, fridgeDays, searchFoods }) {
  const kpg = kcalPerG(f);
  const kcal = target * num(f.pct) / 100;
  const grams = kpg > 0 ? kcal / kpg : 0;
  const cans = f.mode === "perUnit" && num(f.kcalPerUnit) > 0 ? kcal / num(f.kcalPerUnit) : null;
  const cups = f.mode === "perKg" && num(f.gramsPerCup) > 0 ? grams / num(f.gramsPerCup) : null;
  const daysPerCan = f.mode === "perUnit" && kcal > 0 && num(f.kcalPerUnit) > 0 ? num(f.kcalPerUnit) / kcal : null;
  const overFridge = daysPerCan != null && fridgeDays && daysPerCan > fridgeDays + 0.05;
  const r0 = Math.round;
  const r1 = (n) => Math.round(n * 10) / 10;
  const modeFields = f.mode === "perKg"
    ? [["kcalPerKg", "Energy", "kcal/kg", "10"], ["gramsPerCup", "Grams per cup", "g (opt)", "1"]]
    : [["kcalPerUnit", "Energy per can", "kcal", "1"], ["gramsPerUnit", "Grams per can", "g", "1"]];
  return (
    <div style={{ borderColor: C.line }} className="border rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <FoodSearch
          value={f.name}
          search={searchFoods}
          onChangeName={(v) => onSet(f.id, "name", v)}
          onPick={(food) => onPrefill(f.id, libEntry(food))}
        />
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: C.line }}>
          {[["perKg", "dry / kcal·kg"], ["perUnit", "wet / kcal·can"]].map(([m, lbl]) => (
            <button key={m} onClick={() => onSet(f.id, "mode", m)} style={{ background: f.mode === m ? C.spruce : "transparent", color: f.mode === m ? "#fff" : C.sub }} className="text-xs px-2 py-1 font-mono">{lbl}</button>
          ))}
        </div>
        {onRemove && <button onClick={() => onRemove(f.id)} style={{ color: C.faint }} className="p-1"><X size={15} /></button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {modeFields.map(([k, lbl, suf, step]) => (
          <Field key={k} label={lbl} suffix={suf}><NumInput value={f[k]} onChange={(v) => onSet(f.id, k, v)} step={step} /></Field>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input type="range" min="0" max="100" step="1" value={num(f.pct)} onChange={(e) => (onSlidePct ? onSlidePct(f.id, Number(e.target.value)) : onSet(f.id, "pct", Number(e.target.value)))} className="flex-1" style={{ accentColor: C.amber }} />
        <div className="flex items-baseline gap-1">
          <input type="number" value={num(f.pct)} onChange={(e) => onSet(f.id, "pct", e.target.value === "" ? 0 : Number(e.target.value))} className="w-12 text-right bg-transparent outline-none font-mono text-sm tabular-nums" style={{ color: C.ink }} />
          <span style={{ color: C.faint }} className="font-mono text-sm">%</span>
        </div>
      </div>
      <div style={{ background: C.spruceSoft }} className="mt-3 rounded-lg px-3 py-2 flex items-baseline justify-between">
        <span style={{ color: C.spruce }} className="font-mono text-lg font-semibold tabular-nums">{r0(grams)} g</span>
        <span style={{ color: C.sub }} className="font-mono text-xs">{r0(kcal)} kcal{cans != null && <> · {r1(cans)} can{r1(cans) === 1 ? "" : "s"}</>}{cups != null && <> · {r1(cups)} cup{r1(cups) === 1 ? "" : "s"}</>}</span>
      </div>
      {daysPerCan != null && (
        <div className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: overFridge ? C.amber : C.faint }}>
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>1 can ≈ {r1(daysPerCan)} days at this portion.{overFridge && <> That outlasts the ~{fridgeDays}-day fridge window — start a fresh can by day {fridgeDays} and discard the rest (~{r0((1 - fridgeDays / daysPerCan) * 100)}% wasted). A smaller can wastes less.</>}</span>
        </div>
      )}
    </div>
  );
}
