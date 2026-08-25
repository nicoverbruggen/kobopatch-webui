/**
 * Build-time manifest of bundled installable assets.
 *
 * `scripts/build.mjs` derives this from `installables.lock` and injects it via
 * Vite `define` (`globalThis.__INSTALLABLES__`), so the app knows each add-on's
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

/** Whether this deployment actually bundled the installable's archive. */
export function installableAvailable(id) {
    return manifest()[id]?.available === true;
}

/** The full manifest object (used by app.js to mark features available at startup). */
export function installablesManifest() {
    return manifest();
}

/**
 * The served asset index (`/assets/index.json`, written by tools/installables).
 * It maps each id to `{ asset, version, size }` so the app can show the expected
 * download size — the lockfile that holds these sizes isn't served. Fetched once
 * and cached; resolves to `{}` if the index is missing (e.g. an old deployment).
 */
let indexPromise = null;
function loadIndex() {
    if (!indexPromise) {
        indexPromise = fetch('/assets/index.json')
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}));
    }
    return indexPromise;
}

/** Expected download size in bytes for an installable id, or null if unknown. */
export async function installableSize(id) {
    const entry = (await loadIndex())[id];
    return entry && typeof entry.size === 'number' ? entry.size : null;
}

/**
 * A pinned version as it should be shown to the user. Upstream tags are not
 * consistent — most carry a `v` prefix, some (SimpleUI's `2.5.0`) do not — so a
 * version that starts with a digit gets one, keeping the version pills in the
 * feature list uniform. The lock and the asset URL keep the real tag, since that
 * is what upstream serves and what the update check compares against.
 */
export function displayVersion(version) {
    if (typeof version !== 'string' || version === '') return version;
    return /^\d/.test(version) ? `v${version}` : version;
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
