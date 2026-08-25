// @vitest-environment jsdom
//
// The Foods page: the saved-food library as a place you can create, edit and remove in.
// Mounted for real, because a library you can't actually add to is the bug this page fixes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AppProvider } from "../state/AppState.jsx";
import FoodsPage from "./FoodsPage.jsx";

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
  const r = render(<AppProvider><FoodsPage /></AppProvider>);
  await act(async () => { await Promise.resolve(); });
  return r;
};
const openForm = async () => act(async () => { fireEvent.click(screen.getByRole("button", { name: /add a food/i })); });
const type = async (labelRe, value) => act(async () => { fireEvent.change(screen.getByLabelText(labelRe), { target: { value } }); });

beforeEach(() => { installStorage(); window.location.hash = "#/foods"; });
afterEach(() => { cleanup(); window.localStorage.clear(); window.location.hash = ""; });

describe("Foods page", () => {
  it("shows the built-in starter foods", async () => {
    const { container } = await mount();
    expect(container.textContent).toMatch(/\d+ saved/);
    expect(screen.getByLabelText(/search your foods/i)).toBeTruthy();
  });

  it("filters as you search", async () => {
    const { container } = await mount();
    await type(/search your foods/i, "zzzznothing");
    expect(container.textContent).toMatch(/Nothing matches that/);
  });

  // The actual point of the page.
  it("creates a food, which is then searchable", async () => {
    const { container } = await mount();
    await openForm();
    await type(/new food name/i, "Fancy Rabbit Pâté");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is wet food/i })); });
    await type(/Energy \/ can/i, "82");
    await type(/Grams \/ can/i, "85");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    expect(screen.getByDisplayValue("Fancy Rabbit Pâté")).toBeTruthy();
    await type(/search your foods/i, "rabbit");
    expect(screen.getByDisplayValue("Fancy Rabbit Pâté")).toBeTruthy();
    expect(container.textContent).toMatch(/1 shown/);
  });

  // The four types the app actually has. Offering only "by weight / by the can" derived the type
  // from the measurement, which silently made every non-kibble food wet — so a treat or a
  // supplement could not be created anywhere but a ration row.
  it("offers all four types, not just how it's measured", async () => {
    await mount();
    await openForm();
    for (const re of [/is dry food/i, /is wet food/i, /is a treat/i, /is a supplement/i]) {
      expect(screen.getByRole("button", { name: re })).toBeTruthy();
    }
  });

  it("creates a treat, with the label's own two figures", async () => {
    const { container } = await mount();
    await openForm();
    await type(/new food name/i, "Temptations");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is a treat/i })); });
    // a treat is entered as the package states it — per treat AND per kg
    await type(/Calories \/ treat/i, "2");
    await type(/Calories \/ kg/i, "4000");
    expect(container.textContent).toMatch(/g per treat · worked out from the label/); // weight derived
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await type(/search your foods/i, "Tempt");
    expect(screen.getByDisplayValue("Temptations")).toBeTruthy();
    expect(container.textContent).toMatch(/treat ·/);
  });

  it("creates a supplement, which is given by the sachet", async () => {
    const { container } = await mount();
    await openForm();
    await type(/new food name/i, "Probiotic Sachet");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is a supplement/i })); });
    await type(/Calories \/ sachet/i, "4");
    await type(/Grams \/ sachet/i, "1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await type(/search your foods/i, "Probiotic");
    expect(container.textContent).toMatch(/supplement · 4 kcal \/ 1 g sachet/);
  });

  // A half-typed food would be offered in every search on every screen. The bar is
  // isCompleteFood — the SAME one the ration's bookmark uses, so the library's two doors agree.
  it("won't save one without a name and an energy", async () => {
    await mount();
    await openForm();
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(true);
    await type(/new food name/i, "Nameless Energy");
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(true); // still no energy
    await type(/^Energy$/i, "3800");
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(false);
  });

  it("a can's energy alone is enough — same as saving it from a ration row", async () => {
    await mount();
    await openForm();
    await type(/new food name/i, "Gramless Can");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is wet food/i })); });
    await type(/Energy \/ can/i, "60"); // no grams/can — the bookmark path accepts exactly this
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(false);
  });

  // Searching for a food in order to rename it is the obvious path, and a live filter fights it:
  // the row stops matching mid-word and disappears while you're still typing in it.
  it("doesn't yank a row out from under you while you rename it", async () => {
    await mount();
    await openForm();
    await type(/new food name/i, "Typo Chicken");
    await type(/^Energy$/i, "3800");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await type(/search your foods/i, "Typo");
    // rename it to something that no longer matches "Typo" — it must stay put
    await act(async () => { fireEvent.change(screen.getByLabelText(/Typo Chicken name/i), { target: { value: "Fixed Chicken" } }); });
    expect(screen.getByDisplayValue("Fixed Chicken")).toBeTruthy();
    // and re-filtering does apply the search again
    await type(/search your foods/i, "Typo ");
    expect(screen.queryByDisplayValue("Fixed Chicken")).toBeNull();
  });

  it("edits a saved food in place", async () => {
    const { container } = await mount();
    await openForm();
    await type(/new food name/i, "Typo Chicken");
    await type(/^Energy$/i, "3800");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/Typo Chicken name/i), { target: { value: "Fixed Chicken" } }); });
    expect(screen.getByDisplayValue("Fixed Chicken")).toBeTruthy();
    expect(screen.queryByDisplayValue("Typo Chicken")).toBeNull();
  });

  it("removes one, after asking", async () => {
    const { container } = await mount();
    await openForm();
    await type(/new food name/i, "Doomed Duck");
    await type(/^Energy$/i, "3800");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await type(/search your foods/i, "Doomed");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /remove Doomed Duck/i })); });
    expect(screen.getByDisplayValue("Doomed Duck")).toBeTruthy(); // said no, so it stayed
    confirm.mockReturnValue(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /remove Doomed Duck/i })); });
    expect(screen.queryByDisplayValue("Doomed Duck")).toBeNull();
    expect(container.textContent).toMatch(/Nothing matches that/);
    confirm.mockRestore();
  });

  // THE reported bug, exactly as reported: "I tried removing some of the default foods from my
  // library yesterday, but now they are back." Remove a starter food, come back tomorrow (a fresh
  // mount over the same storage), and it must still be gone — ensureBuiltins used to re-add it on
  // every load.
  it("keeps a removed starter food removed across a reload", async () => {
    const first = await mount();
    // the starter list carries this recipe in TWO can sizes — remove every one, or the survivor
    // makes the reload assertion pass for the wrong reason
    await type(/search your foods/i, "Tiki Cat After Dark Chicken & Beef");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    while (screen.queryAllByRole("button", { name: /^remove/i }).length) {
      await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^remove/i })[0]); });
    }
    confirm.mockRestore();
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); }); // debounced save
    first.unmount();
    cleanup();
    const { container } = await mount(); // "the next morning": same storage, fresh app
    await type(/search your foods/i, "Tiki Cat After Dark Chicken & Beef");
    expect(container.textContent).toMatch(/Nothing matches that/);
  });

  it("but re-adding it by hand un-deletes it, including across a reload", async () => {
    const first = await mount();
    await type(/search your foods/i, "Tiki Cat After Dark Chicken & Beef");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    while (screen.queryAllByRole("button", { name: /^remove/i }).length) {
      await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^remove/i })[0]); });
    }
    confirm.mockRestore();
    await type(/search your foods/i, "");
    await openForm();
    await type(/new food name/i, "Tiki Cat After Dark Chicken & Beef");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /is wet food/i })); });
    await type(/Energy \/ can/i, "60");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    first.unmount();
    cleanup();
    await mount();
    // scope to the food rows' own name inputs — the search box is also an input holding the query
    expect(screen.getAllByLabelText(/Chicken & Beef.*name$/i).length).toBeGreaterThan(0);
  });

  // Steph's rule, checked in the place it was broken: the form must save through the same seam
  // the ration's bookmark uses (saveFood → toLibraryEntry), so the row-only fields the draft
  // carries (blankFood's pct, a scratch id) never land in the library.
  it("saves through the shared seam — no ration-only fields leak into the library", async () => {
    await mount();
    await openForm();
    await type(/new food name/i, "Seam Check");
    await type(/^Energy$/i, "3800");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    const saved = JSON.parse(window.localStorage.getItem("catration_v1"));
    const f = saved.library.find((x) => x.name === "Seam Check");
    expect(f).toBeTruthy();
    expect(f.pct).toBeUndefined();
    expect(f.modAt).toBeGreaterThan(0);
  });

  // The hand-off from the cupboard: it links here with the name it couldn't do anything with.
  it("opens ready to save a name handed over in the link", async () => {
    window.location.hash = "#/foods?new=Fancy%20Rabbit";
    await mount();
    expect(screen.getByLabelText(/new food name/i).value).toBe("Fancy Rabbit");
  });
});
