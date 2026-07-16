import { Scale, Activity, NotebookPen, ChevronRight, Settings as SettingsIcon } from "lucide-react";
import { C } from "../theme.js";
import { useApp } from "../state/AppState.jsx";
import { r0, r1, clamp } from "../lib/util.js";
import { toDisplayWeight, weightLabel, weeklyRate } from "../lib/units.js";
import { resolveTarget } from "../lib/targeting.js";
import { RATE } from "../lib/weightPlan.js";
import CatMark from "../components/CatMark.jsx";

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

// Dashboard: a masthead status line, three real-data stat cards, then the three tools.
// Every tile degrades honestly — first-run demo, no weigh-ins yet, a growing kitten, or not
// enough data for a measured estimate all get their own truthful copy, never a guessed number.
export default function Home() {
  const { p, t, expenditure, weightLog, intakeLog, expSettings, currentWeight, ration } = useApp();
  const unit = expSettings.unit || "kg";
  const wLbl = weightLabel(unit);
  const showW = (kg, d = 1) => `${(d === 1 ? r1 : r0)(toDisplayWeight(kg, unit))} ${wLbl}`;
  const name = p.name || "Your cat";

  const kitten = t.stage !== "adult";
  const hasWeighIns = currentWeight.fromLog;
  const ratePct = expenditure.ratePctPerWeek;
  const rateMag = Math.abs(ratePct || 0);
  const rate = weeklyRate(expenditure.rateKgPerWeek || 0, unit);
  const tooFast = expenditure.enoughData && rateMag > RATE.max;
  const rateTone = !expenditure.enoughData ? null : tooFast ? "warn" : "ok";

  const { target, measured, dir } = resolveTarget({ t, expenditure, expSettings });
  const targetLine = measured
    ? dir === "maintain" ? "measured maintenance" : `gentle ${dir === "gain" ? "surplus" : "trim"} · her measured burn`
    : "from the vet formula";

  // Masthead headline + one-line status — every branch reads only real, already-computed
  // values (currentWeight, expenditure, t), never a fabricated number.
  let headline, sub;
  if (!hasWeighIns) {
    headline = `${name}'s kitchen`;
    sub = "No weigh-ins logged yet — add one on the ration planner to start tracking the trend.";
  } else if (kitten) {
    headline = `${name} is growing`;
    sub = `${showW(currentWeight.kg)} today. Kittens gain steadily — the ration planner has growth-aware targets, not a weight-loss one.`;
  } else if (!expenditure.enoughData) {
    headline = `${name}'s kitchen`;
    sub = `${showW(currentWeight.kg)} today — a couple more weeks of weigh-ins and the measured trend fills in.`;
  } else if (tooFast) {
    headline = `${name}'s weight is moving fast`;
    sub = `${ratePct < 0 ? "Down" : "Up"} ${r1(rateMag)}% this week — faster than the safe ${RATE.min}–${RATE.max}%/wk range. Worth a re-check on the ration.`;
  } else if (rateMag < 0.15) {
    headline = `${name} is holding steady`;
    sub = `Barely moving this week — right where maintenance should sit. Tonight's target is ${r0(target)} kcal.`;
  } else {
    headline = `${name} is doing great`;
    sub = `${ratePct < 0 ? "Down" : "Up"} a gentle ${r1(rateMag)}% this week — right in the safe zone. Tonight's target is ${r0(target)} kcal.`;
  }

  const tools = [
    { href: "#/ration", icon: Scale, dot: "accent", title: "Ration planner",
      desc: "Split tonight's calories into gram portions across her foods.",
      fig: `${r0(target)} kcal → ${ration.items.length} food${ration.items.length === 1 ? "" : "s"}` },
    { href: "#/expenditure", icon: Activity, dot: "second", title: "Energy expenditure",
      desc: "What she actually burns — measured from weigh-ins, not guessed.",
      fig: expenditure.enoughData ? `${r0(expenditure.kcal)} ±${r0(1.96 * expenditure.sd)} kcal` : "log more to measure" },
    { href: "#/log", icon: NotebookPen, dot: "neutral", title: "Log",
      desc: "Weigh-ins and meals, day by day — these feed the expenditure estimate.",
      fig: `${weightLog.items.length} · ${intakeLog.items.length} entries` },
  ];

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        {/* masthead */}
        <div className="flex items-end gap-4 sm:gap-[18px] flex-wrap sm:flex-nowrap">
          <CatMark size={92} />
          <div className="min-w-0">
            <div style={{ color: C.amber }} className="font-mono text-[10.5px] tracking-[0.2em] uppercase">{greeting()}</div>
            <h1 className="text-[28px] sm:text-[32px] font-extrabold leading-tight mt-0.5" style={{ letterSpacing: "-0.02em" }}>{headline}</h1>
            <p style={{ color: C.sub }} className="text-[15px] mt-0.5 leading-snug">{sub}</p>
          </div>
        </div>

        {/* stat strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
          <StatCard label="Weight" value={showW(currentWeight.kg)}>
            {hasWeighIns && rateTone && (
              <Pill tone={rateTone}>{ratePct <= 0 ? "▾" : "▴"} {r1(rateMag)} %/wk · {rateTone === "ok" ? "safe" : "fast"}</Pill>
            )}
            {!hasWeighIns && <Caption>starting estimate — log a weigh-in ↓</Caption>}
            {hasWeighIns && !expenditure.enoughData && <Caption>{rate.value ? `${r0(rate.value)} ${rate.unit}` : "logging"} · trend fills in soon</Caption>}
            {!kitten && <WeightBand weightKg={currentWeight.kg} idealKg={t.idealWeight} />}
          </StatCard>

          <StatCard label="Tonight's bowl" value={`${r0(target)}`} unit="kcal">
            <Caption>{targetLine}</Caption>
          </StatCard>

          <StatCard label={`${name} burns`} value={expenditure.enoughData ? r0(expenditure.kcal) : "—"} unit={expenditure.enoughData ? `±${r0(1.96 * expenditure.sd)}` : null}>
            {expenditure.enoughData
              ? <ConfidenceBand sd={expenditure.sd} kcal={expenditure.kcal} />
              : <Caption>log weight + intake to estimate</Caption>}
          </StatCard>
        </div>

        {/* tools */}
        <h2 style={{ color: C.sub }} className="text-xs font-extrabold tracking-[0.14em] uppercase mt-8 mb-2.5">Tools</h2>
        <div className="space-y-2.5">
          {tools.map((tool) => <ToolRow key={tool.href} {...tool} />)}
        </div>

        <div className="flex items-center gap-2 mt-6">
          <a href="#/settings" style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white"><SettingsIcon size={13} /> Settings — cats, appearance, export/import</a>
        </div>
        <p style={{ color: C.faint }} className="text-xs leading-relaxed mt-3 px-1">
          A planning aid, not veterinary advice. Saved on this device only — Export from Settings to back up or move to another browser.
        </p>
      </div>
    </div>
  );
}

const DOT_STYLE = {
  accent: { background: C.amberSoft, color: C.amber },
  second: { background: C.spruceSoft, color: C.spruce },
  neutral: { background: C.line, color: C.ink },
};

function ToolRow({ href, icon: Icon, dot, title, desc, fig }) {
  const dotStyle = DOT_STYLE[dot] || DOT_STYLE.neutral;
  return (
    <a href={href} style={{ background: C.card, borderColor: C.line }}
      className="flex items-center gap-3.5 border rounded-2xl px-4 py-4 hover:shadow-sm transition-shadow">
      <div style={dotStyle} className="w-11 h-11 rounded-full grid place-items-center shrink-0"><Icon size={20} /></div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-[15.5px]" style={{ letterSpacing: "-0.01em" }}>{title}</h3>
        <p style={{ color: C.sub }} className="text-[13px] mt-0.5 leading-snug">{desc}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span style={{ color: dotStyle.color }} className="text-xs font-mono tabular-nums whitespace-nowrap hidden sm:inline">{fig}</span>
        <ChevronRight size={16} style={{ color: C.faint }} />
      </div>
    </a>
  );
}

function StatCard({ label, value, unit, children }) {
  return (
    <div style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl px-4 py-3.5">
      <span style={{ color: C.sub }} className="block text-[11px] font-bold tracking-[0.06em] uppercase">{label}</span>
      <span className="block font-mono text-[25px] font-bold tabular-nums mt-1.5">
        {value}{unit && <small style={{ color: C.sub }} className="text-xs font-medium ml-1">{unit}</small>}
      </span>
      {children}
    </div>
  );
}

function Pill({ tone, children }) {
  const on = tone === "ok" ? { bg: C.okSoft, fg: C.ok } : { bg: C.warnSoft, fg: C.warn };
  return (
    <span style={{ background: on.bg, color: on.fg }} className="inline-flex items-center gap-1 text-[11.5px] font-bold rounded-full px-2.5 py-0.5 mt-2">{children}</span>
  );
}

function Caption({ children }) {
  return <span style={{ color: C.sub }} className="block text-[11.5px] mt-2">{children}</span>;
}

// The weight-vs-ideal meter ("the scale thing") — a subtle track from ideal weight up to a
// sensible upper reference, with the healthy range shaded and a dot marking where the cat
// sits today. Uses C.ok (not C.spruce/second) since this IS a safe-state claim — in the
// spruce skin those diverge, and a safe zone must stay green there too.
function WeightBand({ weightKg, idealKg }) {
  if (!(idealKg > 0) || !(weightKg > 0)) return null;
  const lo = idealKg, hi = idealKg * 1.3, safeHi = idealKg * 1.15;
  const pos = clamp(((weightKg - lo) / (hi - lo)) * 100, 0, 100);
  const safeWidth = clamp(((safeHi - lo) / (hi - lo)) * 100, 0, 100);
  return (
    <div className="mt-2.5">
      <div style={{ background: C.line }} className="relative h-[7px] rounded-full">
        <div style={{ left: 0, width: `${safeWidth}%`, background: C.okSoft, borderColor: C.ok }} className="absolute inset-y-0 rounded-full border" />
        <div style={{ left: `${pos}%`, background: C.ok, borderColor: C.card }} className="absolute top-1/2 w-3 h-3 rounded-full border-2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <span style={{ color: C.faint }} className="block text-[10.5px] mt-1.5">vs. ideal weight · shaded = healthy range</span>
    </div>
  );
}

// A soft confidence-width indicator for the measured burn estimate — narrower as ± shrinks
// relative to the point estimate. Decorative uncertainty visualization, not a safety claim,
// so it keeps the mockup's accent (clay) styling rather than C.ok.
function ConfidenceBand({ sd, kcal }) {
  if (sd == null || !(kcal > 0)) return null;
  const width = clamp(((1.96 * sd) / kcal) * 220, 10, 86);
  const left = (100 - width) / 2;
  return (
    <div className="mt-2.5">
      <div style={{ background: C.line }} className="relative h-[7px] rounded-full">
        <div style={{ left: `${left}%`, width: `${width}%`, background: C.amberSoft, borderColor: C.amber }} className="absolute inset-y-0 rounded-full border" />
        <div style={{ left: `${left + width / 2}%`, background: C.amber, borderColor: C.card }} className="absolute top-1/2 w-3 h-3 rounded-full border-2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <span style={{ color: C.faint }} className="block text-[10.5px] mt-1.5">confidence — narrows as you log</span>
    </div>
  );
}
