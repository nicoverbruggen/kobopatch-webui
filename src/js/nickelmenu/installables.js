/**
 * Build-time manifest of bundled installable assets.
 *
 * `scripts/build.mjs` derives this from `installables.lock` and injects it via
 * esbuild `define` (`globalThis.__INSTALLABLES__`), so the app knows each add-on's
 * pinned version and whether this deployment shipped its asset — without any
 * runtime `*-release.json` fetch. Shape: `{ <id>: { version, available } }`.
 *
 * Read lazily (not captured at import time) so unit tests can set the global
 * before exercising a feature, and so the `{}` fallback applies when a build
 * didn't inject it (e.g. raw-source test runs).
 */
function manifest() {
    return (typeof globalThis !== 'undefined' && globalThis.__INSTALLABLES__) || {};
}

/** Pinned version string for an installable id, or null if not in the manifest. */
export function installableVersion(id) {
    const entry = manifest()[id];
    return entry ? entry.version : null;
}

/** Whether this deployment shipped the installable's asset. */
export function installableAvailable(id) {
    const entry = manifest()[id];
    return !!(entry && entry.available);
}

/** The full manifest object (used by app.js to mark features available at startup). */
export function installablesManifest() {
    return manifest();
}

/**
 * Build a version-suffixed, cacheable asset URL: `/assets/<file>?v=<version>`.
 * The `?v=` makes the URL change whenever the pinned version does, so the server
 * (and a CDN) can serve the large archives as `immutable`. Falls back to the bare
 * path when the version is unknown.
 */
export function installableAssetUrl(id, file) {
    const version = installableVersion(id);
    const path = `/assets/${file}`;
    return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}
