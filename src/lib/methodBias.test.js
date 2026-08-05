import { describe, it, expect } from "vitest";
import {
  dailyByMethod, referenceMethod, methodOffsets, alignToReference, describeOffsets,
  MIN_PAIRS, MAX_OFFSET_KG,
} from "./methodBias.js";
import { addDays } from "./series.js";

// A realistic shape: the Litter-Robot reads several times a day, every day; the owner does a
// [me+cat]−[me] check roughly monthly, and it comes out ~0.09 kg (0.2 lb) LOW.
function series({ days = 60, biasKg = -0.091, manualEvery = 30, manualDates = null } = {}) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const date = addDays("2026-06-01", d);
    const trueKg = 4.5 - 0.0015 * d; // a slow, real loss
    for (const jitter of [-0.01, 0.0, 0.012]) out.push({ date, kg: trueKg + jitter, method: "litterRobot" });
    const isManual = manualDates ? manualDates.includes(date) : d % manualEvery === 0;
    if (isManual) out.push({ date, kg: trueKg + biasKg, method: "difference" });
  }
  return out;
}

describe("picking the reference frame", () => {
  it("is whichever method supplies the most readings", () => {
    expect(referenceMethod(series())).toBe("litterRobot");
  });
  it("is deterministic on a tie, so the whole series doesn't shift between reloads", () => {
    const tie = [{ date: "2026-06-01", kg: 4, method: "b" }, { date: "2026-06-02", kg: 4, method: "a" }];
    expect(referenceMethod(tie)).toBe(referenceMethod([...tie].reverse()));
  });
  it("handles no usable readings", () => {
    expect(referenceMethod([])).toBeNull();
    expect(methodOffsets([])).toMatchObject({ ref: null, offsets: {} });
  });
});

describe("measuring the offset", () => {
  it("recovers the real between-method difference", () => {
    const { ref, offsets } = methodOffsets(series());
    expect(ref).toBe("litterRobot");
    expect(offsets.difference.offsetKg).toBeCloseTo(-0.091, 2);
    expect(offsets.difference.n).toBeGreaterThanOrEqual(2);
  });

  it("medians a method's multiple same-day reads before pairing, so a chatty method isn't over-counted", () => {
    const rows = dailyByMethod(series({ days: 2, manualEvery: 1 }));
    expect(rows.filter((r) => r.date === "2026-06-01")).toHaveLength(2); // one per method, not four
  });

  it("is robust to a single bad reading (median, not mean)", () => {
    const s = series({ days: 90, manualEvery: 10 });
    s.push({ date: "2026-06-11", kg: 9.9, method: "difference" }); // a fat-fingered entry
    expect(methodOffsets(s).offsets.difference.offsetKg).toBeCloseTo(-0.091, 2);
  });

  it("reports a spread so the UI can say how consistent the offset is", () => {
    const { offsets } = methodOffsets(series({ days: 120, manualEvery: 10 }));
    expect(offsets.difference.spreadKg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(offsets.difference.spreadKg)).toBe(true);
  });

  it("ignores a manual reading with no same-day reference — there's nothing to compare it to", () => {
    const s = [
      { date: "2026-06-01", kg: 4.5, method: "litterRobot" },
      { date: "2026-06-02", kg: 4.4, method: "difference" }, // no LR that day
    ];
    expect(methodOffsets(s).offsets.difference).toBeUndefined();
  });
});

describe("when the correction is APPLIED", () => {
  it("not until there are enough paired days", () => {
    const twoPairs = series({ days: 40, manualDates: ["2026-06-01", "2026-06-20"] });
    const o = methodOffsets(twoPairs).offsets.difference;
    expect(o.n).toBe(2);
    expect(o.applied).toBe(false); // measured and shown, but not yet trusted enough to act on
  });

  it("once there are, the reading is shifted into the reference frame", () => {
    const s = series({ days: 120, manualEvery: 20 });
    const offs = methodOffsets(s);
    expect(offs.offsets.difference.applied).toBe(true);
    const aligned = alignToReference(s, offs);
    const day0 = aligned.filter((e) => e.date === "2026-06-01");
    const lr = day0.filter((e) => e.method === "litterRobot").map((e) => e.kg);
    const man = day0.find((e) => e.method === "difference").kg;
    // the manual reading now sits inside the Litter-Robot cluster instead of ~0.09 kg below it
    expect(man).toBeGreaterThan(Math.min(...lr) - 0.03);
    expect(man).toBeLessThan(Math.max(...lr) + 0.03);
  });

  it("refuses an implausible offset — that's a data-entry mistake, not calibration", () => {
    const s = series({ days: 120, manualEvery: 20, biasKg: -2.0 }); // lb typed into a kg field
    const o = methodOffsets(s).offsets.difference;
    expect(Math.abs(o.offsetKg)).toBeGreaterThan(MAX_OFFSET_KG);
    expect(o.applied).toBe(false);
    expect(alignToReference(s, methodOffsets(s))).toEqual(s); // left exactly as logged
  });

  it("leaves the reference method's own readings untouched", () => {
    const s = series({ days: 120, manualEvery: 20 });
    const aligned = alignToReference(s, methodOffsets(s));
    const before = s.filter((e) => e.method === "litterRobot").map((e) => e.kg);
    const after = aligned.filter((e) => e.method === "litterRobot").map((e) => e.kg);
    expect(after).toEqual(before);
  });

  it("does not mutate the entries it was given", () => {
    const s = series({ days: 120, manualEvery: 20 });
    const snapshot = JSON.stringify(s);
    alignToReference(s, methodOffsets(s));
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("works on the { value } shape the estimators consume as well as { kg }", () => {
    const s = series({ days: 120, manualEvery: 20 }).map((e) => ({ date: e.date, value: e.kg, method: e.method }));
    const aligned = alignToReference(s, methodOffsets(s));
    const man = aligned.find((e) => e.method === "difference");
    expect(man.value).toBeCloseTo(4.5 - 0.091 + 0.091, 3);
  });
});

describe("what the owner is told", () => {
  const labels = { litterRobot: "Litter-Robot", difference: "Scale − you" };
  const labelOf = (m) => labels[m] || m;

  it("states it as a RELATIVE comparison, never as one method being wrong", () => {
    const [line] = describeOffsets(methodOffsets(series({ days: 120, manualEvery: 20 })), labelOf);
    expect(line.text).toMatch(/Scale − you reads \d+ g/);
    expect(line.text).toMatch(/below Litter-Robot/);
    expect(line.text).not.toMatch(/wrong|incorrect|inaccurate/i);
  });

  it("says whether it's being corrected for, and what's needed if not", () => {
    const few = describeOffsets(methodOffsets(series({ days: 40, manualDates: ["2026-06-01", "2026-06-20"] })), labelOf);
    expect(few[0].text).toMatch(new RegExp(`needs ${MIN_PAIRS} days measured both ways`));
    const many = describeOffsets(methodOffsets(series({ days: 120, manualEvery: 20 })), labelOf);
    expect(many[0].text).toMatch(/Corrected for in the fit/);
  });

  it("says nothing when only one method has ever been used", () => {
    const lrOnly = series({ days: 30, manualDates: [] }); // no manual readings at all
    expect(describeOffsets(methodOffsets(lrOnly), labelOf)).toEqual([]);
  });
});
