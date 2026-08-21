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

  it("normalizes a missing or non-string start date to blank", () => {
    expect(collarOf({ collar: { grams: 40 } }).since).toBe("");
    expect(collarOf({ collar: { grams: 40, since: 20260821 } }).since).toBe("");
    expect(collarOf({ collar: { grams: 40, since: "2026-08-21" } }).since).toBe("2026-08-21");
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

  // THE CASE THIS WAS ADDED FOR: a cat that is ABOUT to start wearing a collar. Setting one up must
  // not restate every weigh-in she ever had as 40 g lighter than the scale said.
  it("leaves everything before the start date alone", () => {
    const c = { grams: 40, defaultOn: true, since: "2026-08-21" };
    expect(collarWorn({ date: "2026-08-20" }, c)).toBe(false); // the day before: bare cat
    expect(collarWorn({ date: "2026-08-21" }, c)).toBe(true);  // the day itself counts
    expect(collarWorn({ date: "2026-08-22" }, c)).toBe(true);
  });

  it("still lets a single early weigh-in say the collar was on", () => {
    const c = { grams: 40, defaultOn: true, since: "2026-08-21" };
    expect(collarWorn({ date: "2026-08-10", collarOn: true }, c)).toBe(true);
  });

  // THE OTHER END. A collar that comes off must not un-correct the months it was on — the owner
  // needs a move that's truthful about both halves at once, or the model has trapped them.
  it("stops correcting after the last day it was worn", () => {
    const c = { grams: 40, defaultOn: false, since: "2026-03-01", until: "2026-08-21" };
    expect(collarWorn({ date: "2026-02-28" }, c)).toBe(false); // before she had it
    expect(collarWorn({ date: "2026-03-01" }, c)).toBe(true);
    expect(collarWorn({ date: "2026-06-15" }, c)).toBe(true);  // the middle stays corrected
    expect(collarWorn({ date: "2026-08-21" }, c)).toBe(true);  // the last day counts
    expect(collarWorn({ date: "2026-08-22" }, c)).toBe(false); // bare again
  });

  it("an open-ended period runs to the present", () => {
    const c = { grams: 40, defaultOn: true, since: "2026-03-01", until: "" };
    expect(collarWorn({ date: "2030-01-01" }, c)).toBe(true);
  });

  // The regime a period can't express, and what every profile saved before `until` existed means.
  it("switched off with no period recorded corrects nothing", () => {
    expect(collarWorn({ date: "2026-06-15" }, { grams: 40, defaultOn: false, since: "", until: "" })).toBe(false);
    expect(collarWorn({ date: "2026-06-15" }, { grams: 40, defaultOn: false, since: "2026-03-01", until: "" })).toBe(false);
  });

  it("with no start date recorded, the default reaches all the way back", () => {
    // nothing the UI produces — it stamps a date whenever a weight is first entered — but an
    // imported or hand-edited profile can say this, and it shouldn't crash or silently do nothing
    expect(collarWorn({ date: "2020-01-01" }, { grams: 40, defaultOn: true, since: "" })).toBe(true);
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

// The real-life setup: a cat with a month of history who starts wearing a collar TODAY. Nothing
// already logged may move, and nothing logged from here on may look like sudden weight gain.
describe("putting a collar on a cat that already has history", () => {
  const SINCE = "2026-08-21";
  const c = { grams: 40, defaultOn: true, since: SINCE };
  const before = ["2026-08-18", "2026-08-19", "2026-08-20"].map((date) => ({ date, kg: 4.5 }));
  const after = ["2026-08-21", "2026-08-22", "2026-08-23"].map((date) => ({ date, kg: 4.54 }));

  it("the back history reads exactly as it was logged", () => {
    const out = stripCollar(before, c);
    expect(out.map((e) => e.kg)).toEqual([4.5, 4.5, 4.5]);
    expect(out.every((e) => e.collarOn === false)).toBe(true);
  });

  it("and the series doesn't step on the day the collar goes on", () => {
    const all = stripCollar([...before, ...after], c);
    expect(all.every((e) => Math.abs(e.kg - 4.5) < 1e-9)).toBe(true);
  });

  // Without the start date this is what the owner would get: a truthful-looking history that has
  // quietly been restated 40 g light, every point of it, for a collar the cat wasn't wearing.
  it("without one, every past weigh-in is silently rewritten", () => {
    const noDate = stripCollar(before, { grams: 40, defaultOn: true, since: "" });
    expect(noDate.every((e) => e.kg < 4.5)).toBe(true);
    expect(noDate[0].rawKg).toBe(4.5); // the reading itself survives — only the reading OF it moved
  });
});

// The collar era ending, which is the same problem as it starting, pointed the other way. Whatever
// the owner does on that day, the record of the months she wore it must not move.
describe("taking the collar off for good", () => {
  const worn = ["2026-08-19", "2026-08-20", "2026-08-21"].map((date) => ({ date, kg: 4.54 }));
  const bare = ["2026-08-22", "2026-08-23"].map((date) => ({ date, kg: 4.5 }));
  const ended = { grams: 40, defaultOn: false, since: "2026-08-19", until: "2026-08-21" };

  it("keeps the worn stretch corrected and leaves the bare days alone", () => {
    const all = stripCollar([...worn, ...bare], ended);
    expect(all.every((e) => Math.abs(e.kg - 4.5) < 1e-9)).toBe(true); // one continuous flat cat
    expect(all.slice(0, 3).every((e) => e.collarOn === true)).toBe(true);
    expect(all.slice(3).every((e) => e.collarOn === false)).toBe(true);
  });

  it("the raw readings are untouched throughout, as always", () => {
    expect(stripCollar([...worn, ...bare], ended).map((e) => e.rawKg)).toEqual([4.54, 4.54, 4.54, 4.5, 4.5]);
  });

  // What the owner would have been left with if ending the period weren't expressible: the only
  // available move — clearing the collar's weight — silently restates every day she DID wear it.
  it("simply deleting the collar instead would rewrite the worn stretch", () => {
    const deleted = stripCollar([...worn, ...bare], { grams: 0, defaultOn: true, since: "", until: "" });
    expect(deleted.slice(0, 3).every((e) => e.kg === 4.54)).toBe(true); // 40 g of collar, read as cat
    expect(new Set(deleted.map((e) => e.kg)).size).toBe(2);             // a step that never happened
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
