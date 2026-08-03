// The account keyring: how a signed-in device gets the data key, and why the server can't.
//
// With accounts, signing in proves WHO you are — it does not, and must not, hand back the key that
// decrypts your data. If the server could return the key, the server could read the data and the
// E2EE claim would be a lie. So identity and key custody are separate:
//
//   sign in (Firebase/whatever)  ->  proves the uid  ->  fetch the account's ENCRYPTED blobs
//   passphrase (never uploaded)  ->  unwraps the data key locally
//
// WRAPPING, NOT DERIVING. The data key (DEK) is random and permanent for the account. The
// passphrase derives a separate WRAPPING key, which encrypts the DEK. The server stores only
// { wrappedDek, salt, ... }. Two things fall out of that:
//   * Changing the passphrase re-wraps ONE key (see rewrap) instead of re-encrypting every
//     weigh-in and meal ever logged.
//   * A device that's already unlocked can hand the DEK to a new device directly — that's the QR
//     pairing in keyTransfer.js — so the passphrase is the recovery path, not the daily path.
//
// KDF CHOICE, stated plainly: Argon2id is the better answer (memory-hard, so GPUs help an attacker
// much less) but isn't in WebCrypto and would mean shipping a WASM blob. This uses PBKDF2-SHA256 at
// OWASP's current iteration count — native, nothing to bundle, and honestly weaker per unit of
// attacker cost. The mitigation is that `kdf` and `iterations` are STORED IN the wrapped blob, so
// raising the count or moving to Argon2id later is a re-wrap on next unlock, not a migration that
// strands anyone. Which is also why unlock reads its parameters from the blob rather than assuming
// today's constants.
//
// THE BARGAIN, again where the code is: lose every unlocked device AND the passphrase, and the
// cloud copy is unrecoverable. That is the property, not a bug — say it in the UI before anyone
// relies on it.

import { encryptBlob, decryptBlob, bytesToHex, hexToBytes, KEY_BYTES } from "./syncCrypto.js";

export const KDF = "PBKDF2-SHA256";
export const DEFAULT_ITERATIONS = 600_000; // OWASP's PBKDF2-HMAC-SHA256 guidance
export const SALT_BYTES = 16;
export const WRAP_VERSION = 1;

// Derive the wrapping key from a passphrase. Deliberately takes every parameter explicitly (rather
// than reading module constants) so unlocking an OLD blob uses the numbers it was written with.
async function wrappingKey(passphrase, saltBytes, iterations, kdf = KDF) {
  if (kdf !== KDF) throw new Error(`unsupported key-derivation function: ${kdf}`);
  if (typeof passphrase !== "string" || passphrase.length === 0) throw new Error("a passphrase is required");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    base,
    KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

// Wrap an existing DEK under a passphrase. Split out from createAccountKeyring so rewrap and
// first-time setup share one implementation.
async function wrap(dek, passphrase, iterations = DEFAULT_ITERATIONS) {
  if (!(dek instanceof Uint8Array) || dek.length !== KEY_BYTES) {
    throw new Error(`data key must be ${KEY_BYTES} raw bytes`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const wk = await wrappingKey(passphrase, salt, iterations);
  return {
    v: WRAP_VERSION,
    kdf: KDF,
    iterations,
    salt: bytesToHex(salt),
    wrappedDek: await encryptBlob(wk, { dek: bytesToHex(dek) }), // AES-256-GCM, fresh IV
  };
}

// First-time setup for an account: mint a random DEK and wrap it. The caller uploads `wrapped`
// (safe — it's useless without the passphrase) and keeps `dek` in memory / IndexedDB on this device.
export async function createAccountKeyring({ passphrase, iterations = DEFAULT_ITERATIONS }) {
  const dek = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return { dek, wrapped: await wrap(dek, passphrase, iterations) };
}

// Recover the DEK on a new device from the passphrase and the stored blob.
// `needsRewrap` is true when the blob was written with weaker parameters than we'd use today — the
// caller can transparently re-wrap and upload, upgrading the account without asking the user.
export async function unlockAccountKeyring({ passphrase, wrapped }) {
  if (!wrapped || typeof wrapped !== "object") throw new Error("no wrapped key stored for this account");
  const iterations = Number(wrapped.iterations);
  if (!Number.isFinite(iterations) || iterations < 1) throw new Error("stored key is malformed: bad iteration count");
  const salt = hexToBytes(String(wrapped.salt || ""));
  if (salt.length !== SALT_BYTES) throw new Error("stored key is malformed: bad salt");
  const wk = await wrappingKey(passphrase, salt, iterations, wrapped.kdf || KDF);

  let payload;
  try {
    payload = await decryptBlob(wk, wrapped.wrappedDek);
  } catch {
    // GCM auth failure. Overwhelmingly "wrong passphrase" — say that rather than something
    // cryptographic, but don't promise it (a corrupted blob lands here too).
    throw new Error("that passphrase doesn't unlock this account");
  }
  const hex = payload?.dek;
  if (typeof hex !== "string" || hex.length !== KEY_BYTES * 2 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("stored key is malformed: the unwrapped key is the wrong shape");
  }
  return {
    dek: hexToBytes(hex),
    needsRewrap: iterations < DEFAULT_ITERATIONS || (wrapped.kdf || KDF) !== KDF,
  };
}

// Change the passphrase (or upgrade the KDF parameters) WITHOUT re-encrypting any synced data —
// the DEK is unchanged, only its wrapper is replaced. Requires the current passphrase: this is a
// change, not a reset, because a reset is exactly the capability E2EE denies the server.
export async function rewrapAccountKeyring({ wrapped, currentPassphrase, newPassphrase, iterations = DEFAULT_ITERATIONS }) {
  const { dek } = await unlockAccountKeyring({ passphrase: currentPassphrase, wrapped });
  return { dek, wrapped: await wrap(dek, newPassphrase ?? currentPassphrase, iterations) };
}

// A stable storeId for an account, so signing in on any device addresses the same store.
// SHA-256(uid) truncated to the 16 bytes the Store contract expects — deterministic, fixed-length,
// and not the raw uid, so the store key doesn't restate the account id in a third place.
export async function storeIdForUid(uid) {
  if (typeof uid !== "string" || !uid) throw new Error("uid is required");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kilocat:store:${uid}`)));
  return bytesToHex(digest.slice(0, 16));
}

// The Keyring shape syncClient consumes (see the contract in syncStore.js): resolve identity into
// { storeId, key }. Built from an authenticated uid plus an unlocked DEK.
export function accountKeyring({ uid, dek }) {
  return { unlock: async () => ({ storeId: await storeIdForUid(uid), key: dek }) };
}
