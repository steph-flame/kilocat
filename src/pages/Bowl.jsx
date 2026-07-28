import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { distributeBowl } from "../lib/bowl.js";
import { foodType, kcalPerG, libEntry, rationMacroProfile, aafcoCheck } from "../lib/foods.js";
import FoodSearch from "../components/FoodSearch.jsx";

// Ration — Step 2 of 2: The bowl. Split the Intent target across N foods, each fixed / share /
// remainder. One basis for everything: % of the full target (see lib/bowl.js).

const r0 = (n) => Math.round(n);
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const MODES = [["fixed", "fixed"], ["share", "share"], ["remainder", "rest"]];
const dotColor = (f) => (f.mode === "fixed" ? A.food.treat : foodType(f) === "wet" ? A.food.wet : A.food.dry);

function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

export default function Bowl() {
  const { intent, ration, library, t, tr } = useApp();
  const target = r0(intent.target);
  const dist = distributeBowl(ration.items, target);
  const byId = Object.fromEntries(dist.rows.map((r) => [r.id, r]));

  // exactly one remainder — promoting one demotes any other.
  const setMode = (id, mode) => ration.setItems((fs) => fs.map((f) => {
    if (f.id === id) return { ...f, mode };
    if (mode === "remainder" && f.mode === "remainder") return { ...f, mode: "share" };
    return f;
  }));

  const prof = rationMacroProfile(ration.items);
  const aafco = prof ? aafcoCheck(prof.dryMatter, t.stage) : null;

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        <div style={{ padding: "18px 24px 0" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>Step 2 of 2 · the bowl</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 6px" }}>
            How should {target} kcal be split?
          </h1>
          <p style={{ fontSize: 12.5, color: A.bodyOnFill, margin: "0 0 14px", lineHeight: 1.45 }}>
            Any number of foods. Each takes a <b style={{ fontWeight: 600 }}>share</b>, a <b style={{ fontWeight: 600 }}>fixed amount</b>, or <b style={{ fontWeight: 600 }}>whatever is left</b>.
          </p>
        </div>

        <Card style={{ padding: "4px 16px 14px" }}>
          {ration.items.length === 0 && (
            <p style={{ fontSize: 12, color: A.muted, padding: "14px 0" }}>No foods yet — add one below.</p>
          )}
          {ration.items.map((f, i) => {
            const row = byId[f.id] || { kcal: 0, grams: null, pct: 0 };
            const mode = f.mode || "share";
            const color = dotColor(f);
            return (
              <div key={f.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${A.hairline}`, padding: "12px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: color, flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FoodSearch value={f.name} search={library.search}
                      onChangeName={(v) => ration.setField(f.id, "name", v)}
                      onPick={(food) => ration.patch(f.id, libEntry(food))} />
                  </div>
                  <button onClick={() => ration.remove(f.id)} aria-label="Remove food" style={{ color: A.muted, border: "none", background: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                </div>

                {/* mode selector */}
                <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                  {MODES.map(([m, lbl]) => {
                    const on = mode === m;
                    const c = A.mode[m];
                    return (
                      <button key={m} onClick={() => setMode(f.id, m)} aria-pressed={on}
                        style={{ fontFamily: TYPE.mono, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", borderRadius: 6, padding: "4px 8px",
                          border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? c.bg : "transparent", color: on ? c.text : A.muted, cursor: "pointer" }}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>

                {/* per-mode controls */}
                {mode === "share" && (
                  <>
                    <input type="range" min={0} max={100} step={1} value={r0(f.pct) || 0}
                      onChange={(e) => ration.setField(f.id, "pct", Number(e.target.value))}
                      aria-label={`${f.name || "food"} share`}
                      style={{ width: "100%", marginTop: 8, accentColor: color }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2 }}>
                      <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body }}>{r0(row.pct)}% of {target} · {r0(row.kcal)} kcal</span>
                      <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{row.grams != null ? `${r0(row.grams)} g` : "—"}</span>
                    </div>
                  </>
                )}
                {mode === "fixed" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                    <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body, display: "inline-flex", alignItems: "baseline", gap: 5 }}>
                      taken off the top ·
                      <input type="number" value={f.fixedKcal ?? ""} onChange={(e) => ration.setField(f.id, "fixedKcal", e.target.value === "" ? "" : Number(e.target.value))}
                        aria-label="fixed kcal" style={{ width: 44, fontFamily: TYPE.mono, fontSize: 13, color: A.ink, background: "transparent", border: "none", borderBottom: `1px solid ${A.cardBorder}`, textAlign: "right" }} /> kcal
                    </span>
                    <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{row.grams != null ? `${r0(row.grams)} g` : "—"}</span>
                  </div>
                )}
                {mode === "remainder" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
                    <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.body }}>absorbs what's left · {r0(row.pct)}% · {r0(row.kcal)} kcal</span>
                    <span style={{ fontFamily: TYPE.mono, fontSize: 16, color: A.ink }}>{row.grams != null ? `${r0(row.grams)} g` : "—"}</span>
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={() => ration.add()} style={{ width: "100%", marginTop: 6, border: `1px dashed ${A.cardBorder}`, borderRadius: 12, background: "transparent", color: A.body, fontFamily: TYPE.sans, fontSize: 12.5, padding: "10px 0", cursor: "pointer" }}>
            + Add a food
          </button>

          {/* balance line */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: TYPE.mono, fontSize: 12 }}>
            <span style={{ color: A.muted }}>{dist.hasRemainder ? "wet + dry + rest" : "allocated"}</span>
            {dist.overAllocated ? (
              <span style={{ color: A.danger.bg, fontWeight: 600 }}>{r0(dist.fixedKcal + dist.shareKcal)} / {target} — over by {r0(dist.fixedKcal + dist.shareKcal - target)}</span>
            ) : dist.balances ? (
              <span style={{ color: A.good, fontWeight: 600 }}>{r0(dist.totalKcal)} / {target} kcal ✓</span>
            ) : (
              <span style={{ color: A.body }}>{r0(dist.totalKcal)} / {target} · {r0(dist.unallocated)} left — add a rest food</span>
            )}
          </div>
        </Card>

        {/* folded nutrition detail */}
        {prof && (
          <Card>
            <div style={label()}>This blend delivers</div>
            <div style={{ fontSize: 13, color: A.body, marginTop: 8, lineHeight: 1.5 }}>
              <div><b style={{ color: A.ink }}>{prof.caloric.protein}%</b> protein · <b style={{ color: A.ink }}>{prof.caloric.fat}%</b> fat · <b style={{ color: A.ink }}>{prof.caloric.carb}%</b> carb of calories</div>
              <div style={{ color: A.muted, marginTop: 3 }}>
                Dry-matter protein {r0(prof.dryMatter.protein)}%{aafco && aafco.protein === "below" ? ` · below the AAFCO ${aafco.stage} minimum` : aafco && aafco.protein === "ok" ? " · clears AAFCO" : ""} · {r0(prof.moisture)}% moisture
              </div>
              {prof.coverageKcalPct < 99 && (
                <div style={{ color: A.muted, marginTop: 3 }}>Based on {r0(prof.coverageKcalPct)}% of the blend — add guaranteed-analysis to the rest.</div>
              )}
            </div>
          </Card>
        )}

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 24px 0", gap: 12 }}>
          <a href="#/intent" style={{ fontFamily: TYPE.mono, fontSize: 11.5, color: A.bodyOnFill, textDecoration: "none" }}>‹ Step 1 · intent</a>
          <a href="#/" style={{ background: A.good, color: A.card, fontFamily: TYPE.sans, fontSize: 13, fontWeight: 600, borderRadius: 14, padding: "12px 20px", textDecoration: "none" }}>
            Save this ration
          </a>
        </div>
      </div>
    </div>
  );
}
