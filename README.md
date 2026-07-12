# Cat Ration Calculator

Work out **how much to feed a cat**, two ways: a vet-formula energy target, or the
cat's *measured* maintenance back-calculated from its weight trend and intake — plus
a food split into gram portions and a transition schedule. It shows its work — every
number traces back to a formula or a logged data point.

Built for one cat originally, but the model is general. A home screen routes to two
tools that share one profile, food library, and history.

## What it does

**Ration planner**
- **Target energy** from resting energy requirement (RER) × a life-stage feline
  factor (MER), with goals that adapt to age: support growth, gentle trim, active
  loss, maintain, gain, or a custom target you slide between the presets.
- **Body condition** entered as % over/under ideal or a 1–9 BCS score (kept in sync).
- **The ration** — split the daily calories across any number of foods (dry by
  kcal/kg, wet by kcal/can). Grams, cans, and cups fall out automatically, plus a
  fridge-life warning when a can outlasts the days an opened can keeps.
- **Saved foods with search** — every food you enter is remembered and offered by
  name the next time you add one. Fully editable, seeded with verified starters.
- **Transition planner** — an even ramp from your current blend to the new ration
  over N days, in grams or kcal, holding total energy constant.
- **Energy basis toggle** — drive the target from the vet formula *or* the measured
  expenditure (below).

**Energy expenditure** (adaptive, "MacroFactor for cats")
- Log body weight (many weigh-ins/day are median-averaged, tagged by measurement
  method) and what you dispensed; the app **back-calculates the real maintenance
  requirement** from energy balance, with a **confidence band** that tightens as data
  builds and a vet-formula fallback until there's enough.
- Three selectable estimators: **v1** EWMA + regression, **v2** a Kalman filter
  (precision-weighted by weigh-in method, with a real confidence band), and **v3**
  (default) an unobserved-components model that separates gut-fill/hydration transients
  from genuine expenditure change — ~2× less day-to-day jitter than v2.
- **Safe weight-loss plan** — a *calorie* deficit off maintenance, sized to a vet-safe
  rate (0.5–2%/week, default 1%), with a nutritional floor, an honest projected rate,
  and a weeks-to-ideal estimate. Disabled for kittens (growth confounds the balance).
- **Timeline** — weight and energy (calories in vs. estimated expenditure, with its
  confidence band) on two x-aligned panels over a selectable range (1W–1Y), with a
  hover crosshair. The intake-below-expenditure gap visibly drives the weight trend.
- Intake log **grouped by day** with per-day totals.

- Everything **saves automatically** on your device (localStorage).

> A planning aid, not veterinary advice. Re-weigh every 3–4 weeks and adjust.

## The science

- `RER = 70 × kg^0.75` (ACVN-endorsed).
- `MER = feline factor × RER`: neutered adult 1.2, intact 1.4, inactive 1.0, weight
  loss 0.8–1.0 (at target weight), gain ~1.6, kitten peak 2.5 tapering to the adult
  factor by 12 months.
- Note: `vetcalculators.com` lists 1.6 / 1.8 for neutered / intact — those are
  **canine** factors and overestimate for a cat.

**Adaptive expenditure** (the energy-expenditure tool):
- Energy balance: `expenditure ≈ mean intake − ρ × (rate of weight change)`, over a
  trailing window, where `ρ ≈ 8000 kcal/kg` (a cat in weight management loses mostly
  fat, so this skews above the human ~7700 blended figure). Log *dispensed* grams — a
  steady grazing-leftover fraction cancels, since the estimate calibrates dispensed
  calories against the weight response. This mirrors the described behaviour of
  [MacroFactor's expenditure algorithm](https://macrofactor.com/expenditure-v3/)
  (a recursive prediction-error estimator). Three transparent estimators share one
  interface: **v1** EWMA + OLS rate; **v2** a 2-state Kalman filter `[W, E]` with a
  real confidence band and per-method precision weighting; **v3** (default) a 3-state
  unobserved-components model `[W, E, T]` that adds a mean-reverting transient `T` for
  gut-fill/hydration, so a bump gets attributed to `T` (which decays) rather than to
  expenditure. v3 was prototyped and tuned in Python (`research/`) — where it showed
  ~2× lower estimate jitter than v2 under transients without being worse on clean data
  — then ported to JS with the same synthetic-data tests as a cross-language contract.
- Safe loss rate **0.5–2%/week** for cats (conservative — cats are prone to hepatic
  lipidosis if slimmed too fast); starting/floor intake ~`0.8 × RER(ideal)`.

Check the numbers yourself against the primary sources:

- [2021 AAHA Nutrition and Weight Management Guidelines — resource center](https://www.aaha.org/resources/2021-aaha-nutrition-and-weight-management-guidelines/resource-center/)
  ("How to Calculate Energy Requirements" and the BCS ↔ overweight-% chart).
- [Pet Nutrition Alliance — Calorie Calculator](https://petnutritionalliance.org/resources/calorie-calculator)
  (the MER factor table this tool mirrors).
- [AAHA — helping a cat lose weight](https://www.aaha.org/resources/feline-fitness-how-to-help-your-cat-lose-weight/)
  and [APOP weight-loss guidance](https://www.petobesityprevention.org/weight-loss-cats)
  (safe rate + hepatic lipidosis risk).

The energy factors are all editable in the app under "energy factors."

## Architecture

Storage and semantics are kept in separate modules that never import each other:

```
src/
  lib/            pure logic — no React, no I/O (so it's all unit-tested)
    nutrition.js    energy model — RER, MER, BCS↔%, life-stage goals, targets
    foods.js        food math (splits, transitions, energy density) + library
    series.js       generic time-series math (median, daily-reduce, group-by-day, ewma, linreg)
    mat.js          small dense linear algebra (for the Kalman / state-space filters)
    expenditure.js  adaptive back-calc of maintenance (v1 EWMA, v2 Kalman, v3 UC)
    weightPlan.js   safe-deficit prescription (rate → calorie target, floor, timeline)
    scale.js        chart scale math (extent, nice ticks, linear scale)
    timeline.js     assembles the weight/intake/expenditure frame + range clipping
    storage.js      persistence only — one JSON blob in localStorage
    util.js         tiny shared number/id helpers
  state/
    AppState.jsx    one provider owning all persisted state + derived values
  hooks/
    useFoodList.js     an editable food list (the ration, the start blend)
    useFoodLibrary.js  the saved-food library: auto-save, edit, search
    useLog.js          generic dated-entry log (weight log, intake log)
    useHashRoute.js    dependency-free hash router (GitHub-Pages-safe)
  pages/
    Home.jsx        landing → the two tools
    RationPlanner.jsx / Expenditure.jsx   UI only, read shared state via useApp()
  components/       RationRow, FoodSearch, SavedFoods, TimelineChart, primitives
  App.jsx           provider + router shell
  theme.js          palette
research/
  v3_expenditure.py Python prototype that validated & tuned the v3 model before porting
```

Layers never cross the wrong way: `storage.js` knows nothing about cats; the `lib/`
logic knows nothing about React; pages are pure views over `AppState`. `storage.js`
exposes an async `{ load, save, clear }` interface, so swapping localStorage for a
backend (fetch, IndexedDB, a sync service) is a one-file change — and the same seam
is where a Litter-Robot / smart-feeder weight feed would land.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the built output
npm test           # run the unit suite once (vitest)
npm run test:watch # re-run on change
```

Stack: React 18, Vite, Tailwind CSS, lucide-react, Vitest.

### Tests

Every `lib/` module is pure, so the claims the app makes are pinned by assertions
rather than re-verified by hand (`src/lib/*.test.js`, ~75 cases), including:

- maintenance always uses the adult factor, never the kitten growth factor;
- the growth factor tapers from 2.5 (≤4 mo) to the adult factor (12 mo);
- BCS ↔ % round-trips for every integer score;
- `distribute` returns integers that sum exactly to the target;
- `waterfall` keeps a split at 100% — including dragging the last row;
- a transition day's kcal column sums to the target at every blend fraction;
- all three estimators recover a known maintenance value (v1 loss/gain/stable; v2 & v3
  from a wrong prior, through gut-fill transients and sensor noise);
- v2 tightens its confidence band with data, weights looser weigh-in methods less, and
  rejects a spurious spike; v3 wobbles less than v2 on the same noisy data;
- `planWeightLoss` sizes the deficit to the chosen rate, clamps to 0.5–2%/week, holds
  a nutritional floor, and reports the *actual* rate it delivers when floored.

> The two `npm audit` advisories are in Vite's dev-server dependency (esbuild) and
> affect only the local dev server, not the production build. Upgrading requires a
> breaking Vite major; left as-is intentionally.

## Deploy

The build is a static site (`dist/`) — host it anywhere. For GitHub Pages under a
project path, build with the repo name as base:

```bash
VITE_BASE="/cat_ration_calculator/" npm run build
```

## License

MIT — see [LICENSE](LICENSE).
