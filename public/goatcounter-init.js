// GoatCounter config, kept OUT of index.html so the Content-Security-Policy can forbid inline
// script entirely (script-src 'self' with no 'unsafe-inline'). Loads before count.js, which is
// async — a plain classic script in <head> always executes first.
//
// The path hook records the hash route so #/ration and #/trend count as distinct pages; the
// hashchange listener counts in-app navigation, not just first loads.
window.goatcounter = { path: () => location.pathname + location.hash };
window.addEventListener("hashchange", () => {
  if (window.goatcounter.count) window.goatcounter.count({ path: location.pathname + location.hash });
});
