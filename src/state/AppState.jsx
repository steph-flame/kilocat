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
  updateCatProfile as updateCatProfilePure, freshCatState, freshProfile, defaultTr, defaultExpSettings, resolveUnit,
} from "../lib/catStore.js";
import { toV2, migrateV1 } from "../lib/migrate.js";
import { login as lrLogin, listAllRobots as lrListAllRobots, syncWeights as lrSyncWeights, FIRST_SYNC_DAYS } from "../lib/litterRobot.js";

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
  // Weight display unit (kg/lb): shared across every cat (like skin/fridgeDays), not per-cat
  // data — used to live in each cat's expSettings. Defaults to "kg".
  const [unit, setUnitState] = useState("kg");
  const setUnit = (u) => { if (u === "kg" || u === "lb") setUnitState(u); };
  // Litter-Robot connection: shared, top-level (like skin/unit/fridgeDays), not per-cat —
  // one Whisker account's refresh token, which robot serial it's reading, and which cat's
  // weightLog it feeds. Null = not connected. Never stores the password, only this token.
  const [litterRobot, setLitterRobotState] = useState(null);

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
    let activeCatId;
    if (Object.keys(cats).length) {
      activeCatId = d.activeCatId && cats[d.activeCatId] ? d.activeCatId : Object.keys(cats)[0];
      setCatsState({ activeCatId, cats });
    }
    if (d.library) library.setFoods(dedupeFoods(ensureBuiltins(d.library.map(cleanFood))));
    if (typeof d.fridgeDays === "number") setFridgeDays(d.fridgeDays);
    if (typeof d.skin === "string" && SKINS[d.skin]) setSkinState(d.skin);
    const resolved = resolveUnit(d.unit, activeCatId && cats[activeCatId]?.expSettings?.unit);
    if (resolved) setUnitState(resolved);
    if (d.litterRobot !== undefined) setLitterRobotState(d.litterRobot);
  };

  // Import (user-picked file, Settings → Data): a v2 file is a full backup, so it replaces
  // every cat. A v1 file (a legacy single-cat export, or one made before this device had
  // other cats) is adopted as one NEW cat alongside whatever's already here, rather than
  // clobbering existing cats — "migrate on accept". Shared fields (library/fridgeDays) only
  // change if the file actually has them, so an old/partial file can't blank out the library.
  const importData = (raw) => {
    if (!raw || typeof raw !== "object") return;
    setHydrated(true);
    let newActiveCat; // the cat that becomes active by this import, if any — for the unit fallback below
    if (raw.v === 2) {
      const cats = catsFromV2(raw);
      if (Object.keys(cats).length) {
        const activeCatId = raw.activeCatId && cats[raw.activeCatId] ? raw.activeCatId : Object.keys(cats)[0];
        setCatsState({ activeCatId, cats });
        newActiveCat = cats[activeCatId];
      }
    } else {
      const migrated = migrateV1(raw);
      const newId = migrated.activeCatId;
      const rawCat = migrated.cats[newId];
      if (Object.keys(rawCat).length) { // a wholly-empty import has nothing to adopt
        const cat = sanitizeCat(rawCat);
        setCatsState((s) => ({ activeCatId: newId, cats: { ...s.cats, [newId]: cat } }));
        newActiveCat = cat;
      }
    }
    if (raw.library) library.setFoods(dedupeFoods(ensureBuiltins(raw.library.map(cleanFood))));
    if (typeof raw.fridgeDays === "number") setFridgeDays(raw.fridgeDays);
    if (typeof raw.skin === "string" && SKINS[raw.skin]) setSkinState(raw.skin);
    const resolved = resolveUnit(raw.unit, newActiveCat?.expSettings?.unit);
    if (resolved) setUnitState(resolved);
    if (raw.litterRobot !== undefined) setLitterRobotState(raw.litterRobot);
  };

  const persistData = { v: 2, activeCatId: catsState.activeCatId, cats: catsState.cats, library: library.foods, fridgeDays, skin, unit, litterRobot };
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
  // blank — callers show "unnamed cat"), a formatted age (or null — "age unknown"), the raw
  // dob/neutered (for Settings' profile editor), and how many weigh-ins it has logged.
  const catsSummary = Object.entries(catsState.cats).map(([id, cat]) => {
    const months = ageMonthsFromDob(cat.profile?.dob, today);
    const unit = cat.profile?.ageUnit || "months";
    return {
      id,
      name: (cat.profile?.name || "").trim(),
      dob: cat.profile?.dob || "",
      neutered: !!cat.profile?.neutered,
      ageDisplay: months == null ? null : unit === "years" ? `${r1(months / 12)} yr` : `${r1(months)} mo`,
      weighIns: (cat.weightLog || []).length,
      active: id === catsState.activeCatId,
    };
  });
  const switchCat = (id) => setCatsState((s) => switchCatPure(s, id));
  const addCat = () => setCatsState((s) => addCatPure(s));
  const deleteCat = (id) => setCatsState((s) => deleteCatPure(s, id));
  const clearCatHistory = (id) => setCatsState((s) => clearCatHistoryPure(s, id));
  const updateCatProfile = (id, patch) => setCatsState((s) => updateCatProfilePure(s, id, patch));

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
    setLitterRobotState(null);
  };

  // ---- Litter-Robot weight sync ----
  // Append parsed weigh-ins to a SPECIFIC cat's log by id — not necessarily the active cat,
  // since the connection's target cat (conn.catId) can differ from whichever cat is
  // currently being viewed. A thin sibling of makeLogView's add(), for an arbitrary cat.
  const appendWeightsToCat = (catId, entries) => {
    if (!entries.length) return;
    setCatsState((s) => (s.cats[catId]
      ? { ...s, cats: { ...s.cats, [catId]: { ...s.cats[catId], weightLog: [...s.cats[catId].weightLog, ...entries.map((e) => ({ id: uid(), ...e }))] } } }
      : s));
  };

  // One sync pass against a given connection: refresh the session, pull activity since its
  // last sync (or FIRST_SYNC_DAYS back on the very first sync), dedupe, append, and record
  // when it happened. Shared by the on-load background sync, "sync now", and the sync that
  // kicks off right after Connect. Never throws — callers get { ok, count, error }, for a
  // legible status in the UI instead of an unhandled rejection.
  const runLitterRobotSync = async (conn) => {
    if (!conn) return { ok: false };
    const cat = catsState.cats[conn.catId];
    if (!cat) return { ok: false, error: new Error("The cat this connection feeds no longer exists.") };
    const sinceMs = conn.lastSyncTs || Date.now() - FIRST_SYNC_DAYS * 86400000;
    try {
      const { entries, syncedAt, weightScale } = await lrSyncWeights({
        refreshToken: conn.refreshToken, serial: conn.serial, sinceMs, existingEntries: cat.weightLog, model: conn.model,
      });
      appendWeightsToCat(conn.catId, entries);
      // weightScale is only ever present for an LR5 sync (which unit interpretation won — see
      // parseWeightEventsLR5); once it sticks the first time, keep it even on a sync that
      // returns nothing new (an empty page shouldn't blank out an already-determined scale).
      setLitterRobotState((s) => (s ? { ...s, lastSyncTs: syncedAt, weightScale: weightScale ?? s.weightScale } : s));
      return { ok: true, count: entries.length };
    } catch (error) {
      return { ok: false, error };
    }
  };

  // Step 1 of Connect: log in with the owner's own credentials (used ONLY for this one
  // request — never stored) and list their robots, across BOTH generations (LR4 + LR5 — see
  // lib/litterRobot.js listAllRobots; either generation may legitimately be absent on a given
  // account). Returns the pieces Settings needs to show a robot picker; doesn't touch state
  // yet (nothing is "connected" until finish()).
  const connectLitterRobotStart = async (email, password) => {
    const { idToken, refreshToken, userId } = await lrLogin(email, password);
    const robots = await lrListAllRobots(idToken, userId);
    return { refreshToken, robots };
  };
  // Step 2: commit the connection (refresh token + chosen serial/model + target cat) and kick
  // off the first sync immediately. Returns that first sync's result so the UI can show it.
  const connectLitterRobotFinish = (refreshToken, serial, catId, model) => {
    const conn = { refreshToken, serial, catId, model, lastSyncTs: null };
    setLitterRobotState(conn);
    return runLitterRobotSync(conn);
  };
  // Wipes the token + connection only — already-imported weigh-ins stay in the cat's log
  // (they're indistinguishable from any other logged weight once they're in).
  const disconnectLitterRobot = () => setLitterRobotState(null);
  const syncLitterRobotNow = () => runLitterRobotSync(litterRobot);

  // Background sync on app load: once, if a connection already exists. Deliberately keyed
  // only on `loaded` (not on litterRobot/catsState) so it fires exactly once per session —
  // depending on the connection itself would re-fire every time lastSyncTs changes, i.e.
  // right after the sync it just ran.
  useEffect(() => {
    if (!loaded || !litterRobot) return;
    runLitterRobotSync(litterRobot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const value = {
    loaded, firstRun, storageOk, p, set, setFactor, ageUnit, ageDisplay, dobMissing, setBcs, setPct,
    today, currentWeight, logWeight,
    ration, start, library, weightLog, intakeLog, saveFood,
    tr, setTr, fridgeDays, setFridgeDays, expSettings, setExpSettings,
    skin, setSkin, unit, setUnit,
    t, expenditure,
    activeCatId: catsState.activeCatId, catsSummary, switchCat, addCat, deleteCat, clearCatHistory, updateCatProfile, eraseAll,
    exportData: () => JSON.stringify(persistData, null, 2),
    importData,
    litterRobot, connectLitterRobotStart, connectLitterRobotFinish, disconnectLitterRobot, syncLitterRobotNow,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
