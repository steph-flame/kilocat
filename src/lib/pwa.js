// iOS install-nudge helpers. No React — mirrors storage.js's defensive window access.
//
// Why: iOS Safari evicts localStorage (and with it months of weigh-in logs) after 7 days
// unused in a browser tab; a home-screen-installed PWA is exempt. So install is data-loss
// protection, worth a one-line nudge — shown only to the browser tab that's actually at risk.

const OTHER_IOS_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i; // WebKit wrappers, not Safari itself
const DISMISS_KEY = "catration_pwa_banner_dismissed";

// iPadOS 13+ requests the desktop site by default, so an iPad's UA reads as plain
// "Macintosh" — indistinguishable from real macOS Safari except that iPads are touch.
export function isIOSSafari(ua = "", maxTouchPoints = 0) {
  const isIOSUA = /iPad|iPhone|iPod/.test(ua);
  const isIPadDesktopUA = /Macintosh/.test(ua) && maxTouchPoints > 1;
  const isSafari = /Safari/i.test(ua) && !OTHER_IOS_BROWSER.test(ua);
  return (isIOSUA || isIPadDesktopUA) && isSafari;
}

export function isStandalone() {
  try {
    return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false; // no window (SSR/tests) — not installed, nothing to hide
  }
}

export function isBannerDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // private mode etc. — banner just won't stay dismissed, not fatal
  }
}

export function dismissBanner() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore — same as storage.js: quota/private-mode errors aren't fatal here */
  }
}
