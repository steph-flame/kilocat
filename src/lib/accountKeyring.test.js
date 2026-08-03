import { describe, it, expect } from "vitest";
import {
  createAccountKeyring, unlockAccountKeyring, rewrapAccountKeyring,
  storeIdForUid, accountKeyring, DEFAULT_ITERATIONS, KDF,
} from "./accountKeyring.js";
import { KEY_BYTES } from "./syncCrypto.js";

// PBKDF2 at 600k iterations is (by design) slow, so tests use a low count except where the real
// default is what's under test.
const FAST = 1000;
const make = (passphrase = "correct horse battery staple") =>
  createAccountKeyring({ passphrase, iterations: FAST });

describe("account keyring", () => {
  it("mints a 32-byte data key and a wrapper that can recover it", async () => {
    const { dek, wrapped } = await make();
    expect(dek).toBeInstanceOf(Uint8Array);
    expect(dek.length).toBe(KEY_BYTES);
    const { dek: back } = await unlockAccountKeyring({ passphrase: "correct horse battery staple", wrapped });
    expect([...back]).toEqual([...dek]);
  });

  // The property the whole design rests on: what the server holds is useless without the passphrase.
  it("what gets uploaded contains no trace of the key or the passphrase", async () => {
    const pass = "a very memorable passphrase";
    const { dek, wrapped } = await createAccountKeyring({ passphrase: pass, iterations: FAST });
    const json = JSON.stringify(wrapped);
    expect(json).not.toContain(pass);
    expect(json).not.toContain([...dek].map((b) => b.toString(16).padStart(2, "0")).join(""));
    expect(Object.keys(wrapped).sort()).toEqual(["iterations", "kdf", "salt", "v", "wrappedDek"]);
  });

  it("the wrong passphrase is rejected, in words a person can act on", async () => {
    const { wrapped } = await make();
    await expect(unlockAccountKeyring({ passphrase: "not it", wrapped }))
      .rejects.toThrow(/passphrase doesn't unlock this account/);
  });

  it("two accounts with the SAME passphrase get different keys (fresh salt + key each time)", async () => {
    const a = await make("same passphrase");
    const b = await make("same passphrase");
    expect([...a.dek]).not.toEqual([...b.dek]);
    expect(a.wrapped.salt).not.toBe(b.wrapped.salt);
    expect(a.wrapped.wrappedDek).not.toBe(b.wrapped.wrappedDek);
    // and one's passphrase can't unlock the other's blob into the wrong key
    const { dek } = await unlockAccountKeyring({ passphrase: "same passphrase", wrapped: a.wrapped });
    expect([...dek]).toEqual([...a.dek]);
  });

  it("tampering with the wrapped blob is detected, not silently accepted", async () => {
    const { wrapped } = await make();
    const tampered = { ...wrapped, wrappedDek: wrapped.wrappedDek.slice(0, -4) + (wrapped.wrappedDek.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(unlockAccountKeyring({ passphrase: "correct horse battery staple", wrapped: tampered })).rejects.toThrow();
  });

  it("rejects malformed stored blobs rather than misbehaving", async () => {
    const { wrapped } = await make();
    await expect(unlockAccountKeyring({ passphrase: "x", wrapped: null })).rejects.toThrow(/no wrapped key/);
    await expect(unlockAccountKeyring({ passphrase: "x", wrapped: { ...wrapped, iterations: 0 } })).rejects.toThrow(/bad iteration count/);
    await expect(unlockAccountKeyring({ passphrase: "x", wrapped: { ...wrapped, salt: "ab" } })).rejects.toThrow(/bad salt/);
    await expect(unlockAccountKeyring({ passphrase: "x", wrapped: { ...wrapped, kdf: "scrypt" } })).rejects.toThrow(/unsupported key-derivation/);
  });

  it("requires a non-empty passphrase", async () => {
    await expect(createAccountKeyring({ passphrase: "" })).rejects.toThrow(/passphrase is required/);
  });
});

describe("changing the passphrase", () => {
  it("keeps the SAME data key, so nothing already synced needs re-encrypting", async () => {
    const { dek, wrapped } = await make("old pass");
    const next = await rewrapAccountKeyring({ wrapped, currentPassphrase: "old pass", newPassphrase: "new pass", iterations: FAST });
    expect([...next.dek]).toEqual([...dek]); // the point of wrapping rather than deriving
    const { dek: viaNew } = await unlockAccountKeyring({ passphrase: "new pass", wrapped: next.wrapped });
    expect([...viaNew]).toEqual([...dek]);
  });

  it("retires the old passphrase", async () => {
    const { wrapped } = await make("old pass");
    const next = await rewrapAccountKeyring({ wrapped, currentPassphrase: "old pass", newPassphrase: "new pass", iterations: FAST });
    await expect(unlockAccountKeyring({ passphrase: "old pass", wrapped: next.wrapped })).rejects.toThrow();
  });

  it("is a CHANGE, not a reset — it needs the current passphrase", async () => {
    const { wrapped } = await make("old pass");
    await expect(rewrapAccountKeyring({ wrapped, currentPassphrase: "guess", newPassphrase: "new" })).rejects.toThrow();
  });
});

describe("KDF parameters travel with the blob, so they can be upgraded", () => {
  it("unlock uses the blob's OWN iteration count, not today's constant", async () => {
    const { dek, wrapped } = await createAccountKeyring({ passphrase: "p", iterations: 1200 });
    expect(wrapped.iterations).toBe(1200);
    expect(wrapped.kdf).toBe(KDF);
    const { dek: back } = await unlockAccountKeyring({ passphrase: "p", wrapped });
    expect([...back]).toEqual([...dek]); // still opens after the default moves
  });

  it("flags a weakly-wrapped account so it can be silently upgraded on unlock", async () => {
    const weak = await createAccountKeyring({ passphrase: "p", iterations: 1000 });
    expect((await unlockAccountKeyring({ passphrase: "p", wrapped: weak.wrapped })).needsRewrap).toBe(true);
    const upgraded = await rewrapAccountKeyring({ wrapped: weak.wrapped, currentPassphrase: "p", iterations: DEFAULT_ITERATIONS });
    expect((await unlockAccountKeyring({ passphrase: "p", wrapped: upgraded.wrapped })).needsRewrap).toBe(false);
    expect([...upgraded.dek]).toEqual([...weak.dek]); // upgrading doesn't change the key
  }, 20000);
});

describe("storeId from uid", () => {
  it("is stable, so every device signing in reaches the same store", async () => {
    expect(await storeIdForUid("uid-abc")).toBe(await storeIdForUid("uid-abc"));
  });
  it("is 16 bytes of hex, matching what the Store contract expects", async () => {
    expect(await storeIdForUid("uid-abc")).toMatch(/^[0-9a-f]{32}$/);
  });
  it("differs per account and doesn't just restate the uid", async () => {
    const a = await storeIdForUid("uid-abc");
    expect(a).not.toBe(await storeIdForUid("uid-abd"));
    expect(a).not.toContain("uid-abc");
  });
  it("requires a uid", async () => {
    await expect(storeIdForUid("")).rejects.toThrow(/uid is required/);
  });
});

describe("the Keyring the sync client consumes", () => {
  it("resolves an authenticated uid + unlocked key into { storeId, key }", async () => {
    const { dek } = await make();
    const { storeId, key } = await accountKeyring({ uid: "uid-abc", dek }).unlock();
    expect(storeId).toBe(await storeIdForUid("uid-abc"));
    expect(key).toBe(dek);
  });
});
