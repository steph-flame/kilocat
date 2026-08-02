import { describe, it, expect } from "vitest";
import { hasRotation, isRotating, activeRotationIndex, activeMember, resolveRotation, resolveRotations, foodFieldsOf, upcomingFlavors } from "./rotation.js";

const A = { name: "Chicken", mode: "perUnit", kcalPerUnit: 66, gramsPerUnit: 79, protein: 16 };
const B = { name: "Lamb", mode: "perUnit", kcalPerUnit: 90, gramsPerUnit: 156, protein: 18 };
const C = { name: "Salmon", mode: "perUnit", kcalPerUnit: 70, gramsPerUnit: 80, protein: 17 };
const slot = { id: "r1", splitMode: "share", pct: 40, rotation: [A, B, C] };

describe("rotation", () => {
  it("detects a rotation slot", () => {
    expect(hasRotation(slot)).toBe(true);
    expect(hasRotation({ id: "x", name: "Kibble", mode: "perKg" })).toBe(false);
    expect(hasRotation({ rotation: [] })).toBe(false);
  });

  it("advances the active flavor by exactly one per calendar day and wraps", () => {
    // Three flavors → the index cycles 0,1,2,0,… on consecutive days.
    const i0 = activeRotationIndex(slot, "2026-01-01");
    const i1 = activeRotationIndex(slot, "2026-01-02");
    const i2 = activeRotationIndex(slot, "2026-01-03");
    const i3 = activeRotationIndex(slot, "2026-01-04");
    expect([i1, i2, i3]).toEqual([(i0 + 1) % 3, (i0 + 2) % 3, (i0 + 3) % 3]);
    expect(i3).toBe(i0); // wrapped after a full cycle
  });

  it("is stable for a given date regardless of timezone-y parsing", () => {
    expect(activeRotationIndex(slot, "2026-06-15")).toBe(activeRotationIndex(slot, "2026-06-15"));
  });

  it("resolves a rotation row to the active flavor while keeping the row's split identity", () => {
    const day = "2026-01-01";
    const idx = activeRotationIndex(slot, day);
    const active = [A, B, C][idx];
    const resolved = resolveRotation(slot, day);
    expect(resolved.id).toBe("r1");
    expect(resolved.splitMode).toBe("share");
    expect(resolved.pct).toBe(40);
    expect(resolved.name).toBe(active.name);
    expect(resolved.kcalPerUnit).toBe(active.kcalPerUnit);
    expect(resolved.rotation).toEqual(slot.rotation); // the source list is preserved for editing
  });

  it("passes a plain (non-rotation) row through untouched", () => {
    const plain = { id: "p", name: "Kibble", mode: "perKg", kcalPerKg: 3800, splitMode: "remainder" };
    expect(resolveRotation(plain, "2026-01-01")).toBe(plain);
  });

  it("resolveRotations maps a mixed list", () => {
    const plain = { id: "p", name: "Kibble", mode: "perKg", splitMode: "remainder" };
    const out = resolveRotations([slot, plain], "2026-01-01");
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("r1");
    expect(out[1]).toBe(plain);
  });

  it("foodFieldsOf strips row-level fields, leaving a plain food", () => {
    const food = foodFieldsOf(slot);
    expect(food.id).toBeUndefined();
    expect(food.splitMode).toBeUndefined();
    expect(food.pct).toBeUndefined();
    expect(food.rotation).toBeUndefined();
  });

  it("activeMember returns null for a non-rotation", () => {
    expect(activeMember({ name: "x" }, "2026-01-01")).toBe(null);
  });

  it("a paused pack keeps its data but stops cycling — it feeds the first flavor", () => {
    const paused = { ...slot, rotateOff: true };
    expect(hasRotation(paused)).toBe(true);   // list is preserved (non-destructive pause)
    expect(isRotating(paused)).toBe(false);
    // fixed on flavor 0 regardless of date
    expect(activeMember(paused, "2026-01-01").name).toBe("Chicken");
    expect(activeMember(paused, "2026-06-15").name).toBe("Chicken");
  });

  it("a single-flavor list doesn't rotate (feeds that flavor)", () => {
    const one = { id: "s", splitMode: "share", rotation: [A] };
    expect(isRotating(one)).toBe(false);
    expect(activeMember(one, "2026-03-03").name).toBe("Chicken");
  });

  it("upcomingFlavors previews the pack in order from a start index, empty when not rotating", () => {
    expect(upcomingFlavors(slot, 0, 3)).toEqual(["Chicken", "Lamb", "Salmon"]);
    expect(upcomingFlavors(slot, 1, 3)).toEqual(["Lamb", "Salmon", "Chicken"]);
    expect(upcomingFlavors({ ...slot, rotateOff: true }, 0, 3)).toEqual([]);
  });
});
