import test from 'node:test';
import assert from 'node:assert/strict';

import betterTypography, { includesNickelTypeFix } from '../../src/js/nickelmenu/features/better-typography/index.js';
import { buildTarGz } from '../../src/js/nickelmenu/archive.js';
import { executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { RecordingDevice, bytes, createInstaller, createProgressRecorder } from './test-helpers.js';

// The mod's published KoboRoot.tgz layout: the NickelHook plugin plus the
// .adds/nickel-type-fix marker whose *absence* triggers self-uninstall
// (an uninstall_xflag, the same shape as NickelClock).
const nickelTypeFixEntries = [
    { path: 'mnt/onboard/.adds/nickel-type-fix/uninstall', data: bytes('Delete this file...'), mode: 0o644 },
    { path: 'usr/local/Kobo/imageformats/libnickeltypefix.so', data: bytes('type fix plugin'), mode: 0o755 },
];

// Serve a synthetic NickelTypeFix release: a real gzipped tar at the versioned
// asset URL, mirroring the published asset (a bare KoboRoot.tgz, no zip wrapper).
function useNickelTypeFixAssetFetch() {
    const originalFetch = globalThis.fetch;
    // The version/availability come from the build-time manifest (Vite define);
    // set it here so koboRootEntries resolves the pinned version + versioned URL.
    const originalManifest = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = { nickeltypefix: { version: 'v0.3', available: true } };

    const fetched = [];
    globalThis.fetch = async (url) => {
        fetched.push(url);
        if (url === '/assets/NickelTypeFix.tgz?v=v0.3') {
            const tgz = await buildTarGz(nickelTypeFixEntries);
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

test('includesNickelTypeFix requires the shipped asset only', () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = { nickeltypefix: { version: 'v0.3', available: true } };
        assert.equal(includesNickelTypeFix({ firmware: '4.45.23646' }), true);
        assert.equal(includesNickelTypeFix({ firmware: '4.20.14622' }), true);
        assert.equal(includesNickelTypeFix(null), true);
        assert.equal(includesNickelTypeFix({ firmware: null }), true);

        // A deployment without the asset never contributes the mod.
        globalThis.__INSTALLABLES__ = {};
        assert.equal(includesNickelTypeFix({ firmware: '4.45.23646' }), false);

        // Vite emits locked-but-missing assets with a version and available:false.
        globalThis.__INSTALLABLES__ = { nickeltypefix: { version: 'v0.3', available: false } };
        assert.equal(includesNickelTypeFix({ firmware: '4.45.23646' }), false);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('koboRootEntries downloads NickelTypeFix and returns its KoboRoot.tgz entries', async () => {
    const restore = useNickelTypeFixAssetFetch();
    try {
        const entries = await betterTypography.koboRootEntries({ progress() {}, deviceInfo: { firmware: '4.45.23646' } });
        assert.deepEqual(
            entries.map((e) => e.path),
            nickelTypeFixEntries.map((e) => e.path),
        );
        assert.equal(entries.find((e) => e.path.endsWith('.so')).mode, 0o755);
    } finally {
        restore();
    }
});

test('koboRootEntries downloads NickelTypeFix regardless of the feature-local firmware', async () => {
    const restore = useNickelTypeFixAssetFetch();
    try {
        const entries = await betterTypography.koboRootEntries({ progress() {}, deviceInfo: { firmware: '4.20.14622' } });
        assert.deepEqual(
            entries.map((e) => e.path),
            nickelTypeFixEntries.map((e) => e.path),
        );
        assert.deepEqual(restore.fetched, ['/assets/NickelTypeFix.tgz?v=v0.3']);
    } finally {
        restore();
    }
});

test('koboRootEntries contributes nothing when the deployment lacks the asset', async () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = {};
        const entries = await betterTypography.koboRootEntries({ progress() {}, deviceInfo: { firmware: '4.45.23646' } });
        assert.deepEqual(entries, []);

        globalThis.__INSTALLABLES__ = { nickeltypefix: { version: 'v0.3', available: false } };
        const unavailableEntries = await betterTypography.koboRootEntries({ progress() {}, deviceInfo: { firmware: '4.45.23646' } });
        assert.deepEqual(unavailableEntries, []);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('reviewNotices mentions NickelTypeFix exactly when the mod will be included', () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = { nickeltypefix: { version: 'v0.3', available: true } };
        const notices = betterTypography.reviewNotices({ deviceInfo: { firmware: '4.45.23646' } });
        assert.equal(notices.length, 1);
        assert.equal(notices[0].mod.name, 'NickelTypeFix');
        assert.equal(notices[0].mod.href, 'https://github.com/nicoverbruggen/NickelTypeFix');

        assert.equal(betterTypography.reviewNotices({ deviceInfo: { firmware: '4.20.14622' } }).length, 1);

        globalThis.__INSTALLABLES__ = {};
        assert.deepEqual(betterTypography.reviewNotices({ deviceInfo: { firmware: '4.45.23646' } }), []);

        globalThis.__INSTALLABLES__ = { nickeltypefix: { version: 'v0.3', available: false } };
        assert.deepEqual(betterTypography.reviewNotices({ deviceInfo: { firmware: '4.45.23646' } }), []);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('optional cleanup removes the .adds/nickel-type-fix directory during NickelMenu removal', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/nickel-type-fix',
            { path: '.adds/nickel-type-fix/uninstall', kind: 'file' },
            { path: '.adds/nickel-type-fix/config', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [betterTypography],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    const removal = device.removalFor('.adds/nickel-type-fix');
    assert.ok(removal, 'expected .adds/nickel-type-fix to be removed');
    assert.deepEqual(removal.options, { recursive: true });
    // The whole footprint is gone; the mod self-removes its root-filesystem
    // plugin on the next reboot once the uninstall marker is missing.
    assert.equal(await device.pathExists(['.adds', 'nickel-type-fix', 'config']), false);
});

test('optional cleanup tolerates NickelTypeFix already being absent', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        textFiles: {
            '.kobo/Kobo/Kobo eReader.conf': '[Reading]\nwebkitTextRendering=optimizeLegibility\nreadingAlignment=Left\n',
        },
        existingEntries: ['.adds/nm'],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [betterTypography],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    assert.equal(device.removalFor('.adds/nickel-type-fix'), undefined);
    const conf = new TextDecoder().decode(device.writeFor('.kobo/Kobo/Kobo eReader.conf').data);
    assert.equal(conf.includes('webkitTextRendering'), false);
    assert.equal(conf.includes('readingAlignment=Left'), true);
});
