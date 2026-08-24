import { useEffect, useState } from "react";

// Minimal hash-based router: no dependency, and hash routes never hit the server, so it
// works on GitHub Pages with no 404.html SPA-fallback trick. Navigate with plain
// <a href="#/expenditure"> links anywhere in the tree.
export function useHashRoute(fallback = "home") {
  // Anything after "?" is a parameter for the page, not part of its name — "#/foods?new=Rabbit"
  // is still the foods route. Without this the whole string was the route and matched no page.
  const read = () => window.location.hash.replace(/^#\/?/, "").split("?")[0] || fallback;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return route;
}

// One parameter off the current hash ("#/foods?new=Fancy%20Rabbit" → "Fancy Rabbit"), or "".
// Read once when a page mounts; navigation remounts it, which is the only time it matters.
export function hashParam(name) {
  const q = (typeof window === "undefined" ? "" : window.location.hash).split("?")[1] || "";
  return new URLSearchParams(q).get(name) || "";
}
