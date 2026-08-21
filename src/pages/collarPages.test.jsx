// @vitest-environment jsdom
//
// Stripping the collar changed what EVERY page reads a weigh-in as, not just the Log page that
// offers the checkbox. This mounts the other consumers with a collared cat and checks two things:
// they render at all, and they show the CAT rather than the scale.
//
// This file exists because "the code compiles and one page loaded" is exactly the evidence that
// preceded a blank app on the user's phone. See LogPage.weight.test.jsx's banner.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import Trend from "./Trend.jsx";
import TodayPage from "./TodayPage.jsx";
import Home from "./Home.jsx";
import { localDateOf } from "../lib/series.js";

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

const COLLAR_G = 40;
const CAT_KG = 4.5; // what the cat weighs; the scale reads CAT_KG + 0.04 with the collar on
const DAYS = 45;

// A flat cat weighed daily wearing its collar, plus a weekly bare check that reads the same once
// the collar is off — so any page still working in the scale's frame shows two different cats.
function seed({ collar = { grams: COLLAR_G, defaultOn: true } } = {}) {
  const today = new Date(`${localDateOf(Date.now())}T00:00:00`);
  const day = (i) => { const d = new Date(today); d.setDate(d.getDate() - (DAYS - 1 - i)); return d.toISOString().slice(0, 10); };
  const weightLog = [];
  const intakeLog = [];
  for (let i = 0; i < DAYS; i++) {
    weightLog.push({ id: `w${i}`, date: day(i), kg: CAT_KG + COLLAR_G / 1000, method: "litterRobot", source: "litter-robot" });
    if (i % 7 === 0) weightLog.push({ id: `b${i}`, date: day(i), kg: CAT_KG, method: "petScale", source: "manual", collarOn: false });
    intakeLog.push({ id: `i${i}`, date: day(i), kcal: 210, name: "Food" });
  }
  return {
    v: 2, activeCatId: "c1", library: [], fridgeDays: 3, skin: "original", unit: "kg", estimator: "v3", settingsModAt: 1,
    cats: { c1: {
      profile: { name: "Mithril", weightKg: CAT_KG, ageMonths: 60, neutered: true, bcMode: "bcs", bcs: 6, goal: "maintain",
        factors: { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1, loss: 1, gain: 1.6 }, collar },
      ration: [{ id: "f1", name: "Instinct", mode: "perKg", kcalPerKg: 4000, splitMode: "remainder", type: "dry", pct: 100 }],
      start: [], fridge: [], intakeDayStatus: {}, weightLog, intakeLog,
    } },
  };
}

const mount = async (Page) => {
  const errors = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));
  const r = render(<AppProvider><Page /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  // React reports a thrown render through console.error before unmounting — a blank page, exactly.
  expect(errors.filter((e) => /Uncaught|The above error/.test(e))).toEqual([]);
  spy.mockRestore();
  expect(r.container.textContent).toMatch(/Mithril|4\.5/); // the fixture loaded, not the demo cat
  return r;
};

beforeEach(() => { installStorage(); window.localStorage.setItem("catration_v1", JSON.stringify(seed())); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("every page that reads a weigh-in survives a collared cat", () => {
  for (const [name, Page] of [["Trend", Trend], ["Today", TodayPage], ["Home", Home]]) {
    it(`${name} renders`, async () => {
      const { container } = await mount(Page);
      expect(container.textContent.length).toBeGreaterThan(50); // not a blank shell
    });
  }
});

describe("the collar is off everywhere, not just where the checkbox is", () => {
  it("Today shows the cat's weight, never the scale's reading", async () => {
    const { container } = await mount(TodayPage);
    expect(container.textContent).toMatch(/4\.5/);
    expect(container.textContent).not.toMatch(/4\.54/);
  });

  // The sharpest available proof, and the whole chain end to end: Trend REPORTS the measured
  // offset between weighing methods (lib/methodBias.js). Here the bare pet-scale checks and the
  // collared Litter-Robot reads are the same cat, so a correct pipeline finds no disagreement at
  // all. Leave the collar on and the same page would announce a 40 g between-method bias that
  // doesn't exist — the two corrections have to compose in this order or each invents work for
  // the other. (Asserting on rendered TEXT here rather than a number: adjacent labels concatenate
  // in textContent — "4.5" beside the ideal "4.09" reads as "4.54.09" — so a bare /4\.54/ would
  // pass or fail for reasons that have nothing to do with collars.)
  it("Trend finds no between-method bias, because the collar accounted for all of it", async () => {
    const { container } = await mount(Trend);
    expect(container.textContent).toMatch(/Pet scale reads 0 g .* above Litter-Robot/);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("and the flat cat reads as flat, with no sawtooth from the bare weigh-ins", async () => {
    const { container } = await mount(Trend);
    expect(container.textContent).toMatch(/\+0 g\/wk/);
  });

  // The negative control, without which the assertions above could be passing for any reason: take
  // the collar setting away and the SAME log shows the disagreement it was hiding.
  it("with no collar set, the same readings do disagree by the collar's weight", async () => {
    // `null`, not `undefined` — a default parameter fires on undefined, which would quietly hand
    // this control the collared profile and make it assert nothing.
    window.localStorage.setItem("catration_v1", JSON.stringify(seed({ collar: null })));
    const { container } = await mount(Trend);
    expect(container.textContent).toMatch(/Pet scale reads 40 g .* below Litter-Robot/);
  });
});
