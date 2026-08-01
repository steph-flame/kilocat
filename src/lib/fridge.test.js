import { describe, it, expect } from "vitest";
import { isCanned, openCan, canStatus, cansOf, availableCansOf, planDraw, consumeFromFridge, returnToFridge } from "./fridge.js";

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

  it("computes use-by and expiry from fridgeDays", () => {
    const c = openCan(wet, "2026-02-01", mkId);
    const s0 = canStatus(c, "2026-02-01", 3);
    expect(s0.useBy).toBe("2026-02-04");
    expect(s0.daysLeft).toBe(3);
    expect(s0.expired).toBe(false);
    const s3 = canStatus(c, "2026-02-04", 3);
    expect(s3.daysLeft).toBe(0);
    expect(s3.expiringToday).toBe(true);
    const s5 = canStatus(c, "2026-02-06", 3);
    expect(s5.expired).toBe(true);
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
