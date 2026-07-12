// Weight unit conversion. Everything is stored and modeled in kg (the RER formula is
// defined in kg); this is a display/entry layer only.

export const LB_PER_KG = 2.2046226218;
const round5 = (n) => Math.round(n / 5) * 5;
export { round5 };

// kg → the display unit's value.
export const toDisplayWeight = (kg, unit) => (unit === "lb" ? kg * LB_PER_KG : kg);
// a value the user typed in the display unit → kg for storage.
export const fromDisplayWeight = (v, unit) => (unit === "lb" ? v / LB_PER_KG : v);

export const weightLabel = (unit) => (unit === "lb" ? "lb" : "kg");

// A weekly rate of change (kg/week, signed) → a friendly {value, unit} for the unit system:
// grams/week in metric, ounces/week in imperial (small changes read better than lb/week).
export function weeklyRate(kgPerWeek, unit) {
  if (unit === "lb") return { value: Math.abs(kgPerWeek) * LB_PER_KG * 16, unit: "oz/wk" };
  return { value: Math.abs(kgPerWeek) * 1000, unit: "g/wk" };
}
