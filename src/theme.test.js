import { describe, it, expect } from "vitest";
import { SKINS, DEFAULT_SKIN } from "./theme.js";

const REQUIRED_KEYS = ["ground", "card", "line", "ink", "soft", "accent", "second", "ok", "data1", "data2"];
const HEX = /^#[0-9A-Fa-f]{6}$/;

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
