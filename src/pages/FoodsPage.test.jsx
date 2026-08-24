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
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /by the can/i })); });
    await type(/Energy per can/i, "82");
    await type(/Grams per can/i, "85");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    expect(screen.getByDisplayValue("Fancy Rabbit Pâté")).toBeTruthy();
    await type(/search your foods/i, "rabbit");
    expect(screen.getByDisplayValue("Fancy Rabbit Pâté")).toBeTruthy();
    expect(container.textContent).toMatch(/1 shown/);
  });

  // A half-typed food would be offered in every search on every screen.
  it("won't save one without a name and an energy", async () => {
    await mount();
    await openForm();
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(true);
    await type(/new food name/i, "Nameless Energy");
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(true); // still no energy
    await type(/Energy$/i, "3800");
    expect(screen.getByRole("button", { name: /save food/i }).disabled).toBe(false);
  });

  // Searching for a food in order to rename it is the obvious path, and a live filter fights it:
  // the row stops matching mid-word and disappears while you're still typing in it.
  it("doesn't yank a row out from under you while you rename it", async () => {
    await mount();
    await openForm();
    await type(/new food name/i, "Typo Chicken");
    await type(/Energy$/i, "3800");
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
    await type(/Energy$/i, "3800");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save food/i })); });
    await act(async () => { fireEvent.change(screen.getByLabelText(/Typo Chicken name/i), { target: { value: "Fixed Chicken" } }); });
    expect(screen.getByDisplayValue("Fixed Chicken")).toBeTruthy();
    expect(screen.queryByDisplayValue("Typo Chicken")).toBeNull();
  });

  it("removes one, after asking", async () => {
    const { container } = await mount();
    await openForm();
    await type(/new food name/i, "Doomed Duck");
    await type(/Energy$/i, "3800");
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

  // The hand-off from the cupboard: it links here with the name it couldn't do anything with.
  it("opens ready to save a name handed over in the link", async () => {
    window.location.hash = "#/foods?new=Fancy%20Rabbit";
    await mount();
    expect(screen.getByLabelText(/new food name/i).value).toBe("Fancy Rabbit");
  });
});
