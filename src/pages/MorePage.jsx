import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { INTAKE_METHODS } from "../lib/expenditure.js";
import { isStandalone, platformInstallHint } from "../lib/pwa.js";
import { validateImport } from "../lib/validate.js";
import { LitterRobotCard } from "./Settings.jsx";

// "More" — cats, connections, preferences and data, in the Almanac style. The 4-skin picker is
// gone (the redesign is one direction). The Litter-Robot flow is reused from the classic Settings
// (a self-contained, working component) rather than rewritten — a small visual seam, no risk to
// the integration.

const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const INSTALL_GESTURE = {
  ios: "Share → Add to Home Screen",
  macSafari: "File → Add to Dock",
  android: "menu → Install app / Add to Home screen",
  other: "your browser's Install / Add to Home Screen",
};

function Card({ children, style }) {
  return <div style={{ background: A.card, border: `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "14px 16px", margin: "0 18px 14px", ...style }}>{children}</div>;
}
function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map(([k, l]) => {
        const on = value === k;
        return <button key={k} onClick={() => onChange(k)} aria-pressed={on}
          style={{ fontFamily: TYPE.mono, fontSize: 11, borderRadius: 999, padding: "4px 11px", cursor: "pointer", border: on ? "none" : `1px solid ${A.cardBorder}`, background: on ? A.ink : "transparent", color: on ? A.card : A.muted }}>{l}</button>;
      })}
    </div>
  );
}
function RowHead({ title, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <h2 style={{ fontFamily: TYPE.sans, fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
      {right}
    </div>
  );
}

export default function MorePage() {
  const {
    p, catsSummary, eraseAll, fridgeDays, setFridgeDays, exportData, importData,
    unit, setUnit, estimator, setEstimator, intakeMethod, setIntakeMethod,
    litterRobot, connectLitterRobotStart, connectLitterRobotFinish, disconnectLitterRobot, syncLitterRobotNow,
    setPetMapping, setRobotMapping,
  } = useApp();
  const realCats = catsSummary.filter((c) => !c.demo);
  const installed = isStandalone();
  const platform = typeof navigator !== "undefined" ? platformInstallHint(navigator.userAgent, navigator.maxTouchPoints) : "other";

  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cat-data-${(p.name || "cats").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const doImport = (ev) => {
    const file = ev.target.files?.[0]; ev.target.value = "";
    if (!file) return;
    if (!window.confirm("Import will ADD any cats, weigh-ins, meals, and foods from this file that you don't already have. Your current cats and settings won't be changed.")) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!validateImport(parsed)) throw new Error("bad shape");
        importData(parsed);
      } catch { window.alert("Couldn't read that file — it doesn't look like a Kilocat export."); }
    };
    reader.readAsText(file);
  };
  const doErase = () => { if (window.confirm("Erase everything — every cat's profile, all saved foods, and all weigh-in and intake history? This can't be undone.")) eraseAll(); };

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        <div style={{ padding: "18px 24px 12px" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>more</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 25, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 0" }}>Cats, data and connections</h1>
        </div>

        {/* cats */}
        <Card>
          <RowHead title="Cats" right={<a href="#/cats" style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.good, textDecoration: "none" }}>manage ›</a>} />
          <div style={{ marginTop: 8 }}>
            {realCats.length === 0 && <p style={{ fontSize: 12, color: A.muted }}>No cats yet — add one on the Cats page.</p>}
            {realCats.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 13 }}>
                <span style={{ color: A.ink }}>{c.name || "unnamed"}</span>
                {c.active && <span style={{ fontFamily: TYPE.mono, fontSize: 10, background: A.ink, color: A.card, borderRadius: 6, padding: "2px 7px" }}>active</span>}
              </div>
            ))}
          </div>
        </Card>

        {/* litter-robot (reused classic flow) */}
        <div style={{ margin: "0 18px 14px" }}>
          <LitterRobotCard connection={litterRobot} catsSummary={realCats}
            connectStart={connectLitterRobotStart} connectFinish={connectLitterRobotFinish}
            disconnect={disconnectLitterRobot} syncNow={syncLitterRobotNow}
            setPetMapping={setPetMapping} setRobotMapping={setRobotMapping} />
        </div>

        {/* preferences */}
        <Card>
          <div style={label({ marginBottom: 10 })}>Preferences</div>
          <PrefRow title="Weight units" sub="Shown everywhere · shared across cats"
            control={<Seg options={[["kg", "kg"], ["lb", "lb"]]} value={unit} onChange={setUnit} />} />
          <PrefRow title="Estimator" sub="How measured burn is computed · shared"
            control={<Seg options={[["v3", "v3 ✓"], ["v4", "v4 β"], ["v5", "v5 β"], ["v2", "v2"], ["v1", "v1"]]} value={estimator} onChange={setEstimator} />} />
          {/* Now the DOMINANT term in the reported uncertainty for anyone past a few weeks, so it
              earns a place here rather than a constant. The hint says what the choice actually costs. */}
          <PrefRow title="How you measure food" sub={`${(INTAKE_METHODS[intakeMethod] || {}).hint || ""}`}
            control={<select value={intakeMethod} onChange={(e) => setIntakeMethod(e.target.value)}
              aria-label="How you measure food"
              style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.ink, background: "transparent", border: `1px solid ${A.cardBorder}`, borderRadius: 8, padding: "4px 6px", maxWidth: 190 }}>
              {Object.entries(INTAKE_METHODS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>} />
          <PrefRow title="Opened cans keep" sub="Drives fridge warnings"
            control={<span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, borderBottom: `1px solid ${A.cardBorder}` }}>
              <input type="number" min="1" step="1" value={fridgeDays} onChange={(e) => setFridgeDays(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 34, fontFamily: TYPE.mono, fontSize: 15, color: A.ink, background: "transparent", border: "none", textAlign: "right" }} aria-label="Opened cans keep for, days" />
              <span style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.muted }}>days</span>
            </span>} last />
        </Card>

        {/* data */}
        <Card>
          <RowHead title="Your data" />
          <p style={{ fontSize: 12, color: A.bodyOnFill, margin: "6px 0 12px", lineHeight: 1.45 }}>Everything lives on this device. Export writes one file; importing merges it with what's here — it never replaces your cats or settings.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={doExport} style={{ border: `1px solid ${A.cardBorder}`, borderRadius: 10, padding: "8px 12px", fontFamily: TYPE.sans, fontSize: 12.5, color: A.body, background: "transparent", cursor: "pointer" }}>Export data</button>
            <label style={{ border: `1px solid ${A.cardBorder}`, borderRadius: 10, padding: "8px 12px", fontFamily: TYPE.sans, fontSize: 12.5, color: A.body, cursor: "pointer" }}>
              Import<input type="file" accept="application/json,.json" onChange={doImport} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} />
            </label>
            <button onClick={doErase} style={{ marginLeft: "auto", background: A.danger.bg, color: A.danger.text, border: "none", borderRadius: 10, padding: "8px 12px", fontFamily: TYPE.mono, fontSize: 11, cursor: "pointer" }}>Erase all…</button>
          </div>
        </Card>

        {/* install note */}
        {!installed && (
          <div style={{ background: A.caution.bg, border: `1px solid ${A.caution.border}`, borderRadius: 12, padding: "11px 13px", margin: "0 18px", fontSize: 12, color: A.caution.text, lineHeight: 1.4 }}>
            Add Kilocat to your home screen ({INSTALL_GESTURE[platform] || INSTALL_GESTURE.other}). On Safari, installing is what protects your data from the 7-day inactive-site cleanup.
          </div>
        )}
      </div>
    </div>
  );
}

function PrefRow({ title, sub, control, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: last ? "none" : `1px solid ${A.hairline}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: A.ink }}>{title}</div>
        <div style={{ fontFamily: TYPE.mono, fontSize: 10.5, color: A.muted, marginTop: 1 }}>{sub}</div>
      </div>
      <div style={{ flex: "none" }}>{control}</div>
    </div>
  );
}
