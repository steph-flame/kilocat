// A collar — especially one with a tracker on it — is on the cat when the scale reads, so every
// weigh-in taken with it on is heavy by a fixed amount. A GPS/activity tracker is 25-60 g, which
// on a 4.5 kg cat is up to 1.3% of body weight: bigger than a Litter-Robot reading's own noise,
// and enough to matter when the app is reasoning about grams per week.
//
// WHY SUBTRACT AT READ TIME RATHER THAN AT ENTRY. What the scale said is a fact; what the cat
// weighs is an inference from it. Storing the net number would bake today's guess at the collar's
// mass into history forever — reweigh the collar and every past point would still carry the old
// correction, with no way to tell which. So the log keeps the raw reading and each entry only
// records WHETHER the collar was on; the subtraction happens once, in the view every derived
// value reads through (see AppState.jsx). Correct the collar's weight and the whole history
// follows, because nothing was ever overwritten.
//
// A UNIFORM shift is harmless to the expenditure fit — burn is inferred from the RATE of change,
// so subtracting the same constant from every reading changes nothing. The reason this feature
// exists is the NON-uniform case: the collar comes off for the vet visit, or a manual weigh-in is
// done bare while the Litter-Robot sees it every day, and the difference reads as real weight
// change. That's the same failure mode lib/methodBias.js handles for between-method offsets, and
// the two compose: strip the collar first (it's a known, physical, per-reading amount), then let
// the method-offset machinery work on what's left.

import { num } from "./util.js";

// grams: the collar + tracker as weighed, "" until the owner enters one. No collar is simply 0 —
// there's no separate "has a collar" flag to fall out of step with the weight itself.
// defaultOn: whether the cat normally wears it at weigh-in time. Owners are in one of two regimes
// (it lives on the cat, or it goes on for outings), and the per-entry checkbox handles the
// exceptions either way.
export const defaultCollar = () => ({ grams: "", defaultOn: true });

// Whatever a profile carries — including nothing at all, on every cat saved before this feature
// and on any imported blob — as { grams: number, defaultOn: boolean }.
export function collarOf(profile) {
  const c = profile?.collar || {};
  const grams = num(c.grams);
  return {
    grams: Number.isFinite(grams) && grams > 0 ? grams : 0,
    defaultOn: c.defaultOn !== false, // absent means yes, since entering a weight implies wearing it
  };
}

export const hasCollar = (collar) => num(collar?.grams) > 0;

// Was the collar on for THIS reading? The entry decides when it says so (the checkbox in the
// weight log, and the only thing ever stored per-entry); otherwise it inherits the cat's default.
// `collarOn` is deliberately tri-state in storage — true / false / absent — so "I didn't say"
// keeps following the default if the default is later corrected, while an explicit answer never
// moves underneath the owner.
export function collarWorn(entry, collar) {
  if (!hasCollar(collar)) return false;
  return entry?.collarOn == null ? !!collar.defaultOn : !!entry.collarOn;
}

// The kg this reading is heavy by (0 when the collar was off, or there isn't one).
export const collarOffsetKg = (entry, collar) => (collarWorn(entry, collar) ? num(collar.grams) / 1000 : 0);

// Weigh-ins as the CAT rather than as the scale saw them. Every entry comes back with:
//   kg        — the cat, collar removed. What the whole app should reason about and display.
//   rawKg     — what the scale actually read, untouched.
//   collarOn  — the RESOLVED answer (default applied), for the UI to show and toggle.
//   collarKg  — how much came off, so a row can explain itself without redoing the arithmetic.
// Mapped entries are a VIEW: never write one back to storage or the derived `kg` becomes the
// stored reading and the correction gets applied twice.
export function stripCollar(entries, collar) {
  return (entries || []).map((e) => {
    const off = collarOffsetKg(e, collar);
    return { ...e, kg: num(e.kg) - off, rawKg: num(e.kg), collarOn: off > 0, collarKg: off };
  });
}
