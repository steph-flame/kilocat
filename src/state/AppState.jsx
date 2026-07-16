import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { num, r1, uid, clamp } from "../lib/util.js";
import { applySkin, DEFAULT_SKIN, SKINS } from "../theme.js";
import { computeTargets, seedProfile, bcsToPct, pctToBcs, ageMonthsFromDob, effectiveAgeMonths } from "../lib/nutrition.js";
import {
  makeRationSeed, makeStartSeed, makeLibrarySeed, toLibraryEntry, dedupeFoods, stripKind, canonicalFoodName,
  migrateLegacyFood, ensureBuiltins, sumPct, blankFood, normalizePct, waterfall,
} from "../lib/foods.js";
import { estimateExpenditure, kalmanEstimateExpenditure, ucEstimateExpenditure, WEIGH_SOURCES, DEFAULT_METHOD } from "../lib/expenditure.js";
import { groupByDay, median } from "../lib/series.js";
import { usePersistence, store, probeStorage } from "../lib/storage.js";
import { useFoodLibrary } from "../hooks/useFoodLibrary.js";
import {
  addCat as addCatPure, deleteCat as deleteCatPure, clearCatHistory as clearCatHistoryPure, switchCat as switchCatPure,
  freshCatState, freshProfile, defaultTr, defaultExpSettings,
} from "../lib/catStore.js";
import { toV2, migrateV1 } from "../lib/migrate.js";

// Clean up legacy food data: strip "(dry)"/"(wet)", snap macro-identical near-dupes to their
// canonical built-in name, and retire the generic Tiki. Pure — used on load and on import.
const cleanName = (f) => (f.name == null ? f : { ...f, name: stripKind(f.name) });
const cleanFood = (f) => { const s = cleanName(f); return s.name == null ? s : migrateLegacyFood({ ...s, name: canonicalFoodName(s) }); };

// A freshly-installed app shows one demo cat (Mithril) — the existing seed data, wrapped as
// a cat. addCat()/deleteCat()'s replacement cat are deliberately NOT this: see freshCatState.
const makeInitialCatsState = () => {
  const id = uid();
  return {
    activeCatId: id,
    cats: {
      [id]: {
        profile: seedProfile, ration: makeRationSeed(), start: makeStartSeed(),
        weightLog: [], intakeLog: [], tr: defaultTr(), expSettings: defaultExpSettings(),
      },
    },
  };
};

// Fill in a per-cat record from (possibly partial/imported) data, defaulting anything
// missing and running the food cleanup on every food-shaped field.
const sanitizeCat = (cat) => ({
  profile: cat?.profile ?? freshProfile(),
  ration: (cat?.ration || []).map(cleanFood),
  start: (cat?.start || []).map(cleanFood),
  weightLog: cat?.weightLog || [],
  intakeLog: (cat?.intakeLog || []).map(cleanName),
  tr: cat?.tr || defaultTr(),
  expSettings: { ...defaultExpSettings(), ...(cat?.expSettings || {}) },
});

const catsFromV2 = (d) => {
  const cats = {};
  for (const [id, cat] of Object.entries(d.cats || {})) cats[id] = sanitizeCat(cat);
  return cats;
};

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Owns every piece of persisted state and the values derived from it. Pages are pure views
// over this. Persistence and semantics stay in their own modules; this just wires them.
//
// State is multi-cat: `catsState` holds { activeCatId, cats: { [id]: <per-cat state> } }.
// Everything below (profile, ration/start, weightLog/intakeLog, tr, expSettings, and every
// derived value) reads/writes the ACTIVE cat only — pages don't know cats exist, they just
// see the same flattened `p`/`ration`/`weightLog`/etc. surface as before multi-cat.
// Food library + fridgeDays are the two things genuinely shared across cats, so they stay
// their own top-level state (unchanged from before multi-cat).
export function AppProvider({ children }) {
  const [catsState, setCatsState] = useState(makeInitialCatsState);
  const library = useFoodLibrary(makeLibrarySeed);
  const [fridgeDays, setFridgeDays] = useState(3);
  const [hydrated, setHydrated] = useState(false); // did we load real saved data (vs. seed defaults)?
  const [storageOk] = useState(probeStorage);
  // Appearance skin: shared across every cat (like fridgeDays), not per-cat data. Defaults
  // to "original" and is tolerant of missing/unknown values on load/import (see hydrate,
  // importData) — an older export simply keeps whatever's already active.
  const [skin, setSkinState] = useState(DEFAULT_SKIN);
  const setSkin = (name) => { if (SKINS[name]) setSkinState(name); };
  useEffect(() => { applySkin(skin); }, [skin]);

  const activeCat = catsState.cats[catsState.activeCatId];
  const updateActiveCat = (fn) =>
    setCatsState((s) => ({ ...s, cats: { ...s.cats, [s.activeCatId]: fn(s.cats[s.activeCatId]) } }));

  // Load: the stored blob is our own — always a whole snapshot (v1 legacy or v2). Migrate
  // v1 → v2 (see lib/migrate.js) then adopt it wholesale.
  const hydrate = (raw) => {
    if (!raw || typeof raw !== "object") return;
    setHydrated(true);
    const d = toV2(raw);
    const cats = catsFromV2(d);
    if (Object.keys(cats).length) {
      const activeCatId = d.activeCatId && cats[d.activeCatId] ? d.activeCatId : Object.keys(cats)[0];
      setCatsState({ activeCatId, cats });
    }
    if (d.library) library.setFoods(dedupeFoods(ensureBuiltins(d.library.map(cleanFood))));
    if (typeof d.fridgeDays === "number") setFridgeDays(d.fridgeDays);
    if (typeof d.skin === "string" && SKINS[d.skin]) setSkinState(d.skin);
  };

  // Import (user-picked file, Settings → Data): a v2 file is a full backup, so it replaces
  // every cat. A v1 file (a legacy single-cat export, or one made before this device had
  // other cats) is adopted as one NEW cat alongside whatever's already here, rather than
  // clobbering existing cats — "migrate on accept". Shared fields (library/fridgeDays) only
  // change if the file actually has them, so an old/partial file can't blank out the library.
  const importData = (raw) => {
    if (!raw || typeof raw !== "object") return;
    setHydrated(true);
    if (raw.v === 2) {
      const cats = catsFromV2(raw);
      if (Object.keys(cats).length) {
        const activeCatId = raw.activeCatId && cats[raw.activeCatId] ? raw.activeCatId : Object.keys(cats)[0];
        setCatsState({ activeCatId, cats });
      }
    } else {
      const migrated = migrateV1(raw);
      const newId = migrated.activeCatId;
      const rawCat = migrated.cats[newId];
      if (Object.keys(rawCat).length) { // a wholly-empty import has nothing to adopt
        const cat = sanitizeCat(rawCat);
        setCatsState((s) => ({ activeCatId: newId, cats: { ...s.cats, [newId]: cat } }));
      }
    }
    if (raw.library) library.setFoods(dedupeFoods(ensureBuiltins(raw.library.map(cleanFood))));
    if (typeof raw.fridgeDays === "number") setFridgeDays(raw.fridgeDays);
    if (typeof raw.skin === "string" && SKINS[raw.skin]) setSkinState(raw.skin);
  };

  const persistData = { v: 2, activeCatId: catsState.activeCatId, cats: catsState.cats, library: library.foods, fridgeDays, skin };
  const loaded = usePersistence(persistData, hydrate);
  const firstRun = loaded && !hydrated; // showing seed defaults, no saved data yet

  // Foods enter the library only on an explicit save click (see saveFood) — never
  // automatically, so typing a food doesn't silently accumulate library entries.
  const saveFood = (f) => library.upsert(toLibraryEntry(f));

  const p = activeCat.profile;
  const setP = (updater) => updateActiveCat((cat) => ({ ...cat, profile: typeof updater === "function" ? updater(cat.profile) : updater }));

  // Editable food list (the ration, the start blend) scoped to the active cat — same
  // {items, setItems, sum, setField, add, remove, normalize, slide, patch} shape the pages
  // already expect (previously from useFoodList).
  const makeListView = (field) => {
    const items = activeCat[field];
    const setItems = (updater) => updateActiveCat((cat) => ({ ...cat, [field]: typeof updater === "function" ? updater(cat[field]) : updater }));
    return {
      items, setItems,
      sum: sumPct(items),
      setField: (id, k, v) => setItems((fs) => fs.map((f) => (f.id === id ? { ...f, [k]: v } : f))),
      add: () => setItems((fs) => [...fs, blankFood()]),
      remove: (id) => setItems((fs) => fs.filter((f) => f.id !== id)),
      normalize: () => setItems((fs) => normalizePct(fs)),
      slide: (id, raw) => setItems((fs) => waterfall(fs, id, raw)),
      patch: (id, obj) => setItems((fs) => fs.map((f) => (f.id === id ? { ...f, ...obj } : f))),
    };
  };
  const ration = makeListView("ration");
  const start = makeListView("start");

  // Generic dated-entry log (weight log, intake log) scoped to the active cat — same
  // {items, setItems, add, edit, remove} shape as before (previously from useLog).
  const makeLogView = (field) => {
    const items = activeCat[field];
    const setItems = (updater) => updateActiveCat((cat) => ({ ...cat, [field]: typeof updater === "function" ? updater(cat[field]) : updater }));
    return {
      items, setItems,
      add: (entry) => setItems((xs) => [...xs, { id: uid(), ...entry }]),
      edit: (id, patch) => setItems((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e))),
      remove: (id) => setItems((xs) => xs.filter((e) => e.id !== id)),
    };
  };
  const weightLog = makeLogView("weightLog");
  const intakeLog = makeLogView("intakeLog");

  const tr = activeCat.tr;
  const setTr = (updater) => updateActiveCat((cat) => ({ ...cat, tr: typeof updater === "function" ? updater(cat.tr) : updater }));
  const expSettings = activeCat.expSettings;
  const setExpSettings = (patch) => updateActiveCat((cat) => ({ ...cat, expSettings: { ...cat.expSettings, ...patch } }));

  // Permanent vs. logged state. Age derives from date of birth (so it never goes stale);
  // with no dob to derive it from, the cat is treated as an adult (never a fabricated
  // newborn — see effectiveAgeMonths) and dobMissing tells the UI to prompt for it instead
  // of showing a made-up age. The current weight the feeding math runs on is the latest
  // weigh-in — not a hand-typed number that can silently disagree with the log — falling
  // back to the seeded profile weight before the first weigh-in.
  const today = new Date().toISOString().slice(0, 10);
  const dobMissing = ageMonthsFromDob(p.dob, today) == null;
  const effAgeMonths = effectiveAgeMonths(p.dob, today);
  const weightDays = groupByDay(weightLog.items); // newest day first
  const currentWeight = weightDays.length
    ? { kg: median(weightDays[0].items.map((e) => num(e.kg))), date: weightDays[0].date, fromLog: true }
    : { kg: num(p.weightKg), date: null, fromLog: false };
  const logWeight = ({ kg, method }) =>
    weightLog.add({ date: today, kg, method: method || expSettings.lastMethod || DEFAULT_METHOD, source: WEIGH_SOURCES.manual });

  const t = useMemo(() => computeTargets({ ...p, ageMonths: effAgeMonths, weightKg: currentWeight.kg }), [p, effAgeMonths, currentWeight.kg]);
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
  const ageDisplay = dobMissing ? null : ageUnit === "years" ? r1(effAgeMonths / 12) : r1(effAgeMonths); // never a fabricated age
  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));
  const setFactor = (k, v) => setP((s) => ({ ...s, factors: { ...s.factors, [k]: v } }));
  const setBcs = (v) => setP((s) => ({ ...s, bcs: v, pctOver: bcsToPct(v), bcAsOf: today }));
  const setPct = (v) => { const cv = clamp(num(v), -60, 100); setP((s) => ({ ...s, pctOver: cv, bcs: pctToBcs(cv), bcAsOf: today })); }; // clamp: a wild % → absurd ideal weight → overfeed

  // One row per cat for the Settings "Cats" list / header switcher: id, display name (or
  // blank — callers show "unnamed cat"), a formatted age (or null — "age unknown"), and how
  // many weigh-ins it has logged.
  const catsSummary = Object.entries(catsState.cats).map(([id, cat]) => {
    const months = ageMonthsFromDob(cat.profile?.dob, today);
    const unit = cat.profile?.ageUnit || "months";
    return {
      id,
      name: (cat.profile?.name || "").trim(),
      ageDisplay: months == null ? null : unit === "years" ? `${r1(months / 12)} yr` : `${r1(months)} mo`,
      weighIns: (cat.weightLog || []).length,
      active: id === catsState.activeCatId,
    };
  });
  const switchCat = (id) => setCatsState((s) => switchCatPure(s, id));
  const addCat = () => setCatsState((s) => addCatPure(s));
  const deleteCat = (id) => setCatsState((s) => deleteCatPure(s, id));
  const clearCatHistory = (id) => setCatsState((s) => clearCatHistoryPure(s, id));

  // Global "erase all" — wipes every cat, the saved-food library, and fridgeDays back to a
  // single fresh blank cat + the built-in food list. Not the seed demo cat: a user who's
  // deliberately erasing everything on a deployed app shouldn't have a stranger's example
  // cat (Mithril) resurface.
  const eraseAll = () => {
    store.clear();
    const id = uid();
    setCatsState({ activeCatId: id, cats: { [id]: freshCatState() } });
    library.reset();
    setFridgeDays(3);
  };

  const value = {
    loaded, firstRun, storageOk, p, set, setFactor, ageUnit, ageDisplay, dobMissing, setBcs, setPct,
    today, currentWeight, logWeight,
    ration, start, library, weightLog, intakeLog, saveFood,
    tr, setTr, fridgeDays, setFridgeDays, expSettings, setExpSettings,
    skin, setSkin,
    t, expenditure,
    activeCatId: catsState.activeCatId, catsSummary, switchCat, addCat, deleteCat, clearCatHistory, eraseAll,
    exportData: () => JSON.stringify(persistData, null, 2),
    importData,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
