// The sync ENVELOPE: the plaintext wrapper around the encrypted blob.
//
// THE PROBLEM IT SOLVES. The dangerous case in cross-device sync isn't a schema change — it's
// VERSION SKEW. Your laptop updates, your phone doesn't reload for a fortnight, and the stale phone
// pulls -> merges -> pushes, silently dropping fields it has never heard of. Data loss caused by
// your own device, with nothing malicious anywhere.
//
// A client therefore has to decide whether it may safely WRITE **before** it decrypts. That's why
// the version cannot live only inside the ciphertext: reading it would require the key and a
// successful decrypt, which is exactly the work we're trying to gate. So a few fields stay in
// plaintext, outside the encryption:
//
//   { v, schemaVersion, cryptoVersion, revision, updatedAt, blob: <ciphertext> }
//
// Nothing here is sensitive — they're version numbers and a counter — and putting them in the clear
// buys two things:
//   1. A client can refuse to write when it's too old, going READ-ONLY instead of destroying data.
//   2. The SERVER can enforce no-downgrade in security rules (schemaVersion >= stored,
//      revision == stored + 1) even though it cannot read a byte of the payload. Rules validating
//      an E2EE document is only possible because these fields are outside it.
//
// The app blob keeps its own `v: 2` and migrate.js chain — that's the INSIDE. This is the outside,
// and the two agree by construction: APP_SCHEMA_VERSION is the blob version this build writes.

import { num } from "./util.js";

// The persisted blob's `v`. Bump BOTH this and migrate.js when the stored shape changes.
export const APP_SCHEMA_VERSION = 2;
// AES-256-GCM with a 12-byte IV, base64(IV ‖ ciphertext) — see syncCrypto.js. Bump if that changes.
export const CRYPTO_VERSION = 1;
// The envelope's own shape, so the envelope can evolve independently of what it wraps.
export const ENVELOPE_VERSION = 1;

// Build the document to store. `revision` is the CAS counter from the Store contract: the caller
// passes what it believes is current, and this stamps current + 1.
export function makeEnvelope({ blob, revision = 0, updatedAt = null,
  schemaVersion = APP_SCHEMA_VERSION, cryptoVersion = CRYPTO_VERSION } = {}) {
  if (typeof blob !== "string" || blob.length === 0) throw new Error("envelope needs a ciphertext blob");
  return {
    v: ENVELOPE_VERSION,
    schemaVersion,
    cryptoVersion,
    revision: Math.max(0, Math.floor(num(revision))) + 1,
    updatedAt: updatedAt ?? null, // caller supplies (server timestamp in Firestore); diagnostics only
    blob,
  };
}

// What THIS build may do with a stored envelope, decided without decrypting anything.
//
// Returns { ok, canRead, canWrite, needsMigration, reason, schemaVersion, cryptoVersion, revision }.
// `reason` is a stable code the UI maps to copy:
//   "ok"                  — same schema; read and write normally.
//   "empty"               — nothing stored yet; this device may create it.
//   "migrate"             — stored is OLDER; read it, migrate on read, write back at ours.
//   "app-outdated"        — stored is NEWER; READ-ONLY. Writing would drop fields we can't see.
//   "crypto-unsupported"  — encrypted by a scheme we don't implement; we can't even read it.
//   "malformed"           — not an envelope. Refuse both, rather than guessing.
export function inspectEnvelope(stored, { schemaVersion = APP_SCHEMA_VERSION, cryptoVersion = CRYPTO_VERSION } = {}) {
  const deny = (reason, extra = {}) => ({ ok: false, canRead: false, canWrite: false, needsMigration: false, reason, ...extra });

  if (stored == null) {
    return { ok: true, canRead: true, canWrite: true, needsMigration: false, reason: "empty", schemaVersion: null, cryptoVersion: null, revision: 0 };
  }
  if (typeof stored !== "object" || typeof stored.blob !== "string" || !stored.blob) return deny("malformed");

  const theirs = num(stored.schemaVersion);
  const theirCrypto = num(stored.cryptoVersion);
  const revision = Math.max(0, Math.floor(num(stored.revision)));
  if (!(theirs >= 1) || !(theirCrypto >= 1)) return deny("malformed", { revision });

  const info = { schemaVersion: theirs, cryptoVersion: theirCrypto, revision };

  // Crypto first: an unsupported scheme means we can't even produce plaintext, so nothing else
  // matters. Checked before schema because a newer crypto version blocks reading, not just writing.
  if (theirCrypto > cryptoVersion) return { ...deny("crypto-unsupported"), ...info };

  // A newer schema: we can still DECRYPT it (crypto is fine), and showing stale-but-real data beats
  // showing nothing — but writing would round-trip through a model that doesn't know the new fields
  // and quietly drop them. So read, never write.
  if (theirs > schemaVersion) return { ok: false, canRead: true, canWrite: false, needsMigration: false, reason: "app-outdated", ...info };

  if (theirs < schemaVersion) return { ok: true, canRead: true, canWrite: true, needsMigration: true, reason: "migrate", ...info };
  return { ok: true, canRead: true, canWrite: true, needsMigration: false, reason: "ok", ...info };
}

// User-facing copy for each verdict. Kept beside the logic so a new reason can't ship without one.
export const ENVELOPE_MESSAGE = {
  ok: null,
  empty: null,
  migrate: null, // silent and automatic — the user doesn't need to know we upgraded the format
  "app-outdated": "This device is running an older Kilocat than the one that last synced. It'll show your data but won't sync changes until you update — otherwise it could overwrite things it doesn't understand.",
  "crypto-unsupported": "This data was saved by a newer Kilocat and can't be opened here. Update the app on this device.",
  malformed: "The synced data couldn't be read. Nothing has been changed on this device.",
};

// Would a write from this build be accepted by the no-downgrade rule the server enforces? Mirrors
// firestore.rules so a rejection is caught locally with a clear message instead of surfacing as an
// opaque PERMISSION_DENIED from the SDK.
export function wouldServerAccept(stored, next) {
  if (!next || typeof next.blob !== "string") return { accept: false, reason: "malformed" };
  if (stored == null) return { accept: num(next.revision) === 1, reason: num(next.revision) === 1 ? "ok" : "revision" };
  if (num(next.schemaVersion) < num(stored.schemaVersion)) return { accept: false, reason: "schema-downgrade" };
  if (num(next.revision) !== num(stored.revision) + 1) return { accept: false, reason: "revision" };
  return { accept: true, reason: "ok" };
}
