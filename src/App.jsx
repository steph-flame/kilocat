import { C } from "./theme.js";
import { AppProvider, useApp } from "./state/AppState.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import Home from "./pages/Home.jsx";
import RationPlanner from "./pages/RationPlanner.jsx";
import Expenditure from "./pages/Expenditure.jsx";
import Log from "./pages/Log.jsx";

const PAGES = { home: Home, ration: RationPlanner, expenditure: Expenditure, log: Log };

function Router() {
  const { loaded } = useApp();
  const route = useHashRoute("home");
  if (!loaded) return <div style={{ background: C.paper, minHeight: "100%" }} className="w-full" />;
  const Page = PAGES[route] || Home;
  return <Page />;
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
