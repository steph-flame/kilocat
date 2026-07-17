import { describe, it, expect } from "vitest";
import { isIOSSafari, isDesktopSafari, platformInstallHint } from "./pwa.js";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.109 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA_SAFARI = // iPadOS 13+ default: reads as Mac, but touch-capable
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_SAFARI = IPAD_DESKTOP_UA_SAFARI; // identical string; only maxTouchPoints tells them apart
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.2151.58";

describe("isIOSSafari", () => {
  it("true for iPhone Safari", () => {
    expect(isIOSSafari(IPHONE_SAFARI, 5)).toBe(true);
  });
  it("false for iPhone Chrome (CriOS) — a WebKit wrapper, not Safari", () => {
    expect(isIOSSafari(IPHONE_CHROME, 5)).toBe(false);
  });
  it("true for iPadOS Safari despite the desktop-Mac UA, using touch points", () => {
    expect(isIOSSafari(IPAD_DESKTOP_UA_SAFARI, 5)).toBe(true);
  });
  it("false for real macOS Safari (no touch points)", () => {
    expect(isIOSSafari(MAC_SAFARI, 0)).toBe(false);
  });
  it("false for Android Chrome", () => {
    expect(isIOSSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe("isDesktopSafari", () => {
  it("true for real macOS Safari (no touch points)", () => {
    expect(isDesktopSafari(MAC_SAFARI, 0)).toBe(true);
  });
  it("false for iPadOS's desktop-Mac UA — touch points give it away", () => {
    expect(isDesktopSafari(IPAD_DESKTOP_UA_SAFARI, 5)).toBe(false);
  });
  it("false for Mac Chrome — Safari-in-UA but Chrome-flagged", () => {
    expect(isDesktopSafari(MAC_CHROME, 0)).toBe(false);
  });
  it("false for iPhone Safari (not a Mac UA)", () => {
    expect(isDesktopSafari(IPHONE_SAFARI, 5)).toBe(false);
  });
  it("false for Windows Edge", () => {
    expect(isDesktopSafari(WINDOWS_EDGE, 0)).toBe(false);
  });
});

describe("platformInstallHint", () => {
  it("ios for iPhone Safari", () => {
    expect(platformInstallHint(IPHONE_SAFARI, 5)).toBe("ios");
  });
  it("ios for iPadOS desktop-UA Safari (touch points)", () => {
    expect(platformInstallHint(IPAD_DESKTOP_UA_SAFARI, 5)).toBe("ios");
  });
  it("macSafari for real macOS Safari", () => {
    expect(platformInstallHint(MAC_SAFARI, 0)).toBe("macSafari");
  });
  it("chromium for Mac Chrome", () => {
    expect(platformInstallHint(MAC_CHROME, 0)).toBe("chromium");
  });
  it("chromium for Windows Edge", () => {
    expect(platformInstallHint(WINDOWS_EDGE, 0)).toBe("chromium");
  });
  it("chromium for Android Chrome", () => {
    expect(platformInstallHint(ANDROID_CHROME, 5)).toBe("chromium");
  });
  it("other for iPhone Chrome (CriOS) — not Safari, not Chromium-UA", () => {
    expect(platformInstallHint(IPHONE_CHROME, 5)).toBe("other");
  });
});
