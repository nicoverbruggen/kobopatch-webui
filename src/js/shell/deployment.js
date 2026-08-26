/**
 * deployment.js — Tells whether the build this page was loaded from is still the
 * one being served.
 *
 * The app is deployed by replacing every file in place, so a page left open
 * across a deploy keeps running old code while the server has moved on. Its own
 * markup and bundle are already in memory and keep working, but anything it
 * downloads later comes from the new build. That is the difference between "this
 * download is corrupt" and "reload the page", and only the server can settle it.
 */

/** The bundle hash this page was loaded with, from its own script tag. */
function loadedBundleHash() {
    if (typeof document === 'undefined') return null;
    const script = document.querySelector('script[src*="bundle.js"]');
    const match = script?.getAttribute('src')?.match(/[?&]h=([^&]+)/);
    return match ? match[1] : null;
}

function loadedVersion() {
    return typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : null;
}

/**
 * Whether the server is now serving a different build than this page came from.
 *
 * Returns false when it cannot tell — an unreachable or malformed `version.json`
 * must never turn into a "the app was updated" claim, because the far more
 * likely explanation for a failed download is an ordinary one.
 */
export async function deployedBuildChanged() {
    try {
        const resp = await fetch('/version.json', { cache: 'no-store' });
        if (!resp.ok) return false;
        const served = await resp.json();
        if (!served || typeof served !== 'object') return false;

        const version = loadedVersion();
        const bundle = loadedBundleHash();
        if (version && served.version && served.version !== version) return true;
        // The bundle hash changes with any deploy, including one that ships the
        // same version number, which a rolling update usually is.
        return Boolean(bundle && served.bundle && served.bundle !== bundle);
    } catch {
        return false;
    }
}

/**
 * Tell the user the app moved on under them.
 *
 * Only ever called when a download did not match the digest this build pinned
 * and the server confirms a different build. At that point the page cannot
 * finish what it started, so the modal offers one way out — reloading — and no
 * way to dismiss it, because carrying on with stale code is not an option worth
 * offering. Nothing has been written to the device at this stage: the install
 * collects every file before it touches the Kobo.
 *
 * The reload is the user's press, not a timer. It is their session, and a page
 * that reloads itself while they are reading is its own kind of rude.
 */
export function announceUpdatedBuild() {
    if (typeof document === 'undefined') return;

    const dialog = document.getElementById('app-updated-dialog');
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
        dialog.showModal();
    }
}
