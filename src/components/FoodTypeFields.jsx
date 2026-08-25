import { A, TYPE } from "../almanac.js";
import { foodType, kcalPerG, treatEnergy } from "../lib/foods.js";

// What a food IS, and the two energy figures that follow from that. Shared by the Ration row's
// details panel and the Foods page, because they were never actually different questions — and a
// second copy is how the Foods page came to offer only wet and dry, silently losing treats and
// supplements from anywhere but the ration.
//
// TYPE vs MODE. Type is what the thing is; mode is how it's measured, and it follows from the type
// rather than being asked separately: kibble comes by weight (perKg), everything else comes by the
// can/treat/sachet (perUnit). Keeping mode derived is what stops a food from claiming to be a treat
// priced by the kilogram, which nothing downstream knows how to feed.

export const TYPES = [["wet", "wet"], ["dry", "dry"], ["treat", "treat"], ["supplement", "supp"]];

export const ENERGY_FIELDS = {
  dry: [["kcalPerKg", "Energy", "kcal/kg"], ["gramsPerCup", "Grams / cup", "g"]],
  wet: [["kcalPerUnit", "Energy / can", "kcal"], ["gramsPerUnit", "Grams / can", "g"]],
  // Treats: enter exactly what's on the package — calories per treat AND calories per kg. The
  // treat's weight (gramsPerUnit) is derived from those, not entered.
  treat: [["kcalPerUnit", "Calories / treat", "kcal"], ["kcalPerKg", "Calories / kg", "kcal/kg"]],
  // Supplements (a probiotic sachet, a powder): given by the sachet/scoop — calories and grams per.
  supplement: [["kcalPerUnit", "Calories / sachet", "kcal"], ["gramsPerUnit", "Grams / sachet", "g"]],
};

// The patch that changes a food's type: the mode moves with it, or the energy fields on screen stop
// matching the ones the food actually stores.
export const typePatch = (ty) => ({ type: ty, mode: ty === "dry" ? "perKg" : "perUnit" });

const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });

export function TypePicker({ food, onPatch, name }) {
  const type = foodType(food);
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {TYPES.map(([ty, lbl]) => {
        const on = type === ty;
        return (
          <button key={ty} onClick={() => onPatch(typePatch(ty))} aria-pressed={on}
            aria-label={`${name || food?.name || "food"} is ${ty === "supplement" ? "a supplement" : ty === "treat" ? "a treat" : `${ty} food`}`}
            style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "4px 12px", cursor: "pointer",
              border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? A.ink : "transparent", color: on ? A.card : A.body }}>{lbl}</button>
        );
      })}
    </div>
  );
}

export function EnergyFields({ food, onPatch }) {
  const type = foodType(food);
  // For treats, changing calories/treat or calories/kg re-derives the treat's weight (gramsPerUnit)
  // so grams throughout the app still work — the owner only ever types what's on the package.
  const change = (k, v) => {
    if (type !== "treat") return onPatch({ [k]: v });
    const next = { ...food, [k]: v };
    onPatch({ [k]: v, gramsPerUnit: treatEnergy({ kcalPerTreat: next.kcalPerUnit, kcalPerKg: next.kcalPerKg }).gramsPerUnit });
  };
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        {ENERGY_FIELDS[type].map(([k, lbl, suf]) => (
          <label key={k} style={{ display: "block" }}>
            <span style={label({ fontSize: 10 })}>{lbl}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 3 }}>
              <input type="number" step="any" min="0" value={food[k] ?? ""} onChange={(e) => change(k, e.target.value === "" ? "" : Number(e.target.value))}
                aria-label={lbl} style={{ width: "100%", fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, padding: "2px 0" }} />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>{suf}</span>
            </div>
          </label>
        ))}
      </div>
      {type === "treat" && kcalPerG(food) > 0 && (
        <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 8 }}>≈ {Number((food.gramsPerUnit || 0).toFixed(2))} g per treat · worked out from the label</div>
      )}
    </>
  );
}
