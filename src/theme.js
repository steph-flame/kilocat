// Shared palette. One place to retune the whole look.
//
// "Companion" theme system: four user-switchable skins (original/blossom/tidepool/spruce)
// that share the same token *names* but swap the underlying hex values. C below never
// changes shape — every value is a CSS custom-property reference (`var(--token)`), so no
// component needs to know which skin is active. Only this module's hex table (SKINS) and
// the effect that writes it onto :root (applySkin) care about the actual colors.
//
// Token roles: ground/card/line = surfaces & hairlines; ink/soft/faint = text, darkest to
// lightest; accent/second = the two brand hues (accent leans warm/CTA-ish, second leans
// calm/positive); ok = the dedicated "this is a safe state" color — kept separate from
// `second` because in the spruce skin `second` is amber (used decoratively) while safe
// states must still read green there. data1/data2 = the two raw chart-series hues (data1 =
// the modeled/trend measure, data2 = intake's base hue before muting — see `mutedIntake`
// below). Every skin below defines data1 === ok, so a trend line is never accidentally the
// same hue as a caution. Chart entity → token mapping lives on CHART near the bottom of this
// file: weight uses `ink` (neutral — it's the observed ground truth, not a modeled series),
// expenditure uses `data1` alone (no longer shared with weight), intake uses the derived,
// desaturated `intake` token (see below), and the confidence band is `data1` at low opacity.
// Contrast audit (see src/theme.test.js's "contrast floor" describe block, and the scratch
// measurement script referenced there): every text/UI-element pairing actually used across the
// app was measured against WCAG 1.4.3/1.4.11 thresholds, per skin. Two categories of locked hex
// below were retuned as a direct result, both minimally — same hue, nudged for legibility:
//   - `line`: deliberately soft (~1.2:1) — it draws card contours and dividers, which are
//     ARCHITECTURE, not information (owner's call: the gentle outlines are part of the look).
//     Information-bearing elements (text, chart marks, zone dividers) carry their own tokens
//     and ARE contrast-gated in theme.test.js; `line` is classified decorative there. Was
//     input-field/segmented-control boundary, which is exactly the "reads too low-contrast"
//     complaint. Retuned to mix(soft, ground, 0.72) per skin (still each skin's own neutral cast,
//     just dark enough to read as a real border, ~3.2-3.5:1 against card).
//   - `accent` (original only) and `ok`/`second`/`data1` (blossom only): each was a hair under
//     4.5:1 in at least one real on-card/on-ground text usage (original's accent as the masthead
//     label text; blossom's sage `ok` as Pill/chip text on its own 13%-tint background — the
//     reported "Blossom" worst case). Both nudged darker by <10%, same hue — not a hue swap.
export const SKINS = {
  original: {
    ground: "#FAF6EE", card: "#FFFFFF", line: "#EAE2D3", ink: "#33302A", soft: "#655F50",
    accent: "#A75633", second: "#54704F", ok: "#54704F", data1: "#54704F", data2: "#A75633",
  },
  blossom: {
    ground: "#FAF5F2", card: "#FFFFFF", line: "#EDDFE0", ink: "#362C31", soft: "#6E5C64",
    accent: "#A8465E", second: "#586F60", ok: "#586F60", data1: "#586F60", data2: "#A8465E",
  },
  tidepool: {
    ground: "#F0F5F4", card: "#FFFFFF", line: "#DBE5E3", ink: "#22312F", soft: "#526562",
    accent: "#B04E38", second: "#26655F", ok: "#26655F", data1: "#26655F", data2: "#B04E38",
  },
  spruce: {
    // Note: accent and second's roles invert here vs. the other three skins — accent
    // (spruce green) is what happens to also be the safe-state green, and second (amber)
    // is NOT safe-colored. ok is pinned to accent, not second, so a safe pill never renders
    // amber in this skin.
    ground: "#F4F6F3", card: "#FFFFFF", line: "#DFE5DF", ink: "#232A26", soft: "#59645C",
    accent: "#3E5C50", second: "#8A5A12", ok: "#3E5C50", data1: "#3E5C50", data2: "#8A5A12",
  },
};

export const DEFAULT_SKIN = "original";

// Universal caution color — deliberately NOT part of the skin tables above. A warning
// should read as "caution" the same way in every skin (never green — see the spruce note
// above, which exists precisely so a genuine safe-state check can never land on this color
// by accident). Same values as the pre-Companion theme's amber/amberSoft.
const WARN = "#8A5A12";
const WARN_SOFT = "#F6EEDD";

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (rgb) => `#${rgb.map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
// Mix `hex` with `towardHex` (t = share of `hex`, 0..1) — used to derive the soft chip/dot
// tints and the faint (tertiary) text tone from each skin's own accent/second/soft, so every
// skin gets a correctly-proportioned tint without hand-picking four more locked hexes apiece.
const mix = (hex, towardHex, t) => {
  const a = hexToRgb(hex), b = hexToRgb(towardHex);
  return rgbToHex(a.map((v, i) => v * t + b[i] * (1 - t)));
};

// The intake line's actual color: data2, evenly blended with the skin's own `soft` neutral.
// data2 alone reads as an error/warning color in more than one skin — most acutely in spruce,
// where `second` (data2's source) is literally the same hex as the universal WARN token (see
// the spruce note above and WARN below) — and even where it isn't an exact match, a fully
// saturated brand hue on a routine "calories in" line reads more alarming than intended.
// Blending toward `soft` roughly halves the saturation while *raising* contrast against the
// white card (soft is a mid-dark neutral, so mixing toward it only darkens), and because
// `soft` carries each skin's own neutral cast rather than warn's fixed amber, the result's hue
// moves away from warn too, not just its saturation — verified in theme.test.js.
export const mutedIntake = (base) => mix(base.data2, base.soft, 0.5);

// The full resolved token set for one skin: its locked hexes plus the derived soft tints and
// the tertiary text tone, plus the fixed warning colors.
export function deriveSkin(base) {
  return {
    ...base,
    accentSoft: mix(base.accent, "#FFFFFF", 0.13),
    secondSoft: mix(base.second, "#FFFFFF", 0.13),
    // Its own soft tint (not just reused from secondSoft) because in the spruce skin ok
    // diverges from second — a safe-zone fill must stay green-tinted there too.
    okSoft: mix(base.ok, "#FFFFFF", 0.13),
    // Contrast audit: at 0.55 this was ~2.3-2.5:1 against both ground and card in every skin —
    // a caption/tertiary text token that fails 4.5:1 everywhere it's actually used (chart tick
    // labels, hints), which is real text, not decoration. 0.90 clears >=4.5:1 against both
    // ground and card in all four skins with margin (see theme.test.js's contrast-floor block).
    faint: mix(base.soft, base.ground, 0.90),
    intake: mutedIntake(base),
    warn: WARN,
    warnSoft: WARN_SOFT,
  };
}

const VAR_NAMES = [
  "ground", "card", "line", "ink", "soft", "faint",
  "accent", "accentSoft", "second", "secondSoft", "ok", "okSoft",
  "data1", "data2", "intake", "warn", "warnSoft",
];

// Write one skin's resolved hex values onto :root as CSS custom properties. Call once on
// mount and again whenever the user switches skins (see AppState.jsx) — every inline style
// and SVG stroke in the app reads `var(--token)` through the C/CHART maps below, so this one
// DOM write re-themes the whole app without touching a single component.
export function applySkin(name) {
  if (typeof document === "undefined") return;
  const skin = deriveSkin(SKINS[name] || SKINS[DEFAULT_SKIN]);
  const root = document.documentElement.style;
  for (const k of VAR_NAMES) root.setProperty(`--${k}`, skin[k]);
}

// Apply the default immediately on load (before React/hydration ever run) so there's no
// flash of unstyled color; AppState re-applies once a persisted skin choice is hydrated.
applySkin(DEFAULT_SKIN);

// Stable references — components never see a raw hex, only a CSS variable name, so they
// re-theme for free whenever applySkin() runs. Names kept from the pre-Companion palette
// (paper/spruce/amber/etc.) to minimize churn across the app; see the role comment above
// for what each now maps to.
export const C = {
  paper: "var(--ground)", card: "var(--card)", ink: "var(--ink)",
  sub: "var(--soft)", faint: "var(--faint)", line: "var(--line)",
  spruce: "var(--second)", spruceSoft: "var(--secondSoft)",
  amber: "var(--accent)", amberSoft: "var(--accentSoft)",
  ok: "var(--ok)", okSoft: "var(--okSoft)",
  warn: "var(--warn)", warnSoft: "var(--warnSoft)",
};

// Chart entity → token map, one source for both the SVG marks and the legend swatches (so
// they can never disagree with each other): weight is the observed ground truth, drawn in the
// neutral `ink` text color, not a data hue — it shouldn't share a color with a *modeled*
// series like expenditure, especially stacked in the adjacent panel. expenditure is `data1`
// (every skin pins data1 === ok, so it's never mistakable for a caution color) and owns that
// hue alone now. intake is the derived, desaturated `intake` token (see mutedIntake above) —
// data2's hue, quieted down so a routine "calories in" line doesn't read as an error/warning.
export const CHART = {
  weight: "var(--ink)",
  intake: "var(--intake)",
  expenditure: "var(--data1)",
};
