import { describe, it, expect } from "vitest";
import { toPortableExport, toPortableImport, stripCredentials, findCredentialFields, isCredentialKey, isUnsafeKey } from "./portableExport.js";
import { mergeV2 } from "./mergeData.js";

// A persisted blob shaped like the real one, with a live-looking credential in it.
const stateWithSecrets = () => ({
  v: 2,
  activeCatId: "cat1",
  cats: { cat1: { profile: { name: "Mithril" }, weighIns: [{ date: "2026-08-01", kg: 4.4 }] } },
  library: [{ name: "Tiki Cat", kcalPerGram: 1.2 }],
  fridgeDays: 5, skin: "original", unit: "kg", settingsModAt: 123,
  litterRobot: {
    refreshToken: "eyJTOTALLY.a.real.looking.token",
    robots: [{ serial: "LR4C1", model: "LR4" }],
    pets: [{ id: "p1", name: "Mithril" }],
    petMap: { p1: "cat1" }, robotMap: { LR4C1: "cat1" }, lastSyncTs: 1, weightScale: null,
  },
  sync: { code: "SYNCCODE", url: "https://example.workers.dev" },
});

describe("portable export — credential safety (P0)", () => {
  it("strips the Litter-Robot connection (and its refreshToken) entirely", () => {
    const out = toPortableExport(stateWithSecrets());
    expect(out.litterRobot).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("eyJTOTALLY");
  });

  it("strips a sync config — the sync code is itself a bearer secret", () => {
    expect(toPortableExport(stateWithSecrets()).sync).toBeUndefined();
  });

  it("keeps all the actual cat data", () => {
    const out = toPortableExport(stateWithSecrets());
    expect(out.cats.cat1.weighIns).toHaveLength(1);
    expect(out.cats.cat1.profile.name).toBe("Mithril");
    expect(out.library).toHaveLength(1);
    expect(out).toMatchObject({ v: 2, fridgeDays: 5, unit: "kg", settingsModAt: 123 });
  });

  // The acceptance criterion, stated as the reviewer wrote it: searching the exported JSON for
  // token/password/secret must turn up no provider credential.
  it("an exported file contains no token/password/secret field at any depth", () => {
    const json = JSON.stringify(toPortableExport(stateWithSecrets()));
    expect(findCredentialFields(JSON.parse(json))).toEqual([]);
    for (const needle of ["refreshToken", "password", "secret", "apiKey", "syncCode"]) {
      expect(json.toLowerCase()).not.toContain(needle.toLowerCase());
    }
  });

  it("catches a credential smuggled somewhere new — nested, and inside arrays", () => {
    const sneaky = {
      v: 2,
      cats: { c1: { integrations: [{ name: "x", accessToken: "SEEKRIT" }] } },
      deep: { a: { b: { apiKey: "SEEKRIT2" } } },
    };
    const out = toPortableExport(sneaky);
    expect(findCredentialFields(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("SEEKRIT");
    expect(out.cats.c1.integrations[0].name).toBe("x"); // non-secret siblings survive
  });

  it("does not mutate the state it was handed", () => {
    const s = stateWithSecrets();
    toPortableExport(s);
    expect(s.litterRobot.refreshToken).toBe("eyJTOTALLY.a.real.looking.token");
  });

  it("recognises the credential-ish key spellings, and leaves ordinary keys alone", () => {
    for (const k of ["refreshToken", "refresh_token", "accessToken", "password", "api_key", "apiKey", "privateKey", "syncCode", "clientSecret", "Authorization"])
      expect(isCredentialKey(k)).toBe(true);
    for (const k of ["kg", "kcalPerGram", "robots", "petMap", "weightScale", "name", "date", "tokenizer_note"])
      expect(isCredentialKey(k)).toBe(k === "tokenizer_note"); // substring match is intentional; no such field exists
  });
});

describe("import — a backup can never reconnect an external account", () => {
  it("scrubs a credential out of an incoming file", () => {
    const incoming = toPortableImport(stateWithSecrets());
    expect(incoming.litterRobot).toBeUndefined();
    expect(findCredentialFields(incoming)).toEqual([]);
  });

  it("mergeV2 never adopts an incoming connection, even when local has none", () => {
    const local = { v: 2, activeCatId: "c1", cats: {}, library: [], litterRobot: null, settingsModAt: 0 };
    const incoming = { v: 2, activeCatId: "c1", cats: {}, library: [], litterRobot: { refreshToken: "NOPE" }, settingsModAt: 0 };
    expect(mergeV2(local, incoming).litterRobot).toBeNull();
  });

  it("mergeV2 never replaces a local connection with an imported one", () => {
    const local = { v: 2, activeCatId: "c1", cats: {}, library: [], litterRobot: { refreshToken: "MINE" }, settingsModAt: 0 };
    const incoming = { v: 2, activeCatId: "c1", cats: {}, library: [], litterRobot: { refreshToken: "THEIRS" }, settingsModAt: 0 };
    expect(mergeV2(local, incoming).litterRobot.refreshToken).toBe("MINE");
  });
});

describe("stripCredentials primitives", () => {
  it("passes through scalars, arrays and nulls unharmed", () => {
    expect(stripCredentials(5)).toBe(5);
    expect(stripCredentials(null)).toBe(null);
    expect(stripCredentials("x")).toBe("x");
    expect(stripCredentials([1, { a: 2 }])).toEqual([1, { a: 2 }]);
  });
  it("findCredentialFields reports the path so a failure says WHERE", () => {
    expect(findCredentialFields({ a: { b: [{ refreshToken: "x" }] } })).toEqual(["a.b[0].refreshToken"]);
  });
});

describe("prototype pollution — untrusted JSON can't reshape objects", () => {
  // JSON.parse('{"__proto__":{...}}') produces a real OWN property named __proto__. Copying it
  // onward with `out[k] = v` fires the prototype setter. This module is the first thing to touch an
  // imported file, so it's where the key has to be dropped.
  const hostile = () => JSON.parse('{"v":2,"cats":{},"__proto__":{"polluted":"yes"},"nested":{"__proto__":{"polluted":"yes"},"keep":1}}');

  it("drops __proto__ at every depth instead of copying it onward", () => {
    const out = toPortableImport(hostile());
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out.nested, "__proto__")).toBe(false);
    expect(out.nested.keep).toBe(1); // ordinary siblings survive
  });

  it("leaves Object.prototype untouched", () => {
    toPortableImport(hostile());
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it("also refuses constructor and prototype keys", () => {
    const out = toPortableImport(JSON.parse('{"constructor":{"x":1},"prototype":{"y":2},"ok":3}'));
    expect(out.ok).toBe(3);
    expect(Object.prototype.hasOwnProperty.call(out, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "prototype")).toBe(false);
  });

  it("the export path refuses them too, so a poisoned local state can't be handed on", () => {
    const out = toPortableExport(JSON.parse('{"v":2,"__proto__":{"polluted":"yes"}}'));
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
  });
});
