# Kilocat Engineering Review & Online Sync Plan

**Audience:** AI coding agent working on Kilocat  
**Prepared:** August 3, 2026  
**Goal:** Preserve Kilocat’s strong local-first architecture while tightening its statistical claims, securing credentials, supporting feeder data, and adding smooth cross-device sync at zero infrastructure cost for current usage.

## Executive recommendation

Kilocat already has the right architectural shape: domain logic is pure, persistence is isolated behind an async interface, and the merge layer already handles multi-device-style convergence semantics. Do not rewrite it around a backend SDK.

The recommended path is:

1. Fix credential export and privacy wording immediately.
2. Add **optional Firebase Authentication + Cloud Firestore sync** while retaining fully functional guest/offline mode.
3. Store append-only observations as individual documents; do not put the full long-term history into one Firestore document.
4. Use Kilocat’s existing `mergeV2` semantics above Firestore’s transport-level synchronization.
5. Add feeder data as raw measurement events, then derive daily dispensed, consumed, and unexplained calories.
6. Reframe the estimator interval as conditional model uncertainty and strengthen empirical validation.

Firebase is the best “free and smooth” fit here because the Spark plan needs no payment information, most Authentication methods are free, Firestore includes generous daily no-cost quotas, and the web SDK supports persistent offline caching. Firestore itself resolves conflicting offline writes to the same document with last-write-wins, so Kilocat should continue to own domain conflict resolution rather than delegating it to the database.

## Prioritized engineering backlog

### P0 — Credential and privacy safety

**Problem:** `persistData` includes the Litter-Robot connection, and `exportData()` serializes `persistData`. The connection contains the Whisker refresh token. A normal backup can therefore become an authentication credential.

**Changes:**

- Add a `toPortableExport(state)` function that strips all secrets and device-local integration state.
- Never sync the Whisker refresh token to Firestore in the first implementation. Keep it device-local; synced weight observations will still become visible on every device.
- Require reconnection after import.
- Update privacy copy to distinguish:
  - data stored locally;
  - data synchronized to the user’s private cloud account after sign-in;
  - credentials sent directly to third-party providers;
  - anonymous page analytics.
- Add regression tests asserting that exported and cloud-synced payloads contain no `refreshToken`, password, provider token, or equivalent credential field.

**Acceptance criteria:** searching an exported JSON file for `token`, `password`, or `secret` produces no provider credential; importing a backup never reconnects an external account.

### P1 — Make uncertainty language match the model

The current interval is useful, but it is conditional on fixed choices such as `rho`, process noise, measurement-noise assumptions, intake treatment, and the state-space specification. It does not represent total uncertainty about real maintenance expenditure.

**Changes:**

- Rename plain “95% confidence” to **“95% model interval”** or **“conditional estimate interval.”**
- Add a concise tooltip: “Reflects measurement noise and model state uncertainty; it does not include all uncertainty in food labels, leftovers, model assumptions, or the energy density of weight change.”
- Keep the interval visually prominent; the fix is calibration of language, not hiding uncertainty.
- Optionally add a sensitivity range computed across plausible `rho` and food-energy-density assumptions.

### P1 — Strengthen estimator validation

Synthetic tests currently establish implementation correctness and behavior under simulated data resembling the estimator. Add tests that can reveal model misspecification.

**Add:**

- Rolling 7-day and 14-day weight forecasts.
- Empirical interval coverage: how often does the later observed weight fall inside the predicted interval?
- Innovation/residual plots and autocorrelation checks.
- Sensitivity sweeps for `qE`, `qT`, `phi`, `rho`, and measurement sigma.
- Adversarial simulations: varying leftovers, scale-method offset, non-Gaussian outliers, abrupt intake changes, missing-not-at-random logging, and slow changes in activity.
- A comparison metric that penalizes both jitter and lag after a known intake step.

Avoid treating “lower jitter” as sufficient evidence of superiority; excessive smoothing can conceal a wrong or delayed estimate.

### P1 — Improve missing-intake handling

A global mean fill is stable but can invent intake values around ration changes.

Use this fallback order:

1. Measured consumption, when available.
2. The feeding-plan target active on that date.
3. Local interpolation between nearby complete days.
4. A missing latent input whose uncertainty explicitly widens the estimate.

Continue distinguishing true zero intake from missing or partially logged intake.

### P1 — Account for systematic scale-method bias

Per-method variance handles random noise, not a stable offset between a pet scale, Litter-Robot, and human-plus-cat subtraction.

Choose one of:

- Estimate a per-device offset during overlapping measurements.
- Segment the series when the primary measurement method changes.
- Require an overlap-calibration period before combining methods.

At minimum, detect a method transition and warn that an apparent weight jump may be instrumental.

## Feeder integration data model

Do not reduce Petlibro events immediately to a daily kcal number. Preserve raw evidence so the feeder can be validated and reprocessed later.

Suggested event shape:

```js
{
  id,                 // stable provider event id or generated UUID
  catId,
  foodId,
  timestamp,
  localDate,
  source,             // manual | petlibro | other
  deviceId,
  type,               // dispense | bowl_weight | consumption | correction | manual_meal
  grams,
  estimatedSdGrams,
  providerPayloadVersion,
  createdAt,
  deletedAt: null
}
```

Derive separate daily series:

- **Dispensed:** what entered the bowl.
- **Consumed:** reduction attributable to eating.
- **Unaccounted:** spills, removal, scale resets, or unexplained deltas.
- **Manual intake:** wet food or treats not measured by the feeder.

During the Granary 2 validation period, compare feeder-reported bowl changes with manual scale measurements and retain video/event references only as optional audit metadata. Do not make camera or cloud-video availability a requirement for nutrition calculations.

## Recommended free cross-device architecture

### Product behavior

- The app remains usable without an account.
- “Sign in to sync” upgrades the current local profile rather than starting an empty account.
- On first sign-in, merge local data into remote data automatically and show a short result summary.
- The app remains writable offline and synchronizes when connectivity returns.
- Display a compact sync state: `Saved locally`, `Syncing`, `Synced`, or `Sync error`.
- On sign-out, offer **Keep data on this device** and **Clear local data**.

### Backend choice: Firebase

Use:

- Firebase Authentication, initially **Google sign-in**. Add email/password later only if there is user demand.
- Cloud Firestore on the Spark plan.
- Firebase Local Emulator Suite for auth, database, and security-rule tests.
- Existing GitHub Pages hosting can remain unchanged.

Why not Supabase as the default: its developer experience and Postgres model are attractive, but free projects can pause after low activity, and production email authentication requires extra SMTP setup. That is a poor fit for a personal utility expected to work after being ignored for a week.

### Firestore layout

Avoid a single permanent `state` document. Firestore documents have a 1 MiB limit, and imported Litter-Robot observations could reach it surprisingly quickly.

```text
users/{uid}/settings/main
users/{uid}/foods/{foodId}
users/{uid}/cats/{catId}
users/{uid}/cats/{catId}/weights/{entryId}
users/{uid}/cats/{catId}/intakes/{entryId}
users/{uid}/cats/{catId}/feederEvents/{eventId}
```

Use soft deletion (`deletedAt`) for observation documents so an offline stale device cannot resurrect deleted data. A periodic local compaction can hide old tombstones without removing the remote deletion record prematurely.

Current mutable bundles such as profile, ration, transition, and estimator settings can stay in the cat document. Append-only observations should be individual documents.

### Sync semantics

- Keep local persistence as an application concern. Prefer IndexedDB as the durable local store once sync work begins; localStorage can remain during the first spike.
- Every record gets `schemaVersion`, `modifiedAtLocal`, `deviceId`, and a deterministic conflict stamp.
- Do not rely only on `Date.now()` for last-write-wins across devices. Add a small hybrid logical clock or `(wallTime, counter, deviceId)` tuple to tolerate clock ties and modest skew.
- Use `mergeV2` when reconciling legacy snapshots and during account adoption.
- For normalized records, use stable document IDs and idempotent upserts.
- Use Firestore server timestamps for diagnostics and auditing, not as the sole domain conflict clock.
- Debounce mutable-state writes; append observation events immediately.
- Hash the last applied canonical state to prevent listener/write echo loops.

### Minimal security rules

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid;
    }
  }
}
```

Add field validation after the schema stabilizes. Test rules in the emulator, including cross-user denial, unauthenticated denial, and valid owner access.

## Suggested implementation sequence

### Milestone 1 — Safety and semantics

- Portable export sanitizer.
- Privacy copy update.
- Interval-label update.
- Tests for secret exclusion.

### Milestone 2 — Sync spike

- Firebase initialization and Google sign-in.
- Guest mode preserved.
- One private test account.
- Local-to-remote adoption using `mergeV2`.
- Sync status UI.
- Emulator-backed security tests.

A temporary snapshot document is acceptable for this spike only. Do not ship it as the permanent log store.

### Milestone 3 — Normalized cloud persistence

- Split cats, foods, weights, and intake into collections.
- Add deterministic record IDs, soft deletion, and conflict stamps.
- Migrate a legacy v2 snapshot on first synchronized login.
- Keep export/import as a portable, provider-independent escape hatch.

### Milestone 4 — Granary 2 ingestion

- Introduce raw feeder events.
- Build derived daily consumed/dispensed/unaccounted series.
- Validate feeder readings against independent measurements.
- Feed measured consumption into the estimator while retaining manual overrides.

### Milestone 5 — Statistical hardening

- Forecast and interval-coverage tests.
- Method-offset handling.
- Improved missing-intake uncertainty.
- Sensitivity analysis in research tooling.

## Non-goals for the first sync release

- No custom backend server.
- No paid cloud functions.
- No automatic sharing between multiple human accounts.
- No cloud storage of third-party refresh tokens.
- No end-to-end encryption unless the product scope expands beyond personal use; it materially complicates password recovery and multi-device onboarding.

## References

1. Kilocat repository and architecture: https://github.com/steph-flame/kilocat
2. Kilocat AppState and export path: https://raw.githubusercontent.com/steph-flame/kilocat/main/src/state/AppState.jsx
3. Firebase pricing plans / Spark: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
4. Firestore free quota and limits: https://firebase.google.com/docs/firestore/quotas
5. Firestore offline persistence: https://firebase.google.com/docs/firestore/manage-data/enable-offline
6. Firebase Authentication for web: https://firebase.google.com/docs/auth/web/start
7. Firestore user-scoped security rules: https://firebase.google.com/docs/firestore/security/rules-conditions
8. Supabase free-project pausing: https://supabase.com/docs/guides/platform/free-project-pausing
9. Supabase SMTP limitations: https://supabase.com/docs/guides/auth/auth-smtp
