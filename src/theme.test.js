import { describe, it, expect } from "vitest";
import { SKINS, DEFAULT_SKIN, mutedIntake, deriveSkin } from "./theme.js";

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

// --- Contrast floor ---------------------------------------------------------------------
// Locks in the audit that retuned `line`/`faint` (and original's `accent`, blossom's
// `ok`/`second`/`data1`) — see theme.js's "Contrast audit" comment above SKINS. This walks
// every token pairing actually used across the app's components (grepped from
// src/components + src/pages: color:/background:/fill:/stroke: usages), per skin, against
// WCAG thresholds:
//   - "text-normal" >= 4.5:1 — regular body/caption/label text (nothing in this app's actual
//     usage of these tokens is >=18px, or >=14px AND bold, so no token gets the 3:1 large-text
//     exemption even where it's rendered at a big font size elsewhere — verified per-pairing
//     below by checking the SMALLEST context each token is actually used at).
//   - "text-large" >= 3:1 — only granted where the *specific* usage is verified >=24px, or
//     >=18.66px (14pt) AND bold (e.g. the CatMenu headline trigger, which inherits the h1's
//     28-32px bold; the big kcal figures at 30-48px bold).
//   - "nontext" >= 3:1 — essential non-text UI (WCAG 1.4.11): chart lines, meter tracks/rings,
//     component borders, the BowlCard segment-transition divider.
// Decorative-only pairings (soft zone-band fills, the confidence band's low-opacity fill, the
// bowl's translucent food wash, DayStrip's selection/hover pill) are deliberately NOT gated
// here: in every case the same information is also carried by real text/position elsewhere
// (numeric low/high labels + status message; the sr-only data table; the dispensed/target
// numbers; aria-pressed + the day panel shown below) — see the inline notes on each skipped
// row in the `pairs()` builder for the specific duplication in each case.
const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hexToRgbLocal = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHexLocal = (rgb) => `#${rgb.map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
const flatten = (fgHex, bgHex, alpha) => {
  const a = hexToRgbLocal(fgHex), b = hexToRgbLocal(bgHex);
  return rgbToHexLocal(a.map((v, i) => v * alpha + b[i] * (1 - alpha)));
};
const contrastRatio = (h1, h2) => {
  const [a, b] = [relLum(h1), relLum(h2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

const THRESH = { "text-normal": 4.5, "text-large": 3, nontext: 3 };

// Every GATED pairing actually used in the app (see src/components/{TimelineChart,DayStrip,
// BowlMark}.jsx and src/pages/{Home,Expenditure,Log,RationPlanner,Cats,Settings}.jsx for the
// underlying color:/background:/fill:/stroke: usages this mirrors). Decorative-only pairings
// (documented above) are intentionally excluded from this list, not included-and-skipped.
function gatedPairs(name) {
  const s = deriveSkin(SKINS[name]);
  const white = "#FFFFFF";
  const P = [];
  const add = (label, role, fgHex, bgHex) => P.push({ label, role, fgHex, bgHex });

  // text on ground
  add("ink text on ground (body copy)", "text-normal", s.ink, s.ground);
  add("sub text on ground (subtitle, 15px)", "text-normal", s.soft, s.ground);
  add("faint text on ground (captions, <=13px)", "text-normal", s.faint, s.ground);
  add("accent text on ground (masthead label, 10.5px mono)", "text-normal", s.accent, s.ground);
  add("second/spruce text on ground (CatMenu headline trigger, inherits h1 28-32px bold)", "text-large", s.second, s.ground);
  // text on card
  add("ink text on card (values, inputs)", "text-normal", s.ink, s.card);
  add("sub text on card (labels, 11-15px)", "text-normal", s.soft, s.card);
  add("faint text on card (captions/chart tick labels, 9-11px)", "text-normal", s.faint, s.card);
  add("accent/amber text on card — small (rate value 14px, Home fig 12px)", "text-normal", s.accent, s.card);
  add("accent/amber text on card — large (kcal figures, 36-48px bold)", "text-large", s.accent, s.card);
  add("second/spruce text on card — small (links, xs 12px)", "text-normal", s.second, s.card);
  add("second/spruce text on card — large (maintenance kcal, 30-48px bold)", "text-large", s.second, s.card);
  add("warn text on card — small (Cats.jsx warn links/buttons, xs)", "text-normal", s.warn, s.card);
  // text on soft-tint chips
  add("warn text on warnSoft (Settings danger banner)", "text-normal", s.warn, s.warnSoft);
  add("ok text on okSoft (Pill 'safe' badge, 11.5px bold)", "text-normal", s.ok, s.okSoft);
  add("second/spruce text on secondSoft (Home dot label, LR badge)", "text-normal", s.second, s.secondSoft);
  add("accent/amber icon on accentSoft (Home dot icon, 20px glyph)", "nontext", s.accent, s.accentSoft);
  // white text on solid brand fills
  add("white text on second/spruce (selected tab pill, buttons)", "text-normal", white, s.second);
  add("white text on warn (erase-all button)", "text-normal", white, s.warn);
  // borders/hairlines — RECLASSIFIED DECORATIVE by owner decision (2026-07-19): card contours,
  // dividers, and meter-track backgrounds are architecture, deliberately soft; the information
  // they frame is carried by fills, markers, and numeric labels, all gated above/below. `line`
  // is therefore NOT contrast-gated. (Original audit had gated it at 3:1, which fixed
  // invisibility but flattened the Companion's gentle look — the owner preferred soft contours.)
  // chart marks (TimelineChart lives inside a C.card section)
  add("CHART.weight line (ink) on card", "nontext", s.ink, s.card);
  add("CHART.expenditure line (data1===ok) on card", "nontext", s.data1, s.card);
  add("CHART.intake line (mutedIntake) on card, stroke-opacity .85", "nontext", flatten(s.intake, s.card, 0.85), s.card);
  // DayStrip (rendered directly on page ground, not inside a card)
  add("DayStrip intake bar fill (mutedIntake) vs ground", "nontext", s.intake, s.ground);
  add("DayStrip weight dot/line (ink) vs ground", "nontext", s.ink, s.ground);
  // BowlMark (inside Home's card)
  add("BowlMark fill-surface line (solid accent stroke) vs card", "nontext", s.accent, s.card);
  add("BowlMark ink outline (rim/body/foot) vs card", "nontext", s.ink, s.card);
  // BowlCard zone-bar: the fills themselves are decorative (see file-level note), but the
  // always-drawn segment-transition divider and the nutritional-floor marker are real
  // non-text UI and must clear the floor against BOTH fills they can sit next to.
  add("BowlCard segment-transition divider (C.sub) vs warnSoft fill", "nontext", s.soft, s.warnSoft);
  add("BowlCard segment-transition divider (C.sub) vs okSoft fill", "nontext", s.soft, s.okSoft);
  add("BowlCard nutritional-floor marker (solid warn) vs warnSoft segment", "nontext", s.warn, s.warnSoft);
  add("BowlCard nutritional-floor marker (solid warn) vs okSoft segment", "nontext", s.warn, s.okSoft);
  // Track backgrounds (C.line) are decorative per the owner's soft-contours decision — the
  // information is the solid fill/marker ON the track, gated below.
  add("BowlCard zone-bar position marker (solid ok) vs soft track (line)", "nontext", s.ok, s.line);
  // WeightBand / ConfidenceBand meters: every position marker is a solid dot with a 2px
  // C.card ring (see borderColor: C.card on each) — the ring-vs-track pairing is the real
  // on-track visibility mechanism, in addition to the dot-vs-its-own-fill check.
  add("WeightBand dot (solid ok) vs its own safe-zone fill (okSoft)", "nontext", s.ok, s.okSoft);
  add("WeightBand marker dot (solid ok) vs soft track (line)", "nontext", s.ok, s.line);
  add("ConfidenceBand marker dot (solid accent) vs soft track (line)", "nontext", s.accent, s.line);
  add("ConfidenceBand dot (solid accent) vs its own fill (accentSoft)", "nontext", s.accent, s.accentSoft);

  return P;
}

describe("contrast floor (WCAG 1.4.3 text / 1.4.11 non-text, per skin)", () => {
  for (const name of Object.keys(SKINS)) {
    const pairs = gatedPairs(name);
    it.each(pairs.map((p) => [p.label, p]))(`${name}: %s`, (_label, p) => {
      const ratio = contrastRatio(p.fgHex, p.bgHex);
      expect(ratio, `${p.fgHex} on ${p.bgHex} — got ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(THRESH[p.role]);
    });
  }
});
