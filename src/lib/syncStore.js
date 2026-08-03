// The sync seams: two small contracts that keep the backend a swappable detail.
//
// Kilocat's sync is deliberately split into three layers, and only the bottom one is
// backend-specific:
//
//   syncCrypto      AES-256-GCM. Never sees a network. Never changes.
//   syncClient      pull -> mergeV2 -> encrypt -> push, with optimistic-concurrency retry.
//                   Never sees a backend. Never changes.
//   Store           "keep these opaque bytes under this id, with a version." <- swappable
//   Keyring         "give me the storeId and key to use."                     <- swappable
//
// Everything valuable (the crypto, and the merge/retry engine that a fuzzer has been run against)
// lives above the seam. Choosing Cloudflare vs. Firestore is a Store implementation; choosing
// sync-codes vs. real accounts is a Keyring implementation. Neither is an architecture decision,
// and the two are independent — accounts on Cloudflare and sync-codes on Firestore are both
// coherent combinations.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE STORE CONTRACT
// ─────────────────────────────────────────────────────────────────────────────────────────────
// A Store is a versioned key/value store of OPAQUE STRINGS. It never sees plaintext, so it can be
// operated by someone we don't trust — that's the whole point of encrypting above it.
//
//   get(storeId) -> { version: number, blob: string } | null
//     null means "nothing stored under this id yet". Never throws for a missing id.
//
//   put(storeId, blob, expectedVersion) -> { ok: true, version } | { conflict: true, current }
//     A COMPARE-AND-SWAP, not a blind write. The write applies only if the stored version is
//     still `expectedVersion`; otherwise it reports the conflict and returns what's actually
//     there now, so the caller can merge and retry instead of clobbering a concurrent write.
//     `expectedVersion` of 0 or undefined means "I believe nothing is stored yet".
//     On success `version` is the NEW version, which the caller remembers for its next put.
//
// Required semantics an implementation MUST honour (all covered by the conformance suite in
// syncStore.conformance.js — run it against any new adapter and the swap is provably safe):
//   1. get on an unknown id returns null, it does not throw.
//   2. A first put with expectedVersion 0/undefined succeeds and yields version 1.
//   3. Versions increase by exactly 1 per successful put.
//   4. A put with a stale expectedVersion returns { conflict, current } and does NOT write.
//   5. A conflict's `current` carries the winning version AND blob, so the caller can merge.
//   6. A first put against an id that already exists conflicts (it isn't a silent overwrite).
//   7. Ids are independent — writing one never disturbs another.
//   8. Blobs round-trip byte-for-byte, including unicode and the empty string.
//
// Errors: throw for transport/auth/capacity failures (the caller surfaces them). A version
// conflict is NOT an error — it's an expected, returned outcome.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE KEYRING CONTRACT
// ─────────────────────────────────────────────────────────────────────────────────────────────
// A Keyring answers "which store, and which key?" — resolving identity into the two things
// syncClient needs. It is the ONLY place that knows whether the user has an account.
//
//   unlock() -> { storeId: string, key: CryptoKey }
//
// Two implementations are planned, and they differ only in where those two values come from:
//
//   syncCodeKeyring(code)        [built]
//     storeId and key are BOTH inside the sync code — Crockford-base32(16B storeId ‖ 32B key).
//     No accounts, no server-side key material, nothing to recover: the code IS the credential.
//
//   accountKeyring({ auth, passphrase, keyStore })   [planned]
//     storeId derives from the authenticated uid, so signing in finds your data.
//     The data key (DEK) is random per account and NEVER derived from the passphrase — instead
//     it's WRAPPED: wrappingKey = Argon2id(passphrase, salt), wrapped = AES-GCM(wrappingKey, DEK).
//     The server holds only { wrappedDek, salt, nonce }. Sign-in fetches those; the passphrase
//     unwraps locally. Wrapping (rather than deriving) is what makes "change your passphrase"
//     a re-wrap of the same DEK instead of re-encrypting the entire history.
//
// THE BARGAIN, stated where the code lives: an account gives you recoverable LOGIN, not
// recoverable DATA. Auth restores access to the ciphertext; only the passphrase (or an already
// -unlocked device) restores the key. If the server could recover the key, it could read the
// data, and the E2EE claim would be false. UI must say so plainly before the user relies on it.

// ─────────────────────────────────────────────────────────────────────────────────────────────

// The reference Store: in memory, no I/O. It exists to (a) be the thing the conformance suite is
// self-tested against, (b) let syncClient tests run without a network, and (c) serve as the
// shortest possible statement of correct behaviour for someone writing a new adapter.
export function memoryStore(seed = {}) {
  const rows = new Map(Object.entries(seed)); // storeId -> { version, blob }
  return {
    async get(storeId) {
      const row = rows.get(storeId);
      return row ? { version: row.version, blob: row.blob } : null;
    },
    async put(storeId, blob, expectedVersion) {
      const row = rows.get(storeId);
      const current = row ? row.version : 0;
      // `undefined` and 0 both mean "I believe this id is empty".
      if ((expectedVersion || 0) !== current) {
        return { conflict: true, current: row ? { version: row.version, blob: row.blob } : null };
      }
      const version = current + 1;
      rows.set(storeId, { version, blob });
      return { ok: true, version };
    },
    // test/debug affordance — not part of the contract, so nothing may depend on it.
    _dump: () => Object.fromEntries([...rows].map(([k, v]) => [k, { ...v }])),
  };
}
