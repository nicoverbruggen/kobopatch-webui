import './dom-harness.js'; // ReloadBanner looks its elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { ReloadBanner } from '../../src/js/flows/patches/ReloadBanner.js';
import { buildAdditionalFilesTgz, sha256Hex } from '../../src/js/patches/additional-files.js';

// Baseline for every expectation here is `patches-flow.js` at `e18299f`:
// `maybeOfferReload` (266-291) and `readReloadAdditionalFiles` (298-325).
//
// Two of these have no coverage anywhere else in the repo. The seven E2E reload
// tests fabricate the manifest and archive themselves and seed them onto the mock
// device, which exercises the happy read path well but never the ordering between
// revealing the banner and resolving the archive, and never a manifest that
// records a sha256 but no size.

const MANIFEST_PATH = ['.kobopatch-webui', 'custom-patches.json'];
const ARCHIVE_PATH = ['.kobopatch-webui', 'custom-patches-files.tgz'];

const pathKey = (parts) => parts.join('/');

/**
 * A session whose device serves `files` (a path-key -> value map). `readFile`
 * returns text, `readFileBytes` returns bytes.
 */
function makeSession(files = {}, overrides = {}) {
    return {
        manualMode: false,
        patchesLoaded: true,
        reloadManifest: null,
        reloadAdditionalFiles: null,
        device: {
            directoryHandle: {},
            readFile: async (parts) => files[pathKey(parts)] ?? null,
            readFileBytes: async (parts) => files[pathKey(parts)] ?? null,
        },
        ...overrides,
    };
}

function makeBanner(session) {
    const calls = [];
    const step = {
        session,
        renderPatchList: () => calls.push('renderPatchList'),
        updatePatchCount: () => calls.push('updatePatchCount'),
        revealAdvancedSection: () => calls.push('revealAdvancedSection'),
    };
    // The banner borrows its owner's signal rather than owning a controller, so
    // the fake step has to supply one the way `PatchesStep` does.
    return { banner: new ReloadBanner(step, new AbortController().signal), calls };
}

/** A manifest plus a matching archive, built the way the app builds them. */
async function manifestWithArchive(entries, { omitSize = false, badSha = false } = {}) {
    const archiveBytes = await buildAdditionalFilesTgz(entries);
    const sha256 = badSha ? 'f'.repeat(64) : await sha256Hex(archiveBytes);
    const archiveRef = { path: '.kobopatch-webui/custom-patches-files.tgz', sha256 };
    if (!omitSize) archiveRef.size = archiveBytes.length;
    return {
        archiveBytes,
        manifest: {
            overrides: {},
            customized: {},
            files: entries.map((e) => ({ path: e.path, type: 'additional-file', sourceName: e.sourceName, size: e.data.length })),
            additionalFilesArchive: archiveRef,
        },
    };
}

const ENTRY = { path: 'extra.txt', sourceName: 'extra.txt', data: new TextEncoder().encode('hi!!'), mode: 0o644 };

test('the prologue resets the banner on every entry, before any early return', async () => {
    // A user who reloads and then navigates back must get a clean offer again
    // rather than a stale green banner with the button hidden. Manual mode returns
    // early, so this is the case that proves the prologue is not behind the guard.
    const { banner } = makeBanner(makeSession({}, { manualMode: true }));

    banner.banner.hidden = false;
    banner.banner.classList.remove('banner--info');
    banner.banner.classList.add('banner--success');
    banner.btnReload.hidden = true;
    banner.btnReload.disabled = true;
    banner.text.textContent = 'stale';

    await banner.maybeOffer();

    assert.equal(banner.banner.hidden, true);
    assert.equal(banner.btnReload.hidden, false);
    assert.equal(banner.btnReload.disabled, false);
    assert.equal(banner.banner.classList.contains('banner--info'), true);
    assert.equal(banner.banner.classList.contains('banner--success'), false);
    assert.notEqual(banner.text.textContent, 'stale');
});

test('the banner is revealed only after the archive read resolves', async () => {
    // Baseline 287-289: `reloadManifest` is set, the archive read is awaited, and
    // only then is the banner shown. Reveal first and a fast click on the button
    // reads `reloadAdditionalFiles` while it is still null and silently restores
    // nothing. There is no E2E test for this race.
    const { archiveBytes, manifest } = await manifestWithArchive([ENTRY]);
    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify(manifest),
        [pathKey(ARCHIVE_PATH)]: archiveBytes,
    });

    const { banner } = makeBanner(session);
    banner.banner.hidden = true;

    let hiddenWhileArchiveOutstanding = null;
    const realReadBytes = session.device.readFileBytes;
    session.device.readFileBytes = async (parts) => {
        hiddenWhileArchiveOutstanding = banner.banner.hidden;
        return realReadBytes(parts);
    };

    await banner.maybeOffer();

    assert.equal(hiddenWhileArchiveOutstanding, true, 'the banner must still be hidden while the archive is being read');
    assert.equal(banner.banner.hidden, false);
    assert.equal(banner.additionalFiles.length, 1);
});

test('a manifest that describes nothing to re-apply shows no banner', async () => {
    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify({ overrides: { 'src/nickel.yaml': { 'Some patch': false } }, customized: {}, files: [] }),
    });
    const { banner } = makeBanner(session);
    banner.banner.hidden = false;

    await banner.maybeOffer();

    assert.equal(banner.banner.hidden, true);
    assert.equal(banner.manifest, null);
});

test('a corrupt manifest is swallowed and shows no banner', async () => {
    const session = makeSession({ [pathKey(MANIFEST_PATH)]: '{ not json' });
    const { banner } = makeBanner(session);
    banner.banner.hidden = false;

    await banner.maybeOffer();

    assert.equal(banner.banner.hidden, true);
    assert.equal(banner.manifest, null);
});

test('an archive whose checksum does not match restores nothing but still offers the reload', async () => {
    // The banner tracks the manifest, not the archive: patches can still be
    // re-applied even when the files cannot be recovered.
    const { archiveBytes, manifest } = await manifestWithArchive([ENTRY], { badSha: true });
    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify(manifest),
        [pathKey(ARCHIVE_PATH)]: archiveBytes,
    });
    const { banner } = makeBanner(session);

    await banner.maybeOffer();

    assert.equal(banner.banner.hidden, false);
    assert.equal(banner.additionalFiles, null);
});

test('a manifest that records a sha256 but no size still verifies on the hash alone', async () => {
    // The size check is guarded by `typeof === 'number'`, so an older manifest
    // written before `size` was recorded still restores. Tightening that to a
    // truthy check would break those silently — and would also reject a
    // legitimately recorded `size: 0`.
    const { archiveBytes, manifest } = await manifestWithArchive([ENTRY], { omitSize: true });
    assert.equal(manifest.additionalFilesArchive.size, undefined);

    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify(manifest),
        [pathKey(ARCHIVE_PATH)]: archiveBytes,
    });
    const { banner } = makeBanner(session);

    await banner.maybeOffer();

    assert.equal(banner.additionalFiles.length, 1);
    assert.equal(banner.additionalFiles[0].destination, 'extra.txt');
});

test('a size that does not match is rejected before the hash is computed', async () => {
    const { archiveBytes, manifest } = await manifestWithArchive([ENTRY]);
    manifest.additionalFilesArchive.size = archiveBytes.length + 1;

    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify(manifest),
        [pathKey(ARCHIVE_PATH)]: archiveBytes,
    });
    const { banner } = makeBanner(session);

    await banner.maybeOffer();

    assert.equal(banner.additionalFiles, null);
});

test('an archive missing one of the manifest paths restores the subset it does carry', async () => {
    // Only a completely unmatched archive returns null; a partial one silently
    // restores what it has.
    const { archiveBytes, manifest } = await manifestWithArchive([ENTRY]);
    manifest.files.push({ path: 'missing.txt', type: 'additional-file', sourceName: 'missing.txt', size: 1 });

    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify(manifest),
        [pathKey(ARCHIVE_PATH)]: archiveBytes,
    });
    const { banner } = makeBanner(session);

    await banner.maybeOffer();

    assert.equal(banner.additionalFiles.length, 1);
    assert.equal(banner.additionalFiles[0].destination, 'extra.txt');
});

test('a manifest with no archive reference restores nothing and still offers the reload', async () => {
    const session = makeSession({
        [pathKey(MANIFEST_PATH)]: JSON.stringify({
            overrides: { 'src/nickel.yaml': { 'Some patch': true } },
            customized: {},
            files: [{ path: 'extra.txt', type: 'additional-file' }],
        }),
    });
    const { banner } = makeBanner(session);

    await banner.maybeOffer();

    assert.equal(banner.banner.hidden, false);
    assert.equal(banner.additionalFiles, null);
});
