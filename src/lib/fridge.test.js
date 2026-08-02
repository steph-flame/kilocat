import { describe, it, expect } from "vitest";
import { isCanned, openCan, canStatus, cansOf, availableCansOf, planDraw, consumeFromFridge, returnToFridge, finishOpenCan, activeMemberWithFridge, packStartIndex, nextPackIndex } from "./fridge.js";

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

  it("draws down the open can and NEVER opens a new one (finishing/opening are explicit)", () => {
    const fridge = [{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 30 }];
    // feed 40 from a 30g can: the can empties (dropped), the 10g excess is untracked, no new can
    const out = consumeFromFridge(fridge, wet, 40, "2026-02-02", 3);
    expect(out).toHaveLength(0);
    // feed 20 from a 30g can: 10 left, still just the one can
    const out2 = consumeFromFridge([{ ...openCan(wet, "2026-02-01", mkId), remainingGrams: 30 }], wet, 20, "2026-02-02", 3);
    expect(out2).toHaveLength(1);
    expect(out2[0].remainingGrams).toBe(10);
    // nothing open → logging does nothing (no phantom can)
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
    expect(out).toHaveLength(0); // Chicken emptied & dropped; NO Lamb opened
  });

  it("nextPackIndex advances the cursor (used by Finish can), wrapping", () => {
    expect(nextPackIndex(pack)).toBe(1);
    expect(nextPackIndex({ ...pack, rotIndex: 2 })).toBe(0);
    expect(nextPackIndex({ ...pack, rotateOff: true })).toBe(0); // not rotating → no cycle
  });
});
