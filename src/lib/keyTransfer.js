// Device pairing by QR: move the data key from an unlocked device to a new one without making
// the owner type a recovery passphrase.
//
// WHY NOT "just put the key in the QR". The data key (DEK) is long-lived and protects everything
// ever synced. A QR that literally contains it is a permanent bearer secret the moment anyone
// photographs the screen — and the owner has no way to know it happened or to revoke it.
//
// So the QR carries a ONE-TIME TRANSFER CREDENTIAL instead, and the DEK travels (encrypted) via
// the relay both devices can already reach:
//
//   old device                         relay (server)                    new device
//   ──────────                         ──────────────                    ──────────
//   mint transferId + transferKey
//   wrapped = AES-GCM(transferKey, DEK)
//   publish(transferId, wrapped) ────►  stores wrapped, TTL
//   show QR = transferId ‖ transferKey ······· scanned ··············►  parse
//                                       ◄──── claim(transferId) ───────  fetch wrapped
//                                       DELETES it (burn-on-read)
//                                                                        unwrap with transferKey
//                                                                        -> DEK
//
// The properties this buys over a key-in-QR:
//   * The relay never sees `transferKey` (it only ever exists in the QR and the two devices), so
//     the server cannot unwrap the DEK. The E2EE claim survives the pairing flow.
//   * Burn-on-read: once the new device claims it, a photo of the QR is worthless.
//   * TTL: an unclaimed transfer expires on its own, so an abandoned pairing doesn't leave a
//     usable secret lying around.
//   * The exposure window is seconds, and a stolen-but-unused QR yields a DEK only if the thief
//     wins the race against the device standing in front of the owner.
//
// The QR payload reuses syncCrypto's `16-byte id ‖ 32-byte key` envelope (Crockford base32,
// uppercase+digits — which is also QR "alphanumeric mode", so the code stays visually simple).
// Same envelope, different meaning: here the id names a one-time transfer, not a durable store.
//
// STILL REQUIRED, and not a substitute for this flow: the recovery passphrase. Pairing works only
// while you still have one unlocked device. Lose them all and the passphrase is the only way back
// — see the E2EE bargain in syncStore.js.

import { encodeSyncCode, parseSyncCode, encryptBlob, decryptBlob, bytesToHex, KEY_BYTES } from "./syncCrypto.js";

export const TRANSFER_ID_BYTES = 16;
export const DEFAULT_TTL_MS = 5 * 60 * 1000; // long enough to walk to the other device, short enough to not linger

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE RELAY CONTRACT
//
//   publish(transferId, wrapped, ttlMs) -> void
//     Store `wrapped` under `transferId`. MUST expire on its own after ttlMs.
//   claim(transferId) -> wrapped | null
//     Return it and DELETE it atomically — a second claim must return null. This burn-on-read is
//     a security property, not an optimisation: it's what makes a photographed QR worthless once
//     the real device has paired. Implement it server-side; a client-side delete doesn't count.
//
// Kept separate from the Store contract in syncStore.js on purpose — Store is durable, versioned,
// and read many times; a transfer is ephemeral, unversioned, and read exactly once.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// In-memory relay: the reference implementation and what the tests run against.
export function memoryTransferRelay({ now = () => Date.now() } = {}) {
  const rows = new Map(); // id -> { wrapped, expiresAt }
  return {
    async publish(transferId, wrapped, ttlMs = DEFAULT_TTL_MS) {
      rows.set(transferId, { wrapped, expiresAt: now() + ttlMs });
    },
    async claim(transferId) {
      const row = rows.get(transferId);
      if (!row) return null;
      rows.delete(transferId); // burn on read — before the expiry check, so a claim is never replayable
      if (row.expiresAt <= now()) return null;
      return row.wrapped;
    },
    _size: () => rows.size,
  };
}

// A short, human-comparable fingerprint of a key. Shown on BOTH devices so the owner can confirm
// the same key landed — catching a mis-scan or a swapped payload, which unwrapping alone wouldn't
// distinguish from "wrong device". Not a secret: it's a truncated hash, useless for deriving the
// key, so it's safe to print on screen.
export async function keyFingerprint(keyBytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
  return bytesToHex(digest.slice(0, 3)).toUpperCase().replace(/(.{2})(?=.)/g, "$1-"); // e.g. "9F-3C-A1"
}

// OLD DEVICE, step 1: mint a one-time transfer, wrap the DEK for it, and hand back what to
// publish and what to render as a QR. Does NOT publish — the caller owns the relay call so this
// module stays free of transport.
export async function beginKeyTransfer(dekBytes, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!(dekBytes instanceof Uint8Array) || dekBytes.length !== KEY_BYTES) {
    throw new Error(`data key must be ${KEY_BYTES} raw bytes`);
  }
  const transferId = crypto.getRandomValues(new Uint8Array(TRANSFER_ID_BYTES));
  const transferKey = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  // The DEK travels as hex inside the encrypted envelope; syncCrypto's encryptBlob takes an
  // object, and hex keeps it JSON-clean without another binary encoding to reason about.
  const wrapped = await encryptBlob(transferKey, { v: 1, dek: bytesToHex(dekBytes) });
  return {
    transferId: bytesToHex(transferId), // relay key
    wrapped, // publish this
    qrPayload: encodeSyncCode(transferId, transferKey), // render this; NEVER send it to the relay
    fingerprint: await keyFingerprint(dekBytes),
    expiresAt: Date.now() + ttlMs,
    ttlMs,
  };
}

// NEW DEVICE: given the scanned QR text and a way to claim from the relay, recover the DEK.
// `claim` is the relay's claim(transferId) — injected so this is testable and transport-free.
export async function completeKeyTransfer(qrPayload, claim) {
  let transferId, transferKey;
  try {
    ({ storeId: transferId, key: transferKey } = parseSyncCode(qrPayload));
  } catch (e) {
    throw new Error(`that doesn't look like a pairing code: ${e.message}`);
  }
  const wrapped = await claim(bytesToHex(transferId));
  if (wrapped == null) {
    // Indistinguishable on purpose — expired, already used, and never-existed all look the same
    // to the claimer, and the honest user-facing answer is the same in every case.
    throw new Error("this pairing code has expired or was already used — start a new one");
  }
  let payload;
  try {
    payload = await decryptBlob(transferKey, wrapped);
  } catch {
    throw new Error("pairing failed: the code doesn't match this transfer");
  }
  const dekHex = payload?.dek;
  if (typeof dekHex !== "string" || dekHex.length !== KEY_BYTES * 2 || !/^[0-9a-f]+$/i.test(dekHex)) {
    throw new Error("pairing failed: the transferred key is malformed");
  }
  const dek = new Uint8Array(dekHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  return { dek, fingerprint: await keyFingerprint(dek) };
}
