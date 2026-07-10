// Tiny shared helpers, no domain knowledge.
export const num = (v) => Number(v) || 0;
export const r0 = (n) => Math.round(n);
export const r1 = (n) => Math.round(n * 10) / 10;
export const uid = () => Math.random().toString(36).slice(2, 9);
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
