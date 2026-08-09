// Litter-Robot 4 weight sync — a pure-ish client for Whisker's cloud API, called directly
// from the browser (no backend: both endpoints below return access-control-allow-origin:*).
//
// AUTH APPROACH: plain Cognito USER_PASSWORD_AUTH over TLS (a single HTTPS POST), not SRP.
// The design brief for this feature asked for SRP if a client library came in under ~40kB
// gzipped; amazon-cognito-identity-js measured at ~24.9kB gzip (82.49 → 107.36kB on this
// app's one build, `npm run build` before/after), which clears that bar on size alone. It
// was NOT used anyway: while researching the exact GraphQL documents, the actual Whisker
// mobile app's own Amplify config (reverse-engineered in jhead/homebridge-litter-robot-4,
// docs/re.md) shows `"authenticationFlowType": "USER_PASSWORD_AUTH"` — i.e. the app client
// itself is set up for password auth, not SRP. Two independent open-source clients
// (jhead/homebridge-litter-robot-4 and ryanleesmith/homebridge-litter-robot-connect) both
// call InitiateAuth with AuthFlow: 'USER_PASSWORD_AUTH' against this exact pool/client and
// report it working. Shipping SRP against a client that may not have ALLOW_USER_SRP_AUTH in
// its ExplicitAuthFlows risks a hard "InvalidParameterException" on every single Connect
// attempt — for a feature whose first live test is the owner's own click, with no
// credentials available here to verify SRP would even be accepted. USER_PASSWORD_AUTH still
// runs over TLS (the password is exposed to Cognito the same way either auth flow exposes it
// to *some* server; SRP's benefit is that Cognito's InitiateAuth never sees the cleartext
// password, a defense-in-depth margin against AWS-side logging bugs, not a transport-security
// difference) — so the tradeoff is a small, theoretical hardening loss in exchange for
// matching the flow that's actually verified to work, and shipping zero extra dependency
// weight. Reassess if Connect starts failing with an auth-flow-not-enabled error.
//
// GraphQL query documents (field lists, query signatures) are copied from the open-source
// jhead/homebridge-litter-robot-4 plugin (MIT), which the design brief pointed at:
//   - robot listing: src/api/litterRobot4Client.ts (GRAPHQL_FIELDS, GRAPHQL_QUERY_ROBOTS_BY_USER)
//   - activity/weight history: docs/schema.graphql (getLitterRobot4Activity, LR4ActivityTimestreamRowOutput)
// Pool id, app client id, and endpoint are further corroborated by that repo's docs/re.md,
// which reproduces the Whisker app's own Amplify config.

import { LB_PER_KG } from "./units.js";
import { WEIGH_SOURCES } from "./expenditure.js";
import { median, localDateOf, diffDays } from "./series.js";

export const COGNITO_REGION = "us-east-1";
export const COGNITO_USER_POOL_ID = "us-east-1_rjhNnZVAm";
export const COGNITO_CLIENT_ID = "4552ujeu3aic90nf8qn53levmn"; // public client, no secret
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
export const GRAPHQL_ENDPOINT = "https://lr4.iothings.site/graphql";
const USER_AGENT = "amplify-flutter/2.6.1 ios/18.5 API/28"; // matches the real app; some AppSync
// resolvers here reportedly key behavior off User-Agent, per the reference plugins.

export const FIRST_SYNC_DAYS = 90; // how far back the very first sync reaches
const GARBAGE_MAX_LB = 25; // a cat over this is almost certainly a bad/garbage reading

// Legible error categories for the UI — never leak raw Cognito/AppSync error shapes to a page.
export class LitterRobotError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "LitterRobotError";
    this.code = code; // "auth" | "network" | "no_robots" | "unknown"
    this.cause = cause;
  }
}

/* ==================== Cognito auth (USER_PASSWORD_AUTH over TLS) ==================== */

// Raw base64url JWT payload decode — no signature verification (we don't need it: the
// token only round-trips to Whisker's own API, which does its own verification). Pure.
export function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return null;
  }
}

// The Cognito `cognito:username` claim is what the reference plugins use as the GraphQL
// `userId` argument. Prior research on this token also found a `mid` claim carrying the same
// role — prefer it if present (it's the one specifically identified for this API), falling
// back to `cognito:username` (the one the working reference clients actually use).
const userIdFromClaims = (claims) => claims?.mid || claims?.["cognito:username"] || claims?.sub || null;

async function cognitoInitiateAuth(authFlow, authParameters) {
  let res;
  try {
    res = await fetch(COGNITO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({ AuthFlow: authFlow, ClientId: COGNITO_CLIENT_ID, AuthParameters: authParameters }),
    });
  } catch (err) {
    throw new LitterRobotError("network", "Couldn't reach Whisker's login service — check your connection.", err);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const type = body?.__type || "";
    if (/NotAuthorized|UserNotFound|UserNotConfirmed/i.test(type)) {
      throw new LitterRobotError("auth", "Email or password not recognized by Whisker.", body);
    }
    throw new LitterRobotError("unknown", body?.message || `Login failed (${res.status}).`, body);
  }
  if (!body?.AuthenticationResult) {
    throw new LitterRobotError("auth", "Whisker's login requires an extra verification step this app can't handle yet.", body);
  }
  return body.AuthenticationResult; // { AccessToken, IdToken, RefreshToken, ExpiresIn, TokenType }
}

// Fresh login with the owner's own credentials. The password is used ONLY for this one
// request (to Amazon Cognito, over TLS) and is never stored — only the refresh token is.
export async function login(email, password) {
  const result = await cognitoInitiateAuth("USER_PASSWORD_AUTH", { USERNAME: email, PASSWORD: password });
  const claims = decodeJwtPayload(result.IdToken);
  const userId = userIdFromClaims(claims);
  if (!userId) throw new LitterRobotError("unknown", "Logged in, but couldn't read the account id from the token.", claims);
  return { idToken: result.IdToken, refreshToken: result.RefreshToken, userId };
}

// Exchange a stored refresh token for a fresh id token. No password involved, so this is
// what every sync (after the first) uses.
export async function refreshIdToken(refreshToken) {
  const result = await cognitoInitiateAuth("REFRESH_TOKEN_AUTH", { REFRESH_TOKEN: refreshToken, CLIENT_ID: COGNITO_CLIENT_ID });
  const claims = decodeJwtPayload(result.IdToken);
  const userId = userIdFromClaims(claims);
  if (!userId) throw new LitterRobotError("unknown", "Refreshed the session, but couldn't read the account id from the token.", claims);
  // REFRESH_TOKEN_AUTH doesn't return a new refresh token — the same one keeps working.
  return { idToken: result.IdToken, userId };
}

/* ==================== GraphQL (AppSync) ==================== */

async function graphqlRequest(idToken, query, variables, endpoint = GRAPHQL_ENDPOINT) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}`, "User-Agent": USER_AGENT },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new LitterRobotError("network", "Couldn't reach the Litter-Robot cloud.", err);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.errors?.length) {
    const msg = body?.errors?.[0]?.message || `Request failed (${res.status}).`;
    if (res.status === 401 || /unauthorized/i.test(msg)) throw new LitterRobotError("auth", "Your Litter-Robot session expired.", body);
    throw new LitterRobotError("unknown", msg, body);
  }
  return body?.data;
}

// Field list borrowed from jhead/homebridge-litter-robot-4 src/api/litterRobot4Client.ts
// (GRAPHQL_FIELDS) — trimmed to just what a robot picker + the weight sync need.
const ROBOTS_BY_USER_QUERY = `
  query GetLR4ByUser($userId: String!) {
    getLitterRobot4ByUser(userId: $userId) {
      name
      serial
      unitId
      isOnboarded
    }
  }
`;

// List every Litter-Robot 4 on the account, onboarded ones only (a not-yet-set-up unit has
// no useful weight data).
export async function listRobots(idToken, userId) {
  const data = await graphqlRequest(idToken, ROBOTS_BY_USER_QUERY, { userId });
  const robots = (data?.getLitterRobot4ByUser || []).filter((r) => r?.isOnboarded);
  if (!robots.length) throw new LitterRobotError("no_robots", "No onboarded Litter-Robot found on that account.");
  return robots.map((r) => ({ name: r.name || "Litter-Robot", serial: r.serial, unitId: r.unitId, model: "LR4" }));
}

// Whisker's separate pet-profile service — NOT the LR4/LR5 robot hosts above. Endpoint,
// query document (GetPetsByUser / getPetsByUser), and field list are copied from
// natekspencer/pylitterbot (MIT), pylitterbot/pet.py on main (fetched directly for this
// feature — see the report): PET_PROFILE_ENDPOINT, Pet.PET_MODEL, Pet.query_by_user. Auth is
// the same Bearer id token as the robot endpoints — confirmed by that same file's
// query_graphql_api, which posts through Session.request, whose Authorization header
// (session.py, get_bearer_authorization) is `Bearer {id token}`, identical in shape to what
// graphqlRequest/lr5Request already send here. Trimmed to just the fields this app uses
// (mapping-picker name + a sanity-check weight) from pylitterbot's much longer PET_MODEL.
export const PET_PROFILE_ENDPOINT = "https://pet-profile.iothings.site/graphql/";
const PETS_BY_USER_QUERY = `
  query GetPetsByUser($userId: String!) {
    getPetsByUser(userId: $userId) {
      petId
      name
      weight
    }
  }
`;

// List every Whisker pet profile on the account (across all robots/generations — pet profiles
// aren't scoped to one robot). Best-effort by design: a Whisker account may have zero pet
// profiles set up (many LR4 owners never touch that part of the app) — that's not an error,
// just an empty list, unlike listRobots/listRobotsLR5 which treat "none" as a no_robots error.
export async function listPets(idToken, userId) {
  const data = await graphqlRequest(idToken, PETS_BY_USER_QUERY, { userId }, PET_PROFILE_ENDPOINT);
  const pets = data?.getPetsByUser || [];
  return pets.map((p) => ({ petId: p.petId, name: p.name || "Pet" }));
}

// Query signature + LR4ActivityTimestreamRowOutput fields borrowed from
// jhead/homebridge-litter-robot-4 docs/schema.graphql. `value` carries the event-type tag
// (e.g. "catWeight"); `actionValue` carries that event's payload, in pounds for weight events
// (per prior research against this API — unverified live without credentials, see report).
const ACTIVITY_QUERY = `
  query GetLR4Activity($serial: String!, $startTimestamp: String, $endTimestamp: String, $activityTypes: [String]) {
    getLitterRobot4Activity(serial: $serial, startTimestamp: $startTimestamp, endTimestamp: $endTimestamp, activityTypes: $activityTypes) {
      measure
      timestamp
      value
      actionValue
    }
  }
`;

// Fetch raw activity events for one robot's serial, restricted to catWeight where the API
// supports server-side filtering (activityTypes) — parseWeightEvents still filters
// defensively in case that argument is ignored or shaped differently than expected.
export async function fetchWeightActivity(idToken, serial, { sinceMs, untilMs } = {}) {
  // The server rejects JS's 3-digit-millisecond ISO strings ("Invalid Timestamp string",
  // observed live). pylitterbot's working call formats with Python's %f — six fractional
  // digits (litterrobot4.py, strftime("%Y-%m-%dT%H:%M:%S.%fZ")) — so pad ms → µs.
  const iso = (ms) => (ms == null ? undefined : new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"));
  const data = await graphqlRequest(idToken, ACTIVITY_QUERY, {
    serial, startTimestamp: iso(sinceMs), endTimestamp: iso(untilMs), activityTypes: ["catWeight"],
  });
  return data?.getLitterRobot4Activity || [];
}

/* ==================== Litter-Robot 5 (REST, not GraphQL) ====================
 *
 * The LR4 GraphQL API (above) does not list or serve activity for LR5 units — pylitterbot
 * (github.com/natekspencer/pylitterbot, account.py) fetches each generation from its own
 * endpoint and merges client-side; listAllRobots() below does the same thing for this app.
 * Auth is identical to LR4 (same Cognito pool/client, same Bearer id token) — no changes there.
 *
 * Base host and the /robots, /robots/{serial}/activities?type=PET_VISIT shapes are per prior
 * research against pylitterbot main; CORS on this host is wildcard on both preflight and
 * response (empirically probed), so it's browser-callable like the LR4 endpoint. The exact
 * field names on the /robots list response and the outer /activities response envelope were
 * NOT pinned down in that research (only the PET_VISIT event fixture from
 * tests/test_litterrobot5.py was) — listRobotsLR5 and the pagination body-unwrapping below are
 * written defensively (tolerate either a bare array or a wrapped object) rather than assumed
 * exact; see the report for what stays unverified until a real account round-trips this.
 */
export const LR5_BASE = "https://ub.prod.iothings.site";
const LR5_PAGE_LIMIT = 100;
const LR5_MAX_PAGES = 10; // defensive cap — never page forever against a misbehaving API

async function lr5Request(idToken, path) {
  let res;
  try {
    res = await fetch(`${LR5_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch (err) {
    throw new LitterRobotError("network", "Couldn't reach the Litter-Robot cloud.", err);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    if (res.status === 401) throw new LitterRobotError("auth", "Your Litter-Robot session expired.", body);
    throw new LitterRobotError("unknown", body?.message || `Request failed (${res.status}).`, body);
  }
  return body;
}

// List every Litter-Robot 5 on the account. Unlike the LR4 GraphQL query, this endpoint takes
// no userId argument — it's scoped by the bearer token alone (per research notes).
export async function listRobotsLR5(idToken) {
  const body = await lr5Request(idToken, "/robots");
  const robots = Array.isArray(body) ? body : body?.robots || [];
  if (!robots.length) throw new LitterRobotError("no_robots", "No Litter-Robot 5 found on that account.");
  return robots.map((r) => ({ name: r.name || r.nickname || "Litter-Robot 5", serial: r.serial, model: "LR5" }));
}

// Page backward through one LR5's activity feed until either a page comes back older than
// sinceTs, a short/empty page signals the end, or LR5_MAX_PAGES is hit. Returns the raw
// PET_VISIT-typed (and possibly other-typed — filtered downstream) event objects, oldest
// cutoff not yet trimmed to sinceTs (parseWeightEventsLR5 + the sync orchestration filter that
// last mile) since a page can straddle the boundary.
export async function fetchWeightActivityLR5(idToken, serial, sinceTs) {
  const events = [];
  let offset = 0;
  for (let page = 0; page < LR5_MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: String(LR5_PAGE_LIMIT), offset: String(offset), type: "PET_VISIT" });
    const body = await lr5Request(idToken, `/robots/${encodeURIComponent(serial)}/activities?${qs}`);
    const batch = Array.isArray(body) ? body : body?.activities || body?.items || [];
    if (!batch.length) break;
    events.push(...batch);
    const oldestInPage = batch.reduce((min, e) => {
      const ms = parseEventMs(e?.timestamp);
      return ms == null ? min : Math.min(min, ms);
    }, Infinity);
    if (sinceTs != null && oldestInPage <= sinceTs) break; // this page already reaches far enough back
    if (batch.length < LR5_PAGE_LIMIT) break; // short page — no more to fetch
    offset += LR5_PAGE_LIMIT;
  }
  return events;
}

// Candidate unit interpretations for a raw LR5 petWeight number, each converting to kg.
// Keyed by a short label that's surfaced as `weightScale` once one wins (see
// parseWeightEventsLR5) so the app can show/remember which interpretation was used.
export const LR5_WEIGHT_SCALES = { LB_HUNDREDTHS: "lb100", LB: "lb", GRAMS: "g" };
const LR5_SCALE_TO_KG = {
  [LR5_WEIGHT_SCALES.LB_HUNDREDTHS]: (v) => v / 100 / LB_PER_KG,
  [LR5_WEIGHT_SCALES.LB]: (v) => v / LB_PER_KG,
  [LR5_WEIGHT_SCALES.GRAMS]: (v) => v / 1000,
};
const PLAUSIBLE_CAT_MIN_KG = 1.0;
const PLAUSIBLE_CAT_MAX_KG = 15;

// Raw LR5 activity events → { entries, weightScale }, oldest first. `petWeight`'s unit is not
// confirmed anywhere in source (see file banner + report) — most likely hundredths-of-a-pound
// by analogy with the state field weightSensor/100, but that's an analogy, not a citation. So:
// try every candidate interpretation, convert the WHOLE BATCH's median through each, and accept
// only the single interpretation whose median lands in a plausible cat weight range. If zero or
// more than one interpretation clears that bar, the batch is genuinely ambiguous — import
// NOTHING rather than risk silently mis-scaled weights (fail empty, never wrong). `weightScale`
// tells the caller (and eventually the UI) which interpretation won, or null if none did.
// `petId`: a PET_VISIT event's `petIds` array attributes the visit to a specific Whisker pet
// profile — confirmed present (a single-element array) in pylitterbot's own LR5 activity test
// fixtures (tests/test_litterrobot5.py, fetched for this feature) and confirmed absent on
// older/other fixtures, so it's read defensively. Exactly one id → that id; zero ids (field
// missing, or present but empty) → null (nothing to attribute to); more than one id → also
// null — a multi-cat household visit the robot itself couldn't attribute to a single pet is
// treated as unattributable here too, not guessed at.
const petIdFromEvent = (e) => (Array.isArray(e.petIds) && e.petIds.length === 1 ? e.petIds[0] : null);

export function parseWeightEventsLR5(events = []) {
  const raw = [];
  for (const e of events || []) {
    if (!e || e.type !== "PET_VISIT") continue;
    const w = Number(e.petWeight);
    const ts = parseEventMs(e.timestamp);
    if (!Number.isFinite(w) || w <= 0 || ts == null) continue;
    raw.push({ w, ts, petId: petIdFromEvent(e) });
  }
  if (!raw.length) return { entries: [], weightScale: null };

  const winners = Object.entries(LR5_SCALE_TO_KG).filter(([, toKg]) => {
    const med = median(raw.map((r) => toKg(r.w)));
    return med >= PLAUSIBLE_CAT_MIN_KG && med <= PLAUSIBLE_CAT_MAX_KG;
  });
  if (winners.length !== 1) return { entries: [], weightScale: null }; // ambiguous or none — see banner above

  const [weightScale, toKg] = winners[0];
  const entries = raw
    .map((r) => ({
      date: localDateOf(r.ts), // LOCAL day the visit happened on, not ts's UTC calendar date
      kg: toKg(r.w),
      method: "litterRobot",
      source: WEIGH_SOURCES.litterRobot,
      ts: r.ts,
      petId: r.petId,
    }))
    .sort((a, b) => a.ts - b.ts);
  return { entries, weightScale };
}

// List both generations concurrently and merge. A Whisker account may genuinely have only
// one generation of robot, so either call is allowed to fail (or come back empty) on its own —
// this only throws if BOTH generations produced nothing usable, preferring to surface whichever
// failure is more specific than a bare "no robots" (e.g. an auth/network problem on the
// generation that's actually present).
export async function listAllRobots(idToken, userId) {
  const [lr4, lr5] = await Promise.allSettled([listRobots(idToken, userId), listRobotsLR5(idToken)]);
  const robots = [];
  if (lr4.status === "fulfilled") robots.push(...lr4.value);
  if (lr5.status === "fulfilled") robots.push(...lr5.value);
  if (robots.length) return robots;

  const errors = [lr4, lr5].filter((r) => r.status === "rejected").map((r) => r.reason);
  const specific = errors.find((e) => e instanceof LitterRobotError && e.code !== "no_robots");
  throw specific || new LitterRobotError("no_robots", "No onboarded Litter-Robot found on that account.");
}

/* ==================== pure parsing / dedupe (no network — fully testable) ==================== */

// A raw activity event's timestamp may come back as an ISO string or an epoch (seen in the
// wild from similar AWS Timestream-backed APIs as either ms or s) — normalize defensively.
function parseEventMs(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  if (/^\d+$/.test(raw)) return parseEventMs(Number(raw));
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

// events: raw getLitterRobot4Activity rows → [{ date, kg, method, source, ts }], oldest first.
// `ts` (the event's epoch ms) rides along for dedupe identity — see dedupeWeightEntries — the
// stored weigh-in shape elsewhere in the app only relies on { date, kg, method, source }, and
// tolerates the extra field.
export function parseWeightEvents(events = []) {
  const out = [];
  for (const e of events) {
    if (!e) continue;
    if (e.value !== "catWeight" && e.measure !== "catWeight") continue;
    const lb = Number(e.actionValue);
    if (!Number.isFinite(lb) || lb <= 0 || lb > GARBAGE_MAX_LB) continue;
    const ts = parseEventMs(e.timestamp);
    if (ts == null) continue;
    const date = localDateOf(ts); // LOCAL day the visit happened on, not ts's UTC calendar date
    out.push({ date, kg: lb / LB_PER_KG, method: "litterRobot", source: WEIGH_SOURCES.litterRobot, ts });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// Drop any parsed event that's already present (same ts + kg) among the target cat's
// existing litter-robot-sourced weigh-ins — so a repeat sync over an overlapping window
// doesn't duplicate rows. Pure; existingEntries is the cat's whole weightLog (mixed sources).
export function dedupeWeightEntries(newEntries, existingEntries = []) {
  const seen = new Set(
    existingEntries
      .filter((e) => e?.source === WEIGH_SOURCES.litterRobot && e.ts != null)
      .map((e) => `${e.ts}_${e.kg}`)
  );
  return newEntries.filter((e) => !seen.has(`${e.ts}_${e.kg}`));
}

/* ==================== orchestration ==================== */

// One full sync pass: refresh the session, fetch + parse activity since `sinceMs` (routed by
// the stored connection's `model` — "LR4" is the default so older-saved connections, which
// predate this field, keep working unchanged), dedupe against what's already logged. Returns
// the pieces AppState needs to fold into state; does not touch storage itself (kept here
// pure-ish / testable, storage stays AppState's job).
//
// `weightScale` is only ever present for an LR5 sync (which interpretation of petWeight won —
// see parseWeightEventsLR5); it's undefined for LR4, where no such ambiguity exists.
export async function syncWeights({ refreshToken, serial, sinceMs, existingEntries, model = "LR4" }) {
  const { idToken } = await refreshIdToken(refreshToken);
  if (model === "LR5") {
    const events = await fetchWeightActivityLR5(idToken, serial, sinceMs);
    const { entries: allParsed, weightScale } = parseWeightEventsLR5(events);
    const parsed = allParsed.filter((e) => e.ts >= sinceMs);
    const fresh = dedupeWeightEntries(parsed, existingEntries);
    return { entries: fresh, syncedAt: Date.now(), weightScale };
  }
  const events = await fetchWeightActivity(idToken, serial, { sinceMs, untilMs: Date.now() });
  const parsed = parseWeightEvents(events);
  const fresh = dedupeWeightEntries(parsed, existingEntries);
  return { entries: fresh, syncedAt: Date.now() };
}

/* ==================== multi-robot / per-pet attribution (v2 connection) ==================== */

// Decide which cat (if any) a single parsed weight entry belongs to, given the connection's
// petMap (Whisker pet id → kilocat cat id, or explicit null for "don't import") and robotMap
// (robot serial → kilocat cat id, same). Routing rule (see report):
//   - entry has a petId (LR5 only) AND petMap has a real cat for it  → that cat
//   - entry has a petId but petMap has nothing (unmapped) or null    → skip
//   - entry has a petId but petMap has nothing (unmapped) or null    → skip
//   - entry has NO petId, from an LR4 → robotMap[serial] if set, else skip
//   - entry has NO petId, from an LR5 → SKIP
//
// That last rule is the one that matters in a house with more than one animal. An LR4 has no pet
// detection at all, so "no petId" carries no information and falling back to the robot's mapped cat
// is the only thing that could be meant. An LR5 DOES attribute visits — so a visit it left
// unattributed is one the robot itself could not identify. Routing that to the robot's cat writes a
// reading into her timeline that may well be another cat, or not a cat at all, and it lands with the
// same weight as a genuine measurement. Better to drop it and report it as skipped: a missing
// reading costs a little precision, a wrong one biases the fit and the owner has no way to spot it.
// Pure; returns a cat id, or null meaning "skip".
export function routeEntry(entry, ctx) { return classifyEntry(entry, ctx).catId; }

// Why a reading was declined — reported in the sync summary so a mis-mapped pet is visible as a
// reason rather than a bare count, and so a routing bug is diagnosable without reading the code.
export const SKIP_REASONS = {
  unattributed: "the robot couldn't tell which cat it was",
  unmappedPet: "from a pet that isn't linked to a cat",
  noRobotMap: "from a robot that isn't linked to a cat",
  implausible: "too far from that cat's known weight",
};

// routeEntry with its reasoning exposed: { catId, reason }. catId null means skipped.
export function classifyEntry(entry, { serial, model = "LR4", petMap = {}, robotMap = {} }) {
  if (entry.petId != null) {
    const catId = petMap[entry.petId] || null;
    return catId ? { catId, reason: null, routedBy: "pet" } : { catId: null, reason: "unmappedPet" };
  }
  if (String(model).toUpperCase() === "LR5") return { catId: null, reason: "unattributed" };
  const catId = robotMap[serial] || null;
  return catId ? { catId, reason: null, routedBy: "robot" } : { catId: null, reason: "noRobotMap" };
}

// Is this reading believable FOR THIS CAT? The absolute GARBAGE_MAX_LB cap only catches nonsense
// like a 30 lb reading; it happily passes 15 lb, which is a perfectly ordinary cat weight and a
// wildly wrong one for a 9.8 lb cat. So compare against the animal's own recent history instead.
//
// Deliberately loose (±35%): a real cat can gain or lose a lot over months, so this must only catch
// readings that are impossible rather than merely surprising — the estimator's own day-median gate
// and maxJumpKg handle ordinary noise.
//
// THE REFERENCE IS A PROJECTION, NOT A STATIC MEDIAN. A young kitten can double its weight in a
// month; comparing against the middle of a 60-day window would reject nearly every genuine reading
// it produces, and silently — the very animals whose growth most needs tracking. Disabling the
// guard for kittens is the wrong answer too, since a kitten sharing a house with an adult is
// exactly where a wrong-cat reading is most likely and most obvious.
//
// So: fit the cat's own recent trajectory and judge the reading against where that trajectory says
// it should BE today. The fit is log-linear (growth is multiplicative — a constant % per week, not
// a constant grams per week) and uses a Theil-Sen median-of-pairwise-slopes, so one bad reading
// already in the history can't tilt the projection. A kitten growing 20%/week has that growth
// predicted, and a reading three times the projection is still rejected. An adult's slope is ~0, so
// the projection collapses to the median and behaves exactly as before.
//
// The window is a TIME SPAN, not a count of readings: a count means completely different things to
// different owners — 60 readings is ten days on a Litter-Robot at 6/day and over a YEAR for someone
// weighing weekly. 60 days is chosen against the safe maximum ADULT loss rate (2%/week ≈ 15% across
// the window, inside the ±35% budget). A weekly weigher still gets ~8 readings; someone weighing
// monthly gets too few and the guard stands down, which is right — it exists to catch bad AUTOMATED
// imports, and a human typing a weight would notice 15 lb themselves.
export const PLAUSIBLE_FRACTION = 0.35;
export const PLAUSIBLE_WINDOW_DAYS = 60;
export const MIN_HISTORY_FOR_PLAUSIBILITY = 5;

// Readings inside the window, collapsed to one point per day (a day's spread is noise here, and it
// keeps the pairwise-slope fit cheap). → [{ date, kg }] oldest first.
function windowDays(history, end) {
  const byDay = new Map();
  for (const e of history || []) {
    const v = Number(e?.kg);
    if (!Number.isFinite(v) || v <= 0 || !e?.date) continue;
    if (end) { const age = diffDays(e.date, end); if (age < 0 || age > PLAUSIBLE_WINDOW_DAYS) continue; }
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(v);
  }
  return [...byDay.entries()].map(([date, vs]) => ({ date, kg: median(vs) })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Where the cat's own recent trend says it should be on `asOf`. Theil-Sen on log(kg) vs day —
// robust to a bad point, and multiplicative so it fits growth rather than fighting it.
export function projectedKg(days, asOf) {
  if (days.length < 2) return days.length ? days[0].kg : null;
  const slopes = [];
  for (let i = 0; i < days.length; i++) {
    for (let j = i + 1; j < days.length; j++) {
      const dt = diffDays(days[i].date, days[j].date);
      if (dt > 0) slopes.push((Math.log(days[j].kg) - Math.log(days[i].kg)) / dt);
    }
  }
  if (!slopes.length) return median(days.map((d) => d.kg));
  const slope = median(slopes);
  // anchor on the median of the most recent few days, so the projection starts from a stable point
  const tail = days.slice(-3);
  const anchor = median(tail.map((d) => d.kg));
  const anchorDate = tail[tail.length - 1].date;
  const ahead = asOf ? diffDays(anchorDate, asOf) : 0;
  return anchor * Math.exp(slope * Math.max(0, ahead));
}

// `history`: the cat's existing weigh-ins [{ date, kg }]. `asOf`: the day being judged (ISO).
export function implausibleForCat(kg, history = [], asOf = null) {
  if (!Number.isFinite(kg) || kg <= 0) return false;
  const end = asOf || (history || []).reduce((a, e) => (e?.date > a ? e.date : a), "");
  const days = windowDays(history, end);
  if (days.length < MIN_HISTORY_FOR_PLAUSIBILITY) return false;
  const ref = projectedKg(days, end);
  if (!(ref > 0)) return false;
  return Math.abs(kg - ref) / ref > PLAUSIBLE_FRACTION;
}

// Full multi-robot sync pass: one session refresh, then fetch + parse + route every robot on
// the connection, dedupe per TARGET cat (not per robot — two robots can feed the same cat),
// and refresh the pet-profile list (best-effort: a pet-profile hiccup shouldn't sink weight
// import, which is why listPets is wrapped separately rather than failing the whole sync).
// `existingEntriesByCat`: { [catId]: thatCat's whole weightLog } for every cat that might
// receive entries — AppState passes every real cat's log since routing isn't known until
// events are parsed. Returns:
//   { byCat: { [catId]: fresh entries[] }, imported, skipped, syncedAt, weightScale, pets }
// `imported`/`skipped` are what the UI's sync-summary line reports (see Settings). `pets` is
// the refreshed Whisker pet-profile list ({ petId, name }[]) for the mapping UI — refreshed on
// every sync (both "sync now" and the connect-time first sync), per the design brief.
export async function syncAllWeights({ refreshToken, robots = [], sinceMs, petMap = {}, robotMap = {}, existingEntriesByCat = {} }) {
  const { idToken, userId } = await refreshIdToken(refreshToken);
  let pets = [];
  try { pets = await listPets(idToken, userId); } catch { pets = []; } // best-effort — see banner

  const byCatRaw = {}; // catId -> raw (not-yet-deduped) entries
  let skipped = 0;
  const skippedByReason = {};
  let weightScale;
  for (const robot of robots) {
    const { serial, model = "LR4" } = robot || {};
    if (!serial) continue;
    let parsed;
    if (model === "LR5") {
      const events = await fetchWeightActivityLR5(idToken, serial, sinceMs);
      const { entries: allParsed, weightScale: ws } = parseWeightEventsLR5(events);
      if (ws) weightScale = weightScale ?? ws;
      parsed = allParsed.filter((e) => e.ts >= sinceMs);
    } else {
      const events = await fetchWeightActivity(idToken, serial, { sinceMs, untilMs: Date.now() });
      parsed = parseWeightEvents(events);
    }
    for (const entry of parsed) {
      const { catId, reason, routedBy } = classifyEntry(entry, { serial, model, petMap, robotMap });
      if (!catId) { skipped++; skippedByReason[reason] = (skippedByReason[reason] || 0) + 1; continue; }
      // Only now do we know whose history to judge it against.
      if (implausibleForCat(entry.kg, existingEntriesByCat[catId] || [], entry.date)) {
        skipped++; skippedByReason.implausible = (skippedByReason.implausible || 0) + 1; continue;
      }
      // Provenance: how this reading came to be filed under this cat. A later routing bug is then
      // findable in the data instead of only by eye.
      (byCatRaw[catId] ||= []).push({ ...entry, routedBy });
    }
  }

  const byCat = {};
  let imported = 0;
  for (const [catId, entries] of Object.entries(byCatRaw)) {
    const fresh = dedupeWeightEntries(entries, existingEntriesByCat[catId] || []);
    if (fresh.length) byCat[catId] = fresh;
    imported += fresh.length;
  }
  return { byCat, imported, skipped, skippedByReason, syncedAt: Date.now(), weightScale, pets };
}

// Migrate a stored connection from the old one-robot-one-cat shape ({ refreshToken, serial,
// model, catId, lastSyncTs, weightScale }) to the current one (robots[] + pets[] + petMap +
// robotMap — see the report / AppState banner). Idempotent: a connection that's already v2
// shape (has a `robots` array) passes through unchanged. `null` (disconnected) passes through
// too. Pure — called from AppState's hydrate() and importData() so both loading a saved
// session and importing an old backup file land on the same shape.

// Auto-match Whisker pets to Kilocat cats by exact name (trimmed, case-insensitive), only when
// the match is unambiguous in BOTH directions — exactly one pet and exactly one cat carry that
// name. Existing petMap entries (including an explicit null = "don't import") always win, and
// anything ambiguous stays unmapped for the owner: a wrong guess here would route weigh-ins
// into the wrong cat's log, which is the one mistake sync must never make.
export function autoMatchPetsByName(pets = [], cats = [], petMap = {}) {
  const norm = (s) => (s || "").trim().toLowerCase();
  const catsByName = new Map();
  for (const c of cats) {
    const n = norm(c.name);
    if (!n) continue;
    catsByName.set(n, catsByName.has(n) ? null : c.id); // null marks a duplicated cat name
  }
  const petNameCounts = new Map();
  for (const p of pets) petNameCounts.set(norm(p.name), (petNameCounts.get(norm(p.name)) || 0) + 1);
  const out = { ...petMap };
  for (const p of pets) {
    if (out[p.petId] !== undefined) continue;
    const n = norm(p.name);
    if (!n || petNameCounts.get(n) !== 1) continue;
    const catId = catsByName.get(n);
    if (catId) out[p.petId] = catId;
  }
  return out;
}

export function migrateConnection(conn) {
  if (!conn) return conn;
  if (Array.isArray(conn.robots)) return conn; // already v2
  const { refreshToken, serial, model, catId, lastSyncTs, weightScale } = conn;
  return {
    refreshToken,
    lastSyncTs: lastSyncTs ?? null,
    weightScale: weightScale ?? null,
    robots: serial ? [{ serial, model: model || "LR4", name: null }] : [],
    pets: [],
    petMap: {},
    robotMap: serial ? { [serial]: catId ?? null } : {},
  };
}
