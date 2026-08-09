import { describe, it, expect } from "vitest";
import { INTAKE_METHODS, DEFAULT_INTAKE_METHOD, intakeCvFor, withIntakeUncertainty } from "./expenditure.js";

describe("food-measurement method sets the dominant uncertainty term", () => {
  it("offers only methods the app can actually work from", () => {
    expect(Object.keys(INTAKE_METHODS).sort()).toEqual(["cup", "feeder", "scale01", "scale1"]);
    // free-feeding is deliberately absent: intake isn't measured, so no CV represents it honestly
    expect(INTAKE_METHODS.freeFeed).toBeUndefined();
  });

  it("orders them by how much systematic error each really carries", () => {
    const { scale01, scale1, feeder, cup } = INTAKE_METHODS;
    expect(scale01.cv).toBeLessThan(scale1.cv);
    expect(scale1.cv).toBeLessThan(feeder.cv);
    expect(feeder.cv).toBeLessThan(cup.cv);
  });

  // The honest part: better scale resolution buys almost nothing, because the label is the floor.
  it("the two scale options are close together — the label dominates, not the resolution", () => {
    expect(INTAKE_METHODS.scale1.cv - INTAKE_METHODS.scale01.cv).toBeLessThan(0.01);
    expect(INTAKE_METHODS.scale01.cv).toBeGreaterThan(0.02); // never claims a portion is exact
  });

  it("volumetric methods are several times worse than weighing", () => {
    expect(INTAKE_METHODS.cup.cv).toBeGreaterThan(3 * INTAKE_METHODS.scale01.cv);
  });

  it("falls back to the default for an unknown or missing method", () => {
    expect(intakeCvFor("nonsense")).toBe(INTAKE_METHODS[DEFAULT_INTAKE_METHOD].cv);
    expect(intakeCvFor(undefined)).toBe(INTAKE_METHODS[DEFAULT_INTAKE_METHOD].cv);
    expect(intakeCvFor("scale01")).toBe(INTAKE_METHODS.scale01.cv);
  });

  it("the default assumes a plain kitchen scale, not the best case", () => {
    expect(DEFAULT_INTAKE_METHOD).toBe("scale1");
  });

  it("changing the method actually moves the reported band", () => {
    const r = { kcal: 200, sd: 10, enoughData: true };
    const widths = ["scale01", "scale1", "feeder", "cup"]
      .map((m) => withIntakeUncertainty(r, 215, intakeCvFor(m)).sd);
    expect(widths).toEqual([...widths].sort((a, b) => a - b)); // monotone
    expect(widths[3]).toBeGreaterThan(widths[0] * 1.5);        // and materially different
  });

  it("every method has copy explaining what it costs", () => {
    for (const m of Object.values(INTAKE_METHODS)) {
      expect(typeof m.label).toBe("string");
      expect(m.hint.length).toBeGreaterThan(10);
      expect(m.cv).toBeGreaterThan(0);
    }
  });
});
