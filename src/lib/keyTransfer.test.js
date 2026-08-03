import { describe, it, expect } from "vitest";
import { beginKeyTransfer, completeKeyTransfer, memoryTransferRelay, keyFingerprint, DEFAULT_TTL_MS } from "./keyTransfer.js";
import { KEY_BYTES } from "./syncCrypto.js";

const aKey = () => crypto.getRandomValues(new Uint8Array(KEY_BYTES));

// Drive the whole flow the way the two devices will: old device begins + publishes, new device
// scans the QR text and claims.
async function pair(dek, { relay = memoryTransferRelay(), ttlMs } = {}) {
  const begun = await beginKeyTransfer(dek, ttlMs ? { ttlMs } : undefined);
  await relay.publish(begun.transferId, begun.wrapped, begun.ttlMs);
  return { begun, relay, complete: () => completeKeyTransfer(begun.qrPayload, relay.claim) };
}

describe("QR device pairing", () => {
  it("moves the data key from one device to the other", async () => {
    const dek = aKey();
    const { complete } = await pair(dek);
    const { dek: got } = await complete();
    expect([...got]).toEqual([...dek]);
  });

  it("both devices show the same fingerprint, so the owner can confirm the match", async () => {
    const dek = aKey();
    const { begun, complete } = await pair(dek);
    const { fingerprint } = await complete();
    expect(fingerprint).toBe(begun.fingerprint);
    expect(fingerprint).toMatch(/^[0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2}$/);
  });

  it("a different key gives a different fingerprint (it actually discriminates)", async () => {
    expect(await keyFingerprint(aKey())).not.toBe(await keyFingerprint(aKey()));
  });

  // The security property that makes a photographed QR worthless.
  it("burn-on-read: a second claim fails, even with the identical QR", async () => {
    const { complete } = await pair(aKey());
    await complete(); // the real device pairs first
    await expect(complete()).rejects.toThrow(/expired or was already used/);
  });

  it("an expired transfer cannot be claimed", async () => {
    let t = 1_000_000;
    const relay = memoryTransferRelay({ now: () => t });
    const { complete } = await pair(aKey(), { relay, ttlMs: 60_000 });
    t += 60_001;
    await expect(complete()).rejects.toThrow(/expired or was already used/);
  });

  it("expiry and reuse are indistinguishable to the claimer", async () => {
    const { complete: c1 } = await pair(aKey());
    await c1();
    const used = await c1().catch((e) => e.message);
    let t = 0;
    const relay = memoryTransferRelay({ now: () => t });
    const { complete: c2 } = await pair(aKey(), { relay, ttlMs: 10 });
    t += 11;
    const expired = await c2().catch((e) => e.message);
    expect(used).toBe(expired);
  });

  // The relay must never be able to unwrap the DEK — this is the whole point of not sending
  // transferKey to the server.
  it("the relay holds only ciphertext: the QR payload is never part of what's published", async () => {
    const dek = aKey();
    const { begun } = await pair(dek);
    const hexDek = [...dek].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(begun.wrapped).not.toContain(hexDek);
    expect(begun.wrapped).not.toContain(begun.qrPayload);
    // and the id used to address the relay is not the secret half
    expect(begun.qrPayload).not.toContain(begun.transferId);
  });

  it("a valid-format QR from a DIFFERENT transfer cannot unwrap this one", async () => {
    const relay = memoryTransferRelay();
    const a = await beginKeyTransfer(aKey());
    const b = await beginKeyTransfer(aKey());
    // publish A's ciphertext under B's id — a wrong-key unwrap, not a missing row
    await relay.publish(b.transferId, a.wrapped, DEFAULT_TTL_MS);
    await expect(completeKeyTransfer(b.qrPayload, relay.claim)).rejects.toThrow(/doesn't match this transfer/);
  });

  it("tampered ciphertext is rejected (AES-GCM authentication)", async () => {
    const relay = memoryTransferRelay();
    const begun = await beginKeyTransfer(aKey());
    const bad = begun.wrapped.slice(0, -4) + (begun.wrapped.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    await relay.publish(begun.transferId, bad, DEFAULT_TTL_MS);
    await expect(completeKeyTransfer(begun.qrPayload, relay.claim)).rejects.toThrow(/doesn't match this transfer/);
  });

  it("rejects junk scanned from some other QR code with a legible message", async () => {
    const relay = memoryTransferRelay();
    for (const junk of ["", "https://example.com", "not-a-code", "1234"]) {
      await expect(completeKeyTransfer(junk, relay.claim)).rejects.toThrow(/doesn't look like a pairing code/);
    }
  });

  it("tolerates the dashes and lowercase a scanner or a human may hand back", async () => {
    const dek = aKey();
    const { begun, relay } = await pair(dek);
    const got = await completeKeyTransfer(begun.qrPayload.toLowerCase(), relay.claim);
    expect([...got.dek]).toEqual([...dek]);
  });

  it("refuses to transfer anything that isn't a 32-byte key", async () => {
    await expect(beginKeyTransfer(new Uint8Array(16))).rejects.toThrow(/32 raw bytes/);
    await expect(beginKeyTransfer("nope")).rejects.toThrow(/32 raw bytes/);
  });

  it("each transfer is unique — no reuse of id or key across pairings", async () => {
    const dek = aKey();
    const a = await beginKeyTransfer(dek);
    const b = await beginKeyTransfer(dek);
    expect(a.transferId).not.toBe(b.transferId);
    expect(a.qrPayload).not.toBe(b.qrPayload);
    expect(a.wrapped).not.toBe(b.wrapped); // fresh IV each time
    expect(a.fingerprint).toBe(b.fingerprint); // same underlying key, though
  });

  it("claiming removes the row, so the relay does not accumulate spent transfers", async () => {
    const { relay, complete } = await pair(aKey());
    expect(relay._size()).toBe(1);
    await complete();
    expect(relay._size()).toBe(0);
  });
});
