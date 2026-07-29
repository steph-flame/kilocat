import { A, TYPE } from "../almanac.js";
import { NAV_TABS, tabForRoute } from "./TabBar.jsx";

// Desktop navigation rail — shown at >=768px in place of the bottom tab bar (see App.jsx's
// responsive shell). Wordmark, the cat switcher (a plain list at this width), then the same four
// destinations as the tab bar, highlighted the same way.
export default function Sidebar({ route, catsSummary, activeCatId, switchCat, addCat }) {
  const active = tabForRoute(route);
  return (
    <div style={{ width: 232, flex: "none", background: A.tabBar, borderRight: `1px solid ${A.tabBorder}`, padding: "22px 16px", display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ fontFamily: TYPE.serif, fontSize: 21, color: A.ink, letterSpacing: "-.01em", marginBottom: 22, paddingLeft: 4 }}>Kilocat</div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: TYPE.mono, fontSize: 9.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, marginBottom: 6, paddingLeft: 4 }}>Cat</div>
        {catsSummary.map((c) => {
          const on = c.id === activeCatId;
          return (
            <button key={c.id} onClick={() => switchCat(c.id)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 10, marginBottom: 2, fontFamily: TYPE.sans, fontSize: 13, cursor: "pointer", border: "none",
                background: on ? A.ink : "transparent", color: on ? A.card : A.body }}>
              {c.name || "unnamed"}{c.demo ? " · demo" : ""}
            </button>
          );
        })}
        <button onClick={addCat} style={{ padding: "6px 10px", fontFamily: TYPE.sans, fontSize: 12.5, color: A.good, background: "none", border: "none", cursor: "pointer" }}>+ add a cat</button>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_TABS.map((t) => {
          const on = active === t.key;
          return (
            <a key={t.key} href={t.href} aria-current={on ? "page" : undefined}
              style={{ padding: "9px 12px", borderRadius: 10, fontFamily: TYPE.sans, fontSize: 14, fontWeight: on ? 600 : 400, textDecoration: "none",
                background: on ? A.card : "transparent", color: on ? A.ink : A.body, border: on ? `1px solid ${A.cardBorder}` : "1px solid transparent" }}>
              {t.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
