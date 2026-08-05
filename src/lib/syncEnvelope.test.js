import { describe, it, expect } from "vitest";
import {
  makeEnvelope, inspectEnvelope, wouldServerAccept, ENVELOPE_MESSAGE,
  APP_SCHEMA_VERSION, CRYPTO_VERSION, ENVELOPE_VERSION,
} from "./syncEnvelope.js";

const stored = (over = {}) => ({
  v: ENVELOPE_VERSION, schemaVersion: APP_SCHEMA_VERSION, cryptoVersion: CRYPTO_VERSION,
  revision: 4, updatedAt: null, blob: "ciphertext", ...over,
});

describe("makeEnvelope", () => {
  it("stamps the versions this build writes and advances the revision", () => {
    const e = makeEnvelope({ blob: "abc", revision: 7 });
    expect(e).toMatchObject({ v: ENVELOPE_VERSION, schemaVersion: APP_SCHEMA_VERSION, cryptoVersion: CRYPTO_VERSION, revision: 8, blob: "abc" });
  });

  it("a first write starts the revision chain at 1", () => {
    expect(makeEnvelope({ blob: "abc" }).revision).toBe(1);
    expect(makeEnvelope({ blob: "abc", revision: 0 }).revision).toBe(1);
  });

  it("refuses to build an envelope with no ciphertext", () => {
    expect(() => makeEnvelope({ blob: "" })).toThrow(/needs a ciphertext blob/);
    expect(() => makeEnvelope({})).toThrow(/needs a ciphertext blob/);
  });

  it("keeps the version fields OUTSIDE the blob — that's what makes them checkable", () => {
    const e = makeEnvelope({ blob: "opaque" });
    expect(Object.keys(e).sort()).toEqual(["blob", "cryptoVersion", "revision", "schemaVersion", "updatedAt", "v"]);
  });
});

describe("inspectEnvelope — decided WITHOUT decrypting", () => {
  it("an empty store may be created by this device", () => {
    expect(inspectEnvelope(null)).toMatchObject({ reason: "empty", canRead: true, canWrite: true, revision: 0 });
  });

  it("the same schema reads and writes normally", () => {
    expect(inspectEnvelope(stored())).toMatchObject({ reason: "ok", canRead: true, canWrite: true, needsMigration: false, revision: 4 });
  });

  it("an OLDER stored schema is read, migrated, and written back", () => {
    const r = inspectEnvelope(stored({ schemaVersion: APP_SCHEMA_VERSION - 1 }));
    expect(r).toMatchObject({ reason: "migrate", canRead: true, canWrite: true, needsMigration: true });
  });

  // The whole point: a stale device must not round-trip newer data through an older model.
  it("a NEWER stored schema is READ-ONLY — it can look, but never write", () => {
    const r = inspectEnvelope(stored({ schemaVersion: APP_SCHEMA_VERSION + 1 }));
    expect(r.canRead).toBe(true);   // stale-but-real data beats a blank screen
    expect(r.canWrite).toBe(false); // writing would silently drop fields it can't see
    expect(r.reason).toBe("app-outdated");
  });

  it("newer CRYPTO blocks reading too, not just writing", () => {
    const r = inspectEnvelope(stored({ cryptoVersion: CRYPTO_VERSION + 1 }));
    expect(r).toMatchObject({ canRead: false, canWrite: false, reason: "crypto-unsupported" });
  });

  it("crypto is judged before schema — an unopenable doc isn't 'just outdated'", () => {
    expect(inspectEnvelope(stored({ schemaVersion: APP_SCHEMA_VERSION + 1, cryptoVersion: CRYPTO_VERSION + 1 })).reason)
      .toBe("crypto-unsupported");
  });

  it("anything that isn't an envelope is refused outright rather than guessed at", () => {
    for (const bad of [{}, { blob: "" }, { blob: 5 }, "nope", 42, { blob: "x", schemaVersion: 0, cryptoVersion: 1 }, { blob: "x", schemaVersion: 1, cryptoVersion: 0 }]) {
      expect(inspectEnvelope(bad)).toMatchObject({ canRead: false, canWrite: false, reason: "malformed" });
    }
  });

  it("every verdict has user-facing copy defined (or is deliberately silent)", () => {
    for (const reason of ["ok", "empty", "migrate", "app-outdated", "crypto-unsupported", "malformed"]) {
      expect(reason in ENVELOPE_MESSAGE).toBe(true);
    }
    expect(ENVELOPE_MESSAGE["app-outdated"]).toMatch(/update/i);
    expect(ENVELOPE_MESSAGE.migrate).toBeNull(); // automatic; nothing to tell the user
  });

  it("a client from the FUTURE reading today's document just migrates it", () => {
    expect(inspectEnvelope(stored(), { schemaVersion: APP_SCHEMA_VERSION + 5 }).reason).toBe("migrate");
  });
});

// Mirrors firestore.rules, so a rejection is caught locally with a clear reason instead of an
// opaque PERMISSION_DENIED from the SDK.
describe("wouldServerAccept — the same no-downgrade rule the server enforces", () => {
  it("a first write must start at revision 1", () => {
    expect(wouldServerAccept(null, makeEnvelope({ blob: "x" }))).toMatchObject({ accept: true });
    expect(wouldServerAccept(null, { ...makeEnvelope({ blob: "x" }), revision: 5 })).toMatchObject({ accept: false, reason: "revision" });
  });

  it("accepts exactly one step forward", () => {
    const cur = stored({ revision: 4 });
    expect(wouldServerAccept(cur, makeEnvelope({ blob: "x", revision: 4 }))).toMatchObject({ accept: true });
  });

  it("rejects a stale write — the losing side of a race can't clobber the winner", () => {
    const cur = stored({ revision: 5 }); // another device already advanced it
    expect(wouldServerAccept(cur, makeEnvelope({ blob: "x", revision: 3 }))).toMatchObject({ accept: false, reason: "revision" });
  });

  it("rejects a replay of the current revision", () => {
    const cur = stored({ revision: 4 });
    expect(wouldServerAccept(cur, { ...makeEnvelope({ blob: "x" }), revision: 4 })).toMatchObject({ accept: false, reason: "revision" });
  });

  it("rejects a schema downgrade even when the revision is valid", () => {
    const cur = stored({ revision: 4, schemaVersion: APP_SCHEMA_VERSION + 1 });
    const next = { ...makeEnvelope({ blob: "x", revision: 4 }), schemaVersion: APP_SCHEMA_VERSION };
    expect(wouldServerAccept(cur, next)).toMatchObject({ accept: false, reason: "schema-downgrade" });
  });

  it("allows a schema UPGRADE alongside the revision step", () => {
    const cur = stored({ revision: 4 });
    const next = { ...makeEnvelope({ blob: "x", revision: 4 }), schemaVersion: APP_SCHEMA_VERSION + 1 };
    expect(wouldServerAccept(cur, next)).toMatchObject({ accept: true });
  });
});

// The two guards compose: an outdated client is stopped locally AND at the server.
describe("belt and braces: the stale-device scenario end to end", () => {
  it("an outdated device is refused by its own guard, and would be refused by the server too", () => {
    const newer = stored({ schemaVersion: APP_SCHEMA_VERSION + 1, revision: 9 });
    expect(inspectEnvelope(newer).canWrite).toBe(false); // it doesn't even try
    // and if a buggy build ignored that, the write it would have sent is rejected anyway
    const next = { ...makeEnvelope({ blob: "x", revision: 9 }), schemaVersion: APP_SCHEMA_VERSION };
    expect(wouldServerAccept(newer, next)).toMatchObject({ accept: false, reason: "schema-downgrade" });
  });
});
