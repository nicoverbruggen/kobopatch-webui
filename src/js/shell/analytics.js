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
        window.umami.track(eventName, data);
    } catch {
        // Silently ignore tracking errors
    }
}
