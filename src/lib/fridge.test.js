import { describe, it, expect } from "vitest";
import { isCanned, openCan, canStatus, cansOf, availableCansOf, planDraw, consumeFromFridge, returnToFridge, planPackDraw, consumePack, activeMemberWithFridge, packStartIndex } from "./fridge.js";

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

  it("consumes grams oldest-first, opening cans, and drops emptied cans", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 30 }];
    const out = consumeFromFridge(fridge, wet, 40, "2026-02-02", 3, mkId);
    // the 30g can is emptied (dropped); a new 80g can opened with 10g taken → 70 left
    expect(out).toHaveLength(1);
    expect(out[0].remainingGrams).toBe(70);
    expect(out[0].openedDate).toBe("2026-02-02");
  });

  it("consume is a no-op for non-canned foods", () => {
    const fridge = [];
    expect(consumeFromFridge(fridge, dry, 40, "2026-02-02", 3, mkId)).toEqual([]);
  });

  it("returnToFridge refills the newest can up to a full can, then re-opens one for the rest", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 50 }]; // canGrams 80, room 30
    const out = returnToFridge(fridge, wet, 45, "2026-02-03", mkId);
    // 30 tops the existing can to 80; the remaining 15 re-opens a fresh can
    expect(out).toHaveLength(2);
    const topped = out.find((c) => c.openedDate === "2026-02-01");
    const fresh = out.find((c) => c.openedDate === "2026-02-03");
    expect(topped.remainingGrams).toBe(80);
    expect(fresh.remainingGrams).toBe(15);
  });

  it("consume then return the same grams nets out (an edit up-then-down leaves stock unchanged)", () => {
    const start = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 60 }];
    const afterDraw = consumeFromFridge(start, wet, 25, "2026-02-01", 3, mkId); // 60 → 35
    const restored = returnToFridge(afterDraw, wet, 25, "2026-02-01", mkId);     // 35 → 60
    const total = (fr) => fr.reduce((s, c) => s + c.remainingGrams, 0);
    expect(total(restored)).toBeCloseTo(total(start), 5);
  });

  it("returnToFridge is a no-op for non-canned foods", () => {
    expect(returnToFridge([], dry, 40, "2026-02-01", mkId)).toEqual([]);
  });

  it("cansOf filters by name, case-insensitively", () => {
    const fridge = [openCan(wet, "2026-02-01", mkId), openCan(dry, "2026-02-01", mkId)];
    expect(cansOf(fridge, "tiki chicken")).toHaveLength(1);
  });
});

describe("variety-pack draw (in order, by the can)", () => {
  const A = { name: "Chicken", mode: "perUnit", type: "wet", kcalPerUnit: 80, gramsPerUnit: 80 };
  const B = { name: "Lamb", mode: "perUnit", type: "wet", kcalPerUnit: 80, gramsPerUnit: 80 };
  const C = { name: "Salmon", mode: "perUnit", type: "wet", kcalPerUnit: 80, gramsPerUnit: 80 };
  const pack = { id: "r", splitMode: "remainder", rotation: [A, B, C], rotIndex: 0 };
  const DAY = "2026-03-01";

  it("a day bigger than a can finishes the first flavor then opens the next", () => {
    const { segs, endIndex } = planPackDraw(pack, 100, [], DAY, 3); // 80g can + 20g into the next
    expect(segs).toEqual([
      { flavor: "Chicken", kind: "new", take: 80 },
      { flavor: "Lamb", kind: "new", take: 20 },
    ]);
    expect(endIndex).toBe(1); // sitting on Lamb (its can has 60 left for tomorrow)
  });

  it("consumePack leaves the next flavor's can open and advances the cursor", () => {
    const { fridge, rotIndex } = consumePack([], pack, 100, DAY, 3, mkId);
    expect(rotIndex).toBe(1);
    expect(fridge).toHaveLength(1); // Chicken emptied & dropped; Lamb open
    expect(fridge[0].name).toBe("Lamb");
    expect(fridge[0].remainingGrams).toBe(60);
  });

  it("next day: finishes the open Lamb can, then opens the NEXT flavor (Salmon), not more Lamb", () => {
    const day1 = consumePack([], pack, 100, DAY, 3, mkId); // → Lamb 60 left, cursor 1
    const packAt1 = { ...pack, rotIndex: day1.rotIndex };
    const { segs } = planPackDraw(packAt1, 80, day1.fridge, "2026-03-02", 3);
    expect(segs).toEqual([
      { flavor: "Lamb", kind: "open", take: 60, status: expect.anything() }, // finish the open can
      { flavor: "Salmon", kind: "new", take: 20 },                            // then the NEXT flavor
    ]);
  });

  it("the active flavor is the open can's, else the cursor", () => {
    const withOpenLamb = [{ ...openCan(B, DAY, mkId), remainingGrams: 40 }];
    expect(activeMemberWithFridge(pack, DAY, withOpenLamb, 3).name).toBe("Lamb");
    expect(activeMemberWithFridge({ ...pack, rotIndex: 2 }, DAY, [], 3).name).toBe("Salmon");
    expect(packStartIndex({ ...pack, rotIndex: 2 }, [], DAY, 3)).toBe(2);
  });
});
