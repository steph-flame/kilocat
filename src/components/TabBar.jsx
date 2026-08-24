import { A, TYPE } from "../almanac.js";

// The Almanac bottom tab bar — the app's primary navigation. Each route (and its aliases) maps to
// the tab that owns it, so the calorie plan highlights "Ration", the classic pages highlight their
// redesign equivalent, etc. Today is the landing/overview home (measured burn, target, trend
// snapshot, quick links); Log is the daily logging screen it links into.
const TABS = [
  { key: "today", label: "Today", href: "#/today" },
  { key: "log", label: "Log", href: "#/log" },
  { key: "ration", label: "Ration", href: "#/ration" },
  { key: "fridge", label: "Cans", href: "#/fridge" },
  { key: "trend", label: "Trend", href: "#/trend" },
  { key: "more", label: "More", href: "#/settings" },
];

// route (from the hash) → which tab owns it.
const OWNER = {
  today: "today", home: "today",
  log: "log",
  ration: "ration", bowl: "ration", calories: "ration", intent: "ration", "ration-classic": "ration",
  fridge: "fridge",
  cans: "fridge",
  trend: "trend", expenditure: "trend", "expenditure-classic": "trend",
  settings: "more", cats: "more",
};

// Shared with the desktop Sidebar so both nav surfaces highlight consistently.
export const tabForRoute = (route) => OWNER[route] || "today";
export const NAV_TABS = TABS;

export default function TabBar({ route }) {
  const active = OWNER[route] || "today";
  return (
    <nav aria-label="Sections" style={{ flex: "none", background: A.tabBar, borderTop: `1px solid ${A.tabBorder}`, padding: "10px 12px calc(10px + env(safe-area-inset-bottom, 8px))", display: "flex" }}>
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <a key={t.key} href={t.href} aria-current={on ? "page" : undefined}
            style={{ flex: 1, textAlign: "center", fontFamily: TYPE.sans, fontSize: 11, fontWeight: on ? 600 : 400, color: on ? A.tabActive : A.tabInactive, textDecoration: "none", padding: "3px 0" }}>
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
