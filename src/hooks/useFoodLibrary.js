import { useState } from "react";
import { upsertFood, searchFoods } from "../lib/foods.js";

// The saved-food library: a persistent, editable set of foods that powers search
// when adding a food. Seeded from the built-in list; grows as you enter foods.
export function useFoodLibrary(makeInitial) {
  const [foods, setFoods] = useState(makeInitial);
  return {
    foods, setFoods,
    // Auto-save: insert or refresh by name. Idempotent, so calling it repeatedly
    // as a row settles is safe.
    upsert: (entry) => setFoods((fs) => upsertFood(fs, entry)),
    upsertMany: (entries) => setFoods((fs) => entries.reduce(upsertFood, fs)),
    // Editing a saved food in place — the reason the library is real state, not a
    // derived view of the rations.
    edit: (id, patch) => setFoods((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f))),
    remove: (id) => setFoods((fs) => fs.filter((f) => f.id !== id)),
    reset: () => setFoods(makeInitial()),
    search: (query) => searchFoods(foods, query),
  };
}
