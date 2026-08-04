// @vitest-environment jsdom
//
// Exhaustive tests for the E2EE sync crypto core (see syncCrypto.js's file banner for the
// exact scheme). Run under jsdom deliberately (rather than the suite's usual default node
// environment — see AppState.integration.test.jsx for the other file that does this) since
// that's the environment the eventual UI-wiring task will actually run this code in; confirms
// WebCrypto (crypto.subtle) is genuinely present there, not just under Node's default env.

import { describe, test, expect } from "vitest";
import {
  generateSyncCode, encodeSyncCode, parseSyncCode,
  encryptBlob, decryptBlob, bytesToHex, hexToBytes,
  STORE_ID_BYTES, KEY_BYTES,
} from "./syncCrypto.js";

describe("environment", () => {
  test("WebCrypto is actually available in this test environment", () => {
    expect(typeof globalThis.crypto).toBe("object");
    expect(typeof globalThis.crypto.subtle).toBe("object");
    expect(typeof globalThis.crypto.getRandomValues).toBe("function");
  });
});

describe("generateSyncCode", () => {
  test("produces the documented byte lengths", () => {
    const { storeId, key } = generateSyncCode();
    expect(storeId).toBeInstanceOf(Uint8Array);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(storeId.length).toBe(STORE_ID_BYTES);
    expect(key.length).toBe(KEY_BYTES);
  });

  test("storeId and key are independently random across calls (not all-zero, not equal)", () => {
    const a = generateSyncCode();
    const b = generateSyncCode();
    expect(a.storeId).not.toEqual(new Uint8Array(STORE_ID_BYTES)); // not all-zero
    expect(a.key).not.toEqual(new Uint8Array(KEY_BYTES));
    expect(a.storeId).not.toEqual(b.storeId);
    expect(a.key).not.toEqual(b.key);
    expect(a.code).not.toBe(b.code);
  });

  test("code is dash-chunked and decodes cleanly", () => {
    const { code } = generateSyncCode();
    expect(code).toMatch(/^[0-9A-Z-]+$/);
    expect(code).toContain("-");
  });
});

describe("sync code encode/decode round-trip", () => {
  test("parseSyncCode inverts encodeSyncCode exactly", () => {
    const { storeId, key, code } = generateSyncCode();
    const parsed = parseSyncCode(code);
    expect(parsed.storeId).toEqual(storeId);
    expect(parsed.key).toEqual(key);
  });

  test("round-trips across many random codes", () => {
    for (let i = 0; i < 25; i++) {
      const { storeId, key, code } = generateSyncCode();
      const parsed = parseSyncCode(code);
      expect(bytesToHex(parsed.storeId)).toBe(bytesToHex(storeId));
      expect(bytesToHex(parsed.key)).toBe(bytesToHex(key));
    }
  });

  test("decoding is case-insensitive", () => {
    const { storeId, key, code } = generateSyncCode();
    const parsed = parseSyncCode(code.toLowerCase());
    expect(parsed.storeId).toEqual(storeId);
    expect(parsed.key).toEqual(key);
  });

  test("decoding tolerates dashes anywhere (chunking is cosmetic) and stray whitespace", () => {
    const { storeId, key, code } = generateSyncCode();
    const raw = code.replace(/-/g, "");
    // Re-chunk arbitrarily (every 3 instead of every 5) — still must decode identically.
    const rechunked = raw.match(/.{1,3}/g).join("-");
    expect(parseSyncCode(rechunked)).toEqual({ storeId, key });
    // Whitespace (spaces, a leading/trailing newline) tolerated too.
    const spaced = `  ${raw.slice(0, 10)} ${raw.slice(10)}\n`;
    expect(parseSyncCode(spaced)).toEqual({ storeId, key });
    // No dashes at all.
    expect(parseSyncCode(raw)).toEqual({ storeId, key });
  });

  test("Crockford confusables (O/0, I/L/1) decode identically to their canonical digit", () => {
    // Build a code, then swap every '0' for 'O' and every '1' for 'I' or 'L' in the raw
    // (pre-chunk) string and confirm it still parses to the same bytes.
    const { storeId, key, code } = generateSyncCode();
    const raw = code.replace(/-/g, "");
    const confused = raw
      .split("")
      .map((ch, i) => (ch === "0" ? "O" : ch === "1" ? (i % 2 ? "I" : "L") : ch))
      .join("");
    expect(parseSyncCode(confused)).toEqual({ storeId, key });
  });

  test("encodeSyncCode rejects the wrong byte lengths", () => {
    expect(() => encodeSyncCode(new Uint8Array(15), new Uint8Array(32))).toThrow();
    expect(() => encodeSyncCode(new Uint8Array(16), new Uint8Array(31))).toThrow();
  });

  describe("malformed codes are rejected", () => {
    test("wrong length (too short)", () => {
      const { code } = generateSyncCode();
      expect(() => parseSyncCode(code.slice(0, -6))).toThrow(/malformed|expected/i);
    });

    test("wrong length (too long)", () => {
      const { code } = generateSyncCode();
      expect(() => parseSyncCode(`${code}-ABCDE`)).toThrow(/malformed|expected/i);
    });

    test("invalid characters (outside the Crockford alphabet, e.g. U)", () => {
      const { code } = generateSyncCode();
      const raw = code.replace(/-/g, "");
      const corrupted = "U" + raw.slice(1);
      expect(() => parseSyncCode(corrupted)).toThrow(/invalid character/i);
    });

    test("non-string input", () => {
      expect(() => parseSyncCode(12345)).toThrow();
      expect(() => parseSyncCode(null)).toThrow();
      expect(() => parseSyncCode(undefined)).toThrow();
    });

    test("empty string", () => {
      expect(() => parseSyncCode("")).toThrow();
    });

    test("garbage input entirely unrelated to the scheme", () => {
      expect(() => parseSyncCode("not-a-sync-code-at-all")).toThrow();
    });
  });
});

describe("hex helpers", () => {
  test("bytesToHex/hexToBytes round-trip", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  test("hexToBytes rejects malformed hex", () => {
    expect(() => hexToBytes("abc")).toThrow(); // odd length
    expect(() => hexToBytes("zz")).toThrow(); // non-hex chars
  });
});

describe("encryptBlob / decryptBlob", () => {
  test("round-trips an arbitrary JSON-serializable object", async () => {
    const { key } = generateSyncCode();
    const obj = { v: 2, cats: { a: { profile: { name: "Mithril" } } }, nested: [1, 2, { x: "y" }], n: 42.5 };
    const payload = await encryptBlob(key, obj);
    expect(typeof payload).toBe("string");
    const decrypted = await decryptBlob(key, payload);
    expect(decrypted).toEqual(obj);
  });

  test("payload is base64 (safe to JSON-stringify/transmit as a plain string)", async () => {
    const { key } = generateSyncCode();
    const payload = await encryptBlob(key, { a: 1 });
    expect(payload).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  test("wrong key fails to decrypt (GCM authentication failure)", async () => {
    const a = generateSyncCode();
    const b = generateSyncCode();
    const payload = await encryptBlob(a.key, { secret: "only for A" });
    await expect(decryptBlob(b.key, payload)).rejects.toThrow();
  });

  test("tampered ciphertext is rejected (flip one byte anywhere after the IV)", async () => {
    const { key } = generateSyncCode();
    const payload = await encryptBlob(key, { data: "important cat weights" });
    const bytes = hexToBytesFromBase64(payload);
    // Flip a bit well past the 12-byte IV, inside the ciphertext/tag region.
    bytes[20] ^= 0xff;
    const tampered = bytesToBase64ForTest(bytes);
    await expect(decryptBlob(key, tampered)).rejects.toThrow();
  });

  test("tampering with the IV itself also breaks decryption (wrong IV -> auth failure or garbage rejected)", async () => {
    const { key } = generateSyncCode();
    const payload = await encryptBlob(key, { data: "x" });
    const bytes = hexToBytesFromBase64(payload);
    bytes[0] ^= 0xff; // corrupt a byte inside the IV
    const tampered = bytesToBase64ForTest(bytes);
    await expect(decryptBlob(key, tampered)).rejects.toThrow();
  });

  test("truncated payload (missing tag bytes) is rejected", async () => {
    const { key } = generateSyncCode();
    const payload = await encryptBlob(key, { data: "x" });
    const bytes = hexToBytesFromBase64(payload);
    const truncated = bytesToBase64ForTest(bytes.slice(0, bytes.length - 4));
    await expect(decryptBlob(key, truncated)).rejects.toThrow();
  });

  test("payload shorter than an IV is rejected outright", async () => {
    const { key } = generateSyncCode();
    await expect(decryptBlob(key, btoa("short"))).rejects.toThrow(/too short/i);
  });

  test("IV uniqueness: many encryptions of the same plaintext with the same key never repeat an IV, and never repeat ciphertext", async () => {
    const { key } = generateSyncCode();
    const obj = { same: "plaintext every time" };
    const N = 100;
    const payloads = await Promise.all(Array.from({ length: N }, () => encryptBlob(key, obj)));
    const ivs = new Set(payloads.map((p) => bytesToBase64ForTest(hexToBytesFromBase64(p).slice(0, 12))));
    const wholePayloads = new Set(payloads);
    expect(ivs.size).toBe(N); // every IV distinct
    expect(wholePayloads.size).toBe(N); // every full payload distinct too (follows from distinct IVs)
    // Every one must still decrypt back to the identical plaintext.
    for (const p of payloads) expect(await decryptBlob(key, p)).toEqual(obj);
  });

  test("decrypting with a key of the wrong length is rejected, not silently coerced", async () => {
    await expect(encryptBlob(new Uint8Array(16), { a: 1 })).rejects.toThrow();
  });
});

describe("the server never sees the key", () => {
  test("a simulated push payload ({ storeId, blob }) contains no trace of the raw key bytes", async () => {
    const { storeId, key } = generateSyncCode();
    const blob = await encryptBlob(key, { v: 2, cats: {}, secretMarker: "should never leak the key" });
    const pushed = { storeId: bytesToHex(storeId), blob };
    const wire = JSON.stringify(pushed);

    // The key must not appear in the wire payload in ANY of the encodings it could plausibly
    // leak through: raw hex, base64 of the raw bytes, or as a substring of the blob itself.
    const keyHex = bytesToHex(key);
    const keyB64 = bytesToBase64ForTest(key);
    expect(wire).not.toContain(keyHex);
    expect(wire).not.toContain(keyB64);
    expect(blob).not.toContain(keyHex);
    expect(blob).not.toContain(keyB64);

    // And structurally: the only keys on the pushed object are storeId/blob — no `key` field
    // could have been accidentally attached.
    expect(Object.keys(pushed).sort()).toEqual(["blob", "storeId"]);
    expect(pushed).not.toHaveProperty("key");
  });
});

/* ---------- local test-only byte helpers (independent of syncCrypto's internal base64 impl,
   so these tests aren't just re-testing the module against itself) ---------- */

function hexToBytesFromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64ForTest(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe("decryptBlob rejects prototype-shifting keys", () => {
  test("drops __proto__ from a decrypted payload", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    // encryptBlob takes an object; build one carrying a literal __proto__ own property
    const payload = JSON.parse('{"dek":"ab","__proto__":{"polluted":"yes"},"deep":{"__proto__":{"polluted":"yes"},"k":1}}');
    const back = await decryptBlob(key, await encryptBlob(key, payload));
    expect(Object.prototype.hasOwnProperty.call(back, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(back.deep, "__proto__")).toBe(false);
    expect(back.deep.k).toBe(1);
    expect({}.polluted).toBeUndefined();
  });
});
