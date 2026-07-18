import { describe, it, expect } from "vitest";
import { extent, niceTicks, linScale } from "./scale.js";
import { linregXY } from "./series.js";
import { buildDailyFrame, historySpanDays, weightChangeRate, pickEndLabelBelow } from "./timeline.js";
import { groupByDay } from "./series.js";

describe("scale", () => {
  it("extent ignores nulls/NaN", () => {
    expect(extent([3, null, 1, NaN, 2])).toEqual([1, 3]);
    expect(extent([])).toEqual([0, 1]);
  });
  it("niceTicks returns round, spanning values", () => {
    const t = niceTicks(2, 97, 5);
    expect(t[0]).toBeLessThanOrEqual(2);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(97);
    expect(t).toContain(40); // evenly spaced round steps (0,20,40,…)
    const gaps = t.slice(1).map((v, i) => v - t[i]);
    expect(new Set(gaps).size).toBe(1); // uniform spacing
  });
  it("linScale maps domain endpoints to range endpoints", () => {
    const s = linScale([0, 10], [0, 100]);
    expect(s(0)).toBe(0); expect(s(5)).toBe(50); expect(s(10)).toBe(100);
  });
  it("linScale guards a zero-width domain", () => {
    expect(() => linScale([5, 5], [0, 100])(5)).not.toThrow();
  });
  it("linregXY fits arbitrary x and gives a real SE for scattered points", () => {
    // y = 10 + 2x on irregular x, with a residual → nonzero slopeSE
    const { slope, slopeSE } = linregXY([0, 5, 20, 21], [10.0, 20.1, 49.8, 52.2]);
    expect(slope).toBeCloseTo(2, 0);
    expect(slopeSE).toBeGreaterThan(0);
    expect(Number.isFinite(slopeSE)).toBe(true);
  });
});

describe("groupByDay", () => {
  it("groups entries by day, newest first", () => {
    const g = groupByDay([
      { date: "2026-01-01", kcal: 60 },
      { date: "2026-01-02", kcal: 40 },
      { date: "2026-01-01", kcal: 30 },
    ]);
    expect(g.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-01"]);
    expect(g[1].items).toHaveLength(2);
  });
});

describe("buildDailyFrame", () => {
  const trend = [
    { date: "2026-06-01", kg: 5.0, e: 250, sd: 40 },
    { date: "2026-06-02", kg: 4.99, e: 252, sd: 35 },
    { date: "2026-06-03", kg: 4.98, e: 255, sd: 30 },
  ];
  const intake = [
    { date: "2026-06-01", value: 200 },
    { date: "2026-06-01", value: 20 }, // summed → 220
    { date: "2026-06-03", value: 210 },
  ];
  it("aligns weight, intake, expenditure by date; missing intake is null", () => {
    const frame = buildDailyFrame(trend, intake, 365);
    expect(frame).toHaveLength(3);
    expect(frame[0]).toMatchObject({ date: "2026-06-01", w: 5.0, e: 250, kin: 220 });
    expect(frame[1].kin).toBeNull(); // no intake logged that day
    expect(frame[2].kin).toBe(210);
  });
  it("clips to the range ending at the most recent day", () => {
    const frame = buildDailyFrame(trend, intake, 1); // just the last day
    expect(frame).toHaveLength(1);
    expect(frame[0].date).toBe("2026-06-03");
  });
  it("historySpanDays counts inclusive days", () => {
    expect(historySpanDays(trend)).toBe(3);
    expect(historySpanDays([])).toBe(0);
  });
  it("marks a day with no intake entries as kinImputed (nothing to render solid)", () => {
    const frame = buildDailyFrame(trend, intake, 365);
    expect(frame[1].kin).toBeNull();
    expect(frame[1].kinImputed).toBe(true);
  });
  it("a normal logged day is NOT kinImputed", () => {
    const frame = buildDailyFrame(trend, intake, 365);
    expect(frame[0].kinImputed).toBe(false);
    expect(frame[2].kinImputed).toBe(false);
  });
  it("a day flagged incomplete is kinImputed even though it has a real logged kin value", () => {
    const frame = buildDailyFrame(trend, intake, 365, { "2026-06-01": "incomplete" });
    expect(frame[0].kin).toBe(220); // still shows what was actually logged
    expect(frame[0].kinImputed).toBe(true); // but flagged as excluded from the estimate
    expect(frame[2].kinImputed).toBe(false); // unflagged day unaffected
  });
});

describe("weightChangeRate", () => {
  it("recovers a steady loss rate and signs it negative", () => {
    // 10 g/day loss on a 5 kg cat → −70 g/week ≈ −1.4%/week
    const frame = Array.from({ length: 20 }, (_, i) => ({ w: 5.0 - 0.01 * i }));
    const rate = weightChangeRate(frame, 1); // alpha 1 = no extra smoothing, exact diff
    const last = rate[rate.length - 1];
    expect(last.kgPerWeek).toBeCloseTo(-0.07, 6);
    expect(last.pctPerWeek).toBeLessThan(0);
    expect(rate[0]).toEqual({ kgPerWeek: null, pctPerWeek: null }); // first point has no prior
  });
});

describe("pickEndLabelBelow (end-of-line label placement)", () => {
  it("rising into the last point → label goes above (dodges the incoming-from-below segment)", () => {
    expect(pickEndLabelBelow({ prevValue: 200, lastValue: 220, preferBelow: true, ownPx: 100, otherPx: null }))
      .toBe(false);
  });
  it("falling into the last point → label goes below (dodges the incoming-from-above segment)", () => {
    expect(pickEndLabelBelow({ prevValue: 260, lastValue: 220, preferBelow: false, ownPx: 100, otherPx: null }))
      .toBe(true);
  });
  it("flat (no slope) or missing history falls back to the series' preferred default side", () => {
    expect(pickEndLabelBelow({ prevValue: 220, lastValue: 220, preferBelow: true, ownPx: 100, otherPx: null })).toBe(true);
    expect(pickEndLabelBelow({ prevValue: null, lastValue: 220, preferBelow: false, ownPx: 100, otherPx: null })).toBe(false);
  });
  it("when the other series' end label lands close by, keeping series apart wins over dodging the line", () => {
    // Would otherwise flip to "above" (rising), but the other label is only 5px away — too
    // close to risk both landing on the same side.
    expect(pickEndLabelBelow({ prevValue: 200, lastValue: 220, preferBelow: true, ownPx: 100, otherPx: 105, minGapPx: 16 }))
      .toBe(true);
  });
  it("once the two end points are far enough apart, the collision check with its own line applies again", () => {
    expect(pickEndLabelBelow({ prevValue: 200, lastValue: 220, preferBelow: true, ownPx: 100, otherPx: 200, minGapPx: 16 }))
      .toBe(false);
  });
});
