import { describe, it, expect } from "vitest";
import {
  generateRecoveryKey, parseRecoveryKey, normalizeRecoveryKey, isValidRecoveryKey,
  formatRecoveryKey, RECOVERY_CHARS, RECOVERY_BYTES,
} from "./recoveryKey.js";
import { createAccountKeyring, unlockAccountKeyring } from "./accountKeyring.js";

describe("recovery key", () => {
  it("is 160 bits shown as 8 groups of 4", () => {
    const { bytes, secret, display } = generateRecoveryKey();
    expect(bytes.length).toBe(RECOVERY_BYTES);
    expect(secret).toHaveLength(RECOVERY_CHARS);
    expect(display).toBe(secret.match(/.{4}/g).join("-"));
    expect(display.split("-")).toHaveLength(8);
  });

  it("uses only Crockford characters — no I, L, O or U to misread on paper", () => {
    for (let i = 0; i < 40; i++) {
      expect(generateRecoveryKey().secret).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{32}$/);
    }
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateRecoveryKey().secret));
    expect(seen.size).toBe(50);
  });

  it("round-trips through the grouped display form the owner actually copies", () => {
    const { secret, display } = generateRecoveryKey();
    expect(parseRecoveryKey(display)).toBe(secret);
  });

  it("forgives how a person retypes it: case, spacing, dashes, line breaks", () => {
    const { secret, display } = generateRecoveryKey();
    for (const variant of [
      display.toLowerCase(),
      display.replace(/-/g, " "),
      display.replace(/-/g, ""),
      `  ${display}  `,
      display.replace(/-/g, "\n"),
    ]) {
      expect(parseRecoveryKey(variant)).toBe(secret);
    }
  });

  it("folds the characters people actually confuse (O/0, I/L/1)", () => {
    expect(normalizeRecoveryKey("O0oI1lL")).toBe("0001111"); // O,0,o -> 0 | I,1,l,L -> 1
    // a key typed with O for 0 still opens
    const { secret } = generateRecoveryKey();
    const typo = secret.replace(/0/g, "O").replace(/1/g, "I");
    expect(parseRecoveryKey(typo)).toBe(secret);
  });

  it("rejects the wrong length with a message that says what's wrong", () => {
    expect(() => parseRecoveryKey("")).toThrow(/enter your recovery key/);
    expect(() => parseRecoveryKey("ABCD-EFGH")).toThrow(/32 characters — that one has 8/);
    expect(() => parseRecoveryKey("A".repeat(40))).toThrow(/that one has 40/);
  });

  it("rejects characters that aren't in the alphabet at all", () => {
    expect(() => parseRecoveryKey("!".repeat(32))).toThrow(/doesn't look like a recovery key/);
    expect(isValidRecoveryKey("U".repeat(32))).toBe(false); // U is excluded from Crockford
  });

  it("isValidRecoveryKey agrees with parseRecoveryKey", () => {
    const { display } = generateRecoveryKey();
    expect(isValidRecoveryKey(display)).toBe(true);
    expect(isValidRecoveryKey("nope")).toBe(false);
    expect(isValidRecoveryKey("")).toBe(false);
  });

  it("formatRecoveryKey handles a short tail without a trailing dash", () => {
    expect(formatRecoveryKey("ABCDEF")).toBe("ABCD-EF");
  });
});

// The reason the key exists: it's the fallback that unlocks an account when no device is available.
describe("recovery key ↔ account keyring", () => {
  it("a generated key wraps and later recovers the data key", async () => {
    const rk = generateRecoveryKey();
    const { dek, wrapped } = await createAccountKeyring({ passphrase: rk.secret, iterations: 1000 });
    // months later, on a new device, typed back from paper in its display form
    const retyped = parseRecoveryKey(rk.display.toLowerCase());
    const { dek: back } = await unlockAccountKeyring({ passphrase: retyped, wrapped });
    expect([...back]).toEqual([...dek]);
  });

  it("a different recovery key does not open the account", async () => {
    const { wrapped } = await createAccountKeyring({ passphrase: generateRecoveryKey().secret, iterations: 1000 });
    await expect(unlockAccountKeyring({ passphrase: generateRecoveryKey().secret, wrapped }))
      .rejects.toThrow(/doesn't unlock this account/);
  });
});
