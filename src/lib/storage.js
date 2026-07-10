// Persistence, kept deliberately separate from every bit of domain semantics.
// This module knows how to load/save one JSON blob and nothing about cats.
//
// Backend is localStorage. The interface is async so it can be swapped for a
// backend (fetch, IndexedDB, a sync service) without touching the app: keep the
// { load, save, clear } shape and the usePersistence hook stays as-is.

import { useEffect, useState } from "react";

const STORE_KEY = "catration_v1";

const hasStore = () => {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false; // some privacy modes throw on access
  }
};

export const store = {
  async load() {
    try {
      if (!hasStore()) return null;
      const raw = window.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async save(data) {
    try {
      if (hasStore()) window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota / private-mode errors */
    }
  },
  async clear() {
    try {
      if (hasStore()) window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

// Load once on mount, then autosave (debounced) whenever `data` changes.
// `hydrate` is called with the loaded blob so the caller can spread it into state.
// Returns `loaded` — false until the initial read resolves, so callers can hold
// rendering (and skip saving) until saved state is in place.
export function usePersistence(data, hydrate) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    store.load().then((d) => {
      if (!live) return;
      if (d) hydrate(d);
      setLoaded(true);
    });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = JSON.stringify(data);
  useEffect(() => {
    if (!loaded) return; // don't overwrite saved state before hydration
    const id = setTimeout(() => store.save(JSON.parse(snapshot)), 400);
    return () => clearTimeout(id);
  }, [loaded, snapshot]);
  return loaded;
}
