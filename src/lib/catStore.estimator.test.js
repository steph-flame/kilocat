import { describe, it, expect } from "vitest";
import { ESTIMATORS, resolveEstimator } from "./catStore.js";

// Adding v4 shipped a settings button that silently did nothing, because AppState's setEstimator
// carried its OWN hardcoded copy of the valid ids. These pin the single-source-of-truth so the
// next estimator can't repeat it.
describe("estimator ids have exactly one source of truth", () => {
  it("every estimator the app dispatches on is selectable", () => {
    expect(ESTIMATORS).toContain("v1");
    expect(ESTIMATORS).toContain("v2");
    expect(ESTIMATORS).toContain("v3");
    expect(ESTIMATORS).toContain("v4");
  });

  it("resolveEstimator accepts each of them, and rejects anything else", () => {
    for (const id of ESTIMATORS) expect(resolveEstimator(id)).toBe(id);
    expect(resolveEstimator("v9")).toBeUndefined();
    expect(resolveEstimator(undefined)).toBeUndefined();
    expect(resolveEstimator(null, "v4")).toBe("v4"); // legacy per-cat `algo` still honoured
  });

  it("AppState's setter validates against the shared list, not a private copy", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/state/AppState.jsx", "utf8"));
    const setter = src.match(/const setEstimator = [^\n]*/)?.[0] || "";
    expect(setter).toMatch(/ESTIMATORS\.includes/);
    // the exact shape of the bug: a hand-written disjunction of ids
    expect(setter).not.toMatch(/=== "v\d"/);
  });

  it("both settings surfaces offer every estimator", async () => {
    const fs = await import("node:fs");
    for (const f of ["src/pages/MorePage.jsx", "src/pages/Settings.jsx"]) {
      const src = fs.readFileSync(f, "utf8");
      for (const id of ESTIMATORS) expect(src, `${f} is missing ${id}`).toContain(`"${id}"`);
    }
  });
});
