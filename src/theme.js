// Shared palette. One place to retune the whole look.
export const C = {
  paper: "#F6F7F4", card: "#FFFFFF", ink: "#1C2420", sub: "#5A665E",
  line: "#DDE1D8", spruce: "#3E5C50", spruceSoft: "#EAF0EC",
  amber: "#B7791F", amberSoft: "#F6EEDD", faint: "#8A968D",
};

// Chart series colors — punchier than the muted UI spruce so lines read as distinct
// categories. The amber/green pair is validated CVD-safe (see the dataviz skill's
// validator); weight lives in its own panel so it takes a calm slate.
export const CHART = {
  weight: "#3E5C6B",       // slate — the weight panel (single series)
  intake: "#B7791F",       // amber — calories in
  expenditure: "#2F8F63",  // green — estimated expenditure
};
