const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const { primary } = require('../config/firmware-config');

// Anchor everything to the repo root so specs never depend on their own depth.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const CACHED_ASSETS = path.resolve(__dirname, '..', 'cached_assets');
const WEBROOT = path.join(REPO_ROOT, 'dist');
const WEBROOT_FIRMWARE = path.join(WEBROOT, '_test_firmware.zip');

// Path resolvers, grouped so call sites read self-documentingly (paths.repo /
// paths.src) and never count `..` to reach the repo root.
const paths = {
    // Absolute filesystem path to a repo-root-relative file, e.g.
    // paths.repo('patches', 'blacklist.json'). Replaces brittle
    // `path.join(__dirname, '..', '..', ...)` chains that break when a spec moves.
    repo: (...segments) => path.join(REPO_ROOT, ...segments),

    // Dynamic-import specifier for an app ESM module under `src/`, e.g.
    //   await import(paths.src('js/patches/patch-metadata.js'))
    // Keeps the `import()` explicit at the call site while avoiding the brittle
    // `../../../../src` specifiers whose depth silently breaks when a spec moves.
    src: (relPath) => pathToFileURL(path.join(SRC_DIR, relPath)).href,
};

// The cached primary-version firmware zip. E2E never downloads it: tests use it
// only when present (and skip otherwise), and the app's firmware URLs are
// redirected to a local symlink of this file. Set FIRMWARE_ZIP to reuse a copy
// you already have anywhere on disk instead of caching another ~150 MB download
// (same env var the WASM/patch test scripts honor).
const FIRMWARE_PATH = process.env.FIRMWARE_ZIP ? path.resolve(process.env.FIRMWARE_ZIP) : path.join(CACHED_ASSETS, `kobo-update-${primary.version}.zip`);

let cachedOriginalTgzSha1 = null;
// Computes the SHA1 of KoboRoot.tgz inside the firmware zip. Used as a
// reference for the "restore original firmware" flow.
async function getOriginalTgzSha1() {
    if (cachedOriginalTgzSha1) return cachedOriginalTgzSha1;
    const zip = await JSZip.loadAsync(fs.readFileSync(FIRMWARE_PATH));
    const entry = zip.file('KoboRoot.tgz');
    if (!entry) throw new Error(`KoboRoot.tgz not found in ${FIRMWARE_PATH}`);
    const data = await entry.async('nodebuffer');
    cachedOriginalTgzSha1 = crypto.createHash('sha1').update(data).digest('hex');
    return cachedOriginalTgzSha1;
}

module.exports = {
    FIRMWARE_PATH,
    WEBROOT,
    WEBROOT_FIRMWARE,
    paths,
    getOriginalTgzSha1,
};
