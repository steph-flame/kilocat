import { useState } from "react";
import { Info, X, Settings as SettingsIcon } from "lucide-react";
import { C } from "./theme.js";
import { AppProvider, useApp } from "./state/AppState.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { platformInstallHint, isStandalone, isBannerDismissed, dismissBanner } from "./lib/pwa.js";
import CatMenu from "./components/CatMenu.jsx";
import Home from "./pages/Home.jsx";
import RationPlanner from "./pages/RationPlanner.jsx";
import Expenditure from "./pages/Expenditure.jsx";
import Log from "./pages/Log.jsx";
import Settings from "./pages/Settings.jsx";

const PAGES = { home: Home, ration: RationPlanner, expenditure: Expenditure, log: Log, settings: Settings };

// Compact app-shell header: a settings link, plus the cat switcher — dense to match the rest
// of the chrome (banners, nav rows). Always shown, even with one cat: "+ add a cat" needs to
// be reachable from here regardless of cat count.
function Header({ catsSummary, activeCatId, switchCat, addCat }) {
  return (
    <div style={{ borderColor: C.line, background: C.paper }} className="w-full border-b">
      <div className="max-w-xl mx-auto px-4 py-1.5 flex items-center justify-between text-xs font-mono">
        <CatMenu variant="chip" catsSummary={catsSummary} activeCatId={activeCatId} switchCat={switchCat} addCat={addCat} />
        <a href="#/settings" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><SettingsIcon size={12} /> settings</a>
      </div>
    </div>
  );
}

function Banner({ children, tone, onClose }) {
  const bg = tone === "warn" ? C.warnSoft : C.spruceSoft;
  const fg = tone === "warn" ? C.warn : C.spruce;
  return (
    <div style={{ background: bg, color: fg }} className="w-full text-xs">
      <div className="max-w-xl mx-auto px-4 py-2 flex items-start gap-2">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span className="flex-1 leading-snug">{children}</span>
        {onClose && <button onClick={onClose} aria-label="Dismiss" style={{ color: fg }} className="shrink-0"><X size={14} /></button>}
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
  const { loaded, firstRun, storageOk, catsSummary, activeCatId, switchCat, addCat } = useApp();
  const route = useHashRoute("home");
  const [introClosed, setIntroClosed] = useState(false);
  const [installNudgeClosed, setInstallNudgeClosed] = useState(false);
  if (!loaded) return <div style={{ background: C.paper, minHeight: "100%" }} className="w-full" />;
  const Page = PAGES[route] || Home;
  const installPlatform = installNudgePlatform();
  return (
    <>
      <Header catsSummary={catsSummary} activeCatId={activeCatId} switchCat={switchCat} addCat={addCat} />
      {!storageOk && (
        <Banner tone="warn">This browser isn't letting the app save (private mode?). Changes won't persist — use Export in Settings to keep your data.</Banner>
      )}
      {firstRun && !introClosed && (
        <Banner onClose={() => setIntroClosed(true)}>Showing example data (a sample cat). Set the cat's profile in Settings and log a weigh-in on the ration planner to make it yours — or head to Settings to start fresh or add another cat.</Banner>
      )}
      {!installNudgeClosed && installPlatform && (
        <Banner onClose={() => { dismissBanner(); setInstallNudgeClosed(true); }}>
          {INSTALL_NUDGE_COPY[installPlatform]}
        </Banner>
      )}
      <Page />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
