import test from 'node:test';
import assert from 'node:assert/strict';

import nickelDissolve, { nickelDissolveSupport } from '../../src/js/nickelmenu/features/nickel-dissolve/index.js';
import nickelclock from '../../src/js/nickelmenu/features/nickelclock/index.js';
import { NICKELMENU_FEATURES } from '../../src/js/nickelmenu/features/index.js';
import { buildTarGz } from '../../src/js/nickelmenu/archive.js';
import { executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { isOptionalCleanupPresent } from '../../src/js/nickelmenu/probes.js';
import { featuresToInstall } from '../../src/js/nickelmenu/selection.js';
import { RecordingDevice, bytes, createInstaller, createProgressRecorder } from './test-helpers.js';

// The mod's published KoboRoot.tgz layout: the NickelHook plugin plus the
// .adds/nickel-dissolve marker whose *absence* triggers self-uninstall
// (an uninstall_xflag, the same shape as NickelTypeFix and NickelClock).
const nickelDissolveEntries = [
    { path: 'mnt/onboard/.adds/nickel-dissolve/uninstall', data: bytes('Delete this file...'), mode: 0o644 },
    { path: 'usr/local/Kobo/imageformats/libnickeldissolve.so', data: bytes('dissolve plugin'), mode: 0o755 },
];

// Serve a synthetic NickelDissolve release: a real gzipped tar at the versioned
// asset URL, mirroring the published asset (a bare KoboRoot.tgz, no zip wrapper).
function useNickelDissolveAssetFetch() {
    const originalFetch = globalThis.fetch;
    // The version/availability come from the build-time manifest (Vite define);
    // set it here so koboRootEntries resolves the pinned version + versioned URL.
    const originalManifest = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = { nickeldissolve: { version: 'v0.1', available: true } };

    const fetched = [];
    globalThis.fetch = async (url) => {
        fetched.push(url);
        if (url === '/assets/NickelDissolve.tgz?v=v0.1') {
            const tgz = await buildTarGz(nickelDissolveEntries);
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

test('nickeldissolve is a Reading Experience feature registered in the NickelMenu feature list', () => {
    assert.ok(NICKELMENU_FEATURES.includes(nickelDissolve));
    assert.equal(nickelDissolve.section, 'Reading Experience');
    // No longer flagged experimental; the mechanism stays for other features.
    assert.equal(nickelDissolve.experimental, false);
    assert.equal(nickelDissolve.default, false);
    // Hidden until the runtime manifest marks the shipped asset available.
    assert.equal(nickelDissolve.available, false);
    assert.deepEqual(nickelDissolve.directories, ['.adds/nickel-dissolve']);
});

test('nickeldissolve is listed immediately below NickelClock in Reading Experience', () => {
    const clockIndex = NICKELMENU_FEATURES.indexOf(nickelclock);
    const dissolveIndex = NICKELMENU_FEATURES.indexOf(nickelDissolve);
    assert.ok(clockIndex >= 0 && dissolveIndex >= 0);
    assert.equal(dissolveIndex, clockIndex + 1);
    assert.equal(nickelclock.section, 'Reading Experience');
});

// Hardware UUIDs from koboHardwareIds in kobo/version.js.
const LIBRA_2 = { hardwareId: '00000000-0000-0000-0000-000000000388', model: 'Kobo Libra 2' };
const LIBRA_COLOUR = { hardwareId: '00000000-0000-0000-0000-000000000390', model: 'Kobo Libra Colour' };
const CLARA_BW_N365 = { hardwareId: '00000000-0000-0000-0000-000000000391', model: 'Kobo Clara BW' };
const CLARA_COLOUR = { hardwareId: '00000000-0000-0000-0000-000000000393', model: 'Kobo Clara Colour' };
const CLARA_BW_P365 = { hardwareId: '00000000-0000-0000-0000-000000000395', model: 'Kobo Clara BW' };
const SAGE = { hardwareId: '00000000-0000-0000-0000-000000000383', model: 'Kobo Sage' };

test('nickelDissolveSupport allowlists exactly the supported Colour and Clara BW hardware revisions', () => {
    for (const device of [LIBRA_COLOUR, CLARA_BW_N365, CLARA_COLOUR, CLARA_BW_P365]) {
        assert.equal(nickelDissolveSupport(device), 'supported', device.model);
    }

    // Other known devices — and unrecognised future hardware — are unsupported.
    assert.equal(nickelDissolveSupport(LIBRA_2), 'unsupported');
    assert.equal(nickelDissolveSupport(SAGE), 'unsupported');
    assert.equal(nickelDissolveSupport({ hardwareId: '00000000-0000-0000-0000-000000000999' }), 'unsupported');

    // An unidentifiable device (manual mode / download flow) is 'unknown'.
    assert.equal(nickelDissolveSupport(null), 'unknown');
    assert.equal(nickelDissolveSupport(undefined), 'unknown');
    assert.equal(nickelDissolveSupport({}), 'unknown');
});

test('unsupportedDeviceReason names the supported models only on unsupported devices', () => {
    // Supported and unidentifiable devices produce no reason (feature offered).
    assert.equal(nickelDissolve.unsupportedDeviceReason(LIBRA_COLOUR), null);
    assert.equal(nickelDissolve.unsupportedDeviceReason(null), null);
    assert.equal(nickelDissolve.unsupportedDeviceReason({}), null);

    const reason = nickelDissolve.unsupportedDeviceReason(SAGE);
    assert.match(reason, /Libra Colour, Clara Colour, and Clara BW/);
    assert.doesNotMatch(reason, /Libra 2/);
    assert.match(reason, /Kobo Sage/);

    // Without a model name the reason still reads cleanly.
    assert.match(nickelDissolve.unsupportedDeviceReason({ hardwareId: 'not-a-kobo' }), /Clara BW\.$/);
});

test('featuresToInstall drops NickelDissolve on unsupported devices even when selected', () => {
    const originalAvailable = nickelDissolve.available;
    nickelDissolve.available = true; // as flipped at runtime when the asset is shipped
    try {
        const session = { selectedFeatureIds: ['nickeldissolve'] };
        const installedOn = (deviceInfo) => featuresToInstall(session, deviceInfo).some((f) => f.id === 'nickeldissolve');

        assert.equal(installedOn(LIBRA_COLOUR), true);
        assert.equal(installedOn(CLARA_BW_P365), true);
        // Manual mode / download flow: the device is unknown, so it stays offered.
        assert.equal(installedOn(null), true);

        assert.equal(installedOn(LIBRA_2), false);
        assert.equal(installedOn(SAGE), false);
    } finally {
        nickelDissolve.available = originalAvailable;
    }
});

test('koboRootEntries downloads NickelDissolve and returns its KoboRoot.tgz entries', async () => {
    const restore = useNickelDissolveAssetFetch();
    try {
        const entries = await nickelDissolve.koboRootEntries({ progress() {} });
        assert.deepEqual(
            entries.map((e) => e.path),
            nickelDissolveEntries.map((e) => e.path),
        );
        assert.equal(entries.find((e) => e.path.endsWith('.so')).mode, 0o755);
        // The size index (/assets/index.json) may also be fetched (once per
        // process); the asset itself must be requested at its versioned URL.
        assert.ok(restore.fetched.includes('/assets/NickelDissolve.tgz?v=v0.1'));
    } finally {
        restore();
    }
});

test('koboRootEntries throws a helpful error when the deployment lacks the asset', async () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = {};
        await assert.rejects(() => nickelDissolve.koboRootEntries({ progress() {} }), /NickelDissolve assets not available/);

        // Vite emits locked-but-missing assets with a version and available:false;
        // the feature stays hidden then, but the guard still holds if reached.
        globalThis.__INSTALLABLES__ = { nickeldissolve: { version: 'v0.1', available: false } };
        await assert.rejects(() => nickelDissolve.koboRootEntries({ progress() {} }), /NickelDissolve assets not available/);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('reviewNotices describes NickelDissolve and links to the repository', () => {
    const notices = nickelDissolve.reviewNotices();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'info');
    assert.match(notices[0].mod.name, /NickelDissolve/);
    // Says what the mod does and that it can be switched off without uninstalling
    // (the "experimental" signal lives only on the feature's Experimental badge).
    assert.match(notices[0].mod.summary, /wipe animation/i);
    assert.match(notices[0].mod.detail, /turn this page turn animation off/i);
    assert.equal(notices[0].mod.href, 'https://github.com/nicoverbruggen/NickelDissolve');
});

test('the mod is detected as installed exactly when its uninstall marker exists', async () => {
    // Shared convention for these mods: marker present = installed.
    assert.deepEqual(nickelDissolve.cleanup.detect, [['.adds', 'nickel-dissolve', 'uninstall']]);

    const withMarker = new RecordingDevice({
        existingEntries: ['.adds/nickel-dissolve', { path: '.adds/nickel-dissolve/uninstall', kind: 'file' }],
    });
    assert.equal(await isOptionalCleanupPresent({ device: withMarker }, nickelDissolve, ''), true);

    // A leftover folder without the marker means the mod already self-uninstalled.
    const withoutMarker = new RecordingDevice({ existingEntries: ['.adds/nickel-dissolve'] });
    assert.equal(await isOptionalCleanupPresent({ device: withoutMarker }, nickelDissolve, ''), false);
});

test('optional cleanup removes the .adds/nickel-dissolve directory during NickelMenu removal', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/nickel-dissolve',
            { path: '.adds/nickel-dissolve/uninstall', kind: 'file' },
            { path: '.adds/nickel-dissolve/config', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [nickelDissolve],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    const removal = device.removalFor('.adds/nickel-dissolve');
    assert.ok(removal, 'expected .adds/nickel-dissolve to be removed');
    assert.deepEqual(removal.options, { recursive: true });
    // The whole footprint (marker, config) is gone; the mod self-removes its
    // root-filesystem plugin on the next reboot.
    assert.equal(await device.pathExists(['.adds', 'nickel-dissolve', 'config']), false);
});

test('optional cleanup tolerates NickelDissolve already being absent', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({ existingEntries: ['.adds/nm'] });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [nickelDissolve],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    assert.equal(device.removalFor('.adds/nickel-dissolve'), undefined);
});
