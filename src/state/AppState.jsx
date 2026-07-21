import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { num, r1, uid, clamp } from "../lib/util.js";
import { applySkin, DEFAULT_SKIN, SKINS } from "../theme.js";
import { computeTargets, bcsToPct, pctToBcs, ageMonthsFromDob, effectiveAgeMonths } from "../lib/nutrition.js";
import {
  makeLibrarySeed, toLibraryEntry, dedupeFoods, stripKind, canonicalFoodName,
  migrateLegacyFood, ensureBuiltins, sumPct, blankFood, normalizePct, waterfall,
} from "../lib/foods.js";
import { estimateExpenditure, kalmanEstimateExpenditure, ucEstimateExpenditure, WEIGH_SOURCES, DEFAULT_METHOD } from "../lib/expenditure.js";
import { groupByDay, median, localDateOf, manualWeighInStamp, patchEntry, repairWeighInDate } from "../lib/series.js";
import { usePersistence, store, probeStorage } from "../lib/storage.js";
import { useFoodLibrary } from "../hooks/useFoodLibrary.js";
import {
  addCat as addCatPure, deleteCat as deleteCatPure, clearCatHistory as clearCatHistoryPure, switchCat as switchCatPure,
  updateCatProfile as updateCatProfilePure, updateActiveCatState, freshCatState, freshProfile, defaultTr, defaultExpSettings, resolveUnit, resolveEstimator, DEMO_CAT_ID,
} from "../lib/catStore.js";
import { buildDemoCat } from "../lib/demoCat.js";
import { toV2, migrateV1 } from "../lib/migrate.js";
import { mergeV2 } from "../lib/mergeData.js";
import {
  login as lrLogin, listAllRobots as lrListAllRobots, listPets as lrListPets,
  syncAllWeights as lrSyncAllWeights, migrateConnection, autoMatchPetsByName, FIRST_SYNC_DAYS,
} from "../lib/litterRobot.js";

// Clean up legacy food data: strip "(dry)"/"(wet)", snap macro-identical near-dupes to their
// canonical built-in name, and retire the generic Tiki. Pure — used on load and on import.
const cleanName = (f) => (f.name == null ? f : { ...f, name: stripKind(f.name) });
const cleanFood = (f) => { const s = cleanName(f); return s.name == null ? s : migrateLegacyFood({ ...s, name: canonicalFoodName(s) }); };

// A freshly-installed app has NO real cats at all — just Biscuit, the virtual demo cat (see
// lib/demoCat.js), active by default. Biscuit is never a key in `cats`; it's generated on the
// fly from `today` (see the demoCat useMemo below) and never persisted. addCat()/deleteCat()'s
// replacement cat are a real, blank cat instead — see freshCatState.
const makeInitialCatsState = () => ({ activeCatId: DEMO_CAT_ID, cats: {} });

// Fill in a per-cat record from (possibly partial/imported) data, defaulting anything
// missing and running the food cleanup on every food-shaped field.
const sanitizeCat = (cat) => ({
  profile: cat?.profile ?? freshProfile(),
  ration: (cat?.ration || []).map(cleanFood),
  start: (cat?.start || []).map(cleanFood),
  // repairWeighInDate: self-heals any weigh-in whose stored `date` was UTC-derived (from
  // before `today` below was fixed to local) and now disagrees with its own `ts` — see
  // lib/series.js. Entries with no `ts` (backfilled/future-dated) pass through untouched.
  weightLog: (cat?.weightLog || []).map(repairWeighInDate),
  intakeLog: (cat?.intakeLog || []).map(cleanName),
  intakeDayStatus: cat?.intakeDayStatus || {},
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
  const [storageOk] = useState(probeStorage);
  // Today's date, computed once per render — everything below (ages, the demo cat's
  // generated history, "current weight") derives from this rather than a stored value, so
  // none of it ever goes stale. LOCAL day (see lib/series.js localDateOf), not UTC — a
  // UTC-sliced string flips to tomorrow every evening in a UTC-negative timezone, which used
  // to wrongly stamp intake, misalign the demo cat/ages, and (worst) make the expenditure
  // estimator's excludeDay exclude the wrong day, re-admitting today's still-running intake
  // total as if it were a complete day.
  const today = localDateOf(Date.now());
  // Biscuit, the virtual demo cat: regenerated whenever `today` changes (at most once a day),
  // never stored. See lib/demoCat.js for the generator and AppState's module banner above for
  // why it's never a key in `catsState.cats`.
  const demoCat = useMemo(() => buildDemoCat(today), [today]);
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
  // Expenditure estimator (v1/v2/v3): shared across every cat (like unit/skin/fridgeDays),
  // not per-cat data — used to live in each cat's expSettings.algo. Defaults to "v3", the
  // recommended unobserved-components estimator (see lib/expenditure.js).
  const [estimator, setEstimatorState] = useState("v3");
  const setEstimator = (a) => { if (a === "v1" || a === "v2" || a === "v3") setEstimatorState(a); };
  // Litter-Robot connection: shared, top-level (like skin/unit/fridgeDays), not per-cat —
  // one Whisker account's refresh token, which robot serial it's reading, and which cat's
  // weightLog it feeds. Null = not connected. Never stores the password, only this token.
  const [litterRobot, setLitterRobotState] = useState(null);

  // Biscuit is never a key in `cats` — it's generated above, not stored — so the active cat
  // is either that generated stand-in or a real lookup into `cats`.
  const activeCat = catsState.activeCatId === DEMO_CAT_ID ? demoCat : catsState.cats[catsState.activeCatId];
  // The ONE seam every per-cat mutation (profile edits, ration/start, weigh-ins, intake, tr,
  // expSettings — see setP/makeListView/makeLogView/setTr/setExpSettings below) funnels
  // through. No-op while Biscuit is active: her data is regenerated fresh every time, so any
  // "edit" would just be silently discarded on the next render anyway — this makes that
  // explicit instead of writing a `cats[DEMO_CAT_ID]` entry into real state.
  const updateActiveCat = (fn) => setCatsState((s) => updateActiveCatState(s, fn));

  // Load: the stored blob is our own — always a whole snapshot (v1 legacy or v2). Migrate
  // v1 → v2 (see lib/migrate.js) then adopt it wholesale.
  const hydrate = (raw) => {
    if (!raw || typeof raw !== "object") return;
    const d = toV2(raw);
    const cats = catsFromV2(d);
    let activeCatId;
    if (Object.keys(cats).length) {
      // A persisted activeCatId of DEMO_CAT_ID is tolerated even though Biscuit is never a
      // key in `cats` — she stays active rather than silently falling back to a real cat.
      activeCatId = d.activeCatId === DEMO_CAT_ID ? DEMO_CAT_ID
        : d.activeCatId && cats[d.activeCatId] ? d.activeCatId : Object.keys(cats)[0];
      setCatsState({ activeCatId, cats });
    }
    if (d.library) library.setFoods(dedupeFoods(ensureBuiltins(d.library.map(cleanFood))));
    if (typeof d.fridgeDays === "number") setFridgeDays(d.fridgeDays);
    if (typeof d.skin === "string" && SKINS[d.skin]) setSkinState(d.skin);
    const resolved = resolveUnit(d.unit, activeCatId && cats[activeCatId]?.expSettings?.unit);
    if (resolved) setUnitState(resolved);
    const resolvedEstimator = resolveEstimator(d.estimator, activeCatId && cats[activeCatId]?.expSettings?.algo);
    if (resolvedEstimator) setEstimatorState(resolvedEstimator);
    if (d.litterRobot !== undefined) setLitterRobotState(migrateConnection(d.litterRobot));
  };

  const persistData = { v: 2, activeCatId: catsState.activeCatId, cats: catsState.cats, library: library.foods, fridgeDays, skin, unit, estimator, litterRobot };
  const loaded = usePersistence(persistData, hydrate);

  // Import (user-picked file, Settings → Data): ADDITIVE MERGE, never a replace — the file's
  // cats/weigh-ins/meals/foods are UNIONED into whatever's already here, so importing can only
  // ever add data, never lose or clobber current setup. See lib/mergeData.js for the exact
  // rule table (short version: append-only logs union+dedupe; a cat's profile/ration/settings
  // stay whatever's local when that cat already exists here; the food library unions by name).
  // A v1 file (a legacy single-cat export, or one made before this device had other cats) is
  // migrated to v2 first (lib/migrate.js), then merged in exactly like any other incoming
  // cat — EXCEPT a wholly-empty v1 blob (e.g. bare `{}`, which validateImport tolerates)
  // contributes nothing: migrateV1 mints a fresh, unstable id for a v1 blob's implicit one
  // cat, so treating an empty one as "a real cat" would add a meaningless blank cat every time.
  //
  // The merge result is adopted through the SAME seam `hydrate` uses on load (toV2 + sanitize
  // + set every piece of state) — merged data is a valid v2 blob, so this is just "hydrate
  // from a blob we built instead of one read from storage," keeping persistence/derived-state
  // identical to the load path.
  const importData = (raw) => {
    if (!raw || typeof raw !== "object") return;
    let incoming;
    if (raw.v === 2) {
      incoming = raw;
    } else {
      const migrated = migrateV1(raw);
      const hasCat = Object.keys(migrated.cats[migrated.activeCatId] || {}).length > 0;
      incoming = hasCat ? migrated : { ...migrated, cats: {} };
    }
    hydrate(mergeV2(persistData, incoming));
  };

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
      edit: (id, patch) => setItems((xs) => patchEntry(xs, id, patch)),
      remove: (id) => setItems((xs) => xs.filter((e) => e.id !== id)),
    };
  };
  const weightLog = makeLogView("weightLog");
  const intakeLog = makeLogView("intakeLog");

  // Per-day "incomplete" flags on the intake log: a day the owner marks as partially-logged
  // (some meals forgotten) is treated by the estimator exactly like a day with no entries at
  // all — see lib/expenditure.js's buildIntakeDayMap, the seam every estimator reads through.
  // Only "incomplete" exists as a status; unflagging a day just deletes its key rather than
  // storing an explicit "complete", so the map only ever grows with cats that actually use it.
  const intakeDayStatus = activeCat.intakeDayStatus || {};
  const setIntakeDayFlag = (date, flagged) => updateActiveCat((cat) => {
    const next = { ...(cat.intakeDayStatus || {}) };
    if (flagged) next[date] = "incomplete";
    else delete next[date];
    return { ...cat, intakeDayStatus: next };
  });

  const tr = activeCat.tr;
  const setTr = (updater) => updateActiveCat((cat) => ({ ...cat, tr: typeof updater === "function" ? updater(cat.tr) : updater }));
  const expSettings = activeCat.expSettings;
  const setExpSettings = (patch) => updateActiveCat((cat) => ({ ...cat, expSettings: { ...cat.expSettings, ...patch } }));

  // Permanent vs. logged state. Age derives from date of birth (so it never goes stale);
  // with no dob to derive it from, the cat is treated as an adult (never a fabricated
  // newborn — see effectiveAgeMonths) and dobMissing tells the UI to prompt for it instead
  // of showing a made-up age. The current weight the feeding math runs on is the latest
  // weigh-in — not a hand-typed number that can silently disagree with the log — falling
  // back to the seeded profile weight before the first weigh-in. (`today` itself is computed
  // once at the top of this provider — see the demoCat useMemo above.)
  const dobMissing = ageMonthsFromDob(p.dob, today) == null;
  const effAgeMonths = effectiveAgeMonths(p.dob, today);
  const weightDays = groupByDay(weightLog.items); // newest day first
  const currentWeight = weightDays.length
    ? { kg: median(weightDays[0].items.map((e) => num(e.kg))), date: weightDays[0].date, fromLog: true }
    : { kg: num(p.weightKg), date: null, fromLog: false };
  // Always a live "log now" (no date picker here — that's Log.jsx's backfill flow), so this
  // always gets a real `ts`; manualWeighInStamp derives `date` from it directly via
  // localDateOf rather than reusing `today` above, so a weigh-in's day is never one render
  // stale relative to the exact moment it was logged. See lib/series.js.
  const logWeight = ({ kg, method }) => {
    const ts = Date.now();
    weightLog.add({ ...manualWeighInStamp(localDateOf(ts), ts), kg, method: method || expSettings.lastMethod || DEFAULT_METHOD, source: WEIGH_SOURCES.manual });
  };

  const t = useMemo(() => computeTargets({ ...p, ageMonths: effAgeMonths, weightKg: currentWeight.kg }), [p, effAgeMonths, currentWeight.kg]);
  const expenditure = useMemo(() => {
    const w = weightLog.items.map((e) => ({ date: e.date, value: e.kg, method: e.method }));
    const i = intakeLog.items.map((e) => ({ date: e.date, value: e.kcal }));
    // cold-start the filter prior from the vet formula; intakeDayStatus feeds every estimator
    // through the same buildIntakeDayMap seam (see lib/expenditure.js). excludeDay: `today` is
    // still being logged — its running intake total isn't a complete day yet, so every
    // estimator treats it as missing (identically to a flagged-incomplete day) rather than
    // reading this morning's partial total as a genuine low-intake day.
    const opts = { priorKcal: t.refs.maintain, intakeDayStatus, excludeDay: today };
    if (estimator === "v1") return estimateExpenditure(w, i, opts);
    if (estimator === "v2") return kalmanEstimateExpenditure(w, i, opts);
    return ucEstimateExpenditure(w, i, opts); // v3 (default)
  }, [weightLog.items, intakeLog.items, intakeDayStatus, estimator, t.refs.maintain, today]);

  // Profile helpers (unchanged semantics, just centralized).
  const ageUnit = p.ageUnit || "months";
  const ageDisplay = dobMissing ? null : ageUnit === "years" ? r1(effAgeMonths / 12) : r1(effAgeMonths); // never a fabricated age
  const set = (k, v) => setP((s) => ({ ...s, [k]: v }));
  const setFactor = (k, v) => setP((s) => ({ ...s, factors: { ...s.factors, [k]: v } }));
  const setBcs = (v) => setP((s) => ({ ...s, bcs: v, pctOver: bcsToPct(v), bcAsOf: today }));
  const setPct = (v) => { const cv = clamp(num(v), -60, 100); setP((s) => ({ ...s, pctOver: cv, bcs: pctToBcs(cv), bcAsOf: today })); }; // clamp: a wild % → absurd ideal weight → overfeed

  // One row per cat for the Cats page list / header switcher: id, display name (or blank —
  // callers show "unnamed cat"), a formatted age (or null — "age unknown"), the raw
  // dob/neutered (for the Cats page's profile editor), and how many weigh-ins/meals it has
  // logged. Biscuit (the virtual demo cat) is always appended last, flagged `demo: true` so
  // callers can single her out (no controls on the Cats page, excluded from the Litter-Robot
  // target-cat picker) — she's never a key in `catsState.cats`, so she can't come from the
  // Object.entries below; she's added on afterward instead.
  const catRow = (id, cat) => {
    const months = ageMonthsFromDob(cat.profile?.dob, today);
    const unit = cat.profile?.ageUnit || "months";
    return {
      id,
      name: (cat.profile?.name || "").trim(),
      dob: cat.profile?.dob || "",
      neutered: !!cat.profile?.neutered,
      ageDisplay: months == null ? null : unit === "years" ? `${r1(months / 12)} yr` : `${r1(months)} mo`,
      weighIns: (cat.weightLog || []).length,
      meals: (cat.intakeLog || []).length,
      active: id === catsState.activeCatId,
    };
  };
  const catsSummary = [
    ...Object.entries(catsState.cats).map(([id, cat]) => catRow(id, cat)),
    { ...catRow(DEMO_CAT_ID, demoCat), name: "Biscuit", demo: true },
  ];
  const switchCat = (id) => setCatsState((s) => switchCatPure(s, id));
  const addCat = () => setCatsState((s) => addCatPure(s));
  const deleteCat = (id) => setCatsState((s) => deleteCatPure(s, id));
  const clearCatHistory = (id) => setCatsState((s) => clearCatHistoryPure(s, id));
  const updateCatProfile = (id, patch) => setCatsState((s) => updateCatProfilePure(s, id, patch));

  // Global "erase all" — wipes every cat, the saved-food library, and fridgeDays back to a
  // single fresh blank cat + the built-in food list. Not Biscuit: a user who's deliberately
  // erasing everything gets an actually-blank cat, not the demo resurfacing as if nothing
  // happened.
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

  // One sync pass against a given connection: refresh the session once, pull + parse + route
  // activity across EVERY robot on the connection (see lib/litterRobot.js syncAllWeights),
  // dedupe per TARGET cat, append, refresh the pet-profile list, and record when it happened.
  // Shared by the on-load background sync, "sync now", and the sync that kicks off right after
  // Connect. Never throws — callers get { ok, imported, skipped, error }, for a legible status
  // in the UI instead of an unhandled rejection.
  //
  // `existingEntriesByCat` is built from every REAL cat (not Biscuit — she's never a sync
  // target, see catStore/demoCat banners) since routing (petMap/robotMap) decides which cat(s)
  // actually receive anything; syncAllWeights itself does the per-cat dedupe once it knows.
  const runLitterRobotSync = async (conn) => {
    if (!conn) return { ok: false };
    const sinceMs = conn.lastSyncTs || Date.now() - FIRST_SYNC_DAYS * 86400000;
    const existingEntriesByCat = Object.fromEntries(
      Object.entries(catsState.cats).map(([id, cat]) => [id, cat.weightLog])
    );
    try {
      const { byCat, imported, skipped, syncedAt, weightScale, pets } = await lrSyncAllWeights({
        refreshToken: conn.refreshToken, robots: conn.robots, sinceMs,
        petMap: conn.petMap, robotMap: conn.robotMap, existingEntriesByCat,
      });
      for (const [catId, entries] of Object.entries(byCat)) appendWeightsToCat(catId, entries);
      // weightScale is only ever present when an LR5 robot's on the connection (which unit
      // interpretation won — see parseWeightEventsLR5); once it sticks the first time, keep it
      // even on a sync that returns nothing new (an empty page shouldn't blank out an
      // already-determined scale). `pets` refreshes every sync per the design brief (connect +
      // sync now), so the Settings mapping UI always shows the current Whisker pet list.
      setLitterRobotState((s) => (s ? { ...s, lastSyncTs: syncedAt, weightScale: weightScale ?? s.weightScale, pets } : s));
      return { ok: true, imported, skipped };
    } catch (error) {
      return { ok: false, error };
    }
  };

  // Step 1 of Connect: log in with the owner's own credentials (used ONLY for this one
  // request — never stored) and list their robots, across BOTH generations (LR4 + LR5 — see
  // lib/litterRobot.js listAllRobots; either generation may legitimately be absent on a given
  // account), plus any Whisker pet profiles on the account (best-effort — an account with no
  // pet profiles set up is not an error, see listPets). Returns the pieces Settings needs;
  // doesn't touch state yet (nothing is "connected" until finish()).
  const connectLitterRobotStart = async (email, password) => {
    const { idToken, refreshToken, userId } = await lrLogin(email, password);
    const robots = await lrListAllRobots(idToken, userId);
    let pets = [];
    try { pets = await lrListPets(idToken, userId); } catch { pets = []; }
    return { refreshToken, robots, pets };
  };
  // Step 2: commit the connection — EVERY robot on the account, not a picked one — and kick
  // off the first sync immediately. Returns that first sync's result so the UI can show it.
  //
  // Auto-map only the zero-config common case: exactly one REAL cat on this device. In that
  // case every robot's robotMap entry points at it (this is the fallback route for ANY event
  // without an attributable petId — LR4 always, LR5 when a visit's own petIds was
  // absent/ambiguous — so it's what keeps a single-cat LR4 household working with no extra
  // steps, exactly as it did before this connection shape existed) and, if there's also
  // exactly one Whisker pet profile, that pet's petMap entry points at the same cat too. Two+
  // real cats (or 0) means routing is genuinely ambiguous — leave both maps empty and let the
  // owner set it up in the Settings mapping section (see design brief item 5).
  const connectLitterRobotFinish = (refreshToken, robots, pets) => {
    const realCatIds = Object.keys(catsState.cats);
    let robotMap = {}, petMap = {};
    if (realCatIds.length === 1) {
      const catId = realCatIds[0];
      robotMap = Object.fromEntries((robots || []).map((r) => [r.serial, catId]));
      if (pets?.length === 1) petMap = { [pets[0].petId]: catId };
    }
    // Beyond the single-cat case, matching names close the gap: Whisker's "Mithril" maps to
    // the Kilocat cat named Mithril without a manual step (unambiguous matches only).
    const realCats = realCatIds.map((id) => ({ id, name: catsState.cats[id]?.profile?.name }));
    petMap = autoMatchPetsByName(pets, realCats, petMap);
    const conn = { refreshToken, lastSyncTs: null, weightScale: null, robots: robots || [], pets: pets || [], petMap, robotMap };
    setLitterRobotState(conn);
    return runLitterRobotSync(conn);
  };
  // Wipes the token + connection only — already-imported weigh-ins stay in the cat's log
  // (they're indistinguishable from any other logged weight once they're in).
  const disconnectLitterRobot = () => setLitterRobotState(null);
  const syncLitterRobotNow = () => runLitterRobotSync(litterRobot);
  // Settings mapping UI: change one Whisker pet's (or one LR4-generation robot's) target cat.
  // `catId` of null/"" means "don't import" — stored explicitly (not just left absent) so a
  // deliberate opt-out is distinguishable from a pet/robot the owner hasn't looked at yet, if
  // that distinction ever matters later; routing treats both the same (skip either way).
  const setPetMapping = (petId, catId) => setLitterRobotState((s) => (s ? { ...s, petMap: { ...s.petMap, [petId]: catId || null } } : s));
  const setRobotMapping = (serial, catId) => setLitterRobotState((s) => (s ? { ...s, robotMap: { ...s.robotMap, [serial]: catId || null } } : s));

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
    loaded, storageOk, p, set, setFactor, ageUnit, ageDisplay, dobMissing, setBcs, setPct,
    today, currentWeight, logWeight,
    ration, start, library, weightLog, intakeLog, intakeDayStatus, setIntakeDayFlag, saveFood,
    tr, setTr, fridgeDays, setFridgeDays, expSettings, setExpSettings,
    skin, setSkin, unit, setUnit, estimator, setEstimator,
    t, expenditure,
    activeCatId: catsState.activeCatId, catsSummary, switchCat, addCat, deleteCat, clearCatHistory, updateCatProfile, eraseAll,
    exportData: () => JSON.stringify(persistData, null, 2),
    importData,
    litterRobot, connectLitterRobotStart, connectLitterRobotFinish, disconnectLitterRobot, syncLitterRobotNow,
    setPetMapping, setRobotMapping,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
