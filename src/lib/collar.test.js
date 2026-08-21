// The collar model, and the property that actually matters: a collar that's only SOMETIMES on must
// not turn into a weight change. See lib/collar.js.

import { describe, it, expect } from "vitest";
import { defaultCollar, collarOf, hasCollar, collarWorn, collarOffsetKg, stripCollar } from "./collar.js";
import { ucEstimateExpenditure } from "./expenditure.js";

const c40 = { grams: 40, defaultOn: true };

describe("reading a collar off a profile", () => {
  it("defaults to nothing worn — no collar until an owner weighs one", () => {
    expect(hasCollar(collarOf({}))).toBe(false);
    expect(hasCollar(collarOf(undefined))).toBe(false);
    expect(collarOf({ collar: defaultCollar() }).grams).toBe(0);
  });

  it("survives every shape a profile from before this feature can be", () => {
    for (const p of [null, {}, { collar: null }, { collar: {} }, { collar: { grams: "" } }, { collar: { grams: "abc" } }, { collar: { grams: -5 } }]) {
      const c = collarOf(p);
      expect(c.grams).toBe(0);
      expect(typeof c.defaultOn).toBe("boolean");
    }
  });

  it("keeps a typed string weight as a number", () => {
    expect(collarOf({ collar: { grams: "42" } }).grams).toBe(42);
  });

  it("treats an absent defaultOn as worn — entering a collar's weight implies the cat wears it", () => {
    expect(collarOf({ collar: { grams: 40 } }).defaultOn).toBe(true);
    expect(collarOf({ collar: { grams: 40, defaultOn: false } }).defaultOn).toBe(false);
  });
});

describe("whether the collar was on for a given reading", () => {
  it("follows the cat's default when the entry doesn't say", () => {
    expect(collarWorn({ kg: 4.5 }, c40)).toBe(true);
    expect(collarWorn({ kg: 4.5 }, { grams: 40, defaultOn: false })).toBe(false);
  });

  it("obeys the entry when it does say, in both directions", () => {
    expect(collarWorn({ collarOn: false }, c40)).toBe(false);
    expect(collarWorn({ collarOn: true }, { grams: 40, defaultOn: false })).toBe(true);
  });

  // The tri-state is the point: "I didn't say" has to stay distinguishable from "no", or correcting
  // the default later would silently rewrite readings the owner explicitly answered for.
  it("distinguishes an unanswered entry from an explicit no", () => {
    const unanswered = { kg: 4.5 };
    const explicitNo = { kg: 4.5, collarOn: false };
    expect(collarWorn(unanswered, c40)).toBe(true);
    expect(collarWorn(explicitNo, c40)).toBe(false);
    // flip the cat's default: only the unanswered one moves
    const off = { grams: 40, defaultOn: false };
    expect(collarWorn(unanswered, off)).toBe(false);
    expect(collarWorn(explicitNo, off)).toBe(false);
  });

  it("never subtracts when there's no collar, whatever the entry claims", () => {
    expect(collarWorn({ collarOn: true }, { grams: 0, defaultOn: true })).toBe(false);
    expect(collarOffsetKg({ collarOn: true }, { grams: 0, defaultOn: true })).toBe(0);
  });
});

describe("stripCollar", () => {
  it("subtracts the collar and keeps the scale's own reading", () => {
    const [e] = stripCollar([{ date: "2026-08-01", kg: 4.54 }], c40);
    expect(e.kg).toBeCloseTo(4.5, 10);
    expect(e.rawKg).toBe(4.54);
    expect(e.collarKg).toBeCloseTo(0.04, 10);
    expect(e.collarOn).toBe(true);
  });

  it("leaves a bare reading alone but still reports the shape", () => {
    const [e] = stripCollar([{ date: "2026-08-01", kg: 4.5, collarOn: false }], c40);
    expect(e.kg).toBe(4.5);
    expect(e.rawKg).toBe(4.5);
    expect(e.collarKg).toBe(0);
    expect(e.collarOn).toBe(false);
  });

  it("carries every other field through untouched", () => {
    const [e] = stripCollar([{ id: "w1", date: "2026-08-01", kg: 4.54, method: "litterRobot", source: "litter-robot", ts: 123 }], c40);
    expect(e).toMatchObject({ id: "w1", date: "2026-08-01", method: "litterRobot", source: "litter-robot", ts: 123 });
  });

  it("is a no-op on a cat with no collar", () => {
    const raw = [{ date: "2026-08-01", kg: 4.5 }, { date: "2026-08-02", kg: 4.52 }];
    expect(stripCollar(raw, collarOf({})).map((e) => e.kg)).toEqual([4.5, 4.52]);
  });

  it("tolerates an empty or missing log", () => {
    expect(stripCollar([], c40)).toEqual([]);
    expect(stripCollar(undefined, c40)).toEqual([]);
  });
});

// THE REASON THIS FEATURE EXISTS. A collar that's ALWAYS on was never the problem: burn is inferred
// from the rate of change, so a constant offset cancels. The damage is the collar coming off partway
// through — the day the tracker's battery dies, say — which puts a 40 g cliff in the middle of the
// history that the estimator has no way to read as anything but the cat losing 40 g overnight.
describe("a collar taken off partway through doesn't masquerade as weight loss", () => {
  const DAYS = 60;
  const dates = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date("2026-01-01T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  // A cat that does not change weight at all. It wears the collar for the first month, then never
  // again — so the SCALE reads 4.54 then 4.50, while the cat is 4.50 throughout.
  const CAT_KG = 4.5;
  const raw = dates.map((date, i) => ({ date, kg: i < 30 ? CAT_KG + 0.04 : CAT_KG, collarOn: i < 30 }));
  const intake = dates.map((date) => ({ date, value: 210 }));
  const fit = (entries) => ucEstimateExpenditure(
    entries.map((e) => ({ date: e.date, value: e.kg, method: "litterRobot" })), intake,
    { priorKcal: 210, priorSdKcal: 60 }
  );

  it("stripping the collar leaves a perfectly flat cat", () => {
    const stripped = stripCollar(raw, c40);
    expect(stripped.every((e) => Math.abs(e.kg - CAT_KG) < 1e-9)).toBe(true);
    expect(Math.abs(fit(stripped).rateKgPerWeek)).toBeLessThan(0.002);
  });

  it("and the uncorrected reading is what would have been read as real loss", () => {
    const uncorrected = fit(raw);
    const corrected = fit(stripCollar(raw, c40));
    // the raw series slopes down; the corrected one doesn't
    expect(uncorrected.rateKgPerWeek).toBeLessThan(-0.002);
    expect(Math.abs(uncorrected.rateKgPerWeek)).toBeGreaterThan(Math.abs(corrected.rateKgPerWeek) * 5);
    // which lands where it hurts: a cat that isn't losing weight is credited with burning more
    // than it eats. 7800 kcal/kg means even this small a cliff moves the number visibly.
    expect(uncorrected.kcal).toBeGreaterThan(corrected.kcal + 3);
  });
});
