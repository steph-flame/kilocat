import { useState } from "react";
import { X } from "lucide-react";
import { A, TYPE } from "./almanac.js";
import { AppProvider, useApp } from "./state/AppState.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { platformInstallHint, isStandalone, isBannerDismissed, dismissBanner } from "./lib/pwa.js";
import { DEMO_CAT_ID } from "./lib/demoCat.js";
import TabBar from "./components/TabBar.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Intent from "./pages/Intent.jsx";
import Bowl from "./pages/Bowl.jsx";
import RationPlanner from "./pages/RationPlanner.jsx";
import Expenditure from "./pages/Expenditure.jsx";
import Trend from "./pages/Trend.jsx";
import Log from "./pages/Log.jsx";
import LogPage from "./pages/LogPage.jsx";
import TodayPage from "./pages/TodayPage.jsx";
import FridgePage from "./pages/FridgePage.jsx";
import Cats from "./pages/Cats.jsx";
import Settings from "./pages/Settings.jsx";
import MorePage from "./pages/MorePage.jsx";
import CatsPage from "./pages/CatsPage.jsx";

// Redesign migration: two INDEPENDENT pages, not a wizard. #/calories is the calorie plan (basis +
// rate → target); #/ration is the ration plan (split the target across foods). Each cross-links to
// the other but neither forces you through it. The classic planner remains at #/ration-classic as a
// reference only — its transition schedule now lives in the new Ration (Bowl). (#/intent and #/bowl
// kept as aliases.)
const PAGES = {
  home: TodayPage, today: TodayPage, calories: Intent, intent: Intent, ration: Bowl, bowl: Bowl, fridge: FridgePage, cans: FridgePage,
  "ration-classic": RationPlanner, trend: Trend, expenditure: Trend, "expenditure-classic": Expenditure, log: LogPage, "log-classic": Log, cats: CatsPage, "cats-classic": Cats, settings: MorePage, "settings-classic": Settings,
};

// Compact app-shell header: a settings link, plus the cat switcher — dense to match the rest
// of the chrome (banners, nav rows). Always shown, even with one cat: "+ add a cat" needs to
// be reachable from here regardless of cat count.
// Almanac top bar: just the active cat, a tap away from switching. Settings moved to the More tab,
// so there's nothing else to carry up here.
function Header({ catsSummary, activeCatId, switchCat, addCat }) {
  const [open, setOpen] = useState(false);
  const active = catsSummary.find((c) => c.id === activeCatId);
  const multi = catsSummary.length > 1;
  return (
    <div style={{ background: A.pageFill, borderBottom: `1px solid ${A.tabBorder}`, padding: "8px 20px", position: "relative", display: "flex", alignItems: "center" }}>
      <button onClick={() => multi ? setOpen((o) => !o) : (window.location.hash = "#/cats")}
        style={{ fontFamily: TYPE.mono, fontSize: 12, fontWeight: 600, color: A.good, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        {active?.name || "your cat"}{multi ? " ▾" : ""}
      </button>
      {open && multi && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ position: "absolute", top: "100%", left: 14, zIndex: 60, marginTop: 2, background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: 5, minWidth: 170, boxShadow: "0 8px 24px rgba(25,28,18,.10)" }}>
            {catsSummary.map((c) => (
              <button key={c.id} onClick={() => { switchCat(c.id); setOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8, fontFamily: TYPE.sans, fontSize: 13, color: A.ink, background: c.id === activeCatId ? A.track : "transparent", border: "none", cursor: "pointer" }}>
                {c.name || "unnamed"}{c.demo ? " · demo" : ""}
              </button>
            ))}
            <button onClick={() => { addCat(); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8, fontFamily: TYPE.sans, fontSize: 13, color: A.good, background: "none", border: "none", cursor: "pointer" }}>+ add a cat</button>
          </div>
        </>
      )}
    </div>
  );
}

function Banner({ children, tone, onClose }) {
  const c = tone === "warn" ? A.caution : { bg: "#E6EFE6", text: A.good };
  return (
    <div style={{ background: c.bg, color: c.text, fontFamily: TYPE.sans, fontSize: 12.5 }}>
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "8px 20px", display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.4 }}>
        <span style={{ flex: 1 }}>{children}</span>
        {onClose && <button onClick={onClose} aria-label="Dismiss" style={{ color: c.text, background: "none", border: "none", cursor: "pointer", flex: "none", marginTop: 1 }}><X size={14} /></button>}
      </div>
    </div>
  );
}

// iOS Safari or desktop Safari (both hit the same 7-day ITP eviction), not installed, not
// already dismissed — computed once per mount, same as storageOk above, since none of these
// change during a session. Chromium/other browsers surface their own install affordance and
// don't evict at 7 days, so they get no banner.
const installNudgePlatform = () => {
  if (typeof navigator === "undefined" || isStandalone() || isBannerDismissed()) return null;
  const hint = platformInstallHint(navigator.userAgent, navigator.maxTouchPoints);
  return hint === "ios" || hint === "macSafari" ? hint : null;
};

const INSTALL_NUDGE_COPY = {
  ios: "Add to Home Screen to keep your data safe — iOS clears browser data for sites unused 7 days.",
  macSafari: "Add to Dock (File menu) to keep your data safe — Safari clears data for sites unused 7 days.",
};

function Router() {
  const { loaded, storageOk, catsSummary, activeCatId, switchCat, addCat } = useApp();
  const route = useHashRoute("home");
  const [demoBannerClosed, setDemoBannerClosed] = useState(false);
  const [installNudgeClosed, setInstallNudgeClosed] = useState(false);
  if (!loaded) return <div style={{ background: A.pageFill, minHeight: "100%" }} />;
  const Page = PAGES[route] || LogPage;
  const installPlatform = installNudgePlatform();
  const isDemo = activeCatId === DEMO_CAT_ID;
  const banners = (
    <>
      {!storageOk && (
        <Banner tone="warn">This browser isn't letting the app save (private mode?). Changes won't persist — use Export in More to keep your data.</Banner>
      )}
      {isDemo && !demoBannerClosed && (
        <Banner onClose={() => setDemoBannerClosed(true)}>You're looking at Biscuit, the demo cat — everything here is sample data. Add your own cat from the cat menu.</Banner>
      )}
      {!installNudgeClosed && installPlatform && (
        <Banner onClose={() => { dismissBanner(); setInstallNudgeClosed(true); }}>
          {INSTALL_NUDGE_COPY[installPlatform]}
        </Banner>
      )}
    </>
  );
  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* desktop: left nav rail (>=768px) */}
      <div className="hidden md:flex">
        <Sidebar route={route} catsSummary={catsSummary} activeCatId={activeCatId} switchCat={switchCat} addCat={addCat} />
      </div>
      {/* main column */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* mobile: top cat bar (desktop puts the cat in the sidebar) */}
        <div className="flex-none md:hidden">
          <Header catsSummary={catsSummary} activeCatId={activeCatId} switchCat={switchCat} addCat={addCat} />
        </div>
        <div className="flex-none">{banners}</div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Page />
        </div>
        {/* mobile: bottom tab bar */}
        <div className="md:hidden">
          <TabBar route={route} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
