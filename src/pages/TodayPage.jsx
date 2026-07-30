import { useApp } from "../state/AppState.jsx";
import { A, TYPE } from "../almanac.js";
import { toDisplayWeight, weightLabel, fmtWeight } from "../lib/units.js";
import { num } from "../lib/util.js";

// Today — the landing/overview home. A read-only glance at where the cat stands right now: the
// measured burn, today's target and how big a deficit/surplus that is, a weight-trend snapshot,
// and quick links out to the pages that actually do things. (No "tonight's bowl" here — that lives
// on Log.) Everything reads from the same resolveIntent/expenditure the other pages use, so it can
// never disagree with them.

const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const label = (extra) => ({ fontFamily: TYPE.mono, fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase", color: A.muted, fontWeight: 500, ...extra });
const cap = { fontSize: 12.5, color: A.bodyOnFill, lineHeight: 1.45, margin: "6px 0 0" };

function Card({ children, style, className, inverted }) {
  return <div className={className} style={{ background: inverted ? A.inverted.bg : A.card, border: inverted ? "none" : `1px solid ${A.cardBorder}`, borderRadius: 20, padding: "16px 18px", margin: "0 18px 14px", ...style }}>{children}</div>;
}

function prettyDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch { return iso; }
}

// A tiny weight sparkline from the daily trend — no axes, just the shape of the last stretch.
function Spark({ trend, disp }) {
  const pts = (trend || []).filter((p) => p.w != null).slice(-60).map((p) => disp(p.w));
  if (pts.length < 2) return null;
  const W = 240, H = 44, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => H - 4 - ((v - lo) / span) * (H - 8);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block", marginTop: 8 }} aria-hidden="true">
      <path d={d} fill="none" stroke={A.chart.trend} strokeWidth="2" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3" fill={A.chart.endDot} />
    </svg>
  );
}

function QuickLink({ href, children }) {
  return (
    <a href={href} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textDecoration: "none",
      border: `1px solid ${A.cardBorder}`, borderRadius: 12, padding: "12px 14px", background: A.card }}>
      <span style={{ fontFamily: TYPE.sans, fontSize: 13.5, fontWeight: 600, color: A.ink }}>{children}</span>
      <span style={{ fontFamily: TYPE.mono, fontSize: 13, color: A.good }}>›</span>
    </a>
  );
}

export default function TodayPage() {
  const { p, intent, expenditure: e, currentWeight, intakeLog, unit, today } = useApp();
  const name = p?.name || "Your cat";
  const disp = (kg) => toDisplayWeight(kg, unit);

  const measured = !!e?.enoughData;
  const burn = measured ? r0(e.kcal) : r0(intent.maintenance);
  const pm = measured ? r0(e.kcal - e.low) : null;

  const target = r0(intent.target);
  const delta = intent.dailyDelta; // signed kcal/day vs maintenance
  const deltaPct = intent.maintenance > 0 ? (delta / intent.maintenance) * 100 : 0;
  const isDeficit = delta < -0.5, isSurplus = delta > 0.5;
  const deltaWord = isDeficit ? "deficit" : isSurplus ? "surplus" : "at maintenance";
  const deltaColor = isDeficit ? A.good : isSurplus ? A.caution.text : A.muted;

  const eatenToday = (intakeLog?.items || []).filter((x) => x.date === today).reduce((a, b) => a + num(b.kcal), 0);
  const loggedToday = (intakeLog?.items || []).some((x) => x.date === today);

  const rate = e?.ratePctPerWeek;
  const rateStr = rate == null ? null : `${rate < 0 ? "−" : rate > 0 ? "+" : ""}${Math.abs(r1(rate))}%/wk`;
  const curKg = currentWeight?.kg;

  return (
    <div style={{ background: A.pageFill, minHeight: "100%", fontFamily: TYPE.sans, color: A.ink, paddingBottom: 28 }}>
      <div className="alm-page alm-grid">
        <div className="span-all" style={{ padding: "18px 24px 2px" }}>
          <div style={label({ color: A.labelOnFill, letterSpacing: ".18em" })}>today · {prettyDate(today)}</div>
          <h1 style={{ fontFamily: TYPE.serif, fontWeight: 400, fontSize: 26, lineHeight: 1.24, letterSpacing: "-.012em", margin: "10px 0 8px" }}>
            How {name} is tracking
          </h1>
        </div>

        {/* measured burn — the hero */}
        <Card className="span-all" inverted>
          <div style={label({ color: A.inverted.sub })}>{measured ? "measured burn" : "burn · formula estimate"}</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 6 }}>
            <div style={{ fontFamily: TYPE.mono, fontSize: 44, fontWeight: 600, color: A.inverted.text, lineHeight: 1 }}>
              {burn}<span style={{ fontSize: 15, color: A.inverted.sub, fontWeight: 400 }}> kcal/day</span>
            </div>
            {measured && <div style={{ fontFamily: TYPE.mono, fontSize: 11, color: A.inverted.sub, textAlign: "right" }}>±{pm} kcal<br />95% interval</div>}
          </div>
          <p style={{ fontSize: 12, color: A.inverted.sub, margin: "10px 0 0", lineHeight: 1.45 }}>
            {measured
              ? <>Worked out from {e.nDays} days of weigh-ins and meals. <a href="#/trend" style={{ color: "#DCE6D6", fontWeight: 600 }}>See the trend →</a></>
              : <>The vet formula's estimate until ~2 weeks of logs turn it into a measured number. <a href="#/log" style={{ color: "#DCE6D6", fontWeight: 600 }}>Log weigh-ins & meals →</a></>}
          </p>
        </Card>

        {/* today's target + deficit/surplus */}
        <Card>
          <div style={label()}>today's target</div>
          <div style={{ fontFamily: TYPE.mono, fontSize: 34, fontWeight: 600, color: A.ink, lineHeight: 1, marginTop: 6 }}>
            {target}<span style={{ fontSize: 14, color: A.body, fontWeight: 400 }}> kcal</span>
          </div>
          <div style={{ fontSize: 13, color: deltaColor, fontWeight: 600, marginTop: 8 }}>
            {deltaWord === "at maintenance" ? "Right at maintenance" : `${Math.abs(r0(deltaPct))}% ${deltaWord} · ${delta < 0 ? "−" : "+"}${Math.abs(r0(delta))} kcal/day`}
          </div>
          <p style={{ ...cap, fontSize: 11.5 }}>
            {isDeficit ? "Below her burn, so she loses gradually." : isSurplus ? "Above her burn, so she gains gradually." : "Matched to her burn."}
            {loggedToday ? <> Logged today: <b style={{ color: A.ink }}>{r0(eatenToday)}</b> of {target} kcal.</> : " Nothing logged yet today."}
          </p>
          <a href="#/calories" style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.good, fontWeight: 600, textDecoration: "none", display: "inline-block", marginTop: 8 }}>Adjust the plan ›</a>
        </Card>

        {/* trend snapshot */}
        <Card>
          <div style={label()}>weight trend</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 6 }}>
            <div style={{ fontFamily: TYPE.mono, fontSize: 26, fontWeight: 600, color: A.ink, lineHeight: 1 }}>
              {curKg > 0 ? fmtWeight(curKg, unit) : "—"}<span style={{ fontSize: 13, color: A.body, fontWeight: 400 }}> {weightLabel(unit)}</span>
            </div>
            {rateStr && <div style={{ fontFamily: TYPE.mono, fontSize: 13, color: rate < 0 ? A.good : rate > 0 ? A.caution.text : A.muted, fontWeight: 600 }}>{rateStr}</div>}
          </div>
          {measured ? <Spark trend={e.trend} disp={disp} /> : <p style={{ ...cap, fontSize: 11.5 }}>A trend line appears once there are a couple of weeks of weigh-ins.</p>}
          <a href="#/trend" style={{ fontFamily: TYPE.mono, fontSize: 12, color: A.good, fontWeight: 600, textDecoration: "none", display: "inline-block", marginTop: 8 }}>Full trend ›</a>
        </Card>

        {/* quick links out */}
        <div className="span-all" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 18px" }}>
          <QuickLink href="#/log">Log a meal or weigh-in</QuickLink>
          <QuickLink href="#/ration">Build the ration</QuickLink>
          <QuickLink href="#/calories">Calorie plan</QuickLink>
          <QuickLink href="#/cats">Cats</QuickLink>
        </div>
      </div>
    </div>
  );
}
