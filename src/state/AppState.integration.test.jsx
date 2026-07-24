// @vitest-environment jsdom
//
// Integration layer for the sync merge feature: drives REAL mutations through AppProvider's
// context value (the same seams the UI itself uses — updateCatProfile, weightLog.add/remove,
// deleteCat, clearCatHistory, logWeight), calls the REAL exportData(), and feeds that through a
// SECOND, independently-seeded AppProvider's REAL importData() — proving the hook-level glue
// (the stamping seams pure mergeData/catStore tests can't see, since those call the pure
// reducers directly) actually produces the stateModAt/tombstone behavior mergeData.js documents.
//
// Deliberately does NOT re-test mergeV2's merge rules themselves (see mergeData.test.js and
// mergeData.fuzz.test.js for that) — only that AppState.jsx wires real edits into real stamps,
// and that a real export/import round-trip through two provider instances behaves as designed.

import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { AppProvider, useApp } from "./AppState.jsx";

// Node's own built-in `localStorage` global (present since Node ~22, unconfigured here — see
// the `--localstorage-file` warning) shadows jsdom's real one on `window` in this environment,
// leaving a stub with no working methods. AppState's own storage.js already tolerates that
// (every real call is try/caught — see lib/storage.js), which is exactly why these tests don't
// depend on real persistence in the first place (each provider's seed state comes from actual
// hook calls, never from a storage round-trip) — but guard our own best-effort cleanup call too.
const clearStorage = () => { try { window.localStorage.clear(); } catch { /* see comment above */ } };

afterEach(() => {
  cleanup();
  clearStorage();
});

// Captures the live context value into a plain mutable ref so tests can call the real
// mutators/read the real derived state directly, without needing to render any actual UI.
function Probe({ apiRef }) {
  apiRef.current = useApp();
  return null;
}

async function renderApp() {
  const apiRef = { current: null };
  const utils = render(<AppProvider><Probe apiRef={apiRef} /></AppProvider>);
  // Flush the initial store.load().then(hydrate) microtask before any test mutates state, so
  // a slow/async hydrate can never race with (and clobber) a mutation the test just made.
  await act(async () => { await Promise.resolve(); });
  return { apiRef, ...utils };
}

const realCats = (apiRef) => apiRef.current.catsSummary.filter((c) => !c.demo);

describe("AppState integration: real mutations through the hook, exported/imported for real", () => {
  it("addCat + a profile edit through the hook stamps a real, non-zero stateModAt in the export", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    const id = apiRef.current.activeCatId;
    const before = Date.now();
    act(() => apiRef.current.updateCatProfile(id, { name: "Mithril" }));
    const blob = JSON.parse(apiRef.current.exportData());
    expect(blob.cats[id].profile.name).toBe("Mithril");
    expect(blob.cats[id].stateModAt).toBeGreaterThanOrEqual(before);
    expect(blob.cats[id].stateModAt).toBeLessThanOrEqual(Date.now());
  });

  it("logWeight through the hook appends a real weigh-in that round-trips through export", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    const id = apiRef.current.activeCatId;
    act(() => apiRef.current.logWeight({ kg: 4.4 }));
    expect(apiRef.current.weightLog.items).toHaveLength(1);
    const blob = JSON.parse(apiRef.current.exportData());
    expect(blob.cats[id].weightLog).toHaveLength(1);
    expect(blob.cats[id].weightLog[0].kg).toBe(4.4);
    // logging a weigh-in must NOT stamp the current-state bundle's clock (see catStore.js's
    // updateActiveCatState banner) — it would fake-bump the profile/ration LWW if it did.
    expect(blob.cats[id].stateModAt).toBe(0);
  });

  it("importing a second, differently-seeded provider's export additively merges both cats in (real importData seam)", async () => {
    const a = await renderApp();
    act(() => a.apiRef.current.addCat());
    act(() => a.apiRef.current.updateCatProfile(a.apiRef.current.activeCatId, { name: "Mithril" }));
    const exportedFromA = a.apiRef.current.exportData();
    a.unmount();
    cleanup();
    clearStorage();

    const b = await renderApp();
    act(() => b.apiRef.current.addCat());
    act(() => b.apiRef.current.updateCatProfile(b.apiRef.current.activeCatId, { name: "Salem" }));
    act(() => b.apiRef.current.importData(JSON.parse(exportedFromA)));

    const names = realCats(b.apiRef).map((c) => c.name).sort();
    expect(names).toEqual(["Mithril", "Salem"]);
  });

  it("an edit made through the hook produces a newer stateModAt that wins over a stale re-import of the same cat", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    const id = apiRef.current.activeCatId;
    act(() => apiRef.current.updateCatProfile(id, { name: "V1" }));
    const staleExport = apiRef.current.exportData(); // "what another device synced a moment ago"

    // A real edit happens locally AFTER that stale copy was taken.
    await new Promise((r) => setTimeout(r, 2)); // ensure Date.now() actually advances
    act(() => apiRef.current.updateCatProfile(id, { name: "V2" }));

    // Re-importing the (now stale) earlier copy must NOT clobber the newer local edit.
    act(() => apiRef.current.importData(JSON.parse(staleExport)));
    expect(apiRef.current.catsSummary.find((c) => c.id === id).name).toBe("V2");
  });

  it("a delete made through the hook records a tombstone that survives a stale re-import of the same cat", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    const id = apiRef.current.activeCatId;
    act(() => apiRef.current.updateCatProfile(id, { name: "Mithril" }));
    const staleExport = apiRef.current.exportData(); // still shows the cat alive

    await new Promise((r) => setTimeout(r, 2));
    act(() => apiRef.current.deleteCat(id));
    expect(realCats(apiRef).map((c) => c.id)).not.toContain(id);

    act(() => apiRef.current.importData(JSON.parse(staleExport)));
    expect(realCats(apiRef).map((c) => c.id)).not.toContain(id); // tombstone stuck — no resurrection
  });

  it("removing a weigh-in through the hook tombstones it — a stale re-import of the same cat does not resurrect it", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    const id = apiRef.current.activeCatId;
    act(() => apiRef.current.logWeight({ kg: 4.4 }));
    const staleExport = apiRef.current.exportData(); // still has the weigh-in

    const entryId = apiRef.current.weightLog.items[0].id;
    act(() => apiRef.current.weightLog.remove(entryId));
    expect(apiRef.current.weightLog.items).toHaveLength(0);

    act(() => apiRef.current.importData(JSON.parse(staleExport)));
    expect(apiRef.current.weightLog.items).toHaveLength(0);
    expect(JSON.parse(apiRef.current.exportData()).cats[id].deletedEntries).toHaveProperty(entryId);
  });

  it("clearCatHistory through the hook wipes weigh-ins/meals, and a stale re-import doesn't bring them back", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    const id = apiRef.current.activeCatId;
    act(() => apiRef.current.logWeight({ kg: 4.4 }));
    act(() => apiRef.current.intakeLog.add({ date: apiRef.current.today, kcal: 200 }));
    const staleExport = apiRef.current.exportData();

    act(() => apiRef.current.clearCatHistory(id));
    expect(apiRef.current.weightLog.items).toHaveLength(0);
    expect(apiRef.current.intakeLog.items).toHaveLength(0);

    act(() => apiRef.current.importData(JSON.parse(staleExport)));
    expect(apiRef.current.weightLog.items).toHaveLength(0);
    expect(apiRef.current.intakeLog.items).toHaveLength(0);
  });

  it("activeCatId stays local through a real hook-driven import — the keep-local asymmetry holds end-to-end", async () => {
    const a = await renderApp();
    act(() => a.apiRef.current.addCat());
    const localActive = a.apiRef.current.activeCatId;

    const b = await renderApp();
    act(() => b.apiRef.current.addCat()); // b's own distinct cat/activeCatId
    const exportedFromB = b.apiRef.current.exportData();
    b.unmount();

    act(() => a.apiRef.current.importData(JSON.parse(exportedFromB)));
    expect(a.apiRef.current.activeCatId).toBe(localActive); // unchanged by the import
  });

  it("importing onto a fresh install (still on Biscuit the demo) auto-switches to the imported cat", async () => {
    const a = await renderApp();
    act(() => a.apiRef.current.addCat());
    act(() => a.apiRef.current.updateCatProfile(a.apiRef.current.activeCatId, { name: "Mithril" }));
    const exportedFromA = a.apiRef.current.exportData();
    a.unmount();
    cleanup();
    clearStorage();

    const b = await renderApp();
    // fresh install starts on the demo cat
    const activeBefore = b.apiRef.current.catsSummary.find((c) => c.id === b.apiRef.current.activeCatId);
    expect(activeBefore.demo).toBe(true);

    act(() => b.apiRef.current.importData(JSON.parse(exportedFromA)));
    const activeAfter = b.apiRef.current.catsSummary.find((c) => c.id === b.apiRef.current.activeCatId);
    expect(activeAfter.demo).toBeFalsy();
    expect(activeAfter.name).toBe("Mithril");
  });

  it("importing multiple cats onto a fresh install switches to the alphabetically-first by name", async () => {
    const a = await renderApp();
    act(() => a.apiRef.current.addCat());
    act(() => a.apiRef.current.updateCatProfile(a.apiRef.current.activeCatId, { name: "Zoe" }));
    act(() => a.apiRef.current.addCat());
    act(() => a.apiRef.current.updateCatProfile(a.apiRef.current.activeCatId, { name: "Anna" }));
    const exportedFromA = a.apiRef.current.exportData();
    a.unmount();
    cleanup();
    clearStorage();

    const b = await renderApp();
    act(() => b.apiRef.current.importData(JSON.parse(exportedFromA)));
    const active = b.apiRef.current.catsSummary.find((c) => c.id === b.apiRef.current.activeCatId);
    expect(active.name).toBe("Anna");
  });

  it("a legacy export (customized skin/unit, settingsModAt 0) carries those over import to a fresh install", async () => {
    const a = await renderApp();
    act(() => a.apiRef.current.addCat());
    act(() => a.apiRef.current.updateCatProfile(a.apiRef.current.activeCatId, { name: "Mithril" }));
    const blob = JSON.parse(a.apiRef.current.exportData());
    // Simulate pre-timestamp legacy data: genuine customizations, but the 0 stamp of that era.
    blob.skin = "tidepool";
    blob.unit = "lb";
    blob.settingsModAt = 0;
    a.unmount();
    cleanup();
    clearStorage();

    const b = await renderApp();
    expect(b.apiRef.current.skin).toBe("original"); // fresh install defaults
    expect(b.apiRef.current.unit).toBe("kg");

    act(() => b.apiRef.current.importData(blob));
    expect(b.apiRef.current.skin).toBe("tidepool"); // legacy customization won over the default
    expect(b.apiRef.current.unit).toBe("lb");
  });

  it("re-importing one's own just-taken export is a no-op (idempotent through the real seam)", async () => {
    const { apiRef } = await renderApp();
    act(() => apiRef.current.addCat());
    act(() => apiRef.current.updateCatProfile(apiRef.current.activeCatId, { name: "Mithril" }));
    act(() => apiRef.current.logWeight({ kg: 4.4 }));
    const before = apiRef.current.exportData();
    act(() => apiRef.current.importData(JSON.parse(before)));
    const after = apiRef.current.exportData();
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
  });
});
