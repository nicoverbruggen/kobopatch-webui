import test from 'node:test';
import assert from 'node:assert/strict';

import nickelCoverFix from '../../src/js/nickelmenu/features/nickel-cover-fix/index.js';
import { NICKELMENU_FEATURES } from '../../src/js/nickelmenu/features/index.js';
import { buildTarGz } from '../../src/js/nickelmenu/archive.js';
import { executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { isOptionalCleanupPresent } from '../../src/js/nickelmenu/probes.js';
import { RecordingDevice, bytes, createInstaller, createProgressRecorder } from './test-helpers.js';

// The mod's published KoboRoot.tgz layout: the NickelHook plugin plus the
// .adds/nickel-cover-fix marker whose *absence* triggers self-uninstall
// (an uninstall_xflag, the same shape as NickelTypeFix and NickelClock).
const nickelCoverFixEntries = [
    { path: 'mnt/onboard/.adds/nickel-cover-fix/uninstall', data: bytes('Delete this file...'), mode: 0o644 },
    { path: 'usr/local/Kobo/imageformats/libnickelcoverfix.so', data: bytes('cover fix plugin'), mode: 0o755 },
];

// Serve a synthetic NickelCoverFix release: a real gzipped tar at the versioned
// asset URL, mirroring the published asset (a bare KoboRoot.tgz, no zip wrapper).
function useNickelCoverFixAssetFetch() {
    const originalFetch = globalThis.fetch;
    // The version/availability come from the build-time manifest (Vite define);
    // set it here so koboRootEntries resolves the pinned version + versioned URL.
    const originalManifest = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = { nickelcoverfix: { version: 'v0.1', available: true } };

    const fetched = [];
    globalThis.fetch = async (url) => {
        fetched.push(url);
        if (url === '/assets/NickelCoverFix.tgz?v=v0.1') {
            const tgz = await buildTarGz(nickelCoverFixEntries);
            return {
                ok: true,
                status: 200,
                async arrayBuffer() {
                    return tgz.buffer.slice(tgz.byteOffset, tgz.byteOffset + tgz.byteLength);
                },
            };
        }
        return { ok: false, status: 404 };
    };

    const restore = () => {
        globalThis.fetch = originalFetch;
        globalThis.__INSTALLABLES__ = originalManifest;
    };
    restore.fetched = fetched;
    return restore;
}

test('nickelcoverfix is an Advanced feature registered in the NickelMenu feature list', () => {
    assert.ok(NICKELMENU_FEATURES.includes(nickelCoverFix));
    assert.equal(nickelCoverFix.section, 'Advanced');
    assert.equal(nickelCoverFix.experimental, true);
    assert.equal(nickelCoverFix.default, false);
    assert.equal(nickelCoverFix.hidden, true);
    // Runtime asset availability is tracked independently of catalogue visibility.
    assert.equal(nickelCoverFix.available, false);
    assert.deepEqual(nickelCoverFix.directories, ['.adds/nickel-cover-fix']);
});

test('koboRootEntries downloads NickelCoverFix and returns its KoboRoot.tgz entries', async () => {
    const restore = useNickelCoverFixAssetFetch();
    try {
        const entries = await nickelCoverFix.koboRootEntries({ progress() {} });
        assert.deepEqual(
            entries.map((e) => e.path),
            nickelCoverFixEntries.map((e) => e.path),
        );
        assert.equal(entries.find((e) => e.path.endsWith('.so')).mode, 0o755);
        // The size index (/assets/index.json) may also be fetched (once per
        // process); the asset itself must be requested at its versioned URL.
        assert.ok(restore.fetched.includes('/assets/NickelCoverFix.tgz?v=v0.1'));
    } finally {
        restore();
    }
});

test('koboRootEntries throws a helpful error when the deployment lacks the asset', async () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = {};
        await assert.rejects(() => nickelCoverFix.koboRootEntries({ progress() {} }), /NickelCoverFix assets not available/);

        // Vite emits locked-but-missing assets with a version and available:false;
        // the feature stays hidden then, but the guard still holds if reached.
        globalThis.__INSTALLABLES__ = { nickelcoverfix: { version: 'v0.1', available: false } };
        await assert.rejects(() => nickelCoverFix.koboRootEntries({ progress() {} }), /NickelCoverFix assets not available/);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('reviewNotices links to the NickelCoverFix repository', () => {
    const notices = nickelCoverFix.reviewNotices();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'info');
    assert.equal(notices[0].title, 'NickelCoverFix');
    assert.equal(notices[0].link.href, 'https://github.com/nicoverbruggen/NickelCoverFix');
});

test('the mod is detected as installed exactly when its uninstall marker exists', async () => {
    // Shared convention for these mods: marker present = installed.
    assert.deepEqual(nickelCoverFix.cleanup.detect, [['.adds', 'nickel-cover-fix', 'uninstall']]);

    const withMarker = new RecordingDevice({
        existingEntries: ['.adds/nickel-cover-fix', { path: '.adds/nickel-cover-fix/uninstall', kind: 'file' }],
    });
    assert.equal(await isOptionalCleanupPresent({ device: withMarker }, nickelCoverFix, ''), true);

    // A leftover folder without the marker means the mod already self-uninstalled.
    const withoutMarker = new RecordingDevice({ existingEntries: ['.adds/nickel-cover-fix'] });
    assert.equal(await isOptionalCleanupPresent({ device: withoutMarker }, nickelCoverFix, ''), false);
});

test('optional cleanup removes the .adds/nickel-cover-fix directory during NickelMenu removal', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/nickel-cover-fix',
            { path: '.adds/nickel-cover-fix/uninstall', kind: 'file' },
            { path: '.adds/nickel-cover-fix/config', kind: 'file' },
            { path: '.adds/nickel-cover-fix/covers', kind: 'directory' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [nickelCoverFix],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    const removal = device.removalFor('.adds/nickel-cover-fix');
    assert.ok(removal, 'expected .adds/nickel-cover-fix to be removed');
    assert.deepEqual(removal.options, { recursive: true });
    // The whole footprint (marker, config, mirrored covers) is gone; the mod
    // self-removes its root-filesystem plugin on the next reboot.
    assert.equal(await device.pathExists(['.adds', 'nickel-cover-fix', 'config']), false);
});

test('optional cleanup still removes the mod while the feature is hidden', async () => {
    // `hidden: true` blocks installation; a mod already on the device
    // must stay detectable and removable.
    const originalHidden = nickelCoverFix.hidden;
    nickelCoverFix.hidden = true;
    try {
        const device = new RecordingDevice({
            existingEntries: ['.adds/nm', '.adds/nickel-cover-fix', { path: '.adds/nickel-cover-fix/uninstall', kind: 'file' }],
        });
        assert.equal(await isOptionalCleanupPresent({ device }, nickelCoverFix, ''), true);

        await executeNickelMenuRemoval({
            device,
            installer: createInstaller(),
            cleanupFeatures: [nickelCoverFix],
            shouldRemoveSyncExclusions: async () => false,
            onProgress: createProgressRecorder(),
        });

        assert.deepEqual(device.removalFor('.adds/nickel-cover-fix').options, { recursive: true });
    } finally {
        if (originalHidden === undefined) delete nickelCoverFix.hidden;
        else nickelCoverFix.hidden = originalHidden;
    }
});

test('optional cleanup tolerates NickelCoverFix already being absent', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({ existingEntries: ['.adds/nm'] });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [nickelCoverFix],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    assert.equal(device.removalFor('.adds/nickel-cover-fix'), undefined);
});
