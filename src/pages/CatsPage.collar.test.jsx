// @vitest-environment jsdom
//
// The Cats page is where a collar's weight gets entered, so this mounts THAT page and drives the
// control the owner actually touches. Same discipline as LogPage.weight.test.jsx: install a real
// localStorage, flush the async hydrate, and assert the seeded cat loaded before asserting anything
// else — a test that silently renders the demo cat proves nothing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import CatsPage from "./CatsPage.jsx";
import { localDateOf } from "../lib/series.js";

const seed = (unit = "kg", collar) => ({
  v: 2,
  activeCatId: "c1",
  cats: {
    c1: {
      profile: { name: "Mithril", dob: "2021-05-01", neutered: true, bcMode: "bcs", bcs: 6, goal: "loss",
        factors: { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1, loss: 1, gain: 1.6 },
        ...(collar ? { collar } : {}) },
      ration: [], start: [], fridge: [], weightLog: [], intakeLog: [], intakeDayStatus: {},
    },
  },
  library: [], fridgeDays: 3, skin: "original", unit, estimator: "v3", settingsModAt: 1,
});

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

const mount = async () => {
  const r = render(<AppProvider><CatsPage /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  // Mithril is the seeded cat; the demo cat is Biscuit. If this fails the fixture didn't load.
  expect(screen.getByDisplayValue("Mithril")).toBeTruthy();
  return r;
};
const openProfile = () => fireEvent.click(screen.getByRole("button", { name: /profile/i }));
// Saves are debounced 400 ms (lib/storage.js), so reading localStorage straight after a keystroke
// reads the PREVIOUS blob — which is how a broken write would look like a passing test.
const flushSave = () => act(async () => { await new Promise((r) => setTimeout(r, 500)); });

beforeEach(() => { installStorage(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Cats page — collar setting", () => {
  it("offers a collar weight in the profile panel", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    openProfile();
    expect(screen.getByLabelText(/collar weight in g/i)).toBeTruthy();
  });

  it("hides the 'usually worn' switch until there IS a collar", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    openProfile();
    expect(screen.queryByRole("switch", { name: /still wearing the collar/i })).toBeNull();

    await act(async () => { fireEvent.change(screen.getByLabelText(/collar weight in g/i), { target: { value: "40" } }); });
    expect(screen.getByRole("switch", { name: /still wearing the collar/i })).toBeTruthy();
  });

  it("persists what was typed, in grams", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    openProfile();
    await act(async () => { fireEvent.change(screen.getByLabelText(/collar weight in g/i), { target: { value: "40" } }); });
    await flushSave();
    const saved = JSON.parse(window.localStorage.getItem("catration_v1"));
    expect(saved.cats.c1.profile.collar.grams).toBe(40);
  });

  // GRAMS, even for a household that weighs the cat in pounds. Small masses in this app are food,
  // and food is logged in grams for everyone — the weight unit is about the cat, and a collar
  // isn't the cat. Entering one in ounces meant doing arithmetic to reconcile it with every other
  // gram figure on screen.
  it("is in grams for an lb household too", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed("lb")));
    await mount();
    openProfile();
    expect(screen.queryByLabelText(/collar weight in oz/i)).toBeNull();
    const field = screen.getByLabelText(/collar weight in grams/i);
    await act(async () => { fireEvent.change(field, { target: { value: "40" } }); });
    await flushSave();
    expect(JSON.parse(window.localStorage.getItem("catration_v1")).cats.c1.profile.collar.grams).toBe(40);
  });

  // A cat acquires a collar; it doesn't retroactively always have had one. Entering a weight has to
  // stamp a start date by itself, because the owner who doesn't notice this field is exactly the
  // one whose whole back history would otherwise be restated 40 g light.
  it("stamps today as the start date the moment a weight is entered", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    openProfile();
    await act(async () => { fireEvent.change(screen.getByLabelText(/collar weight in g/i), { target: { value: "40" } }); });
    await flushSave();
    const saved = JSON.parse(window.localStorage.getItem("catration_v1"));
    expect(saved.cats.c1.profile.collar.since).toBe(localDateOf(Date.now()));
    // and it's shown, editable, for the owner setting this up a week late
    expect(screen.getByLabelText(/started wearing the collar/i).value).toBe(localDateOf(Date.now()));
  });

  it("doesn't overwrite a start date the owner already set", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed("kg", { grams: 40, defaultOn: true, since: "2026-07-01" })));
    await mount();
    openProfile();
    await act(async () => { fireEvent.change(screen.getByLabelText(/collar weight in g/i), { target: { value: "45" } }); });
    await flushSave();
    expect(JSON.parse(window.localStorage.getItem("catration_v1")).cats.c1.profile.collar.since).toBe("2026-07-01");
  });

  // The collar coming off is a date, not a switch: the months she wore it have to stay corrected.
  it("stamps an end date when the collar comes off, rather than just switching the correction away", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed("kg", { grams: 40, defaultOn: true, since: "2026-07-01", until: "" })));
    await mount();
    openProfile();
    expect(screen.queryByLabelText(/last day .* wore the collar/i)).toBeNull(); // not while she's wearing it
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: /still wearing the collar/i })); });
    await flushSave();
    const saved = JSON.parse(window.localStorage.getItem("catration_v1")).cats.c1.profile.collar;
    expect(saved.until).toBe(localDateOf(Date.now()));
    expect(saved.since).toBe("2026-07-01");  // the period kept both ends
    expect(saved.grams).toBe(40);            // and the weight, or the worn stretch would un-correct
    expect(screen.getByLabelText(/last day .* wore the collar/i).value).toBe(localDateOf(Date.now()));
  });

  it("putting it back on reopens the period", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed("kg", { grams: 40, defaultOn: false, since: "2026-07-01", until: "2026-08-01" })));
    await mount();
    openProfile();
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: /still wearing the collar/i })); });
    await flushSave();
    expect(JSON.parse(window.localStorage.getItem("catration_v1")).cats.c1.profile.collar.until).toBe("");
  });

  it("shows a stored collar back as the grams it was stored as", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed("lb", { grams: 42.5, defaultOn: true })));
    await mount();
    openProfile();
    expect(screen.getByLabelText(/collar weight in grams/i).value).toBe("42.5");
  });
});
