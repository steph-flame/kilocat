import { A, TYPE } from "../almanac.js";

// The Almanac bottom tab bar — the app's primary navigation. Five destinations; each route (and
// its aliases) maps to the tab that owns it, so the calorie plan highlights "Ration", the classic
// pages highlight their redesign equivalent, etc.
const TABS = [
  { key: "today", label: "Today", href: "#/today" },
  { key: "ration", label: "Ration", href: "#/ration" },
  { key: "trend", label: "Trend", href: "#/trend" },
  { key: "log", label: "Log", href: "#/log" },
  { key: "more", label: "More", href: "#/settings" },
];

// route (from the hash) → which tab owns it.
const OWNER = {
  today: "today", home: "today",
  ration: "ration", bowl: "ration", calories: "ration", intent: "ration", "ration-classic": "ration",
  trend: "trend", expenditure: "trend", "expenditure-classic": "trend",
  log: "log",
  settings: "more", cats: "more",
};

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
