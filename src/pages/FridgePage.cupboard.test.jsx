// @vitest-environment jsdom
//
// The Cans page's cupboard half, mounted for real. The counts are only worth anything if they can
// actually be entered, so this drives the controls rather than trusting that they render.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import FridgePage from "./FridgePage.jsx";

const flavor = (name) => ({ name, mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 });
const PACK = {
  id: "slot1", name: "Tiki Variety", splitMode: "remainder", pct: 100, rotIndex: 0,
  rotation: ["Chicken", "Duck", "Quail", "Salmon"].map(flavor),
};

const seed = (cupboard = [], cases = []) => ({
  v: 2, activeCatId: "c1", library: [], fridgeDays: 3, skin: "original", unit: "kg", estimator: "v3", settingsModAt: 1,
  cats: { c1: {
    profile: { name: "Mithril", dob: "2021-05-01", weightKg: 4.4, neutered: true, bcMode: "bcs", bcs: 6, goal: "maintain",
      factors: { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1, loss: 1, gain: 1.6 } },
    ration: [PACK], start: [], fridge: [], cupboard, cases, weightLog: [], intakeLog: [], intakeDayStatus: {},
  } },
});

function installStorage() {
  const map = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k), clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; },
    },
  });
}

const mount = async () => {
  const r = render(<AppProvider><FridgePage /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  // Biscuit's ration has no variety pack, so these four flavours prove the fixture loaded.
  expect(screen.getByLabelText(/cans of Chicken in the cupboard/i)).toBeTruthy();
  return r;
};
const countBox = (name) => screen.getByLabelText(new RegExp(`cans of ${name} in the cupboard`, "i"));

beforeEach(() => { installStorage(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Cans page — cupboard", () => {
  it("lists every flavour of the pack, blank until counted", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    for (const n of ["Chicken", "Duck", "Quail", "Salmon"]) expect(countBox(n).value).toBe("");
  });

  it("takes a count and totals the shelf", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    await act(async () => { fireEvent.change(countBox("Duck"), { target: { value: "6" } }); });
    expect(countBox("Duck").value).toBe("6");
    expect(container.textContent).toMatch(/6 cans/);
  });

  it("steps up and down without typing", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Quail", count: 2 }])));
    await mount();
    await act(async () => { fireEvent.click(screen.getByLabelText(/One more Quail/i)); });
    expect(countBox("Quail").value).toBe("3");
    await act(async () => { fireEvent.click(screen.getByLabelText(/One fewer Quail/i)); });
    expect(countBox("Quail").value).toBe("2");
  });

  // The rule made visible: the app says which flavour it will reach for, rather than just doing it.
  it("names the flavour that opens next, and flags the ones you're out of", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([
      { name: "Chicken", count: 1 }, { name: "Duck", count: 5 }, { name: "Quail", count: 0 },
    ])));
    const { container } = await mount();
    expect(container.textContent).toMatch(/opens next/);
    expect(container.textContent).toMatch(/none left/);
    // it's Duck that's up — the tallest pile, not the first in the list
    const rows = [...container.querySelectorAll("div")].filter((d) => /opens next/.test(d.textContent));
    expect(rows.some((d) => /Duck/.test(d.parentElement?.parentElement?.textContent || ""))).toBe(true);
  });

  it("keeps showing a flavour that has stock but has left the ration", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Discontinued Rabbit", count: 3 }])));
    const { container } = await mount();
    expect(container.textContent).toMatch(/Discontinued Rabbit/); // cans don't vanish with the plan
  });
});

describe("Cans page — cases", () => {
  it("saves a mix and adds it by the box", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save a case mix/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /edit the mix/i })); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/Chicken per case/i), { target: { value: "4" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/Duck per case/i), { target: { value: "2" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /\+ 1 case/i })); });
    expect(countBox("Chicken").value).toBe("4");
    expect(countBox("Duck").value).toBe("2");
    // buying the same box again stacks, and the case itself survives
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /\+ 1 case/i })); });
    expect(countBox("Chicken").value).toBe("8");
    expect(container.textContent).toMatch(/6 cans ·/); // the case still describes its own mix
  });

  it("won't add an empty case", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save a case mix/i })); });
    expect(screen.getByRole("button", { name: /\+ 1 case/i }).disabled).toBe(true);
  });
});
