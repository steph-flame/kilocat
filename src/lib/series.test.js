import { describe, it, expect } from "vitest";
import { median, mean, addDays, diffDays, enumerateDays, dailyReduce, fillDaily, ewma, linreg, localDateOf, manualWeighInStamp, patchEntry, repairWeighInDate } from "./series.js";

describe("median / mean", () => {
  it("median of odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("mean", () => expect(mean([2, 4, 6])).toBe(4));
});

describe("day arithmetic", () => {
  it("adds and diffs days across a month/DST boundary (UTC)", () => {
    expect(addDays("2026-03-08", 3)).toBe("2026-03-11");
    expect(diffDays("2026-02-27", "2026-03-02")).toBe(3);
    expect(enumerateDays("2026-01-01", "2026-01-04")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });
});

describe("dailyReduce", () => {
  it("medians multiple same-day weigh-ins and sorts by day", () => {
    const out = dailyReduce([
      { date: "2026-01-02", value: 5.0 },
      { date: "2026-01-01", value: 4.9 },
      { date: "2026-01-02", value: 5.2 },
      { date: "2026-01-02", value: 5.1 },
    ], median);
    expect(out).toEqual([{ date: "2026-01-01", value: 4.9 }, { date: "2026-01-02", value: 5.1 }]);
  });
  it("sums intake per day and skips junk entries", () => {
    const out = dailyReduce([
      { date: "2026-01-01", value: 60 },
      { date: "2026-01-01", value: 40 },
      { date: "2026-01-01", value: NaN },
      { date: null, value: 10 },
    ], (v) => v.reduce((a, b) => a + b, 0));
    expect(out).toEqual([{ date: "2026-01-01", value: 100 }]);
  });
});

describe("fillDaily", () => {
  it("linearly interpolates gaps", () => {
    const out = fillDaily([{ date: "2026-01-01", value: 10 }, { date: "2026-01-03", value: 20 }], "interp");
    expect(out.map((d) => d.value)).toEqual([10, 15, 20]);
    expect(out[1].filled).toBe(true);
  });
  it("holds previous value when asked", () => {
    const out = fillDaily([{ date: "2026-01-01", value: 10 }, { date: "2026-01-03", value: 20 }], "hold");
    expect(out.map((d) => d.value)).toEqual([10, 10, 20]);
  });
});

describe("linreg", () => {
  it("recovers slope and intercept of a clean line", () => {
    const { slope, intercept, slopeSE } = linreg([2, 4, 6, 8]); // y = 2 + 2x
    expect(slope).toBeCloseTo(2, 9);
    expect(intercept).toBeCloseTo(2, 9);
    expect(slopeSE).toBeCloseTo(0, 9);
  });
});

describe("ewma", () => {
  it("seeds on the first value and tracks a constant", () => {
    expect(ewma([5, 5, 5], 0.3)).toEqual([5, 5, 5]);
  });
});

// All constructed via explicit local Date components (new Date(y, m, d, h, min, s)), never
// tz-dependent string parsing — so these assertions hold regardless of which timezone the
// test runner is in (unlike hardcoding a specific date string against a UTC timestamp, which
// only happens to pass in whatever offset the machine is currently set to).
describe("localDateOf", () => {
  it("reads the local calendar date off a mid-day timestamp", () => {
    const ts = new Date(2026, 0, 15, 12, 30, 0).getTime(); // local Jan 15 2026, 12:30pm
    expect(localDateOf(ts)).toBe("2026-01-15");
  });

  it("rolls to the next local day exactly at local midnight", () => {
    const justBefore = new Date(2026, 5, 29, 23, 59, 59, 999).getTime();
    const atMidnight = new Date(2026, 5, 30, 0, 0, 0, 0).getTime();
    expect(localDateOf(justBefore)).toBe("2026-06-29");
    expect(localDateOf(atMidnight)).toBe("2026-06-30");
  });

  it("pads single-digit months and days", () => {
    expect(localDateOf(new Date(2026, 0, 5, 0, 0, 0).getTime())).toBe("2026-01-05");
    expect(localDateOf(new Date(2026, 8, 9, 0, 0, 0).getTime())).toBe("2026-09-09");
  });

  it("agrees with itself across a year boundary", () => {
    expect(localDateOf(new Date(2025, 11, 31, 23, 30, 0).getTime())).toBe("2025-12-31");
    expect(localDateOf(new Date(2026, 0, 1, 0, 30, 0).getTime())).toBe("2026-01-01");
  });
});

describe("manualWeighInStamp", () => {
  it("stamps a real ts when the picked date is today (a live log-now)", () => {
    const now = new Date(2026, 3, 1, 9, 15, 0).getTime();
    const today = localDateOf(now);
    expect(manualWeighInStamp(today, now)).toEqual({ date: today, ts: now });
  });

  it("omits ts for a backfilled past date — no real time-of-day behind it", () => {
    const now = new Date(2026, 3, 1, 9, 15, 0).getTime();
    expect(manualWeighInStamp("2026-03-28", now)).toEqual({ date: "2026-03-28" });
  });

  it("omits ts for a future-dated entry too, not just past ones", () => {
    const now = new Date(2026, 3, 1, 9, 15, 0).getTime();
    expect(manualWeighInStamp("2026-04-05", now)).toEqual({ date: "2026-04-05" });
  });

  it("defaults nowTs to Date.now() when omitted", () => {
    const today = localDateOf(Date.now());
    expect(manualWeighInStamp(today)).toEqual({ date: today, ts: expect.any(Number) });
  });
});

describe("repairWeighInDate", () => {
  it("rewrites a mismatched date to ts's local calendar day", () => {
    const ts = new Date(2026, 3, 2, 8, 0, 0).getTime(); // local Apr 2
    const entry = { id: "a", date: "2026-04-03", ts, kg: 4.5 }; // stale UTC-derived date, one day ahead
    expect(repairWeighInDate(entry)).toEqual({ id: "a", date: "2026-04-02", ts, kg: 4.5 });
  });

  it("is a no-op (same reference) when date already agrees with ts", () => {
    const ts = new Date(2026, 3, 2, 8, 0, 0).getTime();
    const entry = { id: "a", date: "2026-04-02", ts, kg: 4.5 };
    expect(repairWeighInDate(entry)).toBe(entry);
  });

  it("is idempotent — repairing twice gives the same result as once", () => {
    const ts = new Date(2026, 3, 2, 23, 30, 0).getTime();
    const entry = { id: "a", date: "2026-04-03", ts, kg: 4.5 };
    const once = repairWeighInDate(entry);
    const twice = repairWeighInDate(once);
    expect(twice).toEqual(once);
    expect(twice).toBe(once); // second pass finds it already correct — same reference
  });

  it("leaves a ts-less (backfilled/future-dated) entry untouched — nothing to re-derive from", () => {
    const entry = { id: "a", date: "2026-04-03", kg: 4.5 };
    expect(repairWeighInDate(entry)).toBe(entry);
  });

  it("leaves a non-finite ts (null/undefined/NaN) entry untouched", () => {
    expect(repairWeighInDate({ id: "a", date: "2026-04-03", ts: null })).toEqual({ id: "a", date: "2026-04-03", ts: null });
    expect(repairWeighInDate({ id: "a", date: "2026-04-03", ts: undefined })).toEqual({ id: "a", date: "2026-04-03", ts: undefined });
    expect(repairWeighInDate({ id: "a", date: "2026-04-03", ts: NaN })).toEqual({ id: "a", date: "2026-04-03", ts: NaN });
  });
});

describe("patchEntry", () => {
  const items = [
    { id: "a", date: "2026-01-01", kcal: 100 },
    { id: "b", date: "2026-01-01", kcal: 200, grams: 50 },
    { id: "c", date: "2026-01-02", kcal: 50 },
  ];

  it("merges the patch into only the matching entry", () => {
    const out = patchEntry(items, "b", { grams: 60, kcal: 240 });
    expect(out).toEqual([
      { id: "a", date: "2026-01-01", kcal: 100 },
      { id: "b", date: "2026-01-01", kcal: 240, grams: 60 },
      { id: "c", date: "2026-01-02", kcal: 50 },
    ]);
  });

  it("leaves every other entry as the same object reference", () => {
    const out = patchEntry(items, "b", { kcal: 999 });
    expect(out[0]).toBe(items[0]);
    expect(out[2]).toBe(items[2]);
    expect(out[1]).not.toBe(items[1]);
  });

  it("is a no-op (new array, same entries) when the id doesn't match anything", () => {
    const out = patchEntry(items, "nope", { kcal: 1 });
    expect(out).toEqual(items);
    out.forEach((e, i) => expect(e).toBe(items[i]));
  });
});
