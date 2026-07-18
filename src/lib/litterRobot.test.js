import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LB_PER_KG } from "./units.js";
import { WEIGH_SOURCES } from "./expenditure.js";
import {
  parseWeightEvents, dedupeWeightEntries, decodeJwtPayload,
  login, refreshIdToken, listRobots, fetchWeightActivity,
  listRobotsLR5, fetchWeightActivityLR5, parseWeightEventsLR5, listAllRobots,
  listPets, routeEntry, syncAllWeights, migrateConnection,
  LR5_BASE, LR5_WEIGHT_SCALES, PET_PROFILE_ENDPOINT,
  COGNITO_CLIENT_ID, GRAPHQL_ENDPOINT, LitterRobotError,
} from "./litterRobot.js";

// NOTE: no live credentials here — this file mocks fetch and only exercises pure logic and
// request-shaping. The first real authenticated round trip happens when the app's owner
// clicks Connect; see the report for what stays unverified until then.

const catWeightEvent = (lb, iso) => ({ measure: "activity", value: "catWeight", actionValue: String(lb), timestamp: iso });

describe("parseWeightEvents", () => {
  it("converts lbs to kg and tags method/source", () => {
    const [e] = parseWeightEvents([catWeightEvent(10, "2026-01-01T12:00:00Z")]);
    expect(e.kg).toBeCloseTo(10 / LB_PER_KG, 6);
    expect(e.date).toBe("2026-01-01");
    expect(e.method).toBe("litterRobot");
    expect(e.source).toBe(WEIGH_SOURCES.litterRobot);
    expect(typeof e.ts).toBe("number");
  });

  it("ignores non-catWeight events", () => {
    const events = [
      { measure: "activity", value: "cyclesComplete", actionValue: "1", timestamp: "2026-01-01T00:00:00Z" },
      catWeightEvent(9, "2026-01-01T01:00:00Z"),
    ];
    expect(parseWeightEvents(events)).toHaveLength(1);
  });

  it("filters non-positive and garbage-large readings", () => {
    const events = [
      catWeightEvent(0, "2026-01-01T00:00:00Z"),
      catWeightEvent(-3, "2026-01-01T01:00:00Z"),
      catWeightEvent(30, "2026-01-01T02:00:00Z"), // > 25 lb garbage ceiling
      catWeightEvent(9.4, "2026-01-01T03:00:00Z"),
    ];
    const out = parseWeightEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0].kg).toBeCloseTo(9.4 / LB_PER_KG, 6);
  });

  it("drops events with unparseable timestamps or actionValue", () => {
    const events = [
      catWeightEvent(9, "not-a-date"),
      { measure: "activity", value: "catWeight", actionValue: "not-a-number", timestamp: "2026-01-01T00:00:00Z" },
    ];
    expect(parseWeightEvents(events)).toHaveLength(0);
  });

  it("preserves multiple readings on the same day", () => {
    const events = [
      catWeightEvent(9.1, "2026-02-01T08:00:00Z"),
      catWeightEvent(9.3, "2026-02-01T20:00:00Z"),
    ];
    const out = parseWeightEvents(events);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.date === "2026-02-01")).toBe(true);
  });

  it("orders output oldest-first regardless of input order", () => {
    const events = [
      catWeightEvent(9, "2026-01-03T00:00:00Z"),
      catWeightEvent(9, "2026-01-01T00:00:00Z"),
      catWeightEvent(9, "2026-01-02T00:00:00Z"),
    ];
    const out = parseWeightEvents(events);
    expect(out.map((e) => e.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("accepts epoch-seconds and epoch-ms timestamps", () => {
    const seconds = Math.floor(Date.parse("2026-03-01T00:00:00Z") / 1000);
    const ms = Date.parse("2026-03-02T00:00:00Z");
    const out = parseWeightEvents([
      { measure: "activity", value: "catWeight", actionValue: "9", timestamp: seconds },
      { measure: "activity", value: "catWeight", actionValue: "9", timestamp: ms },
    ]);
    expect(out.map((e) => e.date)).toEqual(["2026-03-01", "2026-03-02"]);
  });
});

describe("dedupeWeightEntries", () => {
  it("drops entries already present (same ts + kg) among litter-robot-sourced existing entries", () => {
    const parsed = parseWeightEvents([catWeightEvent(9, "2026-01-01T00:00:00Z"), catWeightEvent(9.2, "2026-01-02T00:00:00Z")]);
    const existing = [{ date: parsed[0].date, kg: parsed[0].kg, method: "litterRobot", source: "litter-robot", ts: parsed[0].ts }];
    const fresh = dedupeWeightEntries(parsed, existing);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].ts).toBe(parsed[1].ts);
  });

  it("ignores manual entries when computing dedupe (no ts, different source)", () => {
    const parsed = parseWeightEvents([catWeightEvent(9, "2026-01-01T00:00:00Z")]);
    const existing = [{ date: "2026-01-01", kg: parsed[0].kg, method: "petScale", source: "manual" }];
    expect(dedupeWeightEntries(parsed, existing)).toHaveLength(1); // not deduped — different source
  });

  it("is a no-op against an empty existing log", () => {
    const parsed = parseWeightEvents([catWeightEvent(9, "2026-01-01T00:00:00Z")]);
    expect(dedupeWeightEntries(parsed, [])).toHaveLength(1);
    expect(dedupeWeightEntries(parsed, undefined)).toHaveLength(1);
  });
});

describe("decodeJwtPayload", () => {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  it("decodes a well-formed JWT payload", () => {
    const payload = { mid: "abc123", exp: 1234 };
    const token = `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
    expect(decodeJwtPayload(token)).toEqual(payload);
  });
  it("returns null for garbage input", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });
});

/* ---------- request-shaping (mocked fetch — no live credentials) ---------- */
describe("network request shaping (mocked)", () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fakeIdToken = (claims) => `${b64url({ alg: "none" })}.${b64url(claims)}.sig`;

  it("login() POSTs USER_PASSWORD_AUTH to the Cognito IDP endpoint with the public client id", async () => {
    const idToken = fakeIdToken({ mid: "user-1" });
    fetchMock.mockResolvedValueOnce(okJson({ AuthenticationResult: { IdToken: idToken, RefreshToken: "rt-1", AccessToken: "at-1" } }));
    const { idToken: got, refreshToken, userId } = await login("a@b.com", "hunter2");
    expect(got).toBe(idToken);
    expect(refreshToken).toBe("rt-1");
    expect(userId).toBe("user-1");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect(opts.headers["X-Amz-Target"]).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(opts.headers["Content-Type"]).toBe("application/x-amz-json-1.1");
    const body = JSON.parse(opts.body);
    expect(body.AuthFlow).toBe("USER_PASSWORD_AUTH");
    expect(body.ClientId).toBe(COGNITO_CLIENT_ID);
    expect(body.AuthParameters).toEqual({ USERNAME: "a@b.com", PASSWORD: "hunter2" });
  });

  it("login() surfaces a bad password as an 'auth'-coded error, never the raw Cognito shape", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ __type: "NotAuthorizedException", message: "Incorrect username or password." }) });
    await expect(login("a@b.com", "wrong")).rejects.toMatchObject({ code: "auth" });
  });

  it("login() surfaces a fetch failure as a 'network'-coded error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(login("a@b.com", "x")).rejects.toBeInstanceOf(LitterRobotError);
    await expect(login("a@b.com", "x")).rejects.toMatchObject({ code: "network" });
  });

  it("refreshIdToken() uses REFRESH_TOKEN_AUTH and never sends a password", async () => {
    const idToken = fakeIdToken({ mid: "user-1" });
    fetchMock.mockResolvedValueOnce(okJson({ AuthenticationResult: { IdToken: idToken, AccessToken: "at" } }));
    await refreshIdToken("rt-stored");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.AuthFlow).toBe("REFRESH_TOKEN_AUTH");
    expect(body.AuthParameters).toEqual({ REFRESH_TOKEN: "rt-stored", CLIENT_ID: COGNITO_CLIENT_ID });
    expect(JSON.stringify(body)).not.toMatch(/PASSWORD/i);
  });

  it("listRobots() POSTs to the GraphQL endpoint with a Bearer token and returns onboarded robots", async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      data: { getLitterRobot4ByUser: [
        { name: "LR4", serial: "LR4-123", unitId: "u1", isOnboarded: true },
        { name: "Not set up", serial: "LR4-999", unitId: "u2", isOnboarded: false },
      ] },
    }));
    const robots = await listRobots("id-token", "user-1");
    expect(robots).toEqual([{ name: "LR4", serial: "LR4-123", unitId: "u1", model: "LR4" }]);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(GRAPHQL_ENDPOINT);
    expect(opts.headers.Authorization).toBe("Bearer id-token");
    const body = JSON.parse(opts.body);
    expect(body.query).toMatch(/getLitterRobot4ByUser/);
    expect(body.variables).toEqual({ userId: "user-1" });
  });

  it("listRobots() throws a 'no_robots'-coded error when nothing is onboarded", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: { getLitterRobot4ByUser: [] } }));
    await expect(listRobots("id-token", "user-1")).rejects.toMatchObject({ code: "no_robots" });
  });

  it("fetchWeightActivity() sends the serial, ISO time window, and activityTypes filter", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: { getLitterRobot4Activity: [] } }));
    const sinceMs = Date.parse("2026-01-01T00:00:00Z");
    const untilMs = Date.parse("2026-02-01T00:00:00Z");
    await fetchWeightActivity("id-token", "LR4-123", { sinceMs, untilMs });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toMatch(/getLitterRobot4Activity/);
    expect(body.variables).toEqual({
      serial: "LR4-123",
      startTimestamp: new Date(sinceMs).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"),
      endTimestamp: new Date(untilMs).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"),
      activityTypes: ["catWeight"],
    });
  });

  it("fetchWeightActivity() surfaces a 401 as an 'auth'-coded error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ errors: [{ message: "Unauthorized" }] }) });
    await expect(fetchWeightActivity("stale-token", "LR4-123", {})).rejects.toMatchObject({ code: "auth" });
  });
});

/* ---------- Litter-Robot 5 (REST) — request shaping (mocked fetch) ---------- */
describe("LR5 request shaping (mocked)", () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

  it("listRobotsLR5() GETs /robots with a Bearer token and no userId param", async () => {
    fetchMock.mockResolvedValueOnce(okJson([{ name: "Living Room", serial: "LR5-1" }]));
    const robots = await listRobotsLR5("id-token");
    expect(robots).toEqual([{ name: "Living Room", serial: "LR5-1", model: "LR5" }]);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${LR5_BASE}/robots`);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer id-token");
    expect(url).not.toMatch(/userId/);
  });

  it("listRobotsLR5() tolerates a { robots: [...] } wrapped response", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ robots: [{ name: "R", serial: "LR5-2" }] }));
    expect(await listRobotsLR5("id-token")).toEqual([{ name: "R", serial: "LR5-2", model: "LR5" }]);
  });

  it("listRobotsLR5() throws a 'no_robots'-coded error when the account has none", async () => {
    fetchMock.mockResolvedValueOnce(okJson([]));
    await expect(listRobotsLR5("id-token")).rejects.toMatchObject({ code: "no_robots" });
  });

  it("listRobotsLR5() surfaces a 401 as an 'auth'-coded error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    await expect(listRobotsLR5("id-token")).rejects.toMatchObject({ code: "auth" });
  });

  const petVisit = (petWeight, iso) => ({ messageId: `m-${iso}`, type: "PET_VISIT", timestamp: iso, petWeight, wasteType: "clumping", duration: 30, petIds: ["PET-1"], isWasteWeightValid: true, wasteWeight: 40 });

  it("fetchWeightActivityLR5() sends limit/offset/type and a Bearer token, stopping on a short page", async () => {
    fetchMock.mockResolvedValueOnce(okJson([petVisit(937, "2026-02-14T23:12:12Z")]));
    const events = await fetchWeightActivityLR5("id-token", "LR5-1", Date.parse("2026-01-01T00:00:00Z"));
    expect(events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // fewer than the page limit came back — that's the last page

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${LR5_BASE}/robots/LR5-1/activities?limit=100&offset=0&type=PET_VISIT`);
    expect(opts.headers.Authorization).toBe("Bearer id-token");
  });

  it("fetchWeightActivityLR5() pages again after a full page, stopping on the following empty page", async () => {
    const sinceTs = Date.parse("2026-01-01T00:00:00Z");
    fetchMock.mockResolvedValueOnce(okJson(
      Array.from({ length: 100 }, (_, i) => petVisit(900, new Date(2026, 1, 1 + i).toISOString())) // all newer than sinceTs
    ));
    fetchMock.mockResolvedValueOnce(okJson([]));
    const events = await fetchWeightActivityLR5("id-token", "LR5-1", sinceTs);
    expect(events).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url2] = fetchMock.mock.calls[1];
    expect(url2).toBe(`${LR5_BASE}/robots/LR5-1/activities?limit=100&offset=100&type=PET_VISIT`);
  });

  it("fetchWeightActivityLR5() stops paging once a page's oldest event reaches sinceTs", async () => {
    const sinceTs = Date.parse("2026-02-01T00:00:00Z");
    fetchMock.mockResolvedValueOnce(okJson(
      Array.from({ length: 100 }, (_, i) => petVisit(900, new Date(sinceTs - 1000 + i * 60000).toISOString()))
    ));
    const events = await fetchWeightActivityLR5("id-token", "LR5-1", sinceTs);
    expect(events).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(1); // full page, but its oldest event is <= sinceTs
  });

  it("fetchWeightActivityLR5() caps out at 10 pages defensively", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okJson(
      Array.from({ length: 100 }, (_, i) => petVisit(900, new Date(2026, 0, 1, 0, i).toISOString()))
    )));
    await fetchWeightActivityLR5("id-token", "LR5-1", 0); // sinceTs of 0 — never satisfied, would page forever
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("fetchWeightActivityLR5() surfaces a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWeightActivityLR5("id-token", "LR5-1", 0)).rejects.toMatchObject({ code: "network" });
  });
});

/* ---------- parseWeightEventsLR5 — unit inference ---------- */
describe("parseWeightEventsLR5", () => {
  const petVisit = (petWeight, iso, type = "PET_VISIT") => ({ messageId: `m-${iso}-${petWeight}`, type, timestamp: iso, petWeight });

  it("infers hundredths-of-a-pound when that's the only interpretation landing in a plausible cat range", () => {
    // 937 / 100 / LB_PER_KG ≈ 4.25 kg (~9.4 lb) — plausible. As plain lb (937 lb) or grams
    // (0.937 g) neither interpretation is remotely plausible.
    const events = [petVisit(937, "2026-02-14T23:12:12Z"), petVisit(920, "2026-02-15T10:00:00Z")];
    const { entries, weightScale } = parseWeightEventsLR5(events);
    expect(weightScale).toBe(LR5_WEIGHT_SCALES.LB_HUNDREDTHS);
    expect(entries).toHaveLength(2);
    expect(entries[0].kg).toBeCloseTo(937 / 100 / 2.2046226218, 5);
    expect(entries.every((e) => e.method === "litterRobot" && e.source === "litter-robot")).toBe(true);
  });

  it("infers plain pounds when THAT'S the only plausible interpretation", () => {
    // 9.4 lb directly plausible; /100 (0.094 lb) and grams (0.0094 g) are not.
    const events = [petVisit(9.4, "2026-03-01T00:00:00Z"), petVisit(9.6, "2026-03-02T00:00:00Z")];
    const { entries, weightScale } = parseWeightEventsLR5(events);
    expect(weightScale).toBe(LR5_WEIGHT_SCALES.LB);
    expect(entries).toHaveLength(2);
    expect(entries[0].kg).toBeCloseTo(9.4 / 2.2046226218, 5);
  });

  it("infers grams when that's the only plausible interpretation", () => {
    // 4200 g = 4.2 kg plausible; as lb (4200 lb) or lb/100 (42 lb) implausible.
    const events = [petVisit(4200, "2026-04-01T00:00:00Z"), petVisit(4300, "2026-04-02T00:00:00Z")];
    const { entries, weightScale } = parseWeightEventsLR5(events);
    expect(weightScale).toBe(LR5_WEIGHT_SCALES.GRAMS);
    expect(entries).toHaveLength(2);
    expect(entries[0].kg).toBeCloseTo(4.2, 5);
  });

  it("imports nothing when the batch is ambiguous (multiple interpretations plausible)", () => {
    // 3000: as lb/100 => 30/2.2046 ≈ 13.6 kg (plausible); as grams => 3.0 kg (also plausible).
    // Two interpretations clear the plausibility bar, so the batch is genuinely ambiguous —
    // fail empty rather than risk a silently wrong scale.
    const ambiguous = [petVisit(3000, "2026-05-01T00:00:00Z"), petVisit(3050, "2026-05-02T00:00:00Z")];
    const { entries, weightScale } = parseWeightEventsLR5(ambiguous);
    expect(entries).toHaveLength(0);
    expect(weightScale).toBeNull();
  });

  it("imports nothing when no interpretation is plausible", () => {
    const events = [petVisit(1, "2026-06-01T00:00:00Z")]; // /100→~0kg, as lb→0.45kg, as g→0.001kg — none plausible
    const { entries, weightScale } = parseWeightEventsLR5(events);
    expect(entries).toHaveLength(0);
    expect(weightScale).toBeNull();
  });

  it("filters out non-PET_VISIT event types", () => {
    const events = [
      petVisit(937, "2026-02-14T23:12:12Z", "DRAWER_FULL"),
      petVisit(937, "2026-02-15T00:00:00Z"),
    ];
    const { entries } = parseWeightEventsLR5(events);
    expect(entries).toHaveLength(1);
  });

  it("preserves multiple readings on the same day, oldest first", () => {
    const events = [
      petVisit(920, "2026-07-01T20:00:00Z"),
      petVisit(937, "2026-07-01T08:00:00Z"),
    ];
    const { entries } = parseWeightEventsLR5(events);
    expect(entries).toHaveLength(2);
    expect(entries[0].ts).toBeLessThan(entries[1].ts);
    expect(entries.every((e) => e.date === "2026-07-01")).toBe(true);
  });

  it("is a no-op on an empty or all-invalid batch", () => {
    expect(parseWeightEventsLR5([])).toEqual({ entries: [], weightScale: null });
    expect(parseWeightEventsLR5([petVisit(-5, "2026-01-01T00:00:00Z")])).toEqual({ entries: [], weightScale: null });
    expect(parseWeightEventsLR5([petVisit(937, "not-a-date")])).toEqual({ entries: [], weightScale: null });
  });
});

/* ---------- listAllRobots — merge across generations ---------- */
describe("listAllRobots", () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  const lr4Ok = (robots) => okJson({ data: { getLitterRobot4ByUser: robots } });

  it("merges both generations when both succeed", async () => {
    fetchMock.mockImplementation((url) => {
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(lr4Ok([{ name: "Old", serial: "LR4-1", unitId: "u1", isOnboarded: true }]));
      return Promise.resolve(okJson([{ name: "New", serial: "LR5-1" }]));
    });
    const robots = await listAllRobots("id-token", "user-1");
    expect(robots).toEqual(expect.arrayContaining([
      { name: "Old", serial: "LR4-1", unitId: "u1", model: "LR4" },
      { name: "New", serial: "LR5-1", model: "LR5" },
    ]));
    expect(robots).toHaveLength(2);
  });

  it("returns just the LR5s when the account has no LR4 (LR4 side comes back empty/errors)", async () => {
    fetchMock.mockImplementation((url) => {
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(lr4Ok([]));
      return Promise.resolve(okJson([{ name: "New", serial: "LR5-1" }]));
    });
    const robots = await listAllRobots("id-token", "user-1");
    expect(robots).toEqual([{ name: "New", serial: "LR5-1", model: "LR5" }]);
  });

  it("returns just the LR4s when the LR5 side fails (e.g. network error)", async () => {
    fetchMock.mockImplementation((url) => {
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(lr4Ok([{ name: "Old", serial: "LR4-1", unitId: "u1", isOnboarded: true }]));
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    const robots = await listAllRobots("id-token", "user-1");
    expect(robots).toEqual([{ name: "Old", serial: "LR4-1", unitId: "u1", model: "LR4" }]);
  });

  it("only throws when BOTH generations fail, preferring a specific error over a bare no_robots", async () => {
    fetchMock.mockImplementation((url) => {
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve({ ok: false, status: 401, json: async () => ({ errors: [{ message: "Unauthorized" }] }) });
      return Promise.resolve(okJson([]));
    });
    await expect(listAllRobots("id-token", "user-1")).rejects.toMatchObject({ code: "auth" });
  });

  it("throws a bare no_robots error when both generations are genuinely empty", async () => {
    fetchMock.mockImplementation((url) => {
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(lr4Ok([]));
      return Promise.resolve(okJson([]));
    });
    await expect(listAllRobots("id-token", "user-1")).rejects.toMatchObject({ code: "no_robots" });
  });
});

/* ---------- listPets — pet-profile GraphQL (all-robots + per-pet attribution) ---------- */
// Endpoint, query document, and field list are copied from natekspencer/pylitterbot's
// pet.py (main, fetched directly for this feature) — PET_PROFILE_ENDPOINT,
// Pet.query_by_user's `getPetsByUser($userId: String!)`. Auth is the same Bearer id token as
// every other call in this file (pylitterbot's session.py get_bearer_authorization confirms it).
describe("listPets", () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

  it("POSTs GetPetsByUser to the pet-profile endpoint (not the LR4/LR5 hosts) with a Bearer token and userId variable", async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      data: { getPetsByUser: [{ petId: "PET-1", name: "Mithril", weight: 9.4 }] },
    }));
    const pets = await listPets("id-token", "user-1");
    expect(pets).toEqual([{ petId: "PET-1", name: "Mithril" }]);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(PET_PROFILE_ENDPOINT);
    expect(url).not.toBe(GRAPHQL_ENDPOINT);
    expect(opts.headers.Authorization).toBe("Bearer id-token");
    const body = JSON.parse(opts.body);
    expect(body.query).toMatch(/getPetsByUser/);
    expect(body.query).toMatch(/GetPetsByUser\(\$userId: String!\)/);
    expect(body.variables).toEqual({ userId: "user-1" });
  });

  it("returns an empty list (not an error) when the account has no pet profiles set up", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: { getPetsByUser: [] } }));
    expect(await listPets("id-token", "user-1")).toEqual([]);
  });

  it("falls back to a generic name when a pet profile has none", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: { getPetsByUser: [{ petId: "PET-2", name: null }] } }));
    expect(await listPets("id-token", "user-1")).toEqual([{ petId: "PET-2", name: "Pet" }]);
  });

  it("surfaces a 401 as an 'auth'-coded error, same as the other GraphQL calls", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ errors: [{ message: "Unauthorized" }] }) });
    await expect(listPets("id-token", "user-1")).rejects.toMatchObject({ code: "auth" });
  });
});

/* ---------- parseWeightEventsLR5 — petId passthrough (per-pet attribution) ---------- */
describe("parseWeightEventsLR5 petId passthrough", () => {
  const petVisit = (petWeight, iso, petIds) => ({ messageId: `m-${iso}`, type: "PET_VISIT", timestamp: iso, petWeight, petIds });

  it("passes through a single petIds entry as petId", () => {
    const events = [petVisit(937, "2026-02-14T23:12:12Z", ["PET-1"]), petVisit(920, "2026-02-15T10:00:00Z", ["PET-1"])];
    const { entries } = parseWeightEventsLR5(events);
    expect(entries.every((e) => e.petId === "PET-1")).toBe(true);
  });

  it("maps a multi-id event (ambiguous attribution) to petId: null", () => {
    const events = [petVisit(937, "2026-02-14T23:12:12Z", ["PET-1", "PET-2"]), petVisit(920, "2026-02-15T10:00:00Z", ["PET-1"])];
    const { entries } = parseWeightEventsLR5(events);
    expect(entries.find((e) => e.ts === Date.parse("2026-02-14T23:12:12Z")).petId).toBeNull();
    expect(entries.find((e) => e.ts === Date.parse("2026-02-15T10:00:00Z")).petId).toBe("PET-1");
  });

  it("maps a missing/empty petIds to petId: null", () => {
    const noField = petVisit(937, "2026-02-14T23:12:12Z", undefined);
    const emptyArr = petVisit(920, "2026-02-15T10:00:00Z", []);
    const { entries } = parseWeightEventsLR5([noField, emptyArr]);
    expect(entries.every((e) => e.petId === null)).toBe(true);
  });
});

/* ---------- routeEntry — routing matrix (mapped/unmapped pet, robot fallback, skip) ---------- */
describe("routeEntry", () => {
  it("routes a petId-bearing entry to petMap's cat when mapped", () => {
    expect(routeEntry({ petId: "PET-1" }, { serial: "LR5-1", petMap: { "PET-1": "cat-a" }, robotMap: {} })).toBe("cat-a");
  });
  it("skips a petId-bearing entry whose pet isn't in petMap at all (unmapped)", () => {
    expect(routeEntry({ petId: "PET-1" }, { serial: "LR5-1", petMap: {}, robotMap: { "LR5-1": "cat-a" } })).toBeNull();
  });
  it("skips a petId-bearing entry explicitly mapped to null (\"don't import\")", () => {
    expect(routeEntry({ petId: "PET-1" }, { serial: "LR5-1", petMap: { "PET-1": null }, robotMap: { "LR5-1": "cat-a" } })).toBeNull();
  });
  it("falls back to robotMap when the entry has no petId (LR4, or an unattributable LR5 visit)", () => {
    expect(routeEntry({ petId: null }, { serial: "LR4-1", petMap: {}, robotMap: { "LR4-1": "cat-b" } })).toBe("cat-b");
  });
  it("skips a petId-less entry when its robot isn't in robotMap either", () => {
    expect(routeEntry({ petId: null }, { serial: "LR4-1", petMap: {}, robotMap: {} })).toBeNull();
  });
  it("skips a petId-less entry whose robot is explicitly mapped to null", () => {
    expect(routeEntry({ petId: null }, { serial: "LR4-1", petMap: {}, robotMap: { "LR4-1": null } })).toBeNull();
  });
});

/* ---------- syncAllWeights — multi-robot orchestration, per-cat dedupe, sync summary ---------- */
describe("syncAllWeights", () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fakeIdToken = (claims) => `${b64url({ alg: "none" })}.${b64url(claims)}.sig`;
  const idToken = fakeIdToken({ mid: "user-1" });
  const authOk = () => okJson({ AuthenticationResult: { IdToken: idToken, AccessToken: "at" } });

  const lr4Activity = (lb, iso) => okJson({ data: { getLitterRobot4Activity: [{ measure: "activity", value: "catWeight", actionValue: String(lb), timestamp: iso }] } });
  const lr5Activity = (petWeight, iso, petIds) => okJson([{ type: "PET_VISIT", timestamp: iso, petWeight, petIds }]);

  it("routes events from multiple robots to different cats, skips unmapped, and dedupes per cat", async () => {
    const sinceMs = Date.parse("2026-01-01T00:00:00Z");
    fetchMock.mockImplementation((url) => {
      if (/cognito-idp/.test(url)) return Promise.resolve(authOk());
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(lr4Activity(9.4, "2026-02-01T00:00:00Z"));
      if (url === PET_PROFILE_ENDPOINT) return Promise.resolve(okJson({ data: { getPetsByUser: [] } }));
      if (/LR5-1\/activities/.test(url)) return Promise.resolve(lr5Activity(937, "2026-02-02T00:00:00Z", ["PET-1"])); // mapped -> cat-pet
      if (/LR5-2\/activities/.test(url)) return Promise.resolve(lr5Activity(937, "2026-02-03T00:00:00Z", ["PET-unmapped"])); // unmapped -> skip
      return Promise.resolve(okJson([]));
    });

    const result = await syncAllWeights({
      refreshToken: "rt-1",
      robots: [{ serial: "LR4-1", model: "LR4" }, { serial: "LR5-1", model: "LR5" }, { serial: "LR5-2", model: "LR5" }],
      sinceMs,
      petMap: { "PET-1": "cat-pet" },
      robotMap: { "LR4-1": "cat-robot" },
      existingEntriesByCat: {},
    });

    expect(Object.keys(result.byCat).sort()).toEqual(["cat-pet", "cat-robot"]);
    expect(result.byCat["cat-robot"]).toHaveLength(1); // LR4 -> robotMap
    expect(result.byCat["cat-pet"]).toHaveLength(1); // LR5-1's mapped pet
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1); // LR5-2's unmapped pet
  });

  it("dedupes against the TARGET cat's own existing entries, per cat (not globally)", async () => {
    const sinceMs = Date.parse("2026-01-01T00:00:00Z");
    const iso = "2026-02-01T00:00:00Z";
    fetchMock.mockImplementation((url) => {
      if (/cognito-idp/.test(url)) return Promise.resolve(authOk());
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(lr4Activity(9.4, iso));
      if (url === PET_PROFILE_ENDPOINT) return Promise.resolve(okJson({ data: { getPetsByUser: [] } }));
      return Promise.resolve(okJson([]));
    });
    const parsed = parseWeightEvents([{ measure: "activity", value: "catWeight", actionValue: "9.4", timestamp: iso }]);
    const result = await syncAllWeights({
      refreshToken: "rt-1",
      robots: [{ serial: "LR4-1", model: "LR4" }],
      sinceMs,
      petMap: {},
      robotMap: { "LR4-1": "cat-a" },
      existingEntriesByCat: { "cat-a": [{ ts: parsed[0].ts, kg: parsed[0].kg, source: "litter-robot" }] },
    });
    expect(result.byCat["cat-a"]).toBeUndefined(); // already logged for this cat -> deduped away
    expect(result.imported).toBe(0);
  });

  it("refreshes the pets list from the pet-profile endpoint and returns it", async () => {
    fetchMock.mockImplementation((url) => {
      if (/cognito-idp/.test(url)) return Promise.resolve(authOk());
      if (url === PET_PROFILE_ENDPOINT) return Promise.resolve(okJson({ data: { getPetsByUser: [{ petId: "PET-1", name: "Mithril" }] } }));
      return Promise.resolve(okJson([]));
    });
    const result = await syncAllWeights({ refreshToken: "rt-1", robots: [], sinceMs: 0, existingEntriesByCat: {} });
    expect(result.pets).toEqual([{ petId: "PET-1", name: "Mithril" }]);
  });

  it("tolerates a pet-profile fetch failure — weight sync still completes with an empty pets list", async () => {
    fetchMock.mockImplementation((url) => {
      if (/cognito-idp/.test(url)) return Promise.resolve(authOk());
      if (url === PET_PROFILE_ENDPOINT) return Promise.reject(new TypeError("Failed to fetch"));
      if (url === GRAPHQL_ENDPOINT) return Promise.resolve(okJson({ data: { getLitterRobot4Activity: [] } }));
      return Promise.resolve(okJson([]));
    });
    const result = await syncAllWeights({
      refreshToken: "rt-1", robots: [{ serial: "LR4-1", model: "LR4" }], sinceMs: 0,
      robotMap: { "LR4-1": "cat-a" }, existingEntriesByCat: {},
    });
    expect(result.pets).toEqual([]);
    expect(result.imported).toBe(0);
  });
});

/* ---------- migrateConnection — old (one-robot-one-cat) -> new (all-robots + petMap) ---------- */
describe("migrateConnection", () => {
  it("passes null (disconnected) through unchanged", () => {
    expect(migrateConnection(null)).toBeNull();
  });

  it("passes an already-v2 connection (has a robots array) through unchanged", () => {
    const v2 = { refreshToken: "rt", robots: [{ serial: "LR4-1", model: "LR4", name: "Living Room" }], pets: [], petMap: {}, robotMap: {} };
    expect(migrateConnection(v2)).toBe(v2); // same reference — true no-op
  });

  it("migrates an old single-robot connection into robots[]/robotMap, leaving petMap empty", () => {
    const old = { refreshToken: "rt-1", serial: "LR4-123", model: "LR4", catId: "cat-a", lastSyncTs: 1700000000000, weightScale: null };
    const migrated = migrateConnection(old);
    expect(migrated).toEqual({
      refreshToken: "rt-1",
      lastSyncTs: 1700000000000,
      weightScale: null,
      robots: [{ serial: "LR4-123", model: "LR4", name: null }],
      pets: [],
      petMap: {},
      robotMap: { "LR4-123": "cat-a" },
    });
  });

  it("defaults model to LR4 and lastSyncTs/weightScale to null when the old shape omits them", () => {
    const migrated = migrateConnection({ refreshToken: "rt-1", serial: "LR4-123", catId: "cat-a" });
    expect(migrated.robots).toEqual([{ serial: "LR4-123", model: "LR4", name: null }]);
    expect(migrated.lastSyncTs).toBeNull();
    expect(migrated.weightScale).toBeNull();
  });

  it("tolerates an old shape with no catId yet (never finished a target-cat pick)", () => {
    const migrated = migrateConnection({ refreshToken: "rt-1", serial: "LR4-123" });
    expect(migrated.robotMap).toEqual({ "LR4-123": null });
  });
});
