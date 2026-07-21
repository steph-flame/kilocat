// Biscuit, the virtual demo cat: present for every user, never stored, never mutated.
//
// Generated fresh from `today` every time (see AppState.jsx) rather than persisted, so it
// can't ever appear in an export/import and can't drift out of sync with "today" the way a
// stored seed cat would. Fully deterministic — a seeded PRNG, and even entry ids are a plain
// counter, not uid()'s Math.random — so the same `today` always produces a byte-identical
// record: screenshots, tests, and repeat visits all see the same Biscuit, while a different
// `today` shifts every date by the same amount and leaves every number untouched.
//
// The generated shape matches freshCatState()'s per-cat record exactly: { profile, ration,
// start, weightLog, intakeLog, tr, expSettings }. AppState treats it as a read-only stand-in
// for a real cat: every mutation seam no-ops while it's active (see updateActiveCat).

import { blankFood } from "./foods.js";
import { WEIGH_SOURCES } from "./expenditure.js";
import { freshProfile, defaultTr, defaultExpSettings, DEMO_CAT_ID as DEMO_ID } from "./catStore.js";

export const DEMO_CAT_ID = DEMO_ID;

// mulberry32: tiny deterministic PRNG — no Math.random anywhere in here, so the exact same
// `today` always regenerates the exact same history (weigh-in noise, meal splits, etc.).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fixed seed — "Biscuit" isn't random, it's the same cat every time.
const DEMO_SEED = 0xb15c41;
const HISTORY_DAYS = 56; // ~8 weeks
const START_KG = 4.95, END_KG = 4.62; // gentle, safe decline (within the 0.5-2%/wk band)
const INTAKE_KCAL = 215, INTAKE_JITTER = 12;

const addDaysISO = (iso, delta) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const subYearsISO = (iso, years) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

// Biscuit's profile: a neutered adult, mildly over ideal weight, on a gentle trim — the
// combination that makes both the ration planner and the expenditure page have something
// honest and flattering to show (a converged measured estimate, a safe ongoing loss rate).
function buildProfile(today) {
  return {
    ...freshProfile(),
    name: "Biscuit",
    dob: subYearsISO(today, 4),
    neutered: true,
    bcMode: "pct",
    pctOver: 12,
    goal: "gentle",
  };
}

// ~8 weeks of weigh-ins, 2-4 a day, sloping from START_KG to END_KG with realistic
// day-to-day noise. Mostly Litter-Robot reads (noisier, automatic) with occasional manual
// pet-scale check-ins — the mix the real Litter-Robot integration produces for an active
// connection, per lib/litterRobot.js / lib/expenditure.js's WEIGH_SOURCES/WEIGH_METHODS.
//
// Each read also gets a `ts` (epoch ms), scattered 6am-11pm — litter-box visits through the
// day, same as a real Litter-Robot feed — so the Log page's per-entry local time actually has
// something to show. `T00:00:00` (no `Z`) parses as LOCAL midnight per spec, so the ts's own
// local calendar date always lines up with `date` above regardless of which timezone this
// runs in — no separate localDateOf reconciliation needed.
function buildWeightLog(rand, startDate, nextId) {
  const entries = [];
  for (let day = 0; day < HISTORY_DAYS; day++) {
    const date = addDaysISO(startDate, day);
    const frac = day / (HISTORY_DAYS - 1);
    const baseKg = START_KG + (END_KG - START_KG) * frac;
    const nReads = 2 + Math.floor(rand() * 3); // 2-4
    const localMidnight = new Date(`${date}T00:00:00`).getTime();
    const reads = [];
    for (let r = 0; r < nReads; r++) {
      const manual = rand() < 0.2; // occasional manual pet-scale read, mostly Litter-Robot
      const noise = (rand() - 0.5) * (manual ? 0.05 : 0.09);
      const kg = Math.round((baseKg + noise) * 100) / 100;
      const hour = 6 + rand() * 17; // scattered 6am-11pm
      reads.push({ kg, manual, ts: localMidnight + Math.round(hour * 3600000) });
    }
    reads.sort((a, b) => a.ts - b.ts); // chronological within the day, for a tidy display
    for (const { kg, manual, ts } of reads) {
      entries.push({
        id: nextId(), date, kg, ts,
        method: manual ? "petScale" : "litterRobot",
        source: manual ? WEIGH_SOURCES.manual : WEIGH_SOURCES.litterRobot,
      });
    }
  }
  return entries;
}

// ~215 ± 12 kcal/day, split across two meals — enough, and dense enough (no missing days),
// for the v3 expenditure estimator to fully converge over the 56-day window.
function buildIntakeLog(rand, startDate, foodNames, nextId) {
  const entries = [];
  for (let day = 0; day < HISTORY_DAYS; day++) {
    const date = addDaysISO(startDate, day);
    const total = Math.round(INTAKE_KCAL + (rand() - 0.5) * 2 * INTAKE_JITTER);
    const split = 0.42 + rand() * 0.16; // ~42-58% at the morning meal
    const morning = Math.round(total * split);
    const evening = total - morning;
    entries.push({ id: nextId(), date, kcal: morning, name: foodNames.dry, grams: null });
    entries.push({ id: nextId(), date, kcal: evening, name: foodNames.wet, grams: null });
  }
  return entries;
}

// Two foods summing to 100%: a dry kibble (kcal/kg) and a wet can (kcal/can) — the same two
// modes every real ration mixes, with plausible label numbers.
function buildRation(nextId) {
  const dry = { ...blankFood(), id: nextId(), name: "Orijen Fit & Trim", mode: "perKg", kcalPerKg: 3700, gramsPerCup: 120, pct: 65 };
  const wet = { ...blankFood(), id: nextId(), name: "Tiki Cat After Dark Chicken & Quail Egg — 2.8 oz can", mode: "perUnit", kcalPerUnit: 66, gramsPerUnit: 79, pct: 35 };
  return { ration: [dry, wet], names: { dry: dry.name, wet: wet.name } };
}

export function buildDemoCat(today) {
  const rand = mulberry32(DEMO_SEED);
  let n = 0;
  const nextId = () => `demo-${n++}`; // deterministic, not uid()'s Math.random
  const startDate = addDaysISO(today, -(HISTORY_DAYS - 1));
  const { ration, names } = buildRation(nextId);

  return {
    profile: buildProfile(today),
    ration,
    start: ration.map((f) => ({ ...f, id: nextId() })),
    weightLog: buildWeightLog(rand, startDate, nextId),
    intakeLog: buildIntakeLog(rand, startDate, names, nextId),
    intakeDayStatus: {}, // Biscuit's log is always complete — never flagged, never mutated
    tr: defaultTr(),
    expSettings: defaultExpSettings(),
    // stateModAt/deletedEntries: the edit-propagation-sync bookkeeping fields (see
    // lib/mergeData.js) — present here only to keep this shape matching freshCatState()'s
    // exactly (see demoCat.test.js); meaningless for Biscuit since she's never persisted,
    // mutated, or merged.
    stateModAt: 0,
    deletedEntries: {},
  };
}
