import { describe, it, expect } from "vitest";
import { memoryStore } from "./syncStore.js";
import { describeStoreContract } from "./syncStore.conformance.js";

// The reference implementation must satisfy the contract it documents. When a real adapter is
// added (Cloudflare Worker, Firestore, …) it gets one line just like this, and the same suite
// decides whether the swap is safe.
describeStoreContract("memoryStore", async () => memoryStore());

describe("memoryStore specifics", () => {
  it("can be seeded, so tests can start from an existing remote state", async () => {
    const s = memoryStore({ abc: { version: 4, blob: "seeded" } });
    expect(await s.get("abc")).toEqual({ version: 4, blob: "seeded" });
    // a caller that believes it's empty must lose against the seeded version
    expect((await s.put("abc", "nope", 0)).conflict).toBe(true);
    expect((await s.put("abc", "yes", 4)).version).toBe(5);
  });

  it("_dump exposes state for debugging without being part of the contract", () => {
    const s = memoryStore();
    expect(typeof s._dump).toBe("function");
    expect(s._dump()).toEqual({});
  });
});
