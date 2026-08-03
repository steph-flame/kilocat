// The crypto core of end-to-end-encrypted cross-device sync. Everything the Worker ever sees
// is ciphertext + a random storeId — the key NEVER leaves this module's callers' hands, and
// the server has no way to derive it (it's full-entropy random, not derived from anything the
// server could guess or brute-force). See worker/src/index.js for the server side (which only
// stores { storeId, blob } and asserts nothing else) and syncClient.js for the sync loop that
// uses these primitives.
//
// SCHEME (implemented exactly, no hand-rolled crypto — WebCrypto only):
//  - storeId: 16 random bytes. Just an opaque bucket name for the Durable Object — not secret,
//    doesn't need to be (an attacker who guesses/observes it only gets ciphertext).
//  - key: 32 random bytes, used directly as an AES-256-GCM key. No PBKDF2/HKDF — a passphrase-
//    derived key would need a KDF to stretch low-entropy input, but this key IS the full 256
//    bits of entropy already (crypto.getRandomValues), so deriving from it would only add
//    complexity for zero security benefit.
//  - sync code: Crockford-base32(storeId ‖ key), dash-chunked for readability. Crockford's
//    alphabet excludes the visually-confusable I/L/O/U and its decoder is case-insensitive and
//    treats O as 0 and I/L as 1 — chosen specifically so a human can read a code off one device
//    and type it into another without transcription errors. Decoding also ignores dashes and
//    whitespace, so the exact chunking is cosmetic only.
//  - encrypt: AES-256-GCM with a FRESH random 96-bit (12-byte) IV every single call — GCM's
//    security completely breaks if the same (key, IV) pair is ever reused, so IV generation is
//    the one place in this file that must never be "clever" (cached, derived, counter-based
//    without persistence, etc.) — always crypto.getRandomValues. Payload shape is
//    IV ‖ ciphertext-with-appended-GCM-tag, base64-encoded as one string — the IV is not secret
//    and travels alongside the ciphertext (this is completely standard for GCM).
//  - decrypt: split IV back off the front, AES-256-GCM decrypt the rest. The GCM tag makes this
//    authenticate-and-decrypt in one step — any bit flipped anywhere in the payload (by an
//    attacker, or by corruption) makes crypto.subtle.decrypt() reject rather than silently
//    return garbage plaintext. That rejection IS the tamper check; there's no separate MAC step
//    to get wrong.
//
// The server (Cloudflare Worker) is handed only { storeId, blob } — see syncClient.js's
// syncOnce — where storeId is this module's storeId (hex-encoded for use as a URL path
// segment / mock-store map key, see bytesToHex) and blob is encryptBlob's output. It never
// receives `key` in any form. syncCrypto.test.js asserts this directly (grepping the exact
// pushed payload for the key's own byte sequence, in every encoding it could plausibly leak
// through).

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 — no I/L/O/U

// Crockford's decode is deliberately permissive: case-insensitive, and the visually-confusable
// letters fold onto the digit they're most often mistaken for (O→0, I/L→1) so a hand-copied
// code still decodes even if the owner wrote a capital letter where the generator used a digit.
const DECODE_MAP = new Map();
ALPHABET.split("").forEach((ch, i) => {
  DECODE_MAP.set(ch, i);
  DECODE_MAP.set(ch.toLowerCase(), i);
});
for (const ch of ["O", "o"]) DECODE_MAP.set(ch, 0);
for (const ch of ["I", "i", "L", "l"]) DECODE_MAP.set(ch, 1);

export const STORE_ID_BYTES = 16;
export const KEY_BYTES = 32;
const TOTAL_BYTES = STORE_ID_BYTES + KEY_BYTES; // 48
// Crockford base32 packs 5 bits/char; 48 bytes = 384 bits, and 77 chars = 385 bits, so the
// last char carries 1 padding bit (which must decode back to zero — see base32ToBytes).
const CODE_CHARS = Math.ceil((TOTAL_BYTES * 8) / 5); // 77

/* ---------- base32 (Crockford) ---------- */

// Bytes -> Crockford base32, no padding character (fixed-length caller always knows how many
// bytes to expect back, so there's no ambiguity to pad against).
export function bytesToBase32(bytes) {
  let value = 0;
  let bits = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      const shift = bits - 5;
      out += ALPHABET[(value >>> shift) & 0x1f];
      bits -= 5;
      value &= (1 << bits) - 1; // drop the bits we just emitted so `value` never grows unbounded
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

// Crockford base32 -> bytes. Throws on any character outside the (case-insensitive,
// confusable-folded) alphabet, or on nonzero padding bits (a strong signal of a mistyped/
// truncated code rather than a genuine one).
export function base32ToBytes(cleaned) {
  let value = 0;
  let bits = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = DECODE_MAP.get(ch);
    if (idx === undefined) throw new Error(`malformed sync code: invalid character "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      const shift = bits - 8;
      out.push((value >>> shift) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
    throw new Error("malformed sync code: nonzero padding bits");
  }
  return Uint8Array.from(out);
}

// Dash-chunk a raw base32 string for human readability (e.g. on a "link this device" screen).
// Purely cosmetic — parseSyncCode strips dashes (and whitespace) right back out, so any
// chunking survives round-trip, including none at all.
function chunk(raw, size = 5) {
  const groups = [];
  for (let i = 0; i < raw.length; i += size) groups.push(raw.slice(i, i + size));
  return groups.join("-");
}

/* ---------- base64 (payload wire format) ---------- */

function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64) {
  let binary;
  try {
    binary = atob(b64);
  } catch {
    throw new Error("malformed payload: not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ---------- hex (storeId as a URL path segment / map key) ---------- */

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("malformed hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---------- sync code ---------- */

// storeId + key -> a dash-chunked sync code. The inverse of parseSyncCode.
export function encodeSyncCode(storeId, key) {
  if (!(storeId instanceof Uint8Array) || storeId.length !== STORE_ID_BYTES) {
    throw new Error(`storeId must be ${STORE_ID_BYTES} bytes`);
  }
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new Error(`key must be ${KEY_BYTES} bytes`);
  }
  const combined = new Uint8Array(TOTAL_BYTES);
  combined.set(storeId, 0);
  combined.set(key, STORE_ID_BYTES);
  return chunk(bytesToBase32(combined));
}

// A fresh random storeId (16 bytes) + key (32 bytes AES-256-GCM), plus the sync code encoding
// them both. This is the ONLY place either is minted — everything else either parses a code a
// user typed/pasted or receives storeId/key already generated here.
export function generateSyncCode() {
  const storeId = crypto.getRandomValues(new Uint8Array(STORE_ID_BYTES));
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return { storeId, key, code: encodeSyncCode(storeId, key) };
}

// Sync code -> { storeId, key }, both Uint8Array. Case-insensitive, tolerates dashes/whitespace
// anywhere (and the Crockford confusable folds), throws with a descriptive message on anything
// else malformed: wrong length, invalid characters, or corrupted padding bits.
export function parseSyncCode(code) {
  if (typeof code !== "string") throw new Error("sync code must be a string");
  const cleaned = code.replace(/[\s-]/g, "");
  if (cleaned.length !== CODE_CHARS) {
    throw new Error(`malformed sync code: expected ${CODE_CHARS} characters, got ${cleaned.length}`);
  }
  const bytes = base32ToBytes(cleaned); // throws on bad chars / bad padding
  if (bytes.length !== TOTAL_BYTES) {
    throw new Error("malformed sync code: decoded to the wrong length"); // defensive; shouldn't be reachable given the length check above
  }
  return { storeId: bytes.slice(0, STORE_ID_BYTES), key: bytes.slice(STORE_ID_BYTES) };
}

/* ---------- encrypt / decrypt ---------- */

async function importAesKey(keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== KEY_BYTES) {
    throw new Error(`key must be ${KEY_BYTES} raw bytes`);
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// AES-256-GCM encrypt a fresh IV every call, returning base64(IV ‖ ciphertext+tag) as one
// string — this exact string is what's safe to hand to the server (see syncClient.js).
export async function encryptBlob(key, plaintextObj) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV, GCM's recommended size — MUST be fresh every call, never reused with this key
  const cryptoKey = await importAesKey(key);
  const plaintext = new TextEncoder().encode(JSON.stringify(plaintextObj));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return bytesToBase64(combined);
}

// Reverse of encryptBlob. Rejects (throws, since crypto.subtle.decrypt rejects) if the key is
// wrong OR if a single bit of the payload was tampered with/corrupted — GCM's authentication
// tag makes forged/modified ciphertext fail to decrypt rather than silently producing garbage.
export async function decryptBlob(key, payload) {
  const combined = base64ToBytes(payload);
  if (combined.length < 12) throw new Error("malformed payload: too short to contain an IV");
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const cryptoKey = await importAesKey(key);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
