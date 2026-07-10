import { Info } from "lucide-react";
import { C } from "../theme.js";

/* ---------- shared UI primitives ---------- */

export function Field({ label, suffix, children }) {
  return (
    <label className="block">
      <div style={{ color: C.sub }} className="text-xs mb-1">{label}</div>
      <div style={{ borderColor: C.line }} className="flex items-baseline border rounded-lg px-2.5 py-1.5 bg-white">
        {children}
        {suffix && <span style={{ color: C.faint }} className="text-xs font-mono ml-1 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

export function NumInput({ value, onChange, step }) {
  return (
    <input
      type="number" value={value} step={step}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className="w-full bg-transparent outline-none font-mono text-sm tabular-nums"
      style={{ color: C.ink }}
    />
  );
}

export function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ background: value ? C.spruce : C.line }}
      className="relative w-10 h-5 rounded-full transition-colors shrink-0"
      role="switch" aria-checked={value}
    >
      <span style={{ transform: value ? "translateX(20px)" : "translateX(2px)" }} className="absolute top-0.5 left-0 w-4 h-4 bg-white rounded-full transition-transform" />
    </button>
  );
}

export function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: C.sub }}>{k}</span>
      <span style={{ color: C.ink }} className="text-right tabular-nums">{v}</span>
    </div>
  );
}

export function RefRow({ label, val, on, note }) {
  return (
    <div className="flex justify-between items-baseline gap-3" style={{ color: on ? C.amber : C.sub }}>
      <span className="flex items-center gap-1.5">{on ? "▸" : "  "} {label}<span style={{ color: C.faint }} className="text-[10px]">{note}</span></span>
      <span className="tabular-nums font-semibold" style={{ color: on ? C.amber : C.ink }}>{Math.round(val)} kcal</span>
    </div>
  );
}

export function Note({ children, tone }) {
  const bg = tone === "warn" ? C.amberSoft : C.spruceSoft;
  const fg = tone === "warn" ? C.amber : C.spruce;
  return (
    <div style={{ background: bg, color: fg }} className="mt-3 rounded-xl px-3 py-2 text-xs leading-snug flex gap-2">
      <Info size={14} className="shrink-0 mt-0.5" /><span>{children}</span>
    </div>
  );
}
