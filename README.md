# Cat Ration Calculator

Work out **how much to feed a cat**: a daily energy target derived from the animal,
grams from a food split you control, and a day-by-day transition schedule for
switching foods. It shows its work — every number traces back to a formula.

Built for one cat originally, but the model is general.

## What it does

- **Target energy** from resting energy requirement (RER) × a life-stage feline
  factor (MER), with goals that adapt to age: support growth, gentle trim, active
  loss, maintain, gain, or a custom target you slide between the presets.
- **Body condition** entered as % over/under ideal or a 1–9 BCS score (kept in sync).
- **The ration** — split the daily calories across any number of foods (dry by
  kcal/kg, wet by kcal/can). Grams, cans, and cups fall out automatically, plus a
  fridge-life warning when a can outlasts the days an opened can keeps.
- **Saved foods with search** — every food you enter is remembered and offered by
  name the next time you add one. The library is fully editable and seeded with a
  few verified starter foods.
- **Transition planner** — an even ramp from your current blend to the new ration
  over N days, in grams or kcal, holding total energy constant.
- Everything **saves automatically** on your device (localStorage).

> A planning aid, not veterinary advice. Re-weigh every 3–4 weeks and adjust.

## The science

- `RER = 70 × kg^0.75` (ACVN-endorsed).
- `MER = feline factor × RER` (AAHA Nutrition Toolkit; Pet Nutrition Alliance):
  neutered adult 1.2, intact 1.4, inactive 1.0, weight loss 0.8–1.0 (at target
  weight), gain ~1.6, kitten peak 2.5 tapering to the adult factor by 12 months.
- Note: `vetcalculators.com` lists 1.6 / 1.8 for neutered / intact — those are
  **canine** factors and overestimate for a cat.

The energy factors are all editable in the app under "energy factors."

## Architecture

Storage and semantics are kept in separate modules that never import each other:

```
src/
  lib/
    nutrition.js   energy model — RER, MER, life-stage goals, targets (pure)
    foods.js       food math (splits, transitions) + the food library (pure)
    storage.js     persistence only — one JSON blob in localStorage
    util.js        tiny shared number/id helpers
  hooks/
    useFoodList.js     an editable food list (the ration, the start blend)
    useFoodLibrary.js  the saved-food library: auto-save, edit, search
  components/
    RationRow.jsx   one food row
    FoodSearch.jsx  the name field + live search over saved foods
    SavedFoods.jsx  view / edit / delete saved foods
    primitives.jsx  shared inputs
  App.jsx           orchestration + layout
  theme.js          palette
```

`storage.js` exposes an async `{ load, save, clear }` interface, so swapping
localStorage for a backend (fetch, IndexedDB, a sync service) is a one-file change.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm run preview  # serve the built output
```

Stack: React 18, Vite, Tailwind CSS, lucide-react.

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
