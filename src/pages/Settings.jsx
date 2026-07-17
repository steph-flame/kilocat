import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Settings as SettingsIcon, Plus, Download, Upload, AlertTriangle, Trash2, RotateCcw, Check, Link2, Unlink, RefreshCw, Loader2, ShieldCheck } from "lucide-react";
import { C, SKINS } from "../theme.js";
import { useApp } from "../state/AppState.jsx";
import { validateImport } from "../lib/validate.js";
import { platformInstallHint, isStandalone } from "../lib/pwa.js";
import { FIRST_SYNC_DAYS } from "../lib/litterRobot.js";
import { Field, Toggle, Note } from "../components/primitives.jsx";
import CatMark from "../components/CatMark.jsx";

const catLabel = (c) => c.name || "unnamed cat";
const SKIN_NAMES = { original: "Original", blossom: "Blossom", tidepool: "Tidepool", spruce: "Spruce" };

// The three install gestures we know how to describe — keyed the same as pwa.js's
// platformInstallHint so the detected platform's row can be picked out and shown first.
const INSTALL_GESTURES = [
  { key: "ios", label: "iPhone / iPad (Safari)", gesture: "Share → Add to Home Screen" },
  { key: "macSafari", label: "Mac (Safari)", gesture: "File menu → Add to Dock" },
  { key: "chromium", label: "Chrome / Edge", gesture: "install icon in the address bar (or menu) → Install" },
];

export default function Settings() {
  const {
    p, today, catsSummary, activeCatId, switchCat, addCat, updateCatProfile, deleteCat, clearCatHistory, eraseAll,
    fridgeDays, exportData, importData, skin, setSkin, unit, setUnit,
    litterRobot, connectLitterRobotStart, connectLitterRobotFinish, disconnectLitterRobot, syncLitterRobotNow,
  } = useApp();
  const [expandedId, setExpandedId] = useState(null);
  const [installExpanded, setInstallExpanded] = useState(false);
  const installed = isStandalone();
  const platform = typeof navigator !== "undefined" ? platformInstallHint(navigator.userAgent, navigator.maxTouchPoints) : "other";
  const detectedGesture = INSTALL_GESTURES.find((g) => g.key === platform);
  const otherGestures = INSTALL_GESTURES.filter((g) => g.key !== platform);

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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!validateImport(parsed)) throw new Error("malformed export shape");
        importData(parsed);
      } catch { window.alert("Couldn't read that file — it doesn't look like a Cat Feeding export."); }
    };
    reader.readAsText(file);
  };

  const clearHistory = (c) => {
    if (window.confirm(`Erase ${catLabel(c)}'s weigh-in and intake history? Profile, ration, and saved foods stay. This can't be undone.`)) clearCatHistory(c.id);
  };
  const removeCat = (c) => {
    const tail = catsSummary.length === 1 ? " Since every cat needs a home, this one is replaced with a fresh blank cat." : "";
    if (window.confirm(`Delete ${catLabel(c)} — profile, ration, and all weigh-in/intake history? This can't be undone.${tail}`)) deleteCat(c.id);
  };
  const doEraseAll = () => {
    if (window.confirm("Erase everything — every cat's profile, all saved foods, and all weigh-in and intake history? This can't be undone.")) eraseAll();
  };

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
        </nav>

        <div className="flex items-end gap-4 mb-6">
          <CatMark size={60} />
          <div className="min-w-0">
            <div style={{ color: C.amber }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><SettingsIcon size={13} /> settings</div>
            <h1 className="text-[26px] font-extrabold leading-tight" style={{ letterSpacing: "-0.02em" }}>Settings</h1>
          </div>
        </div>

        {/* appearance */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="font-medium mb-1">Appearance</h2>
          <p style={{ color: C.faint }} className="text-xs mb-3">Four palettes, same layout. Applies instantly and remembers your choice — shared across every cat.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.keys(SKINS).map((name) => (
              <SkinSwatch key={name} name={name} tokens={SKINS[name]} active={skin === name} onClick={() => setSkin(name)} />
            ))}
          </div>
        </section>

        {/* units */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-medium">Units</h2>
            <div className="flex rounded-full overflow-hidden border" style={{ borderColor: C.line }}>
              {["kg", "lb"].map((u) => (
                <button key={u} onClick={() => setUnit(u)} aria-pressed={unit === u} style={{ background: unit === u ? C.spruce : "transparent", color: unit === u ? "#fff" : C.sub }} className="text-xs px-2.5 py-1.5 font-mono">{u}</button>
              ))}
            </div>
          </div>
          <p style={{ color: C.faint }} className="text-xs">How weight is shown, everywhere — shared across every cat.</p>
        </section>

        {/* install */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="font-medium mb-1">Install as an app</h2>
          {installed ? (
            <p style={{ color: C.spruce }} className="text-xs flex items-center gap-1"><Check size={13} /> Installed — running as its own app.</p>
          ) : (
            <>
              <p style={{ color: C.faint }} className="text-xs mb-3">Works offline — and on Safari, installing is what protects your data from the 7-day inactive-site cleanup.</p>
              <div className="space-y-1.5">
                {detectedGesture && (
                  <div style={{ borderColor: C.spruce, background: C.spruceSoft, color: C.ink }} className="border rounded-xl px-3 py-2 text-sm">
                    <span className="font-medium">{detectedGesture.label}: </span>{detectedGesture.gesture}
                  </div>
                )}
                {otherGestures.length > 0 && (
                  <button onClick={() => setInstallExpanded((v) => !v)} aria-expanded={installExpanded} style={{ color: C.sub }} className="inline-flex items-center gap-0.5 text-xs hover:underline">
                    other platforms {installExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                )}
                {installExpanded && (
                  <div className="space-y-1 pt-1">
                    {otherGestures.map((g) => (
                      <div key={g.key} style={{ color: C.faint }} className="text-xs px-1">
                        <span style={{ color: C.sub }} className="font-medium">{g.label}: </span>{g.gesture}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* litter-robot */}
        <LitterRobotCard
          connection={litterRobot}
          catsSummary={catsSummary}
          activeCatId={activeCatId}
          connectStart={connectLitterRobotStart}
          connectFinish={connectLitterRobotFinish}
          disconnect={disconnectLitterRobot}
          syncNow={syncLitterRobotNow}
        />

        {/* cats */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="font-medium mb-1">Cats</h2>
          <p style={{ color: C.faint }} className="text-xs mb-3">Every cat gets its own profile, ration, and history. They share one food library and fridge setting ({fridgeDays} day{fridgeDays === 1 ? "" : "s"}).</p>
          <div className="space-y-1.5">
            {catsSummary.map((c) => {
              const expanded = c.id === expandedId;
              return (
                <div key={c.id} style={{ borderColor: c.id === activeCatId ? C.spruce : C.line, background: c.id === activeCatId ? C.spruceSoft : "transparent" }}
                  className="border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <input type="radio" name="activeCat" checked={c.id === activeCatId} onChange={() => switchCat(c.id)} style={{ accentColor: C.spruce }} aria-label={`Make ${catLabel(c)} the active cat`} />
                    <div className="flex-1 min-w-0">
                      <CatNameField cat={c} onChange={(name) => updateCatProfile(c.id, { name })} active={c.id === activeCatId} />
                      <div style={{ color: C.faint }} className="text-xs font-mono mt-0.5">{c.ageDisplay || "age unknown"} · {c.weighIns} weigh-in{c.weighIns === 1 ? "" : "s"}</div>
                    </div>
                    <button onClick={() => setExpandedId(expanded ? null : c.id)} aria-expanded={expanded} style={{ color: C.sub }} className="shrink-0 inline-flex items-center gap-0.5 text-xs hover:underline">
                      profile {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  </div>
                  {expanded && (
                    <div style={{ borderColor: C.line }} className="border-t px-3 py-3 space-y-3">
                      <Field label="Date of birth">
                        <input type="date" value={c.dob} max={today} onChange={(e) => updateCatProfile(c.id, { dob: e.target.value })} className="w-full bg-transparent outline-none font-mono text-sm tabular-nums" style={{ color: C.ink }} aria-label={`${catLabel(c)}'s date of birth`} />
                      </Field>
                      <div className="flex items-center gap-2">
                        <span style={{ color: C.sub }} className="text-xs w-28">Spayed / neutered</span>
                        <Toggle value={c.neutered} onChange={(v) => updateCatProfile(c.id, { neutered: v })} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={addCat} style={{ borderColor: C.line, color: C.spruce }} className="mt-3 w-full border border-dashed rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white"><Plus size={15} /> add a cat</button>
        </section>

        {/* data */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="font-medium mb-1">Data</h2>
          <p style={{ color: C.faint }} className="text-xs mb-3">Everything above — every cat, the food library, all history — in one file. Saved on this device only; export to back up or move to another browser.</p>
          <div className="flex items-center gap-2">
            <button onClick={doExport} style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white"><Download size={13} /> Export data</button>
            <label style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white cursor-pointer">
              <Upload size={13} /> Import
              <input type="file" accept="application/json,.json" onChange={doImport} className="sr-only" />
            </label>
          </div>
        </section>

        {/* danger zone */}
        <section style={{ background: C.warnSoft, borderColor: C.warn }} className="border-2 rounded-2xl p-4 sm:p-5 mb-4">
          <h2 style={{ color: C.warn }} className="font-medium mb-1 flex items-center gap-1.5"><AlertTriangle size={16} /> Danger zone</h2>
          <p style={{ color: C.warn }} className="text-xs mb-3 opacity-90">Every action here is permanent — there's no undo, and each button says exactly what it erases.</p>

          <div className="space-y-1.5">
            {catsSummary.map((c) => (
              <div key={c.id} style={{ borderColor: C.warn }} className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2 bg-white/40">
                <span className="text-sm truncate" style={{ color: C.ink }}>{catLabel(c)}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => clearHistory(c)} style={{ borderColor: C.warn, color: C.warn }} className="inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 hover:bg-white"><RotateCcw size={11} /> clear history…</button>
                  <button onClick={() => removeCat(c)} style={{ borderColor: C.warn, color: C.warn }} className="inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 hover:bg-white"><Trash2 size={11} /> delete cat…</button>
                </span>
              </div>
            ))}
          </div>

          <div style={{ borderColor: C.warn }} className="mt-4 border-t pt-3">
            <button onClick={doEraseAll} style={{ background: C.warn }} className="w-full rounded-xl py-2.5 text-sm text-white inline-flex items-center justify-center gap-1.5"><Trash2 size={14} /> erase all — every cat, every food, all history…</button>
          </div>
        </section>
      </div>
    </div>
  );
}

// Inline-editable cat name, scoped to whichever row it's rendered in (not just the active
// cat). Local `value` state — rather than the row's own (trimmed, for display) catsSummary
// name — is the controlled source, so a trailing space mid-word doesn't get stripped out
// from under the cursor on every keystroke; it only resyncs when the row's cat id changes.
function CatNameField({ cat, onChange, active }) {
  const [value, setValue] = useState(cat.name);
  useEffect(() => { setValue(cat.name); }, [cat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text" value={value} placeholder="unnamed cat"
      onChange={(e) => { setValue(e.target.value); onChange(e.target.value); }}
      autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
      aria-label={`${catLabel(cat)}'s name`}
      style={{ color: active ? C.spruce : C.ink }}
      className="w-full bg-transparent outline-none text-sm font-medium border-b border-transparent focus:border-current"
    />
  );
}

// One skin swatch: a small circle in that skin's own ground/accent/second (literal hexes
// from SKINS, not the C token map — a swatch has to show every skin's true colors
// regardless of which one is currently active).
function SkinSwatch({ name, tokens, active, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active} aria-label={`${SKIN_NAMES[name] || name} skin${active ? ", active" : ""}`}
      style={{ borderColor: active ? tokens.accent : C.line, background: active ? tokens.ground : "transparent" }}
      className="flex flex-col items-center gap-1.5 border rounded-2xl px-2 py-3">
      <span style={{ background: tokens.ground, borderColor: C.line }} className="relative w-10 h-10 rounded-full border">
        <span style={{ background: tokens.accent }} className="absolute left-0.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/60" />
        <span style={{ background: tokens.second }} className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/60" />
        {active && (
          <span style={{ background: tokens.accent, color: tokens.ground, borderColor: tokens.ground }} className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full grid place-items-center border-2">
            <Check size={9} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="text-xs font-medium" style={{ color: active ? C.ink : C.sub }}>{SKIN_NAMES[name] || name}</span>
    </button>
  );
}

/* ---------- Litter-Robot connect card ---------- */
// Disconnected: an explainer + email/password form, a trust note, then (after a successful
// login) a robot picker (only shown if the account has more than one) and a cat picker.
// Connected: serial, last sync, sync-now, disconnect. Errors surface as their own .message
// (LitterRobotError from lib/litterRobot.js already turns raw Cognito/AppSync failures into
// something legible — see that file).
function LitterRobotCard({ connection, catsSummary, activeCatId, connectStart, connectFinish, disconnect, syncNow }) {
  return (
    <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
      <h2 className="font-medium mb-1 flex items-center gap-1.5"><Link2 size={15} /> Litter-Robot</h2>
      {connection
        ? <LRConnected connection={connection} catsSummary={catsSummary} disconnect={disconnect} syncNow={syncNow} />
        : <LRDisconnected catsSummary={catsSummary} activeCatId={activeCatId} connectStart={connectStart} connectFinish={connectFinish} />}
    </section>
  );
}

function LRDisconnected({ catsSummary, activeCatId, connectStart, connectFinish }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(null); // { refreshToken, robots } once login succeeds
  const [serial, setSerial] = useState("");
  const [catId, setCatId] = useState(activeCatId);
  const [finishing, setFinishing] = useState(false);
  const [finishResult, setFinishResult] = useState(null);

  const doConnect = async () => {
    setError(""); setBusy(true);
    try {
      const { refreshToken, robots } = await connectStart(email.trim(), password);
      setPicking({ refreshToken, robots });
      setSerial(robots[0]?.serial || "");
    } catch (e) {
      setError(e?.message || "Couldn't connect — try again.");
    } finally {
      setBusy(false);
    }
  };
  const doFinish = async () => {
    setFinishing(true);
    setFinishResult(await connectFinish(picking.refreshToken, serial, catId));
    setFinishing(false);
  };

  if (picking) {
    return (
      <div className="space-y-3">
        <p style={{ color: C.faint }} className="text-xs">
          Signed in. {picking.robots.length > 1 ? "Pick a robot and which cat its weigh-ins go to." : "Pick which cat its weigh-ins go to."}
        </p>
        {picking.robots.length > 1 && (
          <Field label="Robot">
            <select value={serial} onChange={(e) => setSerial(e.target.value)} className="w-full bg-transparent outline-none text-sm" style={{ color: C.ink }}>
              {picking.robots.map((r) => <option key={r.serial} value={r.serial}>{r.name} ({r.serial})</option>)}
            </select>
          </Field>
        )}
        <Field label="Feeds weigh-ins to">
          <select value={catId} onChange={(e) => setCatId(e.target.value)} className="w-full bg-transparent outline-none text-sm" style={{ color: C.ink }}>
            {catsSummary.map((c) => <option key={c.id} value={c.id}>{c.name || "unnamed cat"}</option>)}
          </select>
        </Field>
        <button onClick={doFinish} disabled={finishing || !serial} style={{ background: C.spruce }}
          className="w-full rounded-xl py-2 text-sm text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
          {finishing ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} {finishing ? "Connecting…" : "Finish connecting"}
        </button>
        {finishResult && !finishResult.ok && (
          <Note tone="warn">Connected, but the first sync failed: {finishResult.error?.message || "unknown error"}. It'll retry next time the app loads, or use "sync now" below.</Note>
        )}
        {finishResult?.ok && (
          <Note>Connected — pulled {finishResult.count} weigh-in{finishResult.count === 1 ? "" : "s"} from the last {FIRST_SYNC_DAYS} days.</Note>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p style={{ color: C.faint }} className="text-xs">Sign in with your Whisker account to pull your cat's weigh-ins from the Litter-Robot automatically.</p>
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore
          className="w-full bg-transparent outline-none text-sm" style={{ color: C.ink }} />
      </Field>
      <Field label="Password">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore
          className="w-full bg-transparent outline-none text-sm" style={{ color: C.ink }} />
      </Field>
      {error && <Note tone="warn">{error}</Note>}
      <button onClick={doConnect} disabled={busy || !email || !password} style={{ background: C.spruce }}
        className="w-full rounded-xl py-2 text-sm text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} {busy ? "Connecting…" : "Connect"}
      </button>
      <p style={{ color: C.faint }} className="text-xs flex gap-1.5">
        <ShieldCheck size={13} className="shrink-0 mt-0.5" />
        Your password goes only to Whisker's login service (Amazon Cognito) — Kilocat stores just a revocable token. Open source: check the Network tab.
      </p>
    </div>
  );
}

function LRConnected({ connection, catsSummary, disconnect, syncNow }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const catName = catsSummary.find((c) => c.id === connection.catId)?.name || "unnamed cat";

  const doSync = async () => {
    setBusy(true); setResult(null);
    setResult(await syncNow());
    setBusy(false);
  };
  const doDisconnect = () => {
    if (window.confirm("Disconnect the Litter-Robot? Already-synced weigh-ins stay in the log; new ones will stop appearing until you reconnect.")) disconnect();
  };

  return (
    <div className="space-y-2">
      <p style={{ color: C.spruce }} className="text-xs flex items-center gap-1"><Check size={13} /> Connected — feeding {catName}</p>
      <div style={{ color: C.faint }} className="text-xs font-mono">
        <div>Robot: {connection.serial}</div>
        <div>Last sync: {connection.lastSyncTs ? new Date(connection.lastSyncTs).toLocaleString() : "not yet"}</div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={doSync} disabled={busy} style={{ borderColor: C.line, color: C.sub }}
          className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} sync now
        </button>
        <button onClick={doDisconnect} style={{ borderColor: C.line, color: C.warn }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white">
          <Unlink size={13} /> disconnect
        </button>
      </div>
      {result && (result.ok
        ? <Note>Synced — {result.count} new weigh-in{result.count === 1 ? "" : "s"}.</Note>
        : <Note tone="warn">Sync failed: {result.error?.message || "unknown error"}</Note>)}
    </div>
  );
}
