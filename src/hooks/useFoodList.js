import { useState } from "react";
import { sumPct, blankFood, normalizePct, waterfall } from "../lib/foods.js";

// One hook for any editable food list: state + every operation the ration and the
// start blend share.
export function useFoodList(makeInitial) {
  const [items, setItems] = useState(makeInitial);
  return {
    items, setItems,
    sum: sumPct(items),
    reset: () => setItems(makeInitial()),
    setField: (id, k, v) => setItems((fs) => fs.map((f) => (f.id === id ? { ...f, [k]: v } : f))),
    add: () => setItems((fs) => [...fs, blankFood()]),
    remove: (id) => setItems((fs) => fs.filter((f) => f.id !== id)),
    normalize: () => setItems((fs) => normalizePct(fs)),
    slide: (id, raw) => setItems((fs) => waterfall(fs, id, raw)),
    patch: (id, obj) => setItems((fs) => fs.map((f) => (f.id === id ? { ...f, ...obj } : f))),
  };
}
