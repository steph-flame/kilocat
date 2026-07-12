import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { C } from "../theme.js";
import { num } from "../lib/util.js";

// A short human hint of a saved food's energy, for the dropdown row.
const hintFor = (f) =>
  f.mode === "perKg"
    ? (num(f.kcalPerKg) > 0 ? `${num(f.kcalPerKg)} kcal/kg` : "dry")
    : (num(f.kcalPerUnit) > 0 ? `${num(f.kcalPerUnit)} kcal/can` : "wet");

// Name field with live search over the saved-food library. Typing filters saved
// foods by name; picking one prefills the row's macros. Typing a brand-new name is
// fine too — it just sets the name; the bookmark button on the row saves it to the library.
export default function FoodSearch({ value, onChangeName, onPick, search }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef(null);

  const matches = (open ? search(value) : []).slice(0, 8);
  const show = open && matches.length > 0;

  const choose = (food) => {
    onPick(food);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!show) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      // Only hijack Enter when the typed name isn't already an exact match.
      const exact = matches.some((m) => m.name.toLowerCase() === value.trim().toLowerCase());
      if (!exact && matches[active]) { e.preventDefault(); choose(matches[active]); }
    }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative flex-1">
      <div className="flex items-center gap-1.5">
        <Search size={14} style={{ color: C.faint }} className="shrink-0" />
        <input
          value={value}
          onChange={(e) => { onChangeName(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
          onKeyDown={onKeyDown}
          placeholder="Food name — type to search saved foods"
          className="flex-1 text-sm font-medium bg-transparent outline-none w-full"
          aria-label="Food name" aria-autocomplete="list" aria-expanded={show}
        />
      </div>
      {show && (
        <ul
          style={{ background: C.card, borderColor: C.line }}
          className="absolute z-10 left-0 right-0 mt-1 border rounded-xl shadow-sm overflow-hidden max-h-60 overflow-y-auto"
          // keep the input focused through the mousedown so onPick fires before blur
          onMouseDown={(e) => { e.preventDefault(); clearTimeout(blurTimer.current); }}
        >
          {matches.map((f, i) => (
            <li key={f.id ?? f.name}>
              <button
                type="button"
                onClick={() => choose(f)}
                onMouseEnter={() => setActive(i)}
                style={{ background: i === active ? C.spruceSoft : "transparent" }}
                className="w-full text-left px-3 py-2 flex items-baseline justify-between gap-3"
              >
                <span style={{ color: C.ink }} className="text-sm truncate">{f.name}</span>
                <span style={{ color: C.faint }} className="text-xs font-mono shrink-0">{hintFor(f)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
