// The cupboard, and the thing it exists to prevent: a variety pack ending on a run of whatever
// came four-to-a-box. See lib/cupboard.js.

import { describe, it, expect } from "vitest";
import { stockOf, setStock, addStock, addItems, takeOne, stockStartIndex, packStock, normalizeCupboard, normalizeCases } from "./cupboard.js";
import { packStartIndex, openCan } from "./fridge.js";

const flavor = (name) => ({ name, mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 });
const PACK = ["Chicken", "Duck", "Quail", "Salmon"].map(flavor);
const CASE_MIX = [{ name: "Chicken", count: 4 }, { name: "Duck", count: 2 }, { name: "Quail", count: 2 }, { name: "Salmon", count: 4 }];

describe("counting what's unopened", () => {
  it("tells an untracked flavour apart from one you're out of", () => {
    const c = setStock([], "Chicken", 0);
    expect(stockOf(c, "Chicken")).toBe(0);   // "I have none"
    expect(stockOf(c, "Duck")).toBe(null);   // "I don't track this"
  });

  it("matches names the way the fridge does — trimmed, case-insensitively", () => {
    const c = setStock([], "Tiki Chicken", 3);
    expect(stockOf(c, "  tiki chicken ")).toBe(3);
  });

  it("keeps counts whole and never negative", () => {
    expect(stockOf(setStock([], "Chicken", 2.6), "Chicken")).toBe(3);
    expect(stockOf(setStock([], "Chicken", -5), "Chicken")).toBe(0);
    expect(stockOf(addStock(setStock([], "Chicken", 1), "Chicken", -4), "Chicken")).toBe(0);
  });

  it("survives junk from an old or hand-edited export", () => {
    expect(normalizeCupboard(null)).toEqual([]);
    expect(normalizeCupboard([{ name: "  ", count: 3 }, { count: 1 }, { name: "Ok", count: "2" }]))
      .toEqual([{ name: "Ok", count: 2 }]);
    expect(normalizeCases([{ items: [{ name: "A", count: 1 }] }])[0].id).toBeTruthy();
  });

  it("adds a case's mix to the pool, and can be bought twice", () => {
    let c = addItems([], CASE_MIX);
    expect(packStock(PACK, c)).toBe(12);
    c = addItems(c, CASE_MIX);
    expect(stockOf(c, "Chicken")).toBe(8);
    expect(packStock(PACK, c)).toBe(24);
  });

  // Opening a can of something untracked must not START tracking it at zero — zero reads as "out
  // of stock", which would silently drop that flavour out of the rotation.
  it("takes one off the shelf, and stays silent about untracked flavours", () => {
    expect(stockOf(takeOne(setStock([], "Chicken", 3), "Chicken"), "Chicken")).toBe(2);
    expect(stockOf(takeOne(setStock([], "Chicken", 0), "Chicken"), "Chicken")).toBe(0);
    expect(stockOf(takeOne([], "Duck"), "Duck")).toBe(null);
  });
});

describe("choosing the next flavour", () => {
  it("picks the one there's most of", () => {
    const c = addItems([], CASE_MIX);
    expect(PACK[stockStartIndex(PACK, c)].name).toBe("Chicken"); // 4, and first of the two 4s
  });

  it("says nothing when it has nothing to say, so the cursor keeps deciding", () => {
    expect(stockStartIndex(PACK, [])).toBe(-1);                                   // untracked
    expect(stockStartIndex(PACK, addItems([], CASE_MIX.map((i) => ({ ...i, count: 0 }))))).toBe(-1); // all out
  });

  // The whole point, run end to end: eat a 4/2/2/4 case one can at a time, always taking the
  // fullest pile, and check what the last few cans look like.
  it("finishes a lopsided case varied instead of on a run of one flavour", () => {
    let cup = addItems([], CASE_MIX);
    const order = [];
    while (packStock(PACK, cup) > 0) {
      const i = stockStartIndex(PACK, cup);
      order.push(PACK[i].name);
      cup = takeOne(cup, PACK[i].name);
    }
    expect(order).toHaveLength(12);
    // every can accounted for, in the right proportions
    const count = (n) => order.filter((x) => x === n).length;
    expect([count("Chicken"), count("Duck"), count("Quail"), count("Salmon")]).toEqual([4, 2, 2, 4]);
    // and the tail is varied — the failure being fixed is ending on four of the same
    expect(new Set(order.slice(-4)).size).toBe(4);
    expect(Math.max(...order.map((n, i) => (i > 0 && order[i - 1] === n ? 2 : 1)))).toBe(1); // never twice running
  });

  // What that same case did before counts existed: strict list order, so once the 2s ran out the
  // last four cans alternated between the two flavours that came four-to-a-box.
  it("round-robin over the same case ends on the two you have most of", () => {
    const stock = { Chicken: 4, Duck: 2, Quail: 2, Salmon: 4 };
    const order = [];
    let i = 0;
    while (Object.values(stock).some((n) => n > 0)) {
      const name = PACK[i % PACK.length].name;
      if (stock[name] > 0) { stock[name] -= 1; order.push(name); }
      i += 1;
    }
    expect(new Set(order.slice(-4)).size).toBe(2); // Chicken/Salmon, over and over
  });
});

describe("what the fridge asks for", () => {
  const rot = { id: "s1", rotation: PACK, rotIndex: 0 };
  const DAY = "2026-02-02";

  it("an open can still beats any count — finish what's in the fridge", () => {
    const cup = addItems([], CASE_MIX); // says Chicken
    const fridge = [openCan(flavor("Quail"), DAY, () => "c1")];
    expect(PACK[packStartIndex(rot, fridge, DAY, 3, cup)].name).toBe("Quail");
  });

  it("with nothing open, the cupboard decides", () => {
    const cup = addItems([], [{ name: "Duck", count: 6 }, { name: "Chicken", count: 1 }]);
    expect(PACK[packStartIndex(rot, [], DAY, 3, cup)].name).toBe("Duck");
  });

  it("with no cupboard at all, nothing changes from before", () => {
    expect(packStartIndex({ ...rot, rotIndex: 2 }, [], DAY, 3, undefined)).toBe(2);
    expect(packStartIndex({ ...rot, rotIndex: 2 }, [], DAY, 3, [])).toBe(2);
  });
});
