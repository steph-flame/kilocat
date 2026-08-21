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

// A collar is worn over a PERIOD, and the model has to say so at both ends. Storing only a start
// date leaves the owner whose cat stops wearing it with no truthful move available: clear the
// weight and every reading from the months it WAS on jumps back up by it, keep the weight and every
// bare reading from here on gets it taken off. Both silently wrong, in the exact way this module
// exists to prevent — so the period is a period.
//
// grams: the collar + tracker as weighed, "" until the owner enters one. No collar is simply 0 —
// there's no separate "has a collar" flag to fall out of step with the weight itself.
// since: the day the cat STARTED wearing it (YYYY-MM-DD). Earlier weigh-ins came off a bare cat.
// until: the last day it was worn, "" while the cat is still wearing it. Later weigh-ins are bare
// again, and everything in between stays corrected forever.
// defaultOn: whether the collar is in service at all. False with no `until` is the one regime a
// period can't express — "there's a collar, but it isn't the default at weigh-in time" — and it's
// what older saved profiles mean, so it survives as a plain off switch.
export const defaultCollar = () => ({ grams: "", defaultOn: true, since: "", until: "" });

// Whatever a profile carries — including nothing at all, on every cat saved before this feature
// and on any imported blob — as { grams, defaultOn, since, until }.
export function collarOf(profile) {
  const c = profile?.collar || {};
  const grams = num(c.grams);
  const date = (v) => (typeof v === "string" ? v : "");
  return {
    grams: Number.isFinite(grams) && grams > 0 ? grams : 0,
    defaultOn: c.defaultOn !== false, // absent means yes, since entering a weight implies wearing it
    since: date(c.since),
    until: date(c.until),
  };
}

export const hasCollar = (collar) => num(collar?.grams) > 0;

// Was the collar on for THIS reading? The entry decides when it says so (the checkbox in the
// weight log, and the only thing ever stored per-entry); otherwise it inherits the cat's default.
// `collarOn` is deliberately tri-state in storage — true / false / absent — so "I didn't say"
// keeps following the default if the default is later corrected, while an explicit answer never
// moves underneath the owner.
//
// A COLLAR IS WORN OVER A PERIOD, and the default reaches over that period only. Cats acquire
// collars and cats lose them; the usual reason to set this up at all is that one is going on TODAY.
// Without a start date, entering a weight would reinterpret the entire back history as collared and
// restate every past weigh-in 40 g lighter than the scale said. Without an end date, the day the
// collar comes off there is no honest thing the owner can do — see the banner above. Dates are
// YYYY-MM-DD, so a string compare IS a date compare; an open end is blank, and blank at BOTH ends
// means "for as long as we've been logging" (nothing the UI produces, but an imported or
// hand-edited profile can say it).
//
// Deliberately ONE period, not a list: a collar that comes off and goes back on is what the
// per-entry checkbox is for, and a schedule of collar eras is more machinery than the fact deserves.
export function collarWorn(entry, collar) {
  if (!hasCollar(collar)) return false;
  if (entry?.collarOn != null) return !!entry.collarOn; // the owner answered for this reading
  const { since, until, defaultOn } = collar;
  // Off with no end date recorded is the plain "not by default" switch — there's no period to
  // honour, so nothing is corrected. Off WITH one means the period simply ended.
  if (!defaultOn && !until) return false;
  if (!entry?.date) return !!defaultOn; // undated entry: only the live default can speak for it
  if (since && entry.date < since) return false;
  if (until && entry.date > until) return false;
  return true;
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
