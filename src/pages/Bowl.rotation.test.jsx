// @vitest-environment jsdom
//
// The Ration page's variety-pack row: the flavor list is an editor, so it collapses.
//
// Mounts the real page with a real 4-flavor pack, because "it builds" has never been evidence that
// a UI change works here — see LogPage.weight.test.jsx's banner for what that cost last time.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import Bowl from "./Bowl.jsx";

const flavor = (name) => ({ name, mode: "perUnit", type: "wet", kcalPerUnit: 66, gramsPerUnit: 80 });

const seed = (ration) => ({
  v: 2,
  activeCatId: "c1",
  cats: {
    c1: {
      profile: { name: "Mithril", dob: "2021-05-01", weightKg: 4.4, neutered: true, bcMode: "bcs", bcs: 6, goal: "maintain",
        factors: { neutered: 1.2, intact: 1.4, kittenPeak: 2.5, moderation: 1, loss: 1, gain: 1.6 } },
      ration, start: [], fridge: [], weightLog: [], intakeLog: [], intakeDayStatus: {},
    },
  },
  library: [], fridgeDays: 3, skin: "original", unit: "kg", estimator: "v3", settingsModAt: 1,
});

const PACK = [{
  id: "slot1", name: "Tiki Variety", splitMode: "remainder", pct: 100, rotIndex: 0,
  rotation: ["Tiki Chicken", "Tiki Quail", "Weruva Duck", "Weruva Chicken"].map(flavor),
}];
const PLAIN = [{ id: "slot1", ...flavor("Tiki Chicken"), splitMode: "remainder", pct: 100 }];

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
  const r = render(<AppProvider><Bowl /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  return r;
};
// Every flavor row carries these; the demo cat's ration has no variety pack, so seeing them at all
// is also proof the fixture loaded rather than Biscuit.
const flavorRows = () => screen.queryAllByRole("button", { name: "Remove flavor" });
const toggle = () => screen.getByRole("button", { name: /show or hide the flavor list/i });

beforeEach(() => { installStorage(); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("Ration → variety pack row", () => {
  beforeEach(() => { window.localStorage.setItem("catration_v1", JSON.stringify(seed(PACK))); });

  it("starts collapsed, so a 4-flavor pack doesn't own the page", async () => {
    const { container } = await mount();
    expect(container.textContent).toMatch(/variety pack/); // the seeded pack, not the demo cat
    expect(flavorRows()).toHaveLength(0);
    expect(toggle().textContent).toMatch(/flavors \(4\)/); // says how many are folded away
    expect(toggle()).toHaveProperty("ariaExpanded", "false");
  });

  it("still shows what's coming while collapsed", async () => {
    const { container } = await mount();
    expect(container.textContent).toMatch(/Next up:/);
    expect(container.textContent).toMatch(/Tiki Chicken/);
  });

  it("opens and closes on the toggle", async () => {
    await mount();
    fireEvent.click(toggle());
    expect(flavorRows()).toHaveLength(4);
    expect(screen.getByRole("button", { name: /add flavor/i })).toBeTruthy();
    fireEvent.click(toggle());
    expect(flavorRows()).toHaveLength(0);
  });

  it("keeps the how-it-works copy inside the editor, where it's relevant", async () => {
    const { container } = await mount();
    expect(container.textContent).not.toMatch(/in order, by the can/);
    fireEvent.click(toggle());
    expect(container.textContent).toMatch(/in order, by the can/);
  });
});

describe("starting a rotation", () => {
  // Seeding a pack leaves a BLANK flavor to fill in, so this has to open — a ↻ that collapsed the
  // thing it just created would look like a no-op.
  it("opens the editor so the new blank flavor is visible", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed(PLAIN)));
    await mount();
    expect(flavorRows()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /rotate flavors/i }));
    expect(flavorRows()).toHaveLength(2); // the food that was there + one to fill in
  });
});

// The type picker and energy fields moved out of this page into a shared component so the Foods
// page could stop offering only wet and dry. That refactor has to leave the ration exactly as it
// was, including the treat handling that only ever lived here.
describe("Ration row details, after the type/energy controls were shared", () => {
  const PLAIN_DRY = [{ id: "slot1", name: "Kibble", mode: "perKg", type: "dry", kcalPerKg: 3800, splitMode: "remainder", pct: 100 }];

  const openDetails = () => fireEvent.click(screen.getByRole("button", { name: /details/i }));

  it("still offers all four types", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed(PLAIN_DRY)));
    await mount();
    openDetails();
    for (const re of [/is dry food/i, /is wet food/i, /is a treat/i, /is a supplement/i]) {
      expect(screen.getByRole("button", { name: re })).toBeTruthy();
    }
  });

  it("swaps the energy fields with the type, as it always did", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed(PLAIN_DRY)));
    await mount();
    openDetails();
    expect(screen.getByLabelText(/^Energy$/i)).toBeTruthy();           // dry: kcal/kg
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is wet food/i })); });
    expect(screen.getByLabelText(/Energy \/ can/i)).toBeTruthy();
  });

  // The one piece of real logic in that block: a treat's weight is worked out from the two
  // figures on the package rather than typed.
  it("still derives a treat's weight from the label", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed(PLAIN_DRY)));
    const { container } = await mount();
    openDetails();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is a treat/i })); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/Calories \/ treat/i), { target: { value: "2" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/Calories \/ kg/i), { target: { value: "4000" } }); });
    expect(container.textContent).toMatch(/0\.5 g per treat · worked out from the label/);
  });
});

// The pantry-following slot on the Ration page: no hand list to edit, the caption says where the
// flavours come from, and the switch turns it on and off without losing the explicit list.
describe("Ration → a slot that follows the pantry", () => {
  const WET = (name, kcal = 66) => ({ name, mode: "perUnit", type: "wet", kcalPerUnit: kcal, gramsPerUnit: 80 });
  const pantrySeed = () => {
    const s = seed([{ id: "ps1", ...WET("Duck Can"), rotateSource: "pantry", splitMode: "remainder", pct: 100 }]);
    s.cats.c1.cupboard = [{ name: "Duck Can", count: 2 }, { name: "Chicken Can", count: 5 }];
    s.library = [WET("Duck Can"), WET("Chicken Can", 70)];
    return s;
  };

  it("names today's flavour from the cupboard and says it follows the pantry", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(pantrySeed()));
    const { container } = await mount();
    expect(container.textContent).toMatch(/follows the pantry · 2 flavours in stock/);
    expect(container.textContent).toMatch(/Chicken Can/); // fullest pile is today's flavour
  });

  it("offers no hand-edited flavour rows — the cupboard owns the list", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(pantrySeed()));
    const { container } = await mount();
    fireEvent.click(screen.getByRole("button", { name: /show or hide the flavor list/i }));
    expect(flavorRows()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /add flavor/i })).toBeNull();
    expect(container.textContent).toMatch(/Flavours come from the/);
    expect(screen.getByRole("button", { name: /rotate through the pantry/i })).toHaveProperty("ariaPressed", "true");
  });

  it("says so, rather than feeding a stale plan, when the pantry is empty", async () => {
    const s = pantrySeed();
    s.cats.c1.cupboard = [];
    window.localStorage.setItem("catration_v1", JSON.stringify(s));
    const { container } = await mount();
    expect(container.textContent).toMatch(/nothing in stock, showing the last flavour/);
    expect(container.textContent).toMatch(/Duck Can/); // the slot's own last flavour
  });

  it("an ordinary pack offers the switch, and keeps its list across a round trip", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed(PACK)));
    const { container } = await mount();
    fireEvent.click(toggle());
    const sw = () => screen.getByRole("button", { name: /rotate through the pantry/i });
    expect(sw()).toHaveProperty("ariaPressed", "false");
    fireEvent.click(sw()); // on: the 4 hand rows vanish
    expect(flavorRows()).toHaveLength(0);
    fireEvent.click(sw()); // off: the explicit list is back, intact
    expect(flavorRows()).toHaveLength(4);
    expect(container.textContent).toMatch(/variety pack · 4 flavors/);
  });
});
