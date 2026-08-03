// The Store contract, as an executable test suite.
//
// This is the point of the adapter pattern: a new backend is only "done" when it passes this
// unchanged. Swapping Cloudflare for Firestore (or adding a third) is then provably safe at the
// seam, rather than "it seemed to work when I clicked around".
//
// Usage from any adapter's test file:
//
//   import { describeStoreContract } from "./syncStore.conformance.js";
//   describeStoreContract("firestoreStore", async () => makeStoreBackedByEmulator());
//
// `makeStore` is called fresh per test and must return an EMPTY store (or one whose ids won't
// collide across tests). Async so real adapters can spin up an emulator/fixture.
//
// Deliberately written against the public two-method surface only — no peeking at internals —
// so it can't accidentally encode a memory-store implementation detail as if it were the contract.

import { describe, it, expect } from "vitest";

export function describeStoreContract(name, makeStore) {
  describe(`Store contract: ${name}`, () => {
    const ID = "a1b2c3";
    const OTHER = "ffff00";

    it("get on an unknown id returns null (does not throw)", async () => {
      const s = await makeStore();
      await expect(s.get("nothing-here")).resolves.toBeNull();
    });

    it("first put with expectedVersion 0 succeeds and yields version 1", async () => {
      const s = await makeStore();
      expect(await s.put(ID, "blob-1", 0)).toEqual({ ok: true, version: 1 });
      expect(await s.get(ID)).toEqual({ version: 1, blob: "blob-1" });
    });

    it("treats a missing expectedVersion the same as 0", async () => {
      const s = await makeStore();
      expect(await s.put(ID, "blob-1", undefined)).toEqual({ ok: true, version: 1 });
    });

    it("versions increase by exactly one per successful put", async () => {
      const s = await makeStore();
      expect((await s.put(ID, "v1", 0)).version).toBe(1);
      expect((await s.put(ID, "v2", 1)).version).toBe(2);
      expect((await s.put(ID, "v3", 2)).version).toBe(3);
      expect(await s.get(ID)).toEqual({ version: 3, blob: "v3" });
    });

    it("a stale expectedVersion conflicts and does NOT write", async () => {
      const s = await makeStore();
      await s.put(ID, "winner", 0);
      const res = await s.put(ID, "loser", 0); // still believes the store is empty
      expect(res.ok).toBeUndefined();
      expect(res.conflict).toBe(true);
      // the losing blob must not have landed
      expect(await s.get(ID)).toEqual({ version: 1, blob: "winner" });
    });

    it("a conflict reports the CURRENT version and blob, so the caller can merge and retry", async () => {
      const s = await makeStore();
      await s.put(ID, "remote-state", 0);
      const res = await s.put(ID, "my-state", 0);
      expect(res.current).toEqual({ version: 1, blob: "remote-state" });
    });

    it("the documented retry loop converges: conflict -> re-read -> put at the current version", async () => {
      const s = await makeStore();
      await s.put(ID, "remote", 0);
      let res = await s.put(ID, "mine", 0);
      expect(res.conflict).toBe(true);
      // merge would happen here; retry at the version the conflict reported
      res = await s.put(ID, "merged", res.current.version);
      expect(res).toEqual({ ok: true, version: 2 });
      expect(await s.get(ID)).toEqual({ version: 2, blob: "merged" });
    });

    it("a first-write put against an existing id conflicts (never a silent overwrite)", async () => {
      const s = await makeStore();
      await s.put(ID, "existing", 0);
      const res = await s.put(ID, "clobber", undefined);
      expect(res.conflict).toBe(true);
      expect(await s.get(ID)).toEqual({ version: 1, blob: "existing" });
    });

    it("ids are independent — writing one never disturbs another", async () => {
      const s = await makeStore();
      await s.put(ID, "mine", 0);
      await s.put(OTHER, "theirs", 0);
      expect(await s.get(ID)).toEqual({ version: 1, blob: "mine" });
      expect(await s.get(OTHER)).toEqual({ version: 1, blob: "theirs" });
    });

    it("blobs round-trip byte-for-byte, including unicode and the empty string", async () => {
      const s = await makeStore();
      // ciphertext is base64-ish in practice, but the contract is "opaque string" — hold it to that
      const tricky = 'Mithril 🐈‍⬛ "quoted" \\ / \n\t ünïcøde {"json":"like"} 日本語';
      await s.put(ID, tricky, 0);
      expect((await s.get(ID)).blob).toBe(tricky);
      await s.put(OTHER, "", 0);
      expect((await s.get(OTHER)).blob).toBe("");
    });

    it("two racing writers: exactly one wins, the loser is told what beat it", async () => {
      const s = await makeStore();
      await s.put(ID, "base", 0); // both clients have read version 1
      const [a, b] = await Promise.all([s.put(ID, "A", 1), s.put(ID, "B", 1)]);
      const wins = [a, b].filter((r) => r.ok);
      const loses = [a, b].filter((r) => r.conflict);
      expect(wins).toHaveLength(1);
      expect(loses).toHaveLength(1);
      expect(loses[0].current.version).toBe(2); // the loser can see the winner's version
      expect((await s.get(ID)).version).toBe(2); // and only one write landed
    });
  });
}
