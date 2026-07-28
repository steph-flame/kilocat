import { describe, it, expect } from "vitest";
import { fmtWeight } from "./units.js";

describe("fmtWeight — up to 2 decimals, no precision cut", () => {
  it("keeps 2 decimals from a Litter-Robot weigh-in (kg)", () => {
    expect(fmtWeight(5.44, "kg")).toBe("5.44");
    expect(fmtWeight(5.4, "kg")).toBe("5.4"); // trailing zero trimmed
    expect(fmtWeight(5, "kg")).toBe("5");
  });
  it("keeps precision converting kg -> lb", () => {
    // 2.467 kg = 5.438... lb -> shown 5.44
    expect(fmtWeight(2.467, "lb")).toBe("5.44");
  });
});
