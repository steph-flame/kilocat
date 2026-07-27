// Almanac — the redesign's single design direction (supersedes the 4-skin "Companion" system on
// this branch). Every value here is transcribed from the design handoff's Design Tokens table; it
// is the source of truth for the rebuilt screens. Ratios in comments are measured against the card
// (#FCFBF7); the floor is 4.5:1 at 10.5px.
//
// TWO principles the old palette got wrong and this one fixes:
//  1. A real CONTRAST LADDER — paper, card, and muted text used to sit within a few percent of each
//     other and blend; here each text tier is a measured step apart, and greys are recalibrated per
//     surface (a grey that passes on card white fails on the page fill two steps down).
//  2. Semantic states are separated by FILL-WEIGHT, not hue — three colors at similar darkness on
//     cream are indistinguishable side by side, at 10px, and in greyscale. So: good = plain green
//     text, caution = outlined chip, danger = solid chip.

export const A = {
  /* ---- surfaces ---- */
  pageFill: "#E9E5D9",
  card: "#FCFBF7",
  tabBar: "#DFDACB",
  cardBorder: "#CEC8B4", // 1px card border
  tabBorder: "#C6C0AA",
  hairline: "#E0DBC9", // 1px divider inside a card

  /* ---- text, on card (#FCFBF7) ---- */
  ink: "#191C12", // 16.7:1 — headings, figures, primary
  body: "#4E5142", // 7.9:1 — body copy
  muted: "#6B6D57", // 5.1:1 — the floor; section labels, sub-lines
  good: "#1F5130", // 8.8:1 — positive/"on plan" text (weight 600)

  /* ---- text, recalibrated for other surfaces ---- */
  labelOnFill: "#585A46", // 5.6:1 on pageFill — screen-level labels
  bodyOnFill: "#3F4234", // 8.2:1 on pageFill
  tabInactive: "#4E5142", // 5.8:1 on tabBar
  tabActive: "#191C12",

  /* ---- semantic states — by fill weight, not hue ---- */
  caution: { bg: "#F2DFA4", border: "#C9A227", text: "#4A3A08" }, // outlined chip / note
  danger: { bg: "#93341A", text: "#FCFBF7" }, // solid chip (careful/discard/reorder)

  /* ---- accents ---- */
  gold: "#C9A227", // fills, rules, chip borders ONLY — never small text
  underline: "#E3CE7E", // the prose underline behind key numbers (solid, keeps the digit black)

  /* ---- food dots ---- */
  food: { wet: "#1F5130", dry: "#C9A227", treat: "#8A5A2B", wet2: "#5B7CA8" },

  /* ---- ration mode chips ---- */
  mode: {
    fixed: { bg: "#EDE8D8", text: "#3F4234" },
    share: { bg: "#D3E1D4", text: "#193F24" },
    remainder: { bg: "#EFE3BE", text: "#4A3A08" },
  },

  /* ---- chart supports ---- */
  chart: {
    trend: "#191C12", // ink trend polyline
    ideal: "#C9A227", // gold dashed ideal-weight line
    endDot: "#1F5130",
    weighDot: "#A79E8C",
    underBurn: "#9EBBA3", // energy-balance bars below the burn baseline
    overBurn: "#C98A6E", // …and above it
    overBurnLabel: "#8A4A2E",
    neutralBar: "#C4D3C6", // safe band / neutral day bars
    zeroLine: "#8E9188", // "holding steady" dashed line
  },

  /* ---- selectors / sliders ---- */
  cellUnsel: { bg: "#EDE8D8", text: "#3F4234" }, // BCS cell, unselected
  cellSel: { bg: "#191C12", text: "#FCFBF7" }, // selected (weight 700)
  track: "#DCD6C2", // slider track / interval-bar track
  recZone: "#9EBBA3", // recommended-rate shaded zone inside the track
  inverted: { bg: "#191C12", text: "#FCFBF7", sub: "#BFC6B8" }, // target / whole-ration cards
};

// Type roles. Newsreader (serif) carries prose and headings; IBM Plex Sans is the UI face; IBM
// Plex Mono sets every number, unit and label (always with tabular-nums on figures). The @font-face
// declarations that load these self-hosted (privacy-first — no font CDN) live in almanac-fonts.css.
export const TYPE = {
  serif: '"Newsreader", Georgia, "Times New Roman", serif',
  sans: '"IBM Plex Sans", ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

// Spacing & shape scale (px). Card gutter 18; padding 14–18; radius 20 (16 compact); button 14;
// chip 6 (999 for pills); phone design width 390; minimum hit target 44.
export const SHAPE = {
  gutter: 18,
  cardRadius: 20,
  cardRadiusCompact: 16,
  buttonRadius: 14,
  chipRadius: 6,
  pill: 999,
  phoneWidth: 390,
  hit: 44,
};
