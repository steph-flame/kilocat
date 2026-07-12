import { describe, it, expect } from "vitest";
import { toDisplayWeight, fromDisplayWeight, weightLabel, weeklyRate, round5, LB_PER_KG } from "./units.js";

describe("units", () => {
  it("kg passes through unchanged in metric", () => {
    expect(toDisplayWeight(5, "kg")).toBe(5);
    expect(fromDisplayWeight(5, "kg")).toBe(5);
  });
  it("converts kg ↔ lb and round-trips", () => {
    expect(toDisplayWeight(5, "lb")).toBeCloseTo(11.023, 3);
    expect(fromDisplayWeight(toDisplayWeight(5, "lb"), "lb")).toBeCloseTo(5, 9);
  });
  it("labels the unit", () => {
    expect(weightLabel("kg")).toBe("kg");
    expect(weightLabel("lb")).toBe("lb");
  });
  it("weekly rate is g/wk in metric, oz/wk in imperial", () => {
    expect(weeklyRate(0.05, "kg")).toEqual({ value: 50, unit: "g/wk" });
    const oz = weeklyRate(0.05, "lb");
    expect(oz.unit).toBe("oz/wk");
    expect(oz.value).toBeCloseTo(0.05 * LB_PER_KG * 16, 6);
  });
  it("round5 snaps to the nearest multiple of 5", () => {
    expect(round5(211)).toBe(210);
    expect(round5(213)).toBe(215);
  });
});
