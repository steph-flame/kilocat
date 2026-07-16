import { C } from "../theme.js";

// The brand mark: an ink-drawn sitting cat, lifted verbatim from the approved Companion
// mockups (direction-g-companion.html). Pure decoration — aria-hidden, with the page
// supplying its own heading/label for screen readers — sized via `size` (px, width; height
// follows the 200x190 viewBox aspect ratio).
export default function CatMark({ size = 96, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={(size * 190) / 200}
      viewBox="0 0 200 190"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <g stroke={C.ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        {/* body: back arc from behind head down to haunch, sitting */}
        <path d="M118,86 C150,96 166,122 164,150 C163,164 154,172 138,174 L74,174" />
        {/* tail: from haunch, along ground, curling up at tip */}
        <path d="M160,158 C178,168 186,158 182,146" />
        {/* chest/front: from chin down to front paws */}
        <path d="M76,96 C68,112 66,140 70,174" />
        {/* front paw line */}
        <path d="M96,174 C96,164 92,158 88,156" />
        {/* head outline with ears */}
        <path d="M64,74 C60,62 64,50 72,44 L74,26 L90,36 C96,33 104,33 110,36 L126,26 L128,44 C136,52 138,64 134,74 C130,86 118,92 100,92 C82,92 68,86 64,74 Z" />
        {/* happy closed eyes */}
        <path d="M84,64 C87,68 91,68 94,64" />
        <path d="M106,64 C109,68 113,68 116,64" />
        {/* nose */}
        <path d="M98,76 L102,76 L100,79 Z" />
        {/* whiskers */}
        <line x1="58" y1="70" x2="42" y2="66" />
        <line x1="58" y1="76" x2="42" y2="78" />
        <line x1="142" y1="70" x2="158" y2="66" />
        <line x1="142" y1="76" x2="158" y2="78" />
      </g>
    </svg>
  );
}
