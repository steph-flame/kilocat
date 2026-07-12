import { createContext, useContext, useMemo, useState } from "react";
import { num, r1 } from "../lib/util.js";
import { computeTargets, seedProfile, bcsToPct, pctToBcs } from "../lib/nutrition.js";
import { makeRationSeed, makeStartSeed, makeLibrarySeed, toLibraryEntry, dedupeFoods, stripKind, canonicalFoodName, migrateLegacyFood, ensureBuiltins } from "../lib/foods.js";
import { estimateExpenditure, kalmanEstimateExpenditure, ucEstimateExpenditure } from "../lib/expenditure.js";
import { usePersistence, store } from "../lib/storage.js";
import { useFoodList } from "../hooks/useFoodList.js";
import { useFoodLibrary } from "../hooks/useFoodLibrary.js";
import { useLog } from "../hooks/useLog.js";

const defaultTr = () => ({ on: false, days: 7, timelineUnit: "g" });
const defaultExpSettings = () => ({ pctPerWeek: 1, energyBasis: "formula", algo: "v3", unit: "kg", direction: "auto" });

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Owns every piece of persisted state and the values derived from it. Pages are pure views
// over this. Persistence and semantics stay in their own modules; this just wires them.
export function AppProvider({ children }) {
  const [p, setP] = useState(seedProfile);
  const ration = useFoodList(makeRationSeed);
  const start = useFoodList(makeStartSeed);
  const library = useFoodLibrary(makeLibrarySeed);
  const weightLog = useLog();
  const intakeLog = useLog();
  const [tr, setTr] = useState(defaultTr);
  const [fridgeDays, setFridgeDays] = useState(3);
  const [expSettings, setExpSettingsRaw] = useState(defaultExpSettings);

  const loaded = usePersistence(
    { profile: p, ration: ration.items, start: start.items, library: library.foods,
      weightLog: weightLog.items, intakeLog: intakeLog.items, tr, fridgeDays, expSettings },
    (d) => {
      // Clean up legacy food data on load: strip "(dry)"/"(wet)", snap macro-identical
      // near-duplicates to their canonical built-in name, and retire the generic Tiki.
      const cleanName = (f) => (f.name == null ? f : { ...f, name: stripKind(f.name) });
      const cleanFood = (f) => { const s = cleanName(f); return s.name == null ? s : migrateLegacyFood({ ...s, name: canonicalFoodName(s) }); };
      if (d.profile) setP(d.profile);
      if (d.ration) ration.setItems(d.ration.map(cleanFood));
      if (d.start) start.setItems(d.start.map(cleanFood));
      if (d.library) library.setFoods(dedupeFoods(ensureBuiltins(d.library.map(cleanFood)))); // merge dupes + pick up new built-ins
      if (d.weightLog) weightLog.setItems(d.weightLog);
      if (d.intakeLog) intakeLog.setItems(d.intakeLog.map(cleanName));
      if (d.tr) setTr(d.tr);
      if (typeof d.fridgeDays === "number") setFridgeDays(d.fridgeDays);
      if (d.expSettings) setExpSettingsRaw({ ...defaultExpSettings(), ...d.expSettings });
    }
  );

  // Foods enter the library only on an explicit save click (see saveFood) — never
  // automatically, so typing a food doesn't silently accumulate library entries.
  const saveFood = (f) => library.upsert(toLibraryEntry(f));

  const t = useMemo(() => computeTargets(p), [p]);
  const expenditure = useMemo(() => {
    const w = weightLog.items.map((e) => ({ date: e.date, value: e.kg, method: e.method }));
    const i = intakeLog.items.map((e) => ({ date: e.date, value: e.kcal }));
    const opts = { priorKcal: t.refs.maintain }; // cold-start the filter prior from the vet formula
    if (expSettings.algo === "v1") return estimateExpenditure(w, i, opts);
    if (expSettings.algo === "v2") return kalmanEstimateExpenditure(w, i, opts);
    return ucEstimateExpenditure(w, i, opts); // v3 (default)
  }, [weightLog.items, intakeLog.items, expSettings.algo, t.refs.maintain]);

  // Profile helpers (unchanged semantics, just centralized).
  const ageUnit = p.ageUnit || "months";
  const ageDisplay = ageUnit === "years" ? r1(num(p.ageMonths) / 12) : num(p.ageMonths);
  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));
  const setFactor = (k, v) => setP((s) => ({ ...s, factors: { ...s.factors, [k]: v } }));
  const setAgeDisplay = (v) => set("ageMonths", ageUnit === "years" ? num(v) * 12 : num(v));
  const setBcs = (v) => setP((s) => ({ ...s, bcs: v, pctOver: bcsToPct(v) }));
  const setPct = (v) => setP((s) => ({ ...s, pctOver: v, bcs: pctToBcs(v) }));
  const setExpSettings = (patch) => setExpSettingsRaw((s) => ({ ...s, ...patch }));
  const reset = () => {
    store.clear();
    setP(seedProfile); ration.reset(); start.reset(); library.reset();
    weightLog.reset(); intakeLog.reset();
    setTr(defaultTr()); setFridgeDays(3); setExpSettingsRaw(defaultExpSettings());
  };

  const value = {
    loaded, p, set, setFactor, ageUnit, ageDisplay, setAgeDisplay, setBcs, setPct, reset,
    ration, start, library, weightLog, intakeLog, saveFood,
    tr, setTr, fridgeDays, setFridgeDays, expSettings, setExpSettings,
    t, expenditure,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
