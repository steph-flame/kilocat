import { describe, it, expect } from "vitest";
import { SKINS, DEFAULT_SKIN, mutedIntake } from "./theme.js";

const REQUIRED_KEYS = ["ground", "card", "line", "ink", "soft", "accent", "second", "ok", "data1", "data2"];
const HEX = /^#[0-9A-Fa-f]{6}$/;

// Same fixed amber as theme.js's private WARN — duplicated here (not exported, it's an
// internal constant) so the "intake must not read like a warning" check is self-contained.
const WARN = "#8A5A12";

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
function saturation(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}
const relLum = (hex) => {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexToRgb(hex).map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (h1, h2) => {
  const [a, b] = [relLum(h1), relLum(h2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

describe("theme skins", () => {
  it("defines exactly the four locked skins", () => {
    expect(Object.keys(SKINS).sort()).toEqual(["blossom", "original", "spruce", "tidepool"]);
  });

  it("DEFAULT_SKIN names a real skin", () => {
    expect(SKINS[DEFAULT_SKIN]).toBeTruthy();
    expect(DEFAULT_SKIN).toBe("original");
  });

  it.each(Object.keys(SKINS))("%s has every required token as a valid hex", (name) => {
    const skin = SKINS[name];
    for (const key of REQUIRED_KEYS) {
      expect(skin[key], `${name}.${key}`).toMatch(HEX);
    }
  });

  it.each(Object.keys(SKINS))("%s pins data1 to ok, so a trend line is never a caution color", (name) => {
    expect(SKINS[name].data1).toBe(SKINS[name].ok);
  });

  it("spruce is the one skin where ok diverges from second (amber is not safe-colored there)", () => {
    expect(SKINS.spruce.ok).not.toBe(SKINS.spruce.second);
    expect(SKINS.spruce.ok).toBe(SKINS.spruce.accent);
  });

  it("the other three skins have ok match second, not accent", () => {
    for (const name of ["original", "blossom", "tidepool"]) {
      expect(SKINS[name].ok).toBe(SKINS[name].second);
      expect(SKINS[name].ok).not.toBe(SKINS[name].accent);
    }
  });
});

describe("mutedIntake (the chart intake line color)", () => {
  it.each(Object.keys(SKINS))("%s: is a valid hex, less saturated than raw data2, and still ≥3:1 against a white card", (name) => {
    const base = SKINS[name];
    const muted = mutedIntake(base);
    expect(muted).toMatch(HEX);
    expect(saturation(muted)).toBeLessThan(saturation(base.data2));
    expect(contrast(muted, "#FFFFFF")).toBeGreaterThanOrEqual(3);
  });

  it("spruce: data2 is literally WARN's hex, so muting must still land on a materially different color (not just quieter)", () => {
    // spruce.second (= data2) is defined equal to the fixed WARN amber (see theme.js) — the
    // worst case for "intake reads as a warning." Confirm the muted line color doesn't just
    // stay WARN with a lower alpha; it has to actually move.
    expect(SKINS.spruce.data2).toBe(WARN);
    const muted = mutedIntake(SKINS.spruce);
    expect(muted).not.toBe(WARN);
    expect(saturation(muted)).toBeLessThan(saturation(WARN) * 0.6); // materially less saturated
  });

  it.each(Object.keys(SKINS))("%s: muted intake is never the exact same hex as ok/data1 (the trend color) or ink (weight)", (name) => {
    const base = SKINS[name];
    const muted = mutedIntake(base);
    expect(muted).not.toBe(base.ok);
    expect(muted).not.toBe(base.ink);
  });
});
