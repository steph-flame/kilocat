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

  // A single can of something that has never been in the ration and has never been stocked can't
  // be on the list, because the list is built from those two things — so it needs its own way in.
  it("adds a can of a flavour that isn't in the ration at all", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    expect(container.textContent).not.toMatch(/Fancy Rabbit/);
    const field = screen.getByLabelText(/add a flavour to the cupboard/i);
    await act(async () => { fireEvent.change(field, { target: { value: "Fancy Rabbit" } }); });
    await act(async () => { fireEvent.click(screen.getByLabelText(/Add a can of this flavour/i)); });
    expect(countBox("Fancy Rabbit").value).toBe("1");
    expect(field.value).toBe(""); // cleared, ready for the next one
  });

  it("adds a second can of it the same way, rather than starting over at one", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Fancy Rabbit", count: 1 }])));
    await mount();
    await act(async () => { fireEvent.change(screen.getByLabelText(/add a flavour to the cupboard/i), { target: { value: "Fancy Rabbit" } }); });
    await act(async () => { fireEvent.click(screen.getByLabelText(/Add a can of this flavour/i)); });
    expect(countBox("Fancy Rabbit").value).toBe("2");
  });

  it("won't add a blank", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    expect(screen.getByLabelText(/Add a can of this flavour/i).disabled).toBe(true);
  });

  // A count of 0 is a real answer — "I'm out, keep watching this" — so it can't double as
  // "forget it". Without its own control a row typed by mistake was permanent.
  it("removes a flavour outright, which zero deliberately doesn't do", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Typo Flavour", count: 2 }])));
    await mount();
    expect(countBox("Typo Flavour").value).toBe("2");
    await act(async () => { fireEvent.change(countBox("Typo Flavour"), { target: { value: "0" } }); });
    expect(countBox("Typo Flavour").value).toBe("0"); // still listed, still watched
    await act(async () => { fireEvent.click(screen.getByLabelText(/stop tracking Typo Flavour/i)); });
    expect(screen.queryByLabelText(/cans of Typo Flavour in the cupboard/i)).toBeNull();
  });

  it("won't let a ration flavour be lost by removing it", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Duck", count: 3 }])));
    await mount();
    await act(async () => { fireEvent.click(screen.getByLabelText(/stop tracking Duck/i)); });
    // the count is gone, but the flavour is still in the pack, so it stays on the list to re-count
    expect(countBox("Duck").value).toBe("");
  });

  // A name typed into the cupboard is only a name — nothing can be fed or rationed until it's a
  // real food. Say so, and hand the name over rather than making it be retyped.
  it("points an unsaved flavour at the Foods page, carrying its name", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Fancy Rabbit", count: 1 }])));
    const { container } = await mount();
    const link = [...container.querySelectorAll("a")].find((a) => /add it/.test(a.textContent));
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("#/foods?new=Fancy%20Rabbit");
  });

  it("says nothing of the sort about a flavour that IS a saved food", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Duck", count: 3 }])));
    const { container } = await mount();
    expect(container.textContent).not.toMatch(/not in your foods/);
  });

  it("keeps showing a flavour that has stock but has left the ration", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Discontinued Rabbit", count: 3 }])));
    const { container } = await mount();
    expect(container.textContent).toMatch(/Discontinued Rabbit/); // cans don't vanish with the plan
  });
});

describe("Cans page — layout", () => {
  // jsdom applies no media queries, so this pins the STRUCTURE the desktop grid keys on: the
  // cupboard card as its own grid child, and both fridge cards inside one .alm-col wrapper.
  // (On phones .alm-col is display:contents, so the same structure stacks as before.)
  it("cupboard and fridge are grid siblings, fridge cards share a column wrapper", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    const grid = container.querySelector(".alm-grid");
    const col = grid.querySelector(":scope > .alm-col");
    expect(col).toBeTruthy();
    expect(col.textContent).toMatch(/open cans|Nothing open/i);
    expect(col.textContent).not.toMatch(/cupboard · unopened/i); // the cupboard is NOT inside it
    expect(grid.textContent).toMatch(/cupboard · unopened/i);    // ...but is on the page
  });
});

// Opening moved ONTO the cupboard row — a can leaves the shelf, so the button lives at the shelf.
// The old separate card was the ration's flavours as pills (the cupboard list's subset, twice).
describe("Cans page — opening from the row", () => {
  it("the separate Open-a-can card is gone", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    expect(container.textContent).not.toMatch(/Pick any wet food from your saved foods/);
  });

  it("open on a row moves one can shelf → fridge", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Duck", count: 3 }])));
    const { container } = await mount();
    await act(async () => { fireEvent.click(screen.getByLabelText(/Open a can of Duck/i)); });
    expect(countBox("Duck").value).toBe("2");                   // one left the shelf...
    expect(container.textContent).toMatch(/1 open can/);        // ...and is now in the fridge
    expect(screen.getByLabelText(/grams left of Duck/i)).toBeTruthy();
  });

  it("an uncounted ration flavour can still be opened — counts stay optional", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    await act(async () => { fireEvent.click(screen.getByLabelText(/Open a can of Chicken/i)); });
    expect(container.textContent).toMatch(/1 open can/);
    expect(countBox("Chicken").value).toBe(""); // still untracked, not silently started at 0
  });

  // The row-level version of the pantry exclusions: saved, counted, and still not openable —
  // the row says which of the three reasons applies instead of just hiding the button.
  it("a can saved without grams says so on its row", async () => {
    const s = seed([{ name: "Gramless Can", count: 4 }]);
    s.library = [{ id: "gl", name: "Gramless Can", mode: "perUnit", type: "wet", kcalPerUnit: 66 }];
    window.localStorage.setItem("catration_v1", JSON.stringify(s));
    const { container } = await mount();
    expect(screen.queryByLabelText(/Open a can of Gramless Can/i)).toBeNull();
    expect(container.textContent).toMatch(/needs grams per can to open/);
  });

  it("a bare typed name gets no open button — there's no can size to open", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Mystery Flavour", count: 2 }])));
    await mount();
    expect(screen.queryByLabelText(/Open a can of Mystery Flavour/i)).toBeNull();
  });
});

describe("Cans page — cases", () => {
  const newCase = async () => {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save a case mix/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /edit the mix/i })); });
  };
  const addToCase = async (name) => {
    await act(async () => { fireEvent.change(screen.getByLabelText(/add a food to this case/i), { target: { value: name } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /add this food to the case/i })); });
  };

  // As reported: the editor used to project the WHOLE cupboard list in with a counter each. A
  // case's mix is its own list — it starts empty and grows one food at a time.
  it("a new case starts empty, not as a copy of the cupboard's list", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed([{ name: "Duck", count: 5 }])));
    const { container } = await mount();
    await newCase();
    expect(container.textContent).toMatch(/Empty box so far/);
    expect(screen.queryByLabelText(/Duck per case/i)).toBeNull(); // the cupboard's Duck isn't pre-listed
  });

  it("grows from saved foods, and can hold one the cupboard never mentioned", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    await newCase();
    await addToCase("Brand New Flavour");
    expect(screen.getByLabelText(/Brand New Flavour per case/i).value).toBe("1");
    await addToCase("Brand New Flavour"); // adding again bumps, not duplicates
    expect(screen.getByLabelText(/Brand New Flavour per case/i).value).toBe("2");
    expect(screen.getAllByLabelText(/per case/i)).toHaveLength(1);
  });

  it("saves a mix and adds it by the box", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    const { container } = await mount();
    await newCase();
    await addToCase("Chicken");
    await act(async () => { fireEvent.change(screen.getByLabelText(/Chicken per case/i), { target: { value: "4" } }); });
    await addToCase("Duck");
    await act(async () => { fireEvent.change(screen.getByLabelText(/Duck per case/i), { target: { value: "2" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /\+ 1 case/i })); });
    expect(countBox("Chicken").value).toBe("4");
    expect(countBox("Duck").value).toBe("2");
    // buying the same box again stacks, and the case itself survives
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /\+ 1 case/i })); });
    expect(countBox("Chicken").value).toBe("8");
    expect(container.textContent).toMatch(/6 cans ·/); // the case still describes its own mix
  });

  it("a line can be taken back out of the mix", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    await newCase();
    await addToCase("Chicken");
    await addToCase("Duck");
    await act(async () => { fireEvent.click(screen.getByLabelText(/Remove Chicken from this case/i)); });
    expect(screen.queryByLabelText(/Chicken per case/i)).toBeNull();
    expect(screen.getByLabelText(/Duck per case/i)).toBeTruthy();
  });

  it("won't add an empty case", async () => {
    window.localStorage.setItem("catration_v1", JSON.stringify(seed()));
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save a case mix/i })); });
    expect(screen.getByRole("button", { name: /\+ 1 case/i }).disabled).toBe(true);
  });
});
