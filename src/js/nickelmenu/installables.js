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

/**
 * The version a feature installs, or null when it has none.
 *
 * A feature either carries its own (`better-typography` ships NickelTypeFix, so
 * its id does not match the installable's), or its id is the installable's id.
 * Resolved from the manifest rather than from the feature object alone, so it
 * works for code paths that never went through the flow's decoration step.
 */
export function featureVersion(feature) {
    const own = typeof feature?.version === 'function' ? feature.version() : feature?.version;
    return own || installableVersion(feature?.id) || null;
}

/**
 * Compare two version strings loosely: `v2026.07.1`, `2.5.0` and `v0.7` all
 * parse. Returns -1/0/1, or null when either side holds no digits at all — the
 * caller must then say nothing about direction.
 */
export function compareVersions(a, b) {
    const parse = (v) =>
        String(v ?? '')
            .replace(/^v/i, '')
            .split(/[^0-9]+/)
            .filter(Boolean)
            .map(Number);
    const [x, y] = [parse(a), parse(b)];
    if (x.length === 0 || y.length === 0) return null;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const diff = (x[i] ?? 0) - (y[i] ?? 0);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

/**
 * Whether installing this feature would move it forward. Only true when the
 * installed version is provably older: an unknown version, an unparseable one,
 * or one newer than what is bundled (a rolled-back pin, or a mod that updated
 * itself past us) all read as "leave it alone".
 */
export function isUpgrade(installedVersion, feature) {
    const bundled = featureVersion(feature);
    if (!installedVersion || !bundled) return false;
    return compareVersions(installedVersion, bundled) === -1;
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
