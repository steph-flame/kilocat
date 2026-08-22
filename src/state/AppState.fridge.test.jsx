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
});
