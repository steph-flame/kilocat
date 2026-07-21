import { describe, it, expect } from "vitest";
import { mergeV2, weightKey, intakeKey, pruneTombstones, TOMBSTONE_TTL_MS } from "./mergeData.js";
import { validateImport } from "./validate.js";
import { migrateV1 } from "./migrate.js";

/* ---------- fixtures ---------- */

const profileA = { name: "Mithril", dob: "2025-09-13", weightKg: 4.38, goal: "gentle", factors: {} };
const rationA = [{ id: "r1", name: "Food A", mode: "perKg", kcalPerKg: 4000, pct: 100 }];
const trA = { on: false, days: 7, timelineUnit: "g" };
const expA = { pctPerWeek: 1, energyBasis: "formula", direction: "auto", lastMethod: "petScale" };

// A minimal-but-complete cat, everything filled in so identity/local-wins is unambiguous.
// stateModAt: 0 and deletedEntries: {} are the edit-propagation-sync defaults (see
// lib/mergeData.js) — explicit here (rather than left absent) so a fixture built from this
// helper round-trips through mergeV2 byte-for-byte in the idempotence tests below.
const makeCat = (overrides = {}) => ({
  profile: profileA,
  ration: rationA,
  start: [],
  weightLog: [],
  intakeLog: [],
  intakeDayStatus: {},
  tr: trA,
  expSettings: expA,
  stateModAt: 0,
  deletedEntries: {},
  ...overrides,
});

const snap = (overrides = {}) => ({
  v: 2,
  activeCatId: "cat-1",
  cats: { "cat-1": makeCat() },
  library: [],
  fridgeDays: 3,
  skin: "original",
  unit: "kg",
  estimator: "v3",
  litterRobot: null,
  settingsModAt: 0,
  deletedCats: {},
  ...overrides,
});

const weigh = (id, date, kg, extra = {}) => ({ id, date, kg, method: "petScale", source: "manual", ...extra });
const meal = (id, date, kcal, extra = {}) => ({ id, date, kcal, grams: null, name: null, ...extra });

/* ---------- idempotence ---------- */

describe("mergeV2 idempotence", () => {
  it("merging a snapshot with itself changes nothing (aside from log sort order)", () => {
    const a = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4), weigh("w2", "2026-01-02", 4.5)],
          intakeLog: [meal("m1", "2026-01-01", 200)],
          intakeDayStatus: { "2026-01-02": "incomplete" },
        }),
      },
      library: [{ id: "f1", name: "Food A", mode: "perKg", kcalPerKg: 4000 }],
    });
    const merged = mergeV2(a, a);
    expect(merged).toEqual(a);
  });

  it("merging the same file in twice does not grow any log", () => {
    const local = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4)],
          intakeLog: [meal("m1", "2026-01-01", 200)],
        }),
      },
    });
    const incoming = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4)],
          intakeLog: [meal("m1", "2026-01-01", 200)],
        }),
      },
    });
    const once = mergeV2(local, incoming);
    expect(once.cats["cat-1"].weightLog).toHaveLength(1);
    expect(once.cats["cat-1"].intakeLog).toHaveLength(1);
    // merge the same incoming file in AGAIN, against the already-merged result
    const twice = mergeV2(once, incoming);
    expect(twice.cats["cat-1"].weightLog).toHaveLength(1);
    expect(twice.cats["cat-1"].intakeLog).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it("stays idempotent with a full sync payload: stateModAt, settingsModAt, deletedCats, and deletedEntries all included", () => {
    const now = 1_000_000_000_000; // pinned so pruneTombstones' GC can't make two calls disagree
    const recent = now - 86400000; // within the TTL — must survive GC, unlike the dedicated GC tests below
    const a = snap({
      cats: {
        "cat-1": makeCat({
          stateModAt: 42,
          weightLog: [weigh("w2", "2026-01-02", 4.5)],
          deletedEntries: { w1: recent },
        }),
      },
      settingsModAt: 7,
      deletedCats: { "cat-9": recent },
    });
    const once = mergeV2(a, a, now);
    expect(once).toEqual(a);
    const twice = mergeV2(once, once, now);
    expect(twice).toEqual(once);
  });
});

/* ---------- cat union ---------- */

describe("mergeV2 cat union", () => {
  it("adds a cat present only in incoming, wholesale", () => {
    const local = snap();
    const incomingCat = makeCat({ profile: { name: "Second Cat" } });
    const incoming = snap({ activeCatId: "cat-2", cats: { "cat-2": incomingCat } });
    const merged = mergeV2(local, incoming);
    expect(Object.keys(merged.cats).sort()).toEqual(["cat-1", "cat-2"]);
    expect(merged.cats["cat-2"]).toEqual(incomingCat);
  });

  it("never drops a cat present only in local", () => {
    const local = snap({ cats: { "cat-1": makeCat(), "cat-2": makeCat({ profile: { name: "Local Only" } }) } });
    const incoming = snap({ cats: {} });
    const merged = mergeV2(local, incoming);
    expect(Object.keys(merged.cats).sort()).toEqual(["cat-1", "cat-2"]);
  });

  it("for a cat present in both with tied (or missing/legacy) stateModAt, unions the logs but keeps local's current-state bundle", () => {
    const local = snap({
      cats: {
        "cat-1": makeCat({
          profile: { name: "Local Name" },
          ration: [{ id: "local-r", name: "Local Food", mode: "perKg", kcalPerKg: 1, pct: 100 }],
          tr: { on: true, days: 14, timelineUnit: "kcal" },
          expSettings: { ...expA, lastMethod: "difference" },
          weightLog: [weigh("w1", "2026-01-01", 4.4)],
        }),
      },
    });
    const incoming = snap({
      cats: {
        "cat-1": makeCat({
          profile: { name: "Incoming Name" }, // must NOT win — tie keeps local
          ration: [{ id: "incoming-r", name: "Incoming Food", mode: "perKg", kcalPerKg: 2, pct: 100 }], // must NOT win
          tr: { on: false, days: 7, timelineUnit: "g" }, // must NOT win
          expSettings: { ...expA, lastMethod: "petScale" }, // must NOT win
          weightLog: [weigh("w2", "2026-01-02", 4.5)],
        }),
      },
    });
    const merged = mergeV2(local, incoming);
    const cat = merged.cats["cat-1"];
    expect(cat.profile.name).toBe("Local Name");
    expect(cat.ration).toEqual(local.cats["cat-1"].ration);
    expect(cat.tr).toEqual(local.cats["cat-1"].tr);
    expect(cat.expSettings).toEqual(local.cats["cat-1"].expSettings);
    // logs DID union
    expect(cat.weightLog.map((e) => e.id).sort()).toEqual(["w1", "w2"]);
  });
});

/* ---------- current-state bundle: timestamped LWW (stateModAt) ---------- */

describe("mergeV2 current-state bundle LWW by stateModAt", () => {
  it("incoming's bundle wins when its stateModAt is strictly newer", () => {
    const local = snap({
      cats: {
        "cat-1": makeCat({
          profile: { name: "Local Name" },
          ration: [{ id: "local-r", name: "Local Food", mode: "perKg", kcalPerKg: 1, pct: 100 }],
          tr: { on: true, days: 14, timelineUnit: "kcal" },
          expSettings: { ...expA, lastMethod: "difference" },
          stateModAt: 1000,
        }),
      },
    });
    const incoming = snap({
      cats: {
        "cat-1": makeCat({
          profile: { name: "Incoming Name" },
          ration: [{ id: "incoming-r", name: "Incoming Food", mode: "perKg", kcalPerKg: 2, pct: 100 }],
          tr: { on: false, days: 7, timelineUnit: "g" },
          expSettings: { ...expA, lastMethod: "petScale" },
          stateModAt: 2000,
        }),
      },
    });
    const cat = mergeV2(local, incoming).cats["cat-1"];
    expect(cat.profile.name).toBe("Incoming Name");
    expect(cat.ration).toEqual(incoming.cats["cat-1"].ration);
    expect(cat.tr).toEqual(incoming.cats["cat-1"].tr);
    expect(cat.expSettings).toEqual(incoming.cats["cat-1"].expSettings);
  });

  it("local's bundle wins when its stateModAt is strictly newer", () => {
    const local = snap({ cats: { "cat-1": makeCat({ profile: { name: "Local Name" }, stateModAt: 5000 }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ profile: { name: "Incoming Name" }, stateModAt: 1000 }) } });
    expect(mergeV2(local, incoming).cats["cat-1"].profile.name).toBe("Local Name");
  });

  it("carries the max stateModAt forward regardless of which side wins", () => {
    const local = snap({ cats: { "cat-1": makeCat({ stateModAt: 1000 }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ stateModAt: 9000 }) } });
    expect(mergeV2(local, incoming).cats["cat-1"].stateModAt).toBe(9000);
    // and the reverse direction
    expect(mergeV2(incoming, local).cats["cat-1"].stateModAt).toBe(9000);
  });

  it("treats a missing/legacy stateModAt as 0 (oldest) — a real stamped edit on the OTHER side wins outright", () => {
    const legacyLocal = snap({ cats: { "cat-1": makeCat({ profile: { name: "Legacy Local" } }) } });
    delete legacyLocal.cats["cat-1"].stateModAt; // simulate genuinely-untouched legacy data
    const stampedIncoming = snap({ cats: { "cat-1": makeCat({ profile: { name: "Stamped Incoming" }, stateModAt: 1 }) } });
    expect(mergeV2(legacyLocal, stampedIncoming).cats["cat-1"].profile.name).toBe("Stamped Incoming");
    // and the reverse: a stamped LOCAL edit beats untouched legacy incoming data
    const stampedLocal = snap({ cats: { "cat-1": makeCat({ profile: { name: "Stamped Local" }, stateModAt: 1 }) } });
    const legacyIncoming = snap({ cats: { "cat-1": makeCat({ profile: { name: "Legacy Incoming" } }) } });
    delete legacyIncoming.cats["cat-1"].stateModAt;
    expect(mergeV2(stampedLocal, legacyIncoming).cats["cat-1"].profile.name).toBe("Stamped Local");
  });

  it("logs still union and dedupe regardless of which side's bundle wins", () => {
    const local = snap({ cats: { "cat-1": makeCat({ stateModAt: 1000, weightLog: [weigh("w1", "2026-01-01", 4.4)] }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ stateModAt: 9000, weightLog: [weigh("w2", "2026-01-02", 4.5)] }) } });
    const merged = mergeV2(local, incoming).cats["cat-1"];
    expect(merged.weightLog.map((e) => e.id).sort()).toEqual(["w1", "w2"]);
  });
});

/* ---------- weight/intake log dedupe ---------- */

describe("mergeV2 weightLog dedupe", () => {
  it("dedupes by id when present", () => {
    const local = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w1", "2026-01-01", 4.4)] }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w1", "2026-01-01", 4.4)] }) } });
    const merged = mergeV2(local, incoming);
    expect(merged.cats["cat-1"].weightLog).toHaveLength(1);
  });

  it("preserves two legitimately distinct same-day entries (different id, different kg)", () => {
    const local = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w1", "2026-01-01", 4.4)] }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w2", "2026-01-01", 4.6)] }) } });
    const merged = mergeV2(local, incoming);
    expect(merged.cats["cat-1"].weightLog).toHaveLength(2);
    expect(merged.cats["cat-1"].weightLog.map((e) => e.kg).sort()).toEqual([4.4, 4.6]);
  });

  it("falls back to a composite key (date+ts+kg+method+source) when id is absent", () => {
    const noId = (date, kg, extra = {}) => ({ date, kg, method: "petScale", source: "manual", ...extra });
    const local = snap({ cats: { "cat-1": makeCat({ weightLog: [noId("2026-01-01", 4.4)] }) } });
    // an exact duplicate with no id — should dedupe away
    const dup = snap({ cats: { "cat-1": makeCat({ weightLog: [noId("2026-01-01", 4.4)] }) } });
    expect(mergeV2(local, dup).cats["cat-1"].weightLog).toHaveLength(1);
    // a genuinely distinct same-day reading with no id — should NOT dedupe away
    const distinct = snap({ cats: { "cat-1": makeCat({ weightLog: [noId("2026-01-01", 4.9)] }) } });
    expect(mergeV2(local, distinct).cats["cat-1"].weightLog).toHaveLength(2);
  });

  it("sorts the merged log deterministically by date/ts", () => {
    const local = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w3", "2026-01-03", 4.7, { ts: 3 })] }) } });
    const incoming = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4, { ts: 1 }), weigh("w2", "2026-01-02", 4.5, { ts: 2 })],
        }),
      },
    });
    const merged = mergeV2(local, incoming);
    expect(merged.cats["cat-1"].weightLog.map((e) => e.id)).toEqual(["w1", "w2", "w3"]);
  });
});

describe("mergeV2 intakeLog dedupe", () => {
  it("dedupes by id when present", () => {
    const local = snap({ cats: { "cat-1": makeCat({ intakeLog: [meal("m1", "2026-01-01", 200)] }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ intakeLog: [meal("m1", "2026-01-01", 200)] }) } });
    expect(mergeV2(local, incoming).cats["cat-1"].intakeLog).toHaveLength(1);
  });

  it("preserves two legitimately distinct same-day meals (different id, different kcal)", () => {
    const local = snap({ cats: { "cat-1": makeCat({ intakeLog: [meal("m1", "2026-01-01", 200)] }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ intakeLog: [meal("m2", "2026-01-01", 150)] }) } });
    const merged = mergeV2(local, incoming);
    expect(merged.cats["cat-1"].intakeLog).toHaveLength(2);
  });

  it("falls back to a composite key (date+kcal+grams+name) when id is absent", () => {
    const noId = (date, kcal, extra = {}) => ({ date, kcal, grams: null, name: null, ...extra });
    const local = snap({ cats: { "cat-1": makeCat({ intakeLog: [noId("2026-01-01", 200)] }) } });
    const dup = snap({ cats: { "cat-1": makeCat({ intakeLog: [noId("2026-01-01", 200)] }) } });
    expect(mergeV2(local, dup).cats["cat-1"].intakeLog).toHaveLength(1);
    const distinct = snap({ cats: { "cat-1": makeCat({ intakeLog: [noId("2026-01-01", 250)] }) } });
    expect(mergeV2(local, distinct).cats["cat-1"].intakeLog).toHaveLength(2);
  });
});

describe("weightKey/intakeKey", () => {
  it("prefers the entry id over the composite when present", () => {
    expect(weightKey({ id: "x", date: "2026-01-01", kg: 4.4 })).toBe("x");
    expect(intakeKey({ id: "y", date: "2026-01-01", kcal: 200 })).toBe("y");
  });
});

/* ---------- intakeDayStatus union ---------- */

describe("mergeV2 intakeDayStatus union", () => {
  it("keeps a day flagged incomplete if it's flagged on EITHER side", () => {
    const local = snap({ cats: { "cat-1": makeCat({ intakeDayStatus: { "2026-01-01": "incomplete" } }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ intakeDayStatus: { "2026-01-02": "incomplete" } }) } });
    const merged = mergeV2(local, incoming);
    expect(merged.cats["cat-1"].intakeDayStatus).toEqual({ "2026-01-01": "incomplete", "2026-01-02": "incomplete" });
  });

  it("a day flagged on both sides stays flagged (not doubled/lost)", () => {
    const local = snap({ cats: { "cat-1": makeCat({ intakeDayStatus: { "2026-01-01": "incomplete" } }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ intakeDayStatus: { "2026-01-01": "incomplete" } }) } });
    expect(mergeV2(local, incoming).cats["cat-1"].intakeDayStatus).toEqual({ "2026-01-01": "incomplete" });
  });
});

/* ---------- library union ---------- */

describe("mergeV2 library union", () => {
  it("unions foods by name identity (case-insensitive, (dry)/(wet)-stripped) via dedupeFoods", () => {
    const local = snap({ library: [{ id: "f1", name: "Food A", mode: "perKg", kcalPerKg: 4000 }] });
    const incoming = snap({ library: [{ id: "f2", name: "food a", mode: "perKg", kcalPerKg: 4000 }] });
    const merged = mergeV2(local, incoming);
    expect(merged.library).toHaveLength(1);
  });

  it("fills a missing macro on the local entry from the incoming duplicate (dedupeFoods' own gap-fill)", () => {
    const local = snap({ library: [{ id: "f1", name: "Food A", mode: "perKg", kcalPerKg: "", gramsPerCup: "" }] });
    const incoming = snap({ library: [{ id: "f2", name: "Food A (dry)", mode: "perKg", kcalPerKg: 4000, gramsPerCup: 110 }] });
    const merged = mergeV2(local, incoming);
    expect(merged.library).toHaveLength(1);
    expect(merged.library[0].kcalPerKg).toBe(4000);
    expect(merged.library[0].gramsPerCup).toBe(110);
    expect(merged.library[0].name).toBe("Food A"); // local's clean name wins, not renamed to incoming's
  });

  it("adds a genuinely new food from incoming", () => {
    const local = snap({ library: [{ id: "f1", name: "Food A", mode: "perKg", kcalPerKg: 4000 }] });
    const incoming = snap({ library: [{ id: "f2", name: "Food B", mode: "perKg", kcalPerKg: 3000 }] });
    const merged = mergeV2(local, incoming);
    expect(merged.library.map((f) => f.name).sort()).toEqual(["Food A", "Food B"]);
  });
});

/* ---------- shared scalars kept local ---------- */

describe("mergeV2 shared-settings bundle (fridgeDays/skin/unit/estimator): LWW by settingsModAt", () => {
  it("keeps local's settings bundle on a tie (both 0/untouched — the common/legacy case); activeCatId is always local regardless", () => {
    const local = snap({ activeCatId: "cat-1", fridgeDays: 5, skin: "spruce", unit: "lb", estimator: "v1" });
    const incoming = snap({ activeCatId: "cat-2", fridgeDays: 9, skin: "blossom", unit: "kg", estimator: "v3", cats: { "cat-2": makeCat() } });
    const merged = mergeV2(local, incoming);
    expect(merged.activeCatId).toBe("cat-1");
    expect(merged.fridgeDays).toBe(5);
    expect(merged.skin).toBe("spruce");
    expect(merged.unit).toBe("lb");
    expect(merged.estimator).toBe("v1");
  });

  it("adopts incoming's whole settings bundle when its settingsModAt is strictly newer", () => {
    const local = snap({ fridgeDays: 5, skin: "spruce", unit: "lb", estimator: "v1", settingsModAt: 1000 });
    const incoming = snap({ fridgeDays: 9, skin: "blossom", unit: "kg", estimator: "v3", settingsModAt: 2000 });
    const merged = mergeV2(local, incoming);
    expect(merged.fridgeDays).toBe(9);
    expect(merged.skin).toBe("blossom");
    expect(merged.unit).toBe("kg");
    expect(merged.estimator).toBe("v3");
    expect(merged.settingsModAt).toBe(2000);
    // activeCatId is NOT part of the settings bundle — stays local even when incoming's LWW-wins
    expect(merged.activeCatId).toBe(local.activeCatId);
  });

  it("keeps local's bundle when local's settingsModAt is strictly newer, but still carries the max forward", () => {
    const local = snap({ fridgeDays: 5, settingsModAt: 9000 });
    const incoming = snap({ fridgeDays: 9, settingsModAt: 1000 });
    const merged = mergeV2(local, incoming);
    expect(merged.fridgeDays).toBe(5);
    expect(merged.settingsModAt).toBe(9000);
  });

  it("treats a missing/legacy settingsModAt as 0 (oldest) — a stamped edit on either side wins outright", () => {
    const legacyLocal = snap({ fridgeDays: 5 });
    delete legacyLocal.settingsModAt;
    const stampedIncoming = snap({ fridgeDays: 9, settingsModAt: 1 });
    expect(mergeV2(legacyLocal, stampedIncoming).fridgeDays).toBe(9);
  });
});

/* ---------- litterRobot ---------- */

describe("mergeV2 litterRobot", () => {
  const conn = (token) => ({ refreshToken: token, robots: [{ serial: "LR4-1", model: "LR4" }], lastSyncTs: null, weightScale: null, pets: [], petMap: {}, robotMap: {} });

  it("keeps local's connection when local already has one, even if incoming has a different one", () => {
    const local = snap({ litterRobot: conn("local-token") });
    const incoming = snap({ litterRobot: conn("incoming-token") });
    expect(mergeV2(local, incoming).litterRobot).toEqual(conn("local-token"));
  });

  it("adopts incoming's connection when local has none (null)", () => {
    const local = snap({ litterRobot: null });
    const incoming = snap({ litterRobot: conn("incoming-token") });
    expect(mergeV2(local, incoming).litterRobot).toEqual(conn("incoming-token"));
  });

  it("adopts incoming's connection when local's field is undefined (older local state)", () => {
    const local = snap(); delete local.litterRobot;
    const incoming = snap({ litterRobot: conn("incoming-token") });
    expect(mergeV2(local, incoming).litterRobot).toEqual(conn("incoming-token"));
  });

  it("stays null when neither side has a connection", () => {
    const local = snap({ litterRobot: null });
    const incoming = snap({ litterRobot: null });
    expect(mergeV2(local, incoming).litterRobot).toBeNull();
  });
});

/* ---------- deletedCats tombstones (cat deletion propagation) ---------- */

// `now` is pinned and every deletedAt below is `now`-relative (recent, well within the TTL) —
// mergeV2 runs pruneTombstones on its result (see lib/mergeData.js), so a test that left this
// on the real Date.now() default while using small hand-picked deletedAt values (e.g. 5000ms
// since epoch) would have its own tombstones GC'd away as "ancient" before the assertions run.
const now = 1_000_000_000_000;

describe("mergeV2 deletedCats tombstones", () => {
  it("drops a cat deleted locally (tombstone) even though incoming still has a stale copy", () => {
    // local deleted cat-2 a while ago; incoming never got the memo and still has it.
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 5000 } });
    const incoming = snap({
      cats: { "cat-1": makeCat(), "cat-2": makeCat({ profile: { name: "Stale Copy" }, stateModAt: now - 9000 }) },
    });
    const merged = mergeV2(local, incoming, now);
    expect(Object.keys(merged.cats).sort()).toEqual(["cat-1"]);
    expect(merged.deletedCats["cat-2"]).toBe(now - 5000);
  });

  it("drops a cat deleted on the incoming side too, symmetrically", () => {
    const local = snap({ cats: { "cat-1": makeCat(), "cat-2": makeCat({ stateModAt: now - 9000 }) } });
    const incoming = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 5000 } });
    expect(Object.keys(mergeV2(local, incoming, now).cats).sort()).toEqual(["cat-1"]);
  });

  it("a cat re-created/edited AFTER the tombstone (stateModAt newer than deletedAt) survives — deletion doesn't permanently poison an id", () => {
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 9000 } });
    const incoming = snap({ cats: { "cat-1": makeCat(), "cat-2": makeCat({ profile: { name: "Revived" }, stateModAt: now - 5000 }) } });
    const merged = mergeV2(local, incoming, now);
    expect(Object.keys(merged.cats).sort()).toEqual(["cat-1", "cat-2"]);
    expect(merged.cats["cat-2"].profile.name).toBe("Revived");
  });

  it("a tombstone exactly as new as the surviving stateModAt still drops the cat (>=, not >)", () => {
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 5000 } });
    const incoming = snap({ cats: { "cat-1": makeCat(), "cat-2": makeCat({ stateModAt: now - 5000 }) } });
    expect(Object.keys(mergeV2(local, incoming, now).cats).sort()).toEqual(["cat-1"]);
  });

  it("unions deletedCats tombstones from both sides, newest deletedAt per id wins", () => {
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 9000, "cat-3": now - 1000 } });
    const incoming = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 5000, "cat-3": now - 7000 } });
    const merged = mergeV2(local, incoming, now);
    expect(merged.deletedCats).toEqual({ "cat-2": now - 5000, "cat-3": now - 1000 });
  });

  it("repeat-merging the same stale incoming file never resurrects a deleted cat (idempotent)", () => {
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "cat-2": now - 5000 } });
    const stale = snap({ cats: { "cat-1": makeCat(), "cat-2": makeCat({ stateModAt: now - 9000 }) } });
    const once = mergeV2(local, stale, now);
    const twice = mergeV2(once, stale, now);
    expect(Object.keys(twice.cats).sort()).toEqual(["cat-1"]);
    expect(twice).toEqual(once);
  });

  it("only tombstones an id that actually names a cat on either side (never resurrects/affects an unrelated id)", () => {
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "never-existed": now - 9000 } });
    const incoming = snap({ cats: { "cat-1": makeCat() } });
    expect(Object.keys(mergeV2(local, incoming, now).cats).sort()).toEqual(["cat-1"]);
  });
});

/* ---------- deletedEntries tombstones (weigh-in/meal deletion propagation) ---------- */

describe("mergeV2 deletedEntries tombstones", () => {
  it("drops a weigh-in deleted locally even though incoming still has it", () => {
    const local = snap({
      cats: { "cat-1": makeCat({ weightLog: [], deletedEntries: { w1: now - 5000 } }) },
    });
    const incoming = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w1", "2026-01-01", 4.4)] }) } });
    const merged = mergeV2(local, incoming, now);
    expect(merged.cats["cat-1"].weightLog).toEqual([]);
    expect(merged.cats["cat-1"].deletedEntries.w1).toBe(now - 5000);
  });

  it("drops an intake entry deleted on the incoming side, symmetrically", () => {
    const local = snap({ cats: { "cat-1": makeCat({ intakeLog: [meal("m1", "2026-01-01", 200)] }) } });
    const incoming = snap({ cats: { "cat-1": makeCat({ intakeLog: [], deletedEntries: { m1: now - 5000 } }) } });
    expect(mergeV2(local, incoming, now).cats["cat-1"].intakeLog).toEqual([]);
  });

  it("doesn't resurrect a deleted entry on a repeat merge (idempotent)", () => {
    const local = snap({ cats: { "cat-1": makeCat({ weightLog: [], deletedEntries: { w1: now - 5000 } }) } });
    const stale = snap({ cats: { "cat-1": makeCat({ weightLog: [weigh("w1", "2026-01-01", 4.4)] }) } });
    const once = mergeV2(local, stale, now);
    const twice = mergeV2(once, stale, now);
    expect(twice.cats["cat-1"].weightLog).toEqual([]);
    expect(twice).toEqual(once);
  });

  it("clearCatHistory-style tombstones (every entry cleared) keep the whole log empty across a merge with stale data", () => {
    const local = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [],
          intakeLog: [],
          deletedEntries: { w1: now - 5000, w2: now - 5000, m1: now - 5000 },
        }),
      },
    });
    const stale = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4), weigh("w2", "2026-01-02", 4.5)],
          intakeLog: [meal("m1", "2026-01-01", 200)],
        }),
      },
    });
    const merged = mergeV2(local, stale, now);
    expect(merged.cats["cat-1"].weightLog).toEqual([]);
    expect(merged.cats["cat-1"].intakeLog).toEqual([]);
  });

  it("unions deletedEntries from both sides, newest deletedAt per key wins, and still drops unrelated entries only by exact key", () => {
    const local = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w2", "2026-01-02", 4.5)], // NOT tombstoned — must survive
          deletedEntries: { w1: now - 9000 },
        }),
      },
    });
    const incoming = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4), weigh("w2", "2026-01-02", 4.5)],
          deletedEntries: { w1: now - 5000 },
        }),
      },
    });
    const merged = mergeV2(local, incoming, now);
    expect(merged.cats["cat-1"].weightLog.map((e) => e.id)).toEqual(["w2"]);
    expect(merged.cats["cat-1"].deletedEntries).toEqual({ w1: now - 5000 });
  });

  it("a deletedEntries tombstone doesn't affect the current-state bundle LWW — independent mechanisms", () => {
    const local = snap({
      cats: { "cat-1": makeCat({ profile: { name: "Local" }, stateModAt: now - 1000, deletedEntries: { w1: now - 9000 } }) },
    });
    const incoming = snap({
      cats: { "cat-1": makeCat({ profile: { name: "Incoming" }, stateModAt: now - 5000, weightLog: [weigh("w1", "2026-01-01", 4.4)] }) },
    });
    const merged = mergeV2(local, incoming, now).cats["cat-1"];
    expect(merged.profile.name).toBe("Local"); // bundle LWW: local newer, wins
    expect(merged.weightLog).toEqual([]); // entry tombstone still applies regardless
  });
});

/* ---------- tombstone GC (pruneTombstones) ---------- */

describe("pruneTombstones", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("drops a deletedCats tombstone older than the TTL, keeps one within it", () => {
    const now = 1_000_000_000_000;
    const snapshot = { cats: {}, deletedCats: { old: now - TOMBSTONE_TTL_MS - DAY, fresh: now - DAY } };
    const pruned = pruneTombstones(snapshot, now);
    expect(pruned.deletedCats).toEqual({ fresh: now - DAY });
  });

  it("drops a per-cat deletedEntries tombstone older than the TTL, keeps one within it", () => {
    const now = 1_000_000_000_000;
    const snapshot = {
      cats: { "cat-1": { deletedEntries: { old: now - TOMBSTONE_TTL_MS - DAY, fresh: now - DAY } } },
      deletedCats: {},
    };
    const pruned = pruneTombstones(snapshot, now);
    expect(pruned.cats["cat-1"].deletedEntries).toEqual({ fresh: now - DAY });
  });

  it("leaves a cat with no deletedEntries field alone (doesn't fabricate one)", () => {
    const now = 1_000_000_000_000;
    const pruned = pruneTombstones({ cats: { "cat-1": { profile: {} } }, deletedCats: {} }, now);
    expect(pruned.cats["cat-1"].deletedEntries).toBeUndefined();
  });

  it("is a no-op (aside from the deletedCats default) on a snapshot with no old tombstones", () => {
    const now = 1_000_000_000_000;
    const snapshot = { cats: { "cat-1": { deletedEntries: { w1: now - DAY } } }, deletedCats: { c1: now - DAY } };
    expect(pruneTombstones(snapshot, now)).toEqual(snapshot);
  });

  it("mergeV2 GCs ancient tombstones as part of every merge (using the `now` passed in)", () => {
    const now = 1_000_000_000_000;
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "long-gone": now - TOMBSTONE_TTL_MS - DAY } });
    const incoming = snap({ cats: { "cat-1": makeCat() } });
    const merged = mergeV2(local, incoming, now);
    expect(merged.deletedCats).toEqual({});
  });

  it("mergeV2 keeps a tombstone still within the TTL", () => {
    const now = 1_000_000_000_000;
    const local = snap({ cats: { "cat-1": makeCat() }, deletedCats: { "recent": now - DAY } });
    const incoming = snap({ cats: { "cat-1": makeCat() } });
    const merged = mergeV2(local, incoming, now);
    expect(merged.deletedCats).toEqual({ recent: now - DAY });
  });
});

/* ---------- v1-incoming path ---------- */

describe("mergeV2 with a migrated v1 file", () => {
  it("migrates a v1 blob to v2 then merges it in as a new cat", () => {
    const local = snap();
    const v1 = {
      profile: { name: "Legacy Cat", dob: "2024-01-01", weightKg: 4, goal: "maintain", factors: {} },
      ration: [{ id: "lr1", name: "Legacy Food", mode: "perKg", kcalPerKg: 3800, pct: 100 }],
      weightLog: [weigh("lw1", "2025-06-01", 4.1)],
      library: [{ id: "lf1", name: "Legacy Food", mode: "perKg", kcalPerKg: 3800 }],
    };
    const migrated = migrateV1(v1);
    const merged = mergeV2(local, migrated);
    const newIds = Object.keys(merged.cats).filter((id) => id !== "cat-1");
    expect(newIds).toHaveLength(1);
    expect(merged.cats[newIds[0]].profile.name).toBe("Legacy Cat");
    expect(merged.cats[newIds[0]].weightLog).toHaveLength(1);
    expect(merged.library.some((f) => f.name === "Legacy Food")).toBe(true);
    // local cat untouched
    expect(merged.cats["cat-1"]).toEqual(local.cats["cat-1"]);
  });

  it("a wholly-empty v1 blob migrates to a cat with no fields — merging it in changes nothing meaningful", () => {
    const local = snap();
    const migrated = migrateV1({});
    // AppState.jsx guards this case before calling mergeV2 (see importData), but mergeV2
    // itself is still safe to call directly: it just adds an extra empty cat entry.
    const merged = mergeV2(local, migrated);
    expect(merged.cats["cat-1"]).toEqual(local.cats["cat-1"]);
  });
});

/* ---------- result always validates ---------- */

describe("mergeV2 result always validates", () => {
  it("produces a blob that passes validateImport", () => {
    const local = snap({
      cats: {
        "cat-1": makeCat({
          weightLog: [weigh("w1", "2026-01-01", 4.4)],
          intakeLog: [meal("m1", "2026-01-01", 200)],
          intakeDayStatus: { "2026-01-01": "incomplete" },
        }),
      },
      library: [{ id: "f1", name: "Food A", mode: "perKg", kcalPerKg: 4000 }],
      litterRobot: { refreshToken: "rt", robots: [{ serial: "s1", model: "LR4" }], pets: [], petMap: {}, robotMap: {} },
    });
    const incoming = snap({
      activeCatId: "cat-2",
      cats: { "cat-2": makeCat({ profile: { name: "Other Cat" } }) },
      library: [{ id: "f2", name: "Food B", mode: "perUnit", kcalPerUnit: 60, gramsPerUnit: 79 }],
    });
    const merged = mergeV2(local, incoming);
    expect(validateImport(merged)).toBe(true);
  });

  it("validates even for a minimal single-cat merge with empty logs", () => {
    expect(validateImport(mergeV2(snap(), snap()))).toBe(true);
  });
});
