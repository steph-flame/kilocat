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
    // The intent is that the logged flavor was RECOGNISED as belonging to the pack — not that any
    // particular day came out. (Feeding the pack's full amount is in fact already at target, which
    // is its own correct answer.) So assert what the test is actually about.
    expect(inf.basis).not.toBe("start");
    expect(inf.matchedPrior).toBeGreaterThan(0);
  });

  it("makeSlotKeyer maps every member and the active flavor to one key", () => {
    const { keyOfName } = makeSlotKeyer(startSnapshot, rationWithRotation);
    const k = keyOfName("Tiki Beef");
    expect(keyOfName("Tiki Quail Egg")).toBe(k);
    expect(keyOfName("Tiki Lamb")).toBe(k);
    expect(keyOfName("Farmina")).not.toBe(k); // an unrelated food keeps its own key
  });
});

describe("the schedule TABLE's columns use the same slot identity as the plan", () => {
  // Reported from the real 14-day schedule: the same Tiki variety pack occupied TWO columns —
  // "Tiki ↑" rising and "Tiki ↓" fading — because the pack had rotated since "currently feeding"
  // was captured, so the two lists named different flavors of one slot. Bowl built its columns with
  // its own inline name match; it now shares makeSlotKeyer with the plan, so they can't disagree.
  const flav = (name) => ({ name, type: "wet", mode: "perUnit", gramsPerUnit: 80, kcalPerUnit: 96 });
  const PACK = [flav("Tiki Quail Egg"), flav("Tiki Beef"), flav("Tiki Lamb")];
  const ration = [
    { id: "n1", name: "Farmina", mode: "perKg", kcalPerKg: 4000, splitMode: "remainder" },
    { id: "n2", ...flav("Tiki Quail Egg"), splitMode: "share", pct: 20, rotation: PACK, rotIndex: 0 },
  ];
  const currentlyFeeding = [ // seeded from the ration earlier, when the pack was on a different can
    { id: "o1", name: "Instinct", mode: "perKg", kcalPerKg: 4000, splitMode: "remainder" },
    { id: "o2", ...flav("Tiki Beef"), splitMode: "share", pct: 20 }, // rotation stripped by the copy
  ];

  // Columns are exactly what blendRows produces — one entry per slot.
  const columns = (day) =>
    transitionSteps({ startItems: currentlyFeeding, resolvedRationItems: ration, target: 200, day, days: 14 });

  it("gives the variety pack ONE column, not a rising and a fading one", () => {
    const tiki = columns(7).filter((r) => /Tiki/.test(r.name));
    expect(tiki).toHaveLength(1);
    expect(tiki[0].phase).toBe("both"); // it isn't being switched — only the dry food is
  });

  it("the pack's amount stays flat across the ramp — it isn't part of the switch", () => {
    const at = (d) => columns(d).find((r) => /Tiki/.test(r.name)).kcal;
    expect(at(1)).toBeCloseTo(at(14), 5);
    expect(at(1)).toBeCloseTo(40, 5); // 20% of 200 throughout
  });

  it("the dry food IS switched, and still ramps", () => {
    expect(columns(1).find((r) => r.name === "Farmina").kcal).toBeLessThan(
      columns(14).find((r) => r.name === "Farmina").kcal
    );
    // the row survives at zero (callers drop kcal<=0 rows; the table renders "—")
    expect(columns(14).find((r) => r.name === "Instinct").kcal).toBeCloseTo(0, 5);
  });

  it("every day still totals the target — the merged column didn't drop or double energy", () => {
    for (const d of [1, 7, 14]) {
      expect(columns(d).reduce((a, r) => a + r.kcal, 0)).toBeCloseTo(200, 5);
    }
  });
});

// Reported: mid-switch from A to B, at day 7 of 14 (so already feeding ~50/50), the owner edited the
// RATION to be 50/50 A+B — i.e. the thing they were already feeding. The plan should have recognised
// the switch was over; instead it stayed mid-ramp and asked them to HALVE food B, walking back
// toward the old food. A pure argmin can land mid-ramp when several candidate days fit yesterday
// almost equally well, so the finished ration is now checked explicitly.
describe("editing the ration to what you're already feeding ends the switch", () => {
  const T = 200, DAYS = 14;
  const dry = (id, name, pct) => ({ id, name, mode: "perKg", kcalPerKg: 4000, ...(pct != null ? { splitMode: "share", pct } : { splitMode: "remainder" }) });
  const start = [dry("o1", "Instinct")];
  const oldRation = [dry("n1", "Farmina")];
  const newRation = [dry("n1", "Farmina", 50), dry("n2", "Instinct", 50)];
  const fedOn = (day, ration) => transitionSteps({ startItems: start, resolvedRationItems: ration, target: T, day, days: DAYS })
    .map((r) => ({ name: r.name, kcal: r.kcal }));
  const infer = (priorEntries, ration = newRation) =>
    inferTransitionDay({ startItems: start, resolvedRationItems: ration, target: T, days: DAYS, priorEntries });

  it("declares the ramp finished rather than winding it back", () => {
    const r = infer(fedOn(7, oldRation)); // yesterday, under the OLD target, at the halfway point
    expect(r.basis).toBe("attarget");
    expect(r.day).toBe(DAYS);
  });

  it("today's plan is then the new ration itself, not half of food B", () => {
    const r = infer(fedOn(7, oldRation));
    const plan = transitionSteps({ startItems: start, resolvedRationItems: newRation, target: T, day: r.day, days: DAYS });
    const full = transitionSteps({ startItems: start, resolvedRationItems: newRation, target: T, day: DAYS, days: DAYS });
    for (const row of plan) {
      expect(row.kcal, row.name).toBeCloseTo(full.find((f) => f.name === row.name).kcal, 5);
    }
  });

  it("tolerates ordinary sloppiness in what was actually fed", () => {
    const sloppy = fedOn(7, oldRation).map((e) => ({ ...e, kcal: e.kcal * (e.name === "Farmina" ? 1.06 : 0.95) }));
    expect(infer(sloppy).basis).toBe("attarget");
  });

  it("does NOT wave through a cat genuinely mid-ramp", () => {
    const r = infer(fedOn(4, newRation));
    expect(r.basis).toBe("inferred");
    expect(r.day).toBe(5);
  });

  it("still ends the ramp when the target was reached the ordinary way", () => {
    expect(infer(fedOn(DAYS, newRation)).day).toBe(DAYS);
  });

  it("a cat still on 100% old food is nowhere near target", () => {
    const r = infer([{ name: "Instinct", kcal: T }]);
    expect(r.basis).toBe("inferred");
    expect(r.day).toBe(1);
  });
});

// Reported: "it's somehow splitting the same food B into two separate logs." Two entries that
// resolve to the same SLOT — the same food listed twice in a ration, or two names belonging to one
// rotation family — each became its own row and ramped independently, so one food appeared twice
// with one copy rising and the other flat.
describe("one slot is always one row, even if the ration lists it twice", () => {
  const rows = (arr) => arr.map(([name, kcal, grams]) => ({ name, kcal, grams }));

  it("sums duplicate entries on the NEW side into a single row", () => {
    const out = blendRows(rows([["Instinct", 200, 50]]), rows([["Farmina", 60, 15], ["Farmina", 40, 10]]), 0.5);
    expect(out).toHaveLength(2);
    const f = out.find((r) => r.name === "Farmina");
    expect(f.kcal).toBeCloseTo(50, 5);   // half of the combined 100, not two rows of 30 and 20
    expect(f.grams).toBeCloseTo(12.5, 5);
  });

  it("sums duplicates on the OLD side too", () => {
    const out = blendRows(rows([["Instinct", 120, 30], ["Instinct", 80, 20]]), rows([["Farmina", 200, 50]]), 0.5);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.name === "Instinct").kcal).toBeCloseTo(100, 5);
  });

  it("a duplicated food present on BOTH sides is still one row, and phases correctly", () => {
    const out = blendRows(rows([["Chow", 100, 25], ["Chow", 100, 25]]), rows([["Chow", 60, 15], ["Chow", 60, 15]]), 0.5);
    expect(out).toHaveLength(1);
    expect(out[0].phase).toBe("both");
    expect(out[0].kcal).toBeCloseTo(0.5 * 200 + 0.5 * 120, 5);
  });

  it("names that share a rotation family collapse together", () => {
    const pack = [{ name: "Tiki Beef" }, { name: "Tiki Lamb" }];
    const { keyOfName } = makeSlotKeyer([{ name: "Tiki Beef", rotation: pack }]);
    const out = blendRows([], rows([["Tiki Beef", 40, 10], ["Tiki Lamb", 60, 15]]), 1, keyOfName);
    expect(out).toHaveLength(1);
    expect(out[0].kcal).toBeCloseTo(100, 5);
  });

  it("total energy is preserved by the collapse — nothing is dropped or double-counted", () => {
    const out = blendRows(rows([["A", 200, 50]]), rows([["B", 60, 15], ["B", 40, 10], ["C", 100, 25]]), 1);
    expect(out.reduce((a, r) => a + r.kcal, 0)).toBeCloseTo(200, 5);
  });

  it("the surviving row keeps the first entry's identity, so ids and split modes are stable", () => {
    const out = blendRows([], [
      { id: "keep", name: "Farmina", kcal: 60, grams: 15, splitMode: "share" },
      { id: "other", name: "Farmina", kcal: 40, grams: 10, splitMode: "remainder" },
    ], 1);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("keep");
    expect(out[0].splitMode).toBe("share");
  });
});
