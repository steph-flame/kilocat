// Portable export: the shape of Kilocat data that is safe to leave the device.
//
// The persisted blob is NOT that shape. `persistData` carries `litterRobot`, whose `refreshToken`
// is a live Whisker credential — anyone holding it can pull the account's data without the
// password and without tripping a login notification. Serialising `persistData` straight to a file
// (what `exportData` used to do) quietly turns "here's a backup of my cat's weight log" into
// "here are my credentials", and the same blob is what a cloud sync would upload.
//
// So there are two rules, and they run in opposite directions:
//   OUT (toPortableExport): strip secrets and device-bound integration state before anything is
//        written to a file, uploaded, or handed to another device.
//   IN  (stripCredentials): never TRUST an incoming blob to be clean. Older exports (written
//        before this module existed) still contain a real token, and an imported file is
//        attacker-controlled input in the general case. Scrub on the way in too.
//
// Device-bound state is dropped wholesale rather than surgically de-tokenised: a half-populated
// connection (robots/pets/mappings but no token) is a broken state the UI would have to reason
// about, and re-connecting re-fetches all of it anyway. The cost is that after an import you must
// reconnect the Litter-Robot and redo pet↔cat mapping — deliberate, and the reviewer's acceptance
// criterion ("importing a backup never reconnects an external account") requires it. Already-
// imported weigh-ins are ordinary data and survive; only the live connection goes.

// Top-level keys that are device-bound: a credential, or state that only means anything on the
// device that created it. `sync` is listed ahead of the sync feature landing so a portable export
// can never carry a sync code (which is itself a bearer secret — it contains the AES key).
export const DEVICE_LOCAL_KEYS = ["litterRobot", "sync"];

// Field names that must never appear in anything leaving the device, at ANY depth. This is a
// belt-and-braces net under DEVICE_LOCAL_KEYS: if a future feature tucks a token somewhere new,
// the scrubber and its test catch it even though nobody thought to add the key above.
const CREDENTIAL_RE = /(token|password|passwd|secret|credential|passphrase|api[-_]?key|private[-_]?key|sync[-_]?code|session[-_]?id|bearer|authorization)/i;

export const isCredentialKey = (key) => CREDENTIAL_RE.test(String(key));

// Walk any JSON-ish value and drop every credential-named field, at every depth. Returns a new
// value; the input is never mutated (callers pass live state). Non-plain values (Date, etc.) are
// returned as-is — the persisted blob is plain JSON, so this only matters defensively.
export function stripCredentials(value) {
  if (Array.isArray(value)) return value.map(stripCredentials);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) !== Date.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isCredentialKey(k)) continue;
      out[k] = stripCredentials(v);
    }
    return out;
  }
  return value;
}

// Every path at which a credential-named field survives — `[]` means clean. Used by the
// regression tests, and cheap enough to assert on in the export path itself so a future change
// that reintroduces a secret fails loudly instead of silently shipping it.
export function findCredentialFields(value, path = "") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findCredentialFields(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const at = path ? `${path}.${k}` : k;
      if (isCredentialKey(k)) hits.push(at);
      hits.push(...findCredentialFields(v, at));
    }
  }
  return hits;
}

// The export path. Drops device-bound top-level keys, then scrubs whatever is left by field name.
export function toPortableExport(state) {
  if (!state || typeof state !== "object") return state;
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (DEVICE_LOCAL_KEYS.includes(k)) continue;
    out[k] = stripCredentials(v);
  }
  return out;
}

// The import path. Same scrub, but keeps the shape otherwise intact so the merge still sees a
// normal v2 blob — it just can never carry a connection or a token into the merge.
export function toPortableImport(incoming) {
  return toPortableExport(incoming);
}
