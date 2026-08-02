// Tiny shared helpers, no domain knowledge.
export const num = (v) => Number(v) || 0;
export const r0 = (n) => Math.round(n);
export const r1 = (n) => Math.round(n * 10) / 10;
// Display a kcal value: whole numbers for anything ≥ 10 (burn, targets, meals read cleanest as
// integers), but one decimal below that so small amounts — a 3.7 kcal probiotic sachet — aren't
// rounded away to 4. Returns a trimmed string ("3.7", "4", "247").
export const fmtKcal = (n) => { const v = num(n); return v > 0 && v < 10 ? String(Number(v.toFixed(1))) : String(Math.round(v)); };
export const uid = () => Math.random().toString(36).slice(2, 9);
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
