import { describe, it, expect } from "vitest";
import { transitionSteps, inferTransitionDay, blendRows, shareOfNew, clampDays, makeSlotKeyer } from "./transition.js";

// A switch from Instinct (old) to Farmina (new), both 4 kcal/g, one shared food (a treat) that
// isn't changing — the usual shape: one line differs, everything else holds.
const OLD = [{ id: "o1", name: "Instinct", kcalPerG: 4, splitMode: "remainder" }];
const NEW = [{ id: "n1", name: "Farmina", kcalPerG: 4, splitMode: "remainder" }];
const TARGET = 200;

const plan = (day, days = 7, oldItems = OLD, newItems = NEW) =>
  transitionSteps({ startItems: oldItems, resolvedRationItems: newItems, target: TARGET, day, days });
const kcalOf = (rows, name) => rows.filter((r) => r.name === name).reduce((a, r) => a + r.kcal, 0);

describe("the ramp's per-day mix", () => {
  it("day 1 of 7 is mostly the OLD food — the bug was showing 100% new on day 1", () => {
    const rows = plan(1);
    expect(kcalOf(rows, "Instinct")).toBeCloseTo(TARGET * 6 / 7, 5);
    expect(kcalOf(rows, "Farmina")).toBeCloseTo(TARGET * 1 / 7, 5);
  });

  it("the last day is the full new ration, and the old food is gone", () => {
    const rows = plan(7);
    expect(kcalOf(rows, "Farmina")).toBeCloseTo(TARGET, 5);
    expect(kcalOf(rows, "Instinct")).toBeCloseTo(0, 5);
  });

  it("holds total energy at target on every single day", () => {
    for (let d = 1; d <= 7; d++) {
      expect(plan(d).reduce((a, r) => a + r.kcal, 0)).toBeCloseTo(TARGET, 5);
    }
  });

  it("moves monotonically from old to new", () => {
    const olds = [1, 2, 3, 4, 5, 6, 7].map((d) => kcalOf(plan(d), "Instinct"));
    expect(olds).toEqual([...olds].sort((a, b) => b - a));
    expect(new Set(olds).size).toBe(7); // and actually changes each day
  });

  it("labels each food's role in the ramp", () => {
    const rows = plan(3);
    expect(rows.find((r) => r.name === "Farmina").phase).toBe("in");
    expect(rows.find((r) => r.name === "Instinct").phase).toBe("out");
  });

  it("a food in BOTH blends at the same amount stays flat (no phantom column)", () => {
    const oldItems = [...OLD, { id: "o2", name: "FortiFlora", kcalPerG: 0, splitMode: "fixed", fixedKcal: 3.7 }];
    const newItems = [...NEW, { id: "n2", name: "FortiFlora", kcalPerG: 0, splitMode: "fixed", fixedKcal: 3.7 }];
    for (const d of [1, 4, 7]) {
      const rows = plan(d, 7, oldItems, newItems);
      expect(rows.filter((r) => r.name === "FortiFlora")).toHaveLength(1); // one row, not two
      expect(kcalOf(rows, "FortiFlora")).toBeCloseTo(3.7, 5);
      expect(rows.find((r) => r.name === "FortiFlora").phase).toBe("both");
    }
  });

  it("shareOfNew and clampDays keep nonsense in bounds", () => {
    expect(shareOfNew(0, 7)).toBeCloseTo(1 / 7, 5); // day floors at 1
    expect(shareOfNew(99, 7)).toBe(1); // and caps at the last day
    // 0/absent/garbage all mean "unset" → the 7-day default, matching Bowl's `num(tr.days) || 7`
    expect(clampDays(0)).toBe(7);
    expect(clampDays(undefined)).toBe(7);
    expect(clampDays("nonsense")).toBe(7);
    expect(clampDays(-5)).toBe(1); // a real but impossible number clamps instead
    expect(clampDays(999)).toBe(30);
  });

  it("blendRows tolerates an empty side", () => {
    expect(blendRows([], [{ name: "X", kcal: 10, grams: 2 }], 0.5)[0].kcal).toBeCloseTo(5, 5);
    expect(blendRows([{ name: "X", kcal: 10, grams: 2 }], [], 0.5)[0].kcal).toBeCloseTo(5, 5);
  });
});

describe("inferring which ramp day today is", () => {
  const infer = (priorEntries, days = 7) =>
    inferTransitionDay({ startItems: OLD, resolvedRationItems: NEW, target: TARGET, days, priorEntries });

  it("nothing logged yesterday → day 1, flagged as a fresh start", () => {
    expect(infer([])).toMatchObject({ day: 1, basis: "start" });
    expect(infer(undefined)).toMatchObject({ day: 1, basis: "start" });
    expect(infer([{ name: "Instinct", kcal: 0 }])).toMatchObject({ day: 1, basis: "start" });
  });

  it("recognises yesterday's mix and advances one day", () => {
    // yesterday looked like day 3 of 7
    const y = plan(3).map((r) => ({ name: r.name, kcal: r.kcal }));
    expect(infer(y)).toMatchObject({ day: 4, basis: "inferred", matchedPrior: 3 });
  });

  it("works from every day of the ramp", () => {
    for (let d = 1; d < 7; d++) {
      const y = plan(d).map((r) => ({ name: r.name, kcal: r.kcal }));
      expect(infer(y).matchedPrior).toBe(d);
    }
  });

  it("holds at the last day instead of running off the end", () => {
    const y = plan(7).map((r) => ({ name: r.name, kcal: r.kcal }));
    expect(infer(y).day).toBe(7);
  });

  // The reason inference beats counting calendar days: the app tells owners to repeat a day if
  // stool loosens. Repeating means yesterday matches the SAME day again, so we don't skip ahead.
  it("repeating a day doesn't advance the ramp past it", () => {
    const y = plan(3).map((r) => ({ name: r.name, kcal: r.kcal }));
    expect(infer(y).day).toBe(4);
    // owner repeats day 3 rather than moving to 4 — tomorrow still reads 4, not 5
    expect(infer(y).day).toBe(4);
  });

  it("snaps to the closest day when yesterday was fed a bit off-plan", () => {
    const y = plan(4).map((r) => ({ name: r.name, kcal: r.kcal * 1.06 })); // 6% over, same ratio
    expect(infer(y).matchedPrior).toBe(4);
  });

  it("counts food fed that isn't in the plan at all against the match", () => {
    const exact = plan(4).map((r) => ({ name: r.name, kcal: r.kcal }));
    const withStray = [...exact, { name: "Churu", kcal: 60 }];
    // still lands on 4 (the stray adds the same error to every candidate), but is a worse fit
    expect(infer(withStray).matchedPrior).toBe(4);
  });

  // Day 0 = the pre-ramp state. All-old-food yesterday means the switch hasn't started, so today
  // is day 1 — NOT day 2, which is what came out when candidates began at day 1. See the day-0
  // regression block below.
  it("only the old food yesterday reads as day 0 — the ramp hasn't started", () => {
    const inf = infer([{ name: "Instinct", kcal: TARGET }]);
    expect(inf.matchedPrior).toBe(0);
    expect(inf.day).toBe(1);
  });

  it("only the new food yesterday reads as the end", () => {
    expect(infer([{ name: "Farmina", kcal: TARGET }]).matchedPrior).toBe(7);
  });

  it("is case- and whitespace-insensitive about food names", () => {
    const y = plan(3).map((r) => ({ name: `  ${r.name.toUpperCase()} `, kcal: r.kcal }));
    expect(infer(y).matchedPrior).toBe(3);
  });
});

// ── Regressions for two bugs found on real data ──────────────────────────────────────────────

describe("day 0: the day BEFORE the ramp starts", () => {
  // Reported: "it thinks I'm on day 2, but I'm on day 1." Starting a switch today means yesterday
  // was 100% OLD food. With candidates starting at day 1 (already 1/n new), "all old" snapped to
  // day 1 and today came out as day 2 — a brand-new transition beginning a day ahead of itself.
  const infer = (priorEntries, days) =>
    inferTransitionDay({ startItems: OLD, resolvedRationItems: NEW, target: TARGET, days, priorEntries });

  it("yesterday was all OLD food → today is day 1, not day 2", () => {
    const yesterday = [{ name: "Instinct", kcal: TARGET }];
    expect(infer(yesterday, 14)).toMatchObject({ day: 1, matchedPrior: 0 });
    expect(infer(yesterday, 7)).toMatchObject({ day: 1, matchedPrior: 0 });
  });

  it("still advances correctly once the ramp is under way", () => {
    for (const days of [7, 14]) {
      for (let d = 1; d < days; d++) {
        const y = transitionSteps({ startItems: OLD, resolvedRationItems: NEW, target: TARGET, day: d, days })
          .map((r) => ({ name: r.name, kcal: r.kcal }));
        expect(infer(y, days).day).toBe(d + 1);
      }
    }
  });

  it("a 14-day ramp is honoured, not silently treated as 7", () => {
    const rows = transitionSteps({ startItems: OLD, resolvedRationItems: NEW, target: TARGET, day: 1, days: 14 });
    expect(rows.find((r) => r.name === "Farmina").kcal).toBeCloseTo(TARGET / 14, 5);
  });

  it("missing a day of logging advances the ramp instead of resetting it", () => {
    const y = transitionSteps({ startItems: OLD, resolvedRationItems: NEW, target: TARGET, day: 3, days: 14 })
      .map((r) => ({ name: r.name, kcal: r.kcal }));
    expect(inferTransitionDay({ startItems: OLD, resolvedRationItems: NEW, target: TARGET, days: 14, priorEntries: y, gapDays: 3 }).day).toBe(6);
  });
});

describe("a rotating slot is ONE slot, not a food being swapped", () => {
  // From Steph's real data: "currently feeding" is seeded by copying the ration, and that copy
  // strips `rotation` and keeps whichever flavor was active then. So the same variety pack showed
  // up as "…Beef" (old) and "…Quail Egg" (new) — blending into a phantom fading-out row that no
  // logged meal could satisfy, which is why a fed wet meal still read as "still to feed".
  const PACK = ["Tiki Beef", "Tiki Quail Egg", "Tiki Lamb"];
  const rationWithRotation = [
    { id: "r1", name: "Tiki Quail Egg", mode: "perKg", kcalPerKg: 1200, splitMode: "remainder",
      rotation: PACK.map((n) => ({ name: n, mode: "perKg", kcalPerKg: 1200 })) },
  ];
  const startSnapshot = [{ id: "s1", name: "Tiki Beef", mode: "perKg", kcalPerKg: 1200, splitMode: "remainder" }]; // rotation stripped

  it("collapses the pack into a single row instead of one fading out and one phasing in", () => {
    const rows = transitionSteps({ startItems: startSnapshot, resolvedRationItems: rationWithRotation, target: TARGET, day: 3, days: 14 });
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("both");
    expect(rows[0].kcal).toBeCloseTo(TARGET, 5); // and it isn't split across a phantom row
  });

  it("keeps the ration's identity, so the row still knows its rotation", () => {
    const rows = transitionSteps({ startItems: startSnapshot, resolvedRationItems: rationWithRotation, target: TARGET, day: 3, days: 14 });
    expect(rows[0].id).toBe("r1"); // → LogPage finds the rotation and matches ANY flavor fed
  });

  it("a flavor logged yesterday counts toward the slot when inferring the day", () => {
    const inf = inferTransitionDay({
      startItems: startSnapshot, resolvedRationItems: rationWithRotation, target: TARGET, days: 14,
      priorEntries: [{ name: "Tiki Lamb", kcal: TARGET }], // a third flavor, in neither list by name
    });
    expect(inf.basis).toBe("inferred"); // not treated as off-plan food
  });

  it("makeSlotKeyer maps every member and the active flavor to one key", () => {
    const { keyOfName } = makeSlotKeyer(startSnapshot, rationWithRotation);
    const k = keyOfName("Tiki Beef");
    expect(keyOfName("Tiki Quail Egg")).toBe(k);
    expect(keyOfName("Tiki Lamb")).toBe(k);
    expect(keyOfName("Farmina")).not.toBe(k); // an unrelated food keeps its own key
  });
});
