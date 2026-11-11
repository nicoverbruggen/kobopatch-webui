import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import nickelModManager from '../../src/js/nickelmenu/features/nickel-mod-manager/index.js';
import { buildTarGz, parseTarGz } from '../../src/js/nickelmenu/archive.js';
import { detectInstalledNickelMenuFeatureIds, isOptionalCleanupPresent } from '../../src/js/nickelmenu/probes.js';
import { featuresToInstall } from '../../src/js/nickelmenu/selection.js';
import { executeNickelMenuFeatureCleanups, executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { RecordingDevice, bytes, createInstaller, createResponse } from './test-helpers.js';

const pluginPath = 'usr/local/Kobo/imageformats/libnickelmm.so';
const markerPath = '.adds/nickel-mod-manager/uninstall';

test('NickelModManager selection requires a bundled package and supported firmware', () => {
    const available = nickelModManager.available;
    const session = { selectedFeatureIds: ['nickelmodmanager'] };
    const selected = (firmware) => featuresToInstall(session, firmware ? { firmware } : null).includes(nickelModManager);
    try {
        nickelModManager.available = true;
        assert.equal(selected('4.23.15548'), true);
        assert.equal(selected('4.46.23852'), true);
        assert.equal(selected(null), true);
        for (const firmware of ['4.22.15190', '4.23.15547', '5.18.270971', '6.0.276679']) assert.equal(selected(firmware), false);
        assert.equal(featuresToInstall({ selectedFeatureIds: [] }, null).includes(nickelModManager), false);
        nickelModManager.available = false;
        assert.equal(selected('4.46.23852'), false);
    } finally {
        nickelModManager.available = available;
    }
});

test('NickelModManager merges verified plugin bytes and mode into NickelMenu without adding an uninstall marker', async () => {
    const originalFetch = globalThis.fetch;
    const originalManifest = globalThis.__INSTALLABLES__;
    const archive = await buildTarGz([{ path: pluginPath, data: bytes('manager plugin'), mode: 0o755 }]);
    const base = await buildTarGz([{ path: 'usr/local/Kobo/imageformats/libnm.so', data: bytes('menu plugin'), mode: 0o755 }]);
    const fetched = [];
    globalThis.__INSTALLABLES__ = {
        nickelmodmanager: { version: 'v0.3', available: true, sha256: createHash('sha256').update(archive).digest('hex') },
    };
    globalThis.fetch = async (url) => {
        fetched.push(url);
        return url === '/assets/NickelModManager.tgz?v=v0.3' ? createResponse(archive) : createResponse('', { status: 404 });
    };
    try {
        const result = await createInstaller(base).buildKoboRootTgz([nickelModManager], () => {});
        const entries = await parseTarGz(result);
        assert.deepEqual(entries.map((entry) => entry.path).sort(), ['usr/local/Kobo/imageformats/libnm.so', pluginPath].sort());
        const manager = entries.find((entry) => entry.path === pluginPath);
        assert.deepEqual(manager.data, bytes('manager plugin'));
        assert.equal(manager.mode, 0o755);
        assert.ok(fetched.includes('/assets/NickelModManager.tgz?v=v0.3'));
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('NickelModManager refuses to build when its asset is missing', async () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    try {
        globalThis.__INSTALLABLES__ = { nickelmodmanager: { version: 'v0.3', available: false } };
        await assert.rejects(() => nickelModManager.koboRootEntries({ progress() {} }), /NickelModManager assets not available/);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('NickelModManager detection ignores saved settings after the uninstall marker has been deleted', async () => {
    const device = new RecordingDevice({ textFiles: { '.adds/nickel-mod-manager/state.json': '{}' } });
    device.directoryHandle = {};
    const state = { device };
    assert.equal(await isOptionalCleanupPresent(state, nickelModManager, ''), false);
    assert.equal((await detectInstalledNickelMenuFeatureIds(state, ['nickelmodmanager'], true)).includes('nickelmodmanager'), false);
    device.addEntry(markerPath, 'file');
    assert.equal(await isOptionalCleanupPresent(state, nickelModManager, ''), true);
    assert.ok((await detectInstalledNickelMenuFeatureIds(state)).includes('nickelmodmanager'));
});

for (const mode of ['modify', 'uninstall']) {
    test(`NickelModManager ${mode} cleanup removes only its marker and preserves saved mods`, async () => {
        const savedPaths = ['.adds/nickel-mod-manager/mods/libnm.so', '.adds/nickel-mod-manager/state.json', '.adds/.nickel-mod-manager.initialized'];
        const device = new RecordingDevice({
            existingEntries: [markerPath, ...savedPaths].map((path) => ({ path, kind: 'file' })),
        });
        if (mode === 'modify') {
            await executeNickelMenuFeatureCleanups({ device, features: [nickelModManager] });
        } else {
            await executeNickelMenuRemoval({
                device,
                installer: createInstaller(),
                cleanupFeatures: [nickelModManager],
                shouldRemoveSyncExclusions: async () => false,
            });
        }
        assert.equal(await device.pathExists(markerPath.split('/')), false);
        for (const path of savedPaths) assert.equal(await device.pathExists(path.split('/')), true, path);
        assert.equal(device.removalFor('.adds/nickel-mod-manager'), undefined);
    });
}
