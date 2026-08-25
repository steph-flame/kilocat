import { describe, it, expect } from "vitest";
import { isCanned, openCan, canStatus, cansOf, availableCansOf, planDraw, planSlotDraw, isEmptied, emptiedCansOf, consumeFromFridge, returnToFridge, finishOpenCan, activeMemberWithFridge, packStartIndex, nextPackIndex, pantryMembers, resolvePantrySlots, pantryExclusions } from "./fridge.js";

let idn = 0;
const mkId = () => `can-${idn++}`;
const wet = { name: "Tiki Chicken", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 };
const dry = { name: "Kibble", mode: "perKg", type: "dry", kcalPerKg: 3800, gramsPerCup: 120 };

describe("fridge", () => {
  it("tracks only wet cans/pouches", () => {
    expect(isCanned(wet)).toBe(true);
    expect(isCanned(dry)).toBe(false);
    expect(isCanned({ ...wet, type: "treat", mode: "perUnit" })).toBe(false);
  });

  it("opens a full can snapshot", () => {
    const c = openCan(wet, "2026-02-01", mkId);
    expect(c.remainingGrams).toBe(80);
    expect(c.canGrams).toBe(80);
    expect(c.openedDate).toBe("2026-02-01");
    expect(c.name).toBe("Tiki Chicken");
    expect(c.id).toBeTruthy();
  });

  it("computes goodThru and expiry from fridgeDays, counting the open day", () => {
    // A 3-day can opened the 1st is good the 1st/2nd/3rd (goodThru = the 3rd), toss on the 4th.
    const c = openCan(wet, "2026-02-01", mkId);
    const s0 = canStatus(c, "2026-02-01", 3);
    expect(s0.goodThru).toBe("2026-02-03");
    expect(s0.daysLeft).toBe(2);
    expect(s0.expired).toBe(false);
    const sLast = canStatus(c, "2026-02-03", 3); // the last good day
    expect(sLast.daysLeft).toBe(0);
    expect(sLast.expiringToday).toBe(true);
    expect(sLast.expired).toBe(false);
    const sToss = canStatus(c, "2026-02-04", 3); // one day past — toss it
    expect(sToss.expired).toBe(true);
  });

  it("draws oldest good can first, then opens new ones", () => {
    const fridge = [
      { ...openCan(wet, "2026-02-02", mkId), remainingGrams: 30 },
      { ...openCan(wet, "2026-02-01", mkId), remainingGrams: 20 }, // older
    ];
    const plan = planDraw(fridge, wet, 40, "2026-02-02", 3);
    // 20 from the older can, then 20 from the next open can (no new can needed)
    expect(plan.segs[0].kind).toBe("open");
    expect(plan.segs[0].take).toBe(20);
    expect(plan.segs[1].take).toBe(20);
    expect(plan.segs.every((s) => s.kind === "open")).toBe(true);
  });

  it("opens a new can when open stock is short", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 10 }];
    const plan = planDraw(fridge, wet, 50, "2026-02-01", 3);
    expect(plan.segs[0].kind).toBe("open");
    expect(plan.segs[0].take).toBe(10);
    expect(plan.segs[1].kind).toBe("new");
    expect(plan.segs[1].take).toBe(40);
  });

  it("skips an expired can and opens fresh instead", () => {
    const fridge = [{ ...openCan(wet, "2026-01-01", mkId), remainingGrams: 50 }]; // long expired by Feb
    const avail = availableCansOf(fridge, "Tiki Chicken", "2026-02-10", 3);
    expect(avail).toHaveLength(0);
    const plan = planDraw(fridge, wet, 40, "2026-02-10", 3);
    expect(plan.segs).toHaveLength(1);
    expect(plan.segs[0].kind).toBe("new");
  });

  it("draws down the open can and never opens a SECOND one off it (that was the phantom-can bug)", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 30 }];
    // feed 40 from a 30g can: the can reads empty, the 10g excess is untracked, no new can.
    // The can is KEPT at zero rather than deleted — a "80 g" can varies both ways, so tracked-zero
    // is a prompt to confirm, not proof the can is empty (see isEmptied / the UI's "still has N g").
    const out = consumeFromFridge(fridge, wet, 40, "2026-02-02", 3, mkId);
    expect(out).toHaveLength(1);
    expect(out[0].remainingGrams).toBe(0);
    expect(isEmptied(out[0])).toBe(true);
    expect(availableCansOf(out, wet.name, "2026-02-02", 3)).toHaveLength(0); // never fed from
    // feed 20 from a 30g can: 10 left, still just the one can
    const out2 = consumeFromFridge([{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 30 }], wet, 20, "2026-02-02", 3, mkId);
    expect(out2).toHaveLength(1);
    expect(out2[0].remainingGrams).toBe(10);
  });

  // The other half of that rule, and the one that was wrong: an EMPTY SHELF has no drift to be
  // wrong about. The food was fed, so a can was opened — silently dropping that left the fridge
  // claiming nothing had been opened, and the owner with no record of a can they'd just started.
  it("opens a can when nothing of that food is open at all", () => {
    const out = consumeFromFridge([], wet, 40, "2026-02-02", 3, mkId);
    expect(out).toHaveLength(1);
    expect(out[0].openedDate).toBe("2026-02-02");
    expect(out[0].remainingGrams).toBe(40); // an 80 g can with tonight's 40 g gone
    expect(availableCansOf(out, wet.name, "2026-02-02", 3)).toHaveLength(1);
  });

  it("but NOT when a can of it is sitting at zero waiting to be confirmed", () => {
    // that can is probably still the one being fed from — opening another is the phantom bug
    const emptied = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 0 }];
    expect(consumeFromFridge(emptied, wet, 40, "2026-02-02", 3, mkId)).toHaveLength(1);
  });

  it("opens as many cans as the meal actually needed", () => {
    const out = consumeFromFridge([], wet, 200, "2026-02-02", 3, mkId); // 80 g cans
    expect(out).toHaveLength(3);
    expect(out.reduce((s, c) => s + c.remainingGrams, 0)).toBeCloseTo(40, 5); // 240 opened, 200 fed
  });

  it("opens nothing without an id factory, rather than producing a can with no id", () => {
    expect(consumeFromFridge([], wet, 40, "2026-02-02", 3)).toEqual([]);
  });

  it("finishOpenCan removes the open can regardless of tracked grams", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 5 }];
    expect(finishOpenCan(fridge, wet, "2026-02-02", 3)).toHaveLength(0);
    expect(finishOpenCan([], wet, "2026-02-02", 3)).toEqual([]); // nothing to finish
  });

  it("consume is a no-op for non-canned foods", () => {
    const fridge = [];
    expect(consumeFromFridge(fridge, dry, 40, "2026-02-02", 3)).toEqual([]);
  });

  it("returnToFridge refills the newest can up to full, and drops what won't fit", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 50 }]; // canGrams 80, room 30
    const out = returnToFridge(fridge, wet, 45, "2026-02-03");
    // 30 tops the existing can up; the other 15 has no can to go back into and is dropped rather
    // than conjuring one — food only goes back where food came from
    expect(out).toHaveLength(1);
    expect(out[0].remainingGrams).toBe(80);
  });

  // Her bug, in the two steps that produced it: log a wet meal with an empty fridge, then delete it.
  // The fridge used to do nothing on the way in and invent an open can on the way out.
  it("logging then deleting a meal on an empty shelf leaves the fridge as it started", () => {
    const opened = consumeFromFridge([], wet, 40, "2026-02-02", 3, mkId);
    expect(opened).toHaveLength(1);          // the can she opened is recorded...
    expect(opened[0].remainingGrams).toBe(40);
    const undone = returnToFridge(opened, wet, 40, "2026-02-02");
    expect(undone).toHaveLength(1);          // ...and undoing the meal fills it back up
    expect(undone[0].remainingGrams).toBe(80);
  });

  it("never invents a can out of nothing, however the return arrives", () => {
    expect(returnToFridge([], wet, 40, "2026-02-02")).toEqual([]);
    // the can it came from was finished in between: the grams are simply gone, not re-materialised
    const finished = finishOpenCan(consumeFromFridge([], wet, 40, "2026-02-02", 3, mkId), wet, "2026-02-02", 3);
    expect(returnToFridge(finished, wet, 40, "2026-02-02")).toEqual([]);
  });

  it("consume then return the same grams nets out (an edit up-then-down leaves stock unchanged)", () => {
    const start = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 60 }];
    const afterDraw = consumeFromFridge(start, wet, 25, "2026-02-01", 3, mkId); // 60 → 35
    const restored = returnToFridge(afterDraw, wet, 25, "2026-02-01");           // 35 → 60
    const total = (fr) => fr.reduce((s, c) => s + c.remainingGrams, 0);
    expect(total(restored)).toBeCloseTo(total(start), 5);
  });

  it("returnToFridge is a no-op for non-canned foods", () => {
    expect(returnToFridge([], dry, 40, "2026-02-01")).toEqual([]);
  });

  it("cansOf filters by name, case-insensitively", () => {
    const fridge = [openCan(wet, "2026-02-01", mkId), openCan(dry, "2026-02-01", mkId)];
    expect(cansOf(fridge, "tiki chicken")).toHaveLength(1);
  });
});

describe("variety pack — explicit open/finish, in order", () => {
  const A = { name: "Chicken", mode: "perUnit", type: "wet", kcalPerUnit: 80, gramsPerUnit: 80 };
  const B = { name: "Lamb", mode: "perUnit", type: "wet", kcalPerUnit: 80, gramsPerUnit: 80 };
  const C = { name: "Salmon", mode: "perUnit", type: "wet", kcalPerUnit: 80, gramsPerUnit: 80 };
  const pack = { id: "r", splitMode: "remainder", rotation: [A, B, C], rotIndex: 0 };
  const DAY = "2026-03-01";

  it("the current flavor is the open can's, else the cursor", () => {
    const withOpenLamb = [{ ...openCan(B, DAY, mkId), remainingGrams: 40 }];
    expect(activeMemberWithFridge(pack, DAY, withOpenLamb, 3).name).toBe("Lamb");   // finish what's open
    expect(activeMemberWithFridge({ ...pack, rotIndex: 2 }, DAY, [], 3).name).toBe("Salmon"); // else cursor
    expect(packStartIndex({ ...pack, rotIndex: 2 }, [], DAY, 3)).toBe(2);
  });

  it("logging draws down the open can only — it never auto-opens the next flavor", () => {
    const fridge = [{ ...openCan(A, DAY, mkId), remainingGrams: 30 }];
    const flavor = activeMemberWithFridge(pack, DAY, fridge, 3); // Chicken (open)
    const out = consumeFromFridge(fridge, flavor, 50, DAY, 3);   // feed 50 from a 30g can
    // Chicken reads empty but is kept for confirmation; crucially NO Lamb was auto-opened.
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe(A.name);
    expect(out[0].remainingGrams).toBe(0);
    expect(cansOf(out, B.name)).toHaveLength(0);
  });

  it("nextPackIndex advances the cursor (used by Finish can), wrapping", () => {
    expect(nextPackIndex(pack)).toBe(1);
    expect(nextPackIndex({ ...pack, rotIndex: 2 })).toBe(0);
    expect(nextPackIndex({ ...pack, rotateOff: true })).toBe(0); // not rotating → no cycle
  });
});

describe("planSlotDraw — a slot that outlives its open can", () => {
  // Steph's case: the fridge correctly says 3.4 g left, but the plan showed 53.3 g — the whole
  // slot priced at the OPEN can's density, ignoring that the rest comes from the next flavor.
  const flavor = (name, kcalPerKg) => ({ name, type: "wet", mode: "perUnit", gramsPerUnit: 80, kcalPerUnit: (kcalPerKg * 80) / 1000, kcalPerKg });
  const A_ = flavor("Quail Egg", 1200); // 1.2 kcal/g
  const B_ = flavor("Beef", 1000);      // 1.0 kcal/g — deliberately different density
  const pack = { ...A_, id: "slot", splitMode: "share", rotation: [A_, B_], rotIndex: 0 };
  const today = "2026-02-02";
  const openCan = (f, remainingGrams, openedDate = "2026-02-01") =>
    ({ id: `can-${f.name}`, ...f, openedDate, canGrams: 80, remainingGrams });

  it("finishes the open can first, then continues in the NEXT flavor at its own density", () => {
    const fridge = [openCan(A_, 3.4)];
    const { segs, shortfall } = planSlotDraw(pack, 64, today, fridge, 3);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ name: "Quail Egg", kind: "open", grams: 3.4 });
    expect(segs[1].name).toBe("Beef");
    expect(segs[1].kind).toBe("new");
    // 64 kcal - (3.4 g x 1.2) = 59.92 kcal left, at 1.0 kcal/g -> 59.92 g of Beef
    expect(segs[1].grams).toBeCloseTo(59.92, 1);
    expect(shortfall).toBe(0);
  });

  it("the segments still add up to the slot's energy — the split is by kcal, not grams", () => {
    const { segs } = planSlotDraw(pack, 64, today, [openCan(A_, 3.4)], 3);
    expect(segs.reduce((a, s) => a + s.kcal, 0)).toBeCloseTo(64, 1);
  });

  it("one segment when the open can comfortably covers the slot (no spurious split)", () => {
    const { segs } = planSlotDraw(pack, 24, today, [openCan(A_, 60)], 3);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ name: "Quail Egg", kind: "open" });
    expect(segs[0].grams).toBeCloseTo(20, 1); // 24 kcal / 1.2
  });

  it("opens the current flavor when nothing is open at all", () => {
    const { segs } = planSlotDraw(pack, 24, today, [], 3);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ name: "Quail Egg", kind: "new" });
  });

  it("skips an EXPIRED open can rather than planning to feed it", () => {
    const stale = openCan(A_, 60, "2026-01-01"); // long past a 3-day life
    const { segs } = planSlotDraw(pack, 24, today, [stale], 3);
    expect(segs[0].kind).toBe("new"); // not drawn from the expired can
  });

  it("walks the whole pack for a big slot and reports what it couldn't place", () => {
    const { segs, shortfall } = planSlotDraw(pack, 10000, today, [], 3);
    expect(segs.map((s) => s.name)).toEqual(["Quail Egg", "Beef"]); // one new can each, then stops
    expect(shortfall).toBeGreaterThan(0); // honest about the rest rather than inventing cans
  });

  it("works for a plain canned food with no rotation", () => {
    const solo = { ...A_, id: "s", splitMode: "share" };
    const { segs } = planSlotDraw(solo, 64, today, [openCan(A_, 3.4)], 3);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.name === "Quail Egg")).toBe(true); // same food, next can
  });

  it("returns nothing for a zero/negative need", () => {
    expect(planSlotDraw(pack, 0, today, [openCan(A_, 3.4)], 3).segs).toEqual([]);
    expect(planSlotDraw(null, 64, today, [], 3).segs).toEqual([]);
  });
});

describe("a can that reads empty is confirmed, not assumed", () => {
  // Real cans don't hold exactly what the label says. Steph's "empty" can actually had 6.9 g in it.
  // Auto-deleting at tracked-zero breaks both ways: over-fill silently bins a can with food left
  // and tells you to open the next one; under-fill leaves you scraping a can the app thinks is full.
  const wet = { name: "Tiki", type: "wet", mode: "perUnit", gramsPerUnit: 80, kcalPerUnit: 96 };
  const mk = (() => { let n = 0; return () => `c${n++}`; })();
  const today = "2026-02-02";

  it("keeps the emptied can so the owner can say it still has food", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mk), remainingGrams: 3.4 }];
    const after = consumeFromFridge(fridge, wet, 3.4, today, 3);
    expect(after).toHaveLength(1);
    expect(emptiedCansOf(after, wet.name)).toHaveLength(1);
    // the owner finds 6.9 g actually left and corrects it — the can comes back into play
    const corrected = after.map((c) => ({ ...c, remainingGrams: 6.9 }));
    expect(availableCansOf(corrected, wet.name, today, 3)).toHaveLength(1);
    expect(emptiedCansOf(corrected, wet.name)).toHaveLength(0);
  });

  it("an emptied can is never planned from — the plan moves to the next flavor", () => {
    const A2 = { ...wet, name: "Chicken", kcalPerKg: 1200 };
    const B2 = { ...wet, name: "Lamb", kcalPerKg: 1200 };
    const pack = { ...A2, id: "s", rotation: [A2, B2], rotIndex: 0 };
    const emptied = [{ ...openCan(A2, "2026-02-01", mk), remainingGrams: 0 }];
    const { segs } = planSlotDraw(pack, 60, today, emptied, 3);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ name: "Lamb", kind: "new" });
  });

  it("finishing works on a can that reads empty (the usual case now)", () => {
    const emptied = [{ ...openCan(wet, "2026-02-01", mk), remainingGrams: 0 }];
    expect(finishOpenCan(emptied, wet, today, 3)).toHaveLength(0);
  });

  it("finishing still prefers a non-expired can when both exist", () => {
    const stale = { ...openCan(wet, "2026-01-01", mk), remainingGrams: 0 };
    const fresh = { ...openCan(wet, "2026-02-01", mk), remainingGrams: 20 };
    const after = finishOpenCan([stale, fresh], wet, today, 3);
    expect(after.map((c) => c.id)).toEqual([stale.id]); // the fresh one was the "open" one
  });
});

// A slot that follows the pantry: its flavour list IS the cupboard, materialized at read time.
describe("rotating through the pantry", () => {
  const LIB = [
    { name: "Duck Can", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 },
    { name: "Chicken Can", mode: "perUnit", type: "wet", kcalPerUnit: 70, gramsPerUnit: 80 },
    { name: "Quail Can", mode: "perUnit", type: "wet", kcalPerUnit: 60, gramsPerUnit: 80 },
    { name: "Kibble", mode: "perKg", type: "dry", kcalPerKg: 3800 },          // never a member
    { name: "Unstocked Can", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 },
  ];
  const CUP = [{ name: "Duck Can", count: 2 }, { name: "Chicken Can", count: 5 }, { name: "Quail Can", count: 0 }];
  const DAY = "2026-02-02";
  const slot = { id: "s1", name: "Duck Can", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80, rotateSource: "pantry", splitMode: "remainder", pct: 100 };
  const ctx = (fridge = [], cupboard = CUP) => ({ cupboard, fridge, library: LIB, date: DAY, fridgeDays: 3 });

  it("members are the stocked (or open) wet cans, fullest pile first", () => {
    const m = pantryMembers(CUP, [], LIB, DAY, 3);
    expect(m.map((f) => f.name)).toEqual(["Chicken Can", "Duck Can"]); // 5, then 2; Quail at 0 and Unstocked are out
  });

  it("an open can keeps its flavour in the rotation even with zero stock", () => {
    const fridge = [openCan(LIB[2], DAY, mkId)]; // Quail open, 0 in cupboard
    const m = pantryMembers(CUP, fridge, LIB, DAY, 3);
    expect(m.some((f) => f.name === "Quail Can")).toBe(true);
    // and the open can WINS the start position — finish what's open, whatever the counts say
    const mat = resolvePantrySlots([slot], ctx(fridge))[0];
    expect(mat.rotation[packStartIndex(mat, fridge, DAY, 3, CUP)].name).toBe("Quail Can");
  });

  it("materializes the slot into an ordinary rotation row", () => {
    const mat = resolvePantrySlots([slot], ctx())[0];
    expect(mat.rotation.map((f) => f.name)).toEqual(["Chicken Can", "Duck Can"]);
    expect(activeMemberWithFridge(mat, DAY, [], 3, CUP).name).toBe("Chicken Can"); // fullest pile opens next
  });

  it("an empty pantry falls back to the slot's own last flavour, flagged", () => {
    const mat = resolvePantrySlots([slot], ctx([], []))[0];
    expect(mat.pantryEmpty).toBe(true);
    expect(mat.rotation).toHaveLength(1);
    expect(mat.rotation[0].name).toBe("Duck Can"); // the row's own fields — never a blank bowl
  });

  it("buying a case changes the rotation by itself", () => {
    const restocked = [...CUP.filter((r) => r.name !== "Quail Can"), { name: "Quail Can", count: 9 }];
    const mat = resolvePantrySlots([slot], ctx([], restocked))[0];
    expect(mat.rotation[0].name).toBe("Quail Can"); // tallest pile now leads
  });

  it("leaves explicit-list slots exactly alone", () => {
    const explicit = { id: "s2", rotation: [LIB[0], LIB[1]], rotIndex: 1 };
    expect(resolvePantrySlots([explicit], ctx())[0]).toBe(explicit);
  });
});

// The membership rule is fine; its SILENCE wasn't. Everything stocked-but-excluded gets a reason.
describe("pantryExclusions — why a stocked flavour isn't rotating", () => {
  const LIB = [
    { name: "Good Can", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 },
    { name: "Gramless Can", mode: "perUnit", type: "wet", kcalPerUnit: 66 },        // savable, not rotatable
    { name: "ByWeight Wet", mode: "perKg", type: "wet", kcalPerKg: 900 },
    { name: "Kibble", mode: "perKg", type: "dry", kcalPerKg: 3800 },
  ];
  const DAY = "2026-02-02";
  const stock = (names) => names.map((name) => ({ name, count: 2 }));

  it("names each miss with its distinct fix", () => {
    const out = pantryExclusions(stock(["Good Can", "Gramless Can", "ByWeight Wet", "Kibble", "Mystery"]), [], LIB, DAY, 3);
    const by = Object.fromEntries(out.map((m) => [m.name, m.reason]));
    expect(by["Good Can"]).toBeUndefined();          // a member — nothing to explain
    expect(by["Gramless Can"]).toBe("noGrams");
    expect(by["ByWeight Wet"]).toBe("byWeight");
    expect(by["Kibble"]).toBe("dry");
    expect(by["Mystery"]).toBe("unsaved");
  });

  // The trap that prompted this: the Foods page deliberately saves a can on kcal alone
  // (isCompleteFood), and the pantry rule then excluded it without a word.
  it("a can saved without grams is countable but flagged, not silently dropped", () => {
    const out = pantryExclusions(stock(["Gramless Can"]), [], LIB, DAY, 3);
    expect(out).toEqual([{ name: "Gramless Can", reason: "noGrams" }]);
    expect(pantryMembers(stock(["Gramless Can"]), [], LIB, DAY, 3)).toEqual([]);
  });

  it("an open can of an unsaved food is an exclusion too, not invisible", () => {
    const out = pantryExclusions([], [{ id: "c1", name: "Orphan Open", openedDate: DAY, canGrams: 80, remainingGrams: 40 }], LIB, DAY, 3);
    expect(out).toEqual([{ name: "Orphan Open", reason: "unsaved" }]);
  });

  it("zero stock and nothing open is not an exclusion — it's just not stocked", () => {
    expect(pantryExclusions([{ name: "Kibble", count: 0 }], [], LIB, DAY, 3)).toEqual([]);
  });
});
