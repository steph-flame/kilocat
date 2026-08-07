// @vitest-environment jsdom
//
// Renders the Trend page with enough real-shaped history to reach the estimate card, and checks the
// posterior density actually draws. Written because two changes this project shipped after being
// "verified" by inspection alone and broke on the user's phone — a component that renders in my head
// is not a component that renders.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import Trend from "./Trend.jsx";
import { simulateCat } from "../lib/simCat.js";
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

// 60 days of realistic history ending today, so the estimator has enoughData.
function seed({ estimator = "v3" } = {}) {
  const sim = simulateCat({ days: 60, deficit: 40, gutPct: 0.0042, gutPhi: 0.58, sigmaW: 0.026, readsPerDay: 4 });
  const today = new Date(`${localDateOf(Date.now())}T00:00:00`);
  const shift = (iso, i, n) => { const d = new Date(today); d.setDate(d.getDate() - (n - 1 - i)); return d.toISOString().slice(0, 10); };
  const dates = [...new Set(sim.weightEntries.map((e) => e.date))].sort();
  const remap = new Map(dates.map((d, i) => [d, shift(d, i, dates.length)]));
  return {
    v: 2, activeCatId: "c1", library: [], fridgeDays: 3, skin: "original", unit: "kg", estimator, settingsModAt: 1,
    cats: { c1: {
      profile: { name: "Sim", weightKg: 4.6, ageMonths: 60, neutered: true, bcMode: "bcs", bcs: 6, goal: "loss",
        factors: { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1, loss: 1, gain: 1.6 } },
      ration: [], start: [], fridge: [], intakeDayStatus: {},
      weightLog: sim.weightEntries.map((e, i) => ({ id: `w${i}`, date: remap.get(e.date), kg: e.value, method: "litterRobot", source: "litter-robot" })),
      intakeLog: sim.intakeEntries.map((e, i) => ({ id: `i${i}`, date: remap.get(e.date), kcal: e.value, name: "Food" })),
    } },
  };
}

const mount = async () => {
  const r = render(<AppProvider><Trend /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  return r;
};

beforeEach(() => { installStorage(); window.localStorage.setItem("catration_v1", JSON.stringify(seed())); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Trend renders the posterior as a density", () => {
  it("gets past the not-enough-data state (otherwise everything below is vacuous)", async () => {
    const { container } = await mount();
    expect(container.textContent).not.toMatch(/Not enough logged yet/);
    expect(container.textContent).toMatch(/measured/i);
  });

  it("draws a density curve, not just a bar", async () => {
    const { container } = await mount();
    const labelled = container.querySelector('svg[aria-label*="Posterior distribution"]');
    expect(labelled).toBeTruthy();
    // a real curve: many path points, not a two-point line
    const d = labelled.querySelector("path")?.getAttribute("d") || "";
    expect((d.match(/L/g) || []).length).toBeGreaterThan(50);
  });

  it("shades the middle 95% and marks the peak", async () => {
    const { container } = await mount();
    const svg = container.querySelector('svg[aria-label*="Posterior distribution"]');
    const filled = [...svg.querySelectorAll("path")].filter((p) => p.getAttribute("fill") && p.getAttribute("fill") !== "none");
    expect(filled.length).toBeGreaterThanOrEqual(1);   // the shaded 95% region
    expect(svg.querySelectorAll("line").length).toBeGreaterThanOrEqual(2); // peak tick + baseline
  });

  it("draws the vet-formula prior alongside it", async () => {
    const { container } = await mount();
    const svg = container.querySelector('svg[aria-label*="Posterior distribution"]');
    expect([...svg.querySelectorAll("path")].some((p) => p.getAttribute("stroke-dasharray"))).toBe(true);
    expect(container.textContent).toMatch(/vet formula/);
  });

  it("names both uncertainty sources, so the band isn't a single opaque number", async () => {
    const { container } = await mount();
    expect(container.textContent).toMatch(/from the model/);
    expect(container.textContent).toMatch(/how exactly food is measured/);
  });

  it("renders for every estimator, including v4", async () => {
    for (const est of ["v1", "v2", "v3", "v4"]) {
      cleanup();
      window.localStorage.setItem("catration_v1", JSON.stringify(seed({ estimator: est })));
      const { container } = await mount();
      expect(container.querySelector('svg[aria-label*="Posterior"]'), `${est} drew no density`).toBeTruthy();
    }
  });
});
