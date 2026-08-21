// @vitest-environment jsdom
//
// Renders the Log page's WEIGHT tab with real weigh-ins of several methods.
//
// This test exists because of a specific failure: a change to the weigh-in list shipped after being
// "verified" by a headless load that only ever rendered the FOOD tab with the demo cat — so a crash
// in the weight tab reached the user's phone and blanked the app. Loading a page is not evidence
// that the part you changed renders. This mounts the tab, with entries, and asserts they appear.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import LogPage from "./LogPage.jsx";
import { localDateOf } from "../lib/series.js";

const today = localDateOf(Date.now());
const day = (n) => {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// A cat weighed mostly by Litter-Robot with an occasional [me+cat]−[me] check — the real shape.
const seed = () => ({
  v: 2,
  activeCatId: "c1",
  cats: {
    c1: {
      profile: { name: "Mithril", weightKg: 4.4, ageMonths: 60, neutered: true, bcMode: "bcs", bcs: 6, goal: "loss",
        factors: { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1, loss: 1, gain: 1.6 } },
      ration: [{ id: "f1", name: "Instinct", mode: "perKg", kcalPerKg: 4000, splitMode: "remainder", type: "dry" }],
      start: [], fridge: [], intakeLog: [], intakeDayStatus: {},
      weightLog: [
        { id: "w1", date: day(2), kg: 4.42, method: "litterRobot", source: "litter-robot" },
        { id: "w2", date: day(1), kg: 4.41, method: "litterRobot", source: "litter-robot" },
        { id: "w3", date: today, kg: 4.40, method: "litterRobot", source: "litter-robot" },
        { id: "w4", date: today, kg: 4.31, method: "difference", source: "manual" },   // the manual check
        { id: "w5", date: today, kg: 4.39, method: undefined, source: "manual" },      // legacy, untagged
      ],
    },
  },
  library: [], fridgeDays: 3, skin: "original", unit: "kg", estimator: "v3", settingsModAt: 1,
});

// This environment's `localStorage` is a stub with no working methods (Node's built-in global
// shadows jsdom's — see AppState.integration.test.jsx). Silently tolerating that is how the last
// version of this test "passed" while rendering the DEMO cat instead of the seeded data, so install
// a real one and assert it works rather than wrapping writes in try/catch.
function installStorage() {
  const map = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    },
  });
}

// store.load() is ASYNC, so hydration lands a tick after mount. Without flushing, every assertion
// runs against the DEMO cat — which is how the previous version of this file "passed" while proving
// nothing. mount() flushes, and assertSeeded() fails loudly if the fixture didn't take.
const mount = async () => {
  const r = render(<AppProvider><LogPage /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  return r;
};
const openWeightTab = () => fireEvent.click(screen.getByRole("button", { name: "Weight" }));
// 4.31 is the seeded manual reading and appears nowhere in the demo cat's data.
const assertSeeded = (c) => expect(c.textContent).toMatch(/Mithril|4\.31/);

beforeEach(() => {
  installStorage();
  window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
  // the seed must actually be readable, or every assertion below silently tests the demo cat
  expect(JSON.parse(window.localStorage.getItem("catration_v1")).cats.c1.weightLog).toHaveLength(5);
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Log → Weight tab renders with real weigh-ins", () => {
  it("mounts without throwing and shows the tab", async () => {
    const errors = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));
    const { container: c } = await mount();
    expect(() => openWeightTab()).not.toThrow();
    assertSeeded(c);
    // React logs render errors through console.error before unmounting the tree — catch that too,
    // since a thrown-and-swallowed render is exactly what produced a blank screen.
    expect(errors.filter((e) => /Uncaught|The above error/.test(e))).toEqual([]);
    spy.mockRestore();
  });

  it("lists the day's readings, including one with no method recorded", async () => {
    const { container: c } = await mount(); openWeightTab(); assertSeeded(c);
    expect(screen.getByText(/read/)).toBeTruthy();          // "3 reads"
    expect(screen.getAllByText(/4\.\d/).length).toBeGreaterThan(0); // the weights themselves
  });

  it("renders the weight history chart with a dot per reading", async () => {
    const { container } = await mount();
    openWeightTab();
    assertSeeded(container);
    expect(screen.getByText(/Weight · last \d+ days/)).toBeTruthy();
    // one circle per reading in range (5 seeded), plus the trend path
    expect(container.querySelectorAll("svg circle").length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector("svg path")).toBeTruthy();
  });

  it("colours readings by method, so a differently-measured point is visibly different", async () => {
    const { container } = await mount();
    openWeightTab();
    assertSeeded(container);
    const fills = [...container.querySelectorAll("svg circle")].map((c) => c.getAttribute("fill"));
    expect(new Set(fills).size).toBeGreaterThan(1); // not all one colour
  });

  it("shows a legend naming the methods actually present", async () => {
    const { container: c } = await mount(); openWeightTab(); assertSeeded(c);
    expect(screen.getAllByText("Litter-Robot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Scale − you").length).toBeGreaterThan(0);
  });

  it("the add-a-weigh-in form still renders and every method is offerable", async () => {
    const { container: c } = await mount(); openWeightTab(); assertSeeded(c);
    for (const lbl of ["Pet scale", "Litter-Robot", "Scale − you", "Other"]) {
      expect(screen.getAllByText(lbl).length).toBeGreaterThan(0);
    }
  });

  it("survives a cat with NO weigh-ins at all (the empty state)", async () => {
    const blank = seed();
    blank.cats.c1.weightLog = [];
    window.localStorage.setItem("catration_v1", JSON.stringify(blank));
    const { container: c } = await mount();
    expect(() => openWeightTab()).not.toThrow();
    // the copy is split across JSX text nodes, so match on the rendered text as a whole
    expect(c.textContent).toMatch(/No weigh-ins/);
  });

  it("survives readings whose method string isn't one we know", async () => {
    const odd = seed();
    odd.cats.c1.weightLog = [{ id: "x", date: today, kg: 4.4, method: "smart-litter-box-9000", source: "manual" }];
    window.localStorage.setItem("catration_v1", JSON.stringify(odd));
    const { container: c } = await mount();
    expect(() => openWeightTab()).not.toThrow();
    // this fixture replaces the weight log, so it has its own proof the seed loaded
    expect(c.textContent).toMatch(/4\.4/);
    expect(c.textContent).toMatch(/unknown/); // labelled, not crashed on
  });
});

// The collar comes off in AppState's weightLog view, so this is the test that the seam is actually
// wired to the page the owner uses — not just that lib/collar.js does arithmetic (collar.test.js).
describe("Log → Weight tab with a collared cat", () => {
  // 40 g collar, worn by default. The scale read 4.54; the cat is 4.50.
  const collared = () => {
    const s = seed();
    s.cats.c1.profile.collar = { grams: 40, defaultOn: true };
    s.cats.c1.weightLog = [
      { id: "w1", date: today, kg: 4.54, method: "litterRobot", source: "litter-robot" },
      { id: "w2", date: today, kg: 4.50, method: "petScale", source: "manual", collarOn: false }, // weighed bare
    ];
    return s;
  };
  const seedWith = (blob) => window.localStorage.setItem("catration_v1", JSON.stringify(blob));

  it("shows the cat, not the scale — both readings agree once the collar is off", async () => {
    seedWith(collared());
    const { container: c } = await mount();
    openWeightTab();
    expect(c.textContent).toMatch(/Litter-Robot/); // the seed loaded (this fixture has no 4.31)
    // 4.54 collared and 4.50 bare are the SAME cat, so the raw number must not appear as a weight
    expect(screen.getAllByText(/4\.5\b/).length).toBeGreaterThan(0);
    expect(c.textContent).not.toMatch(/4\.54\s*kg/);
  });

  it("offers the collar checkbox, defaulted to the cat's usual answer", async () => {
    seedWith(collared());
    await mount();
    openWeightTab();
    const box = screen.getByRole("checkbox", { name: /collar on/i });
    expect(box.checked).toBe(true);
  });

  it("lets a logged reading be corrected after the fact, and the weight follows", async () => {
    seedWith(collared());
    const { container: c } = await mount();
    openWeightTab();
    const chips = screen.getAllByRole("button", { name: /collar (on|off)/i });
    expect(chips.map((b) => b.textContent.trim())).toEqual(["collar on", "collar off"]);
    // "actually, the Litter-Robot reading was taken with the collar off" → it becomes 4.54
    await act(async () => { fireEvent.click(chips[0]); });
    expect(c.textContent).toMatch(/4\.54/);
  });

  it("stays out of the way entirely for a cat with no collar", async () => {
    await mount(); // the ordinary seed, no collar
    openWeightTab();
    expect(screen.queryByRole("checkbox", { name: /collar/i })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /collar/i })).toEqual([]);
  });
});

describe("Log → Food tab still renders (the other half of the page)", () => {
  it("mounts without throwing", async () => {
    await expect(mount()).resolves.toBeTruthy();
  });
});
