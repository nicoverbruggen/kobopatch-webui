/**
 * Privacy-focused analytics wrapper.
 * Only tracks events when Umami is loaded (via server-side injection).
 * No personal identifiers are ever sent.
 */

export function isEnabled() {
    return !!window.__ANALYTICS_ENABLED;
}

export function track(eventName, data) {
    if (!isEnabled() || typeof window.umami === 'undefined') return;
    try {
        // umami.track is async, so it returns a promise even when it fails. A
        // bare call would leave that promise unhandled, and the app's global
        // `unhandledrejection` handler treats an unhandled rejection as a crash
        // — so a failing tracker could put the error screen up, which reports
        // another event, which fails again. Swallow both halves: the synchronous
        // throw and the rejection.
        Promise.resolve(window.umami.track(eventName, data)).catch(() => {});
    } catch {
        // Silently ignore tracking errors
    }
}
