import { fetchWithProgress } from '../shell/dom.js';
import { sha256Hex } from '../shell/digest.js';
import { announceUpdatedBuild, deployedBuildChanged } from '../shell/deployment.js';
import { TL } from '../shell/strings.js';

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

/** Expected SHA-256 of an installable's archive, or null when the build did not record one. */
export function installableSha256(id) {
    const entry = manifest()[id];
    return entry?.sha256 || null;
}

/**
 * Download a bundled installable and check it against the digest this build was
 * compiled with.
 *
 * The version lives in the query string (`?v=`), which servers ignore, so after
 * a deploy the same URL hands an older page the *new* archive. Nothing else
 * would notice: it would be written to the device and recorded in the manifest
 * under the version this page believes in. The digest is what turns that into a
 * stop, and asking the server which build it is now serving is what turns the
 * stop into advice the user can act on.
 */
export async function fetchInstallableAsset(id, file, { onProgress, errorPrefix } = {}) {
    const bytes = await fetchWithProgress(installableAssetUrl(id, file), onProgress, errorPrefix);

    const expected = installableSha256(id);
    if (!expected) return bytes;

    const actual = await sha256Hex(bytes);
    if (actual === expected) return bytes;

    if (await deployedBuildChanged()) {
        // The page is running code the server has replaced: say so and let the
        // user reload. The throw stops the install either way.
        announceUpdatedBuild();
        throw new Error(TL.ERROR.ASSET_STALE_PAGE);
    }

    throw new Error(TL.ERROR.ASSET_CORRUPT(file));
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
