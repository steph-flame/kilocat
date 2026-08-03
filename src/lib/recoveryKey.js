// The recovery key: the one secret the owner has to keep, and the only way back in if every
// device is lost at once.
//
// WHY THIS EXISTS WHEN THERE'S ALREADY A LOGIN. Signing in proves who you are, which gets you your
// ENCRYPTED data. It cannot decrypt it — the server never has the key, which is the whole point.
// A brand-new device therefore has to get the key from one of exactly two places:
//   1. another device you already have  -> QR pairing (keyTransfer.js), the normal path
//   2. this recovery key                -> the fallback when there IS no unlocked device
// Remove (2) and "phone died, laptop wiped" means the cloud copy is gone forever. Let the server
// hold a copy instead and it isn't end-to-end encrypted any more. There's no third option; the
// honest move is to make (2) short, generated, and clearly labelled.
//
// GENERATED, NOT CHOSEN. A human-invented passphrase is low-entropy, so its security rests on the
// KDF being slow enough to make guessing expensive — which is where Argon2id-vs-PBKDF2 actually
// matters. 160 random bits has nothing to guess: at ~10^12 attempts/sec, the expected search is
// still longer than the age of the universe by a wide margin. So generating the key removes the
// weakest link rather than hardening it, and the KDF in accountKeyring.js becomes belt-and-braces
// instead of the load-bearing part.
//
// FORMAT. 20 bytes -> exactly 32 Crockford base32 characters -> 8 groups of 4. Crockford is
// uppercase+digits with I/L/O/U removed and confusables folded on input (1/I/L, 0/O), which is what
// makes it survive being written on paper and typed back months later. The same alphabet as the
// sync code, so there's one thing to recognise rather than two.

import { bytesToBase32, base32ToBytes } from "./syncCrypto.js";

export const RECOVERY_BYTES = 20; // 160 bits -> 32 base32 chars exactly, no padding bits to check
export const RECOVERY_CHARS = 32;
const GROUP = 4;

// Group for reading/transcribing. Purely cosmetic — parsing ignores the dashes.
export const formatRecoveryKey = (raw) =>
  (raw.match(new RegExp(`.{1,${GROUP}}`, "g")) || []).join("-");

// Strip anything a person or a password manager might add (spaces, dashes, line breaks, lowercase)
// and fold the Crockford confusables. Doesn't validate — that's isValidRecoveryKey/parse.
export function normalizeRecoveryKey(input) {
  return String(input || "")
    .replace(/[\s-]/g, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export const isValidRecoveryKey = (input) => {
  const c = normalizeRecoveryKey(input);
  if (c.length !== RECOVERY_CHARS) return false;
  try { base32ToBytes(c); return true; } catch { return false; }
};

// Mint a new recovery key. `secret` is what accountKeyring wraps the data key under; `display` is
// the grouped form to show the owner ONCE. Nothing derived here is ever uploaded.
export function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_BYTES));
  const raw = bytesToBase32(bytes);
  return { bytes, secret: raw, display: formatRecoveryKey(raw) };
}

// Turn whatever the owner typed/pasted back into the exact secret used at setup. Throws with
// something legible rather than letting a typo surface later as "wrong key".
export function parseRecoveryKey(input) {
  const c = normalizeRecoveryKey(input);
  if (c.length === 0) throw new Error("enter your recovery key");
  if (c.length !== RECOVERY_CHARS) {
    throw new Error(`a recovery key is ${RECOVERY_CHARS} characters — that one has ${c.length}`);
  }
  try { base32ToBytes(c); } catch { throw new Error("that doesn't look like a recovery key — check for a mistyped character"); }
  return c;
}
