// @vitest-environment jsdom
//
// The fridge, driven through AppProvider's real context the way the Log page drives it —
// consumeFridge / reconcileFridge / consumeRotationSlot, not the pure lib underneath.
//
// This file exists because the reported bug lived in the WIRING as much as the logic: logging a wet
// meal with nothing open left the fridge untouched, and deleting that same meal conjured an open can
// holding exactly the deleted amount. Both halves went through these seams, and a pure fridge.js
// test could not see either — one of them was an argument that wasn't being passed.

import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { AppProvider, useApp } from "./AppState.jsx";

const clearStorage = () => { try { window.localStorage.clear(); } catch { /* stubbed in this env */ } };
afterEach(() => { cleanup(); clearStorage(); });

function Probe({ apiRef }) { apiRef.current = useApp(); return null; }
async function renderApp() {
  const apiRef = { current: null };
  const utils = render(<AppProvider><Probe apiRef={apiRef} /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  act(() => apiRef.current.addCat()); // a real cat: the demo cat's state is regenerated each render
  return { apiRef, ...utils };
}

const WET = { name: "Tiki Chicken", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 };
const DRY = { name: "Kibble", mode: "perKg", type: "dry", kcalPerKg: 3800 };
const cans = (apiRef) => apiRef.current.fridge;

describe("logging a wet meal keeps the fridge honest", () => {
  it("opens the can it was fed from when nothing of that food is open", async () => {
    const { apiRef } = await renderApp();
    expect(cans(apiRef)).toHaveLength(0);
    act(() => apiRef.current.consumeFridge(WET, 40));
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].remainingGrams).toBe(40); // 80 g can, 40 g fed
    expect(cans(apiRef)[0].id).toBeTruthy();         // a real id, not undefined
  });

  // The bug as reported, end to end.
  it("and deleting that meal fills the can back up instead of inventing a second one", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.consumeFridge(WET, 40));
    act(() => apiRef.current.reconcileFridge(WET, -40)); // what removeEntry does
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].remainingGrams).toBe(80);
  });

  it("deleting a meal the fridge never recorded creates nothing at all", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.reconcileFridge(WET, -40));
    expect(cans(apiRef)).toHaveLength(0);
  });

  it("an edit up and back down nets out", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.openFridgeCan(WET));
    act(() => apiRef.current.reconcileFridge(WET, 25));
    expect(cans(apiRef)[0].remainingGrams).toBe(55);
    act(() => apiRef.current.reconcileFridge(WET, -25));
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].remainingGrams).toBe(80);
  });

  it("leaves dry food alone in both directions", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.consumeFridge(DRY, 40));
    act(() => apiRef.current.reconcileFridge(DRY, -40));
    expect(cans(apiRef)).toHaveLength(0);
  });

  it("a second meal draws the can it just opened down further, rather than opening another", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.consumeFridge(WET, 30));
    act(() => apiRef.current.consumeFridge(WET, 30));
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].remainingGrams).toBe(20);
  });
});

// A can that appears in the fridge left the cupboard. There are five routes that open one and the
// decrement lives in exactly one place (setFridge), so these check the routes, not the arithmetic.
describe("opening a can takes it off the shelf", () => {
  const stocked = (apiRef, n) => act(() => apiRef.current.setStockOf(WET.name, n));
  const left = (apiRef) => apiRef.current.cupboard.find((r) => r.name === WET.name)?.count;

  it("by hand, from the Cans page", async () => {
    const { apiRef } = await renderApp();
    stocked(apiRef, 6);
    act(() => apiRef.current.openFridgeCan(WET));
    expect(left(apiRef)).toBe(5);
  });

  // The one a caller could never have remembered to do: this open happens inside pure fridge code
  // that knows nothing about stock. Diffing the fridge in setFridge is what covers it.
  it("and when logging a meal opens one on its own", async () => {
    const { apiRef } = await renderApp();
    stocked(apiRef, 6);
    act(() => apiRef.current.consumeFridge(WET, 40));
    expect(apiRef.current.fridge).toHaveLength(1);
    expect(left(apiRef)).toBe(5);
  });

  it("but drawing down a can already open takes nothing more", async () => {
    const { apiRef } = await renderApp();
    stocked(apiRef, 6);
    act(() => apiRef.current.openFridgeCan(WET));
    act(() => apiRef.current.consumeFridge(WET, 20));
    act(() => apiRef.current.consumeFridge(WET, 20));
    expect(left(apiRef)).toBe(5); // one can opened, one can gone
  });

  it("never goes below zero, and opening an untracked food starts nothing", async () => {
    const { apiRef } = await renderApp();
    stocked(apiRef, 1);
    act(() => apiRef.current.openFridgeCan(WET));
    act(() => apiRef.current.openFridgeCan(WET)); // one more than she had
    expect(left(apiRef)).toBe(0);
    act(() => apiRef.current.openFridgeCan({ ...WET, name: "Something Else" }));
    expect(apiRef.current.cupboard.find((r) => r.name === "Something Else")).toBeUndefined();
  });
});

describe("cases", () => {
  it("pour their mix into the cupboard, and can be bought again", async () => {
    const { apiRef } = await renderApp();
    let id;
    act(() => { id = apiRef.current.addCase("Tiki variety"); });
    act(() => apiRef.current.setCaseItem(id, "Chicken", 4));
    act(() => apiRef.current.setCaseItem(id, "Duck", 2));
    act(() => apiRef.current.stockCase(id));
    expect(apiRef.current.cupboard).toEqual([{ name: "Chicken", count: 4 }, { name: "Duck", count: 2 }]);
    act(() => apiRef.current.stockCase(id));
    expect(apiRef.current.cupboard.find((r) => r.name === "Chicken").count).toBe(8);
    // the case is a shopping list, not a container — buying it doesn't use it up
    expect(apiRef.current.cases[0].items).toHaveLength(2);
  });

  it("can be removed without touching what's already on the shelf", async () => {
    const { apiRef } = await renderApp();
    let id;
    act(() => { id = apiRef.current.addCase("Old case"); });
    act(() => apiRef.current.setCaseItem(id, "Chicken", 4));
    act(() => apiRef.current.stockCase(id));
    act(() => apiRef.current.removeCase(id));
    expect(apiRef.current.cases).toHaveLength(0);
    expect(apiRef.current.cupboard.find((r) => r.name === "Chicken").count).toBe(4);
  });
});

describe("a variety pack slot", () => {
  const PACK = {
    id: "slot1", name: "Tiki Variety", splitMode: "remainder", pct: 100,
    rotation: [
      { name: "Tiki Chicken", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 },
      { name: "Tiki Quail", mode: "perUnit", type: "wet", kcalPerUnit: 70, gramsPerUnit: 80 },
    ],
    rotIndex: 0,
  };

  // consumeRotationSlot resolves the flavor and then consumes; it was the one caller not handing
  // over an id factory, so a pack fed off an empty shelf could never record its can.
  it("records the can opened for the current flavor", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.ration.setItems([PACK]));
    act(() => apiRef.current.consumeRotationSlot("slot1", 40));
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].name).toBe("Tiki Chicken");
    expect(cans(apiRef)[0].id).toBeTruthy();
    expect(cans(apiRef)[0].remainingGrams).toBe(40);
  });

  // The feature, through the real seams: stock says Quail even though Chicken is first in the list.
  it("opens the flavor there's most of, not the next one in the list", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.ration.setItems([PACK]));
    act(() => apiRef.current.setStockOf("Tiki Chicken", 1));
    act(() => apiRef.current.setStockOf("Tiki Quail", 5));
    act(() => apiRef.current.consumeRotationSlot("slot1", 40));
    expect(cans(apiRef)[0].name).toBe("Tiki Quail");
    expect(apiRef.current.cupboard.find((r) => r.name === "Tiki Quail").count).toBe(4);
  });

  it("with no counts kept, the list order still decides", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.ration.setItems([PACK]));
    act(() => apiRef.current.consumeRotationSlot("slot1", 40));
    expect(cans(apiRef)[0].name).toBe("Tiki Chicken");
  });
});

// The pantry-following slot through the real seams — the flavour it feeds comes from the
// cupboard's counts, not from any list on the row.
describe("a slot that rotates through the pantry", () => {
  const DUCK = { name: "Pantry Duck", mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 };
  const CHICKEN = { name: "Pantry Chicken", mode: "perUnit", type: "wet", kcalPerUnit: 70, gramsPerUnit: 80 };
  const SLOT = { id: "ps1", ...DUCK, rotateSource: "pantry", splitMode: "remainder", pct: 100 };

  const setup = async () => {
    const { apiRef } = await renderApp();
    act(() => { apiRef.current.library.upsert(DUCK); });
    act(() => { apiRef.current.library.upsert(CHICKEN); });
    act(() => apiRef.current.ration.setItems([SLOT]));
    return apiRef;
  };

  it("feeds the fullest pile, and the can it opens leaves the shelf", async () => {
    const apiRef = await setup();
    act(() => apiRef.current.setStockOf(DUCK.name, 1));
    act(() => apiRef.current.setStockOf(CHICKEN.name, 6));
    act(() => apiRef.current.consumeRotationSlot("ps1", 40));
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].name).toBe(CHICKEN.name); // not the row's own Duck — the pantry decided
    expect(apiRef.current.cupboard.find((r) => r.name === CHICKEN.name).count).toBe(5);
  });

  it("with an empty pantry it falls back to the slot's own flavour", async () => {
    const apiRef = await setup();
    act(() => apiRef.current.consumeRotationSlot("ps1", 40));
    expect(cans(apiRef)).toHaveLength(1);
    expect(cans(apiRef)[0].name).toBe(DUCK.name);
  });

  it("finishing its can doesn't crash on the missing cursor, and the can goes", async () => {
    const apiRef = await setup();
    act(() => apiRef.current.setStockOf(CHICKEN.name, 2));
    act(() => apiRef.current.consumeRotationSlot("ps1", 40));
    expect(cans(apiRef)).toHaveLength(1);
    act(() => apiRef.current.finishSlotCan("ps1"));
    expect(cans(apiRef)).toHaveLength(0);
  });
});
