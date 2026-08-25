import { useState } from "react";
import { upsertFood, searchFoods, foodKey } from "../lib/foods.js";

// The saved-food library: a persistent, editable set of foods that powers search when adding a
// food. Seeded from the built-in list; grows as you enter foods.
//
// `deleted` is the library's tombstone map, { foodKey: deletedAtMs } — the same discipline as
// deletedCats/deletedEntries (see lib/mergeData.js). It exists because removal alone doesn't
// stick: ensureBuiltins re-adds any "missing" built-in on load, and the library merge is a union,
// so without a record that the removal was ON PURPOSE, every deleted food came back — by the next
// morning locally, or from any other device on sync. Re-adding a food clears its tombstone (and
// upsertFood stamps modAt, which is what outruns a stale tombstone on OTHER devices); reset
// clears them all, since "give me the starter list back" includes the ones deleted.
export function useFoodLibrary(makeInitial) {
  const [foods, setFoods] = useState(makeInitial);
  const [deleted, setDeleted] = useState({});
  const clearTombstone = (name) => setDeleted((d) => {
    const k = foodKey(name);
    if (!(k in d)) return d;
    const next = { ...d }; delete next[k]; return next;
  });
  return {
    foods, setFoods, deleted, setDeleted,
    // Auto-save: insert or refresh by name. Idempotent, so calling it repeatedly as a row
    // settles is safe.
    upsert: (entry) => { setFoods((fs) => upsertFood(fs, entry)); clearTombstone(entry.name); },
    upsertMany: (entries) => { setFoods((fs) => entries.reduce((a, e) => upsertFood(a, e), fs)); entries.forEach((e) => clearTombstone(e.name)); },
    // Editing a saved food in place — the reason the library is real state, not a derived view
    // of the rations. Stamps modAt: an edit is live evidence the food exists, and it's what a
    // merge weighs against a deletion from elsewhere (see lib/mergeData.js's isFoodVisible).
    edit: (id, patch) => setFoods((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch, modAt: Date.now() } : f))),
    // Tombstone from the render's own list, not inside the setFoods updater — updaters can run
    // twice (StrictMode) and must stay pure.
    remove: (id) => {
      const f = foods.find((x) => x.id === id);
      if (f) setDeleted((d) => ({ ...d, [foodKey(f.name)]: Date.now() }));
      setFoods((fs) => fs.filter((x) => x.id !== id));
    },
    reset: () => { setFoods(makeInitial()); setDeleted({}); },
    search: (query) => searchFoods(foods, query),
  };
}
