import { A } from "../almanac.js";

// A parametric ink silhouette of a cat, side profile, whose body condition morphs with the
// 9-point score. Drawn (not photographed) so there's nothing to license — the shapes trace the
// same cues a WSAVA/Purina BCS chart uses: at the thin end a deep abdominal tuck and a spine you
// could count; at the heavy end the tuck fills, the belly sags into a pendulous fat pad below the
// legs, the back broadens, and the tail base thickens. `t` runs 0 (BCS 1) → 1 (BCS 9).
//
// Composited from a few simple shapes rather than one heroic path: legs and tail sit behind, the
// torso + head + ears on top. Everything is filled A.ink so it reads as a single inked figure.

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export default function BcsCat({ score = 5, height = 150, style }) {
  const t = clamp((score - 1) / 8, 0, 1);

  // --- torso: fixed topline, morphing belly line (front → mid → rear) ---
  const yNape = 42;                       // top of the shoulders, at the front
  const yRump = lerp(44, 39, t);          // haunch lifts a touch as fat pads the lower back
  const yBellyFront = lerp(72, 81, t);    // just behind the front legs
  const yBellyMid = lerp(63, 95, t);      // the tell: tucked up high when thin, sagging low when fat
  const yBellyRear = lerp(57, 88, t);     // deep tuck at the flank when thin

  const body = [
    `M150,${yNape}`,
    `C124,36 74,${yRump - 3} 46,${yRump}`,        // topline, nape → rump
    `Q42,${yBellyRear - 7} 58,${yBellyRear}`,     // round the haunch down to the flank
    `Q100,${yBellyMid} 148,${yBellyFront}`,       // the belly line
    `Q157,${(yBellyFront + yNape) / 2} 150,${yNape}`, // up the chest, back to the nape
    "Z",
  ].join(" ");

  // --- tail: thin whip when lean, thick base when heavy ---
  const tailW = lerp(4.5, 9, t);
  const tail = `M48,${yRump + 2} C28,${yRump} 18,26 27,13`;

  // legs sit behind the torso; a lean cat's tuck reveals the gap between them, a fat cat's
  // belly sags down over it. Ground line at y=104.
  const legY = 78, groundY = 104, legW = lerp(6.5, 8.5, t);
  const legs = [132, 143, 55, 67];

  return (
    <svg viewBox="0 0 200 116" width="100%" height={height} style={{ display: "block", ...style }} role="img" aria-label={`Body condition ${score} of 9 illustration`}>
      {legs.map((x) => (
        <rect key={x} x={x - legW / 2} y={legY} width={legW} height={groundY - legY} rx={legW / 2} fill={A.ink} />
      ))}
      <path d={tail} fill="none" stroke={A.ink} strokeWidth={tailW} strokeLinecap="round" />
      <path d={body} fill={A.ink} />
      {/* head + ears, over the chest join */}
      <circle cx="166" cy="46" r="17" fill={A.ink} />
      <path d="M152,34 L150,17 L164,29 Z" fill={A.ink} />
      <path d="M170,29 L180,15 L181,34 Z" fill={A.ink} />
      {/* a lean cat shows a hint of ribs; a heavy one shows nothing but a smooth flank */}
      {t < 0.28 && (
        <g stroke={A.card} strokeWidth="1.4" strokeLinecap="round" opacity={0.7 - t}>
          <path d="M120,54 q3,7 1,14" fill="none" />
          <path d="M128,53 q3,7 1,14" fill="none" />
        </g>
      )}
    </svg>
  );
}
