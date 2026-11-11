import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import nickelModManager from '../../src/js/nickelmenu/features/nickel-mod-manager/index.js';
import { buildTarGz, parseTarGz } from '../../src/js/nickelmenu/archive.js';
import { detectInstalledNickelMenuFeatureIds, isOptionalCleanupPresent } from '../../src/js/nickelmenu/probes.js';
import { featuresToInstall } from '../../src/js/nickelmenu/selection.js';
import { executeNickelMenuFeatureCleanups, executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { RecordingDevice, bytes, createInstaller, createResponse } from './test-helpers.js';

const markerPath = '.adds/nickel-mod-manager/uninstall';

test('NickelModManager selects only the bundled package for the chosen firmware', () => {
    const originalManifest = globalThis.__INSTALLABLES__;
    const session = { selectedFeatureIds: ['nickelmodmanager'] };
    const selected = (firmware) => featuresToInstall(session, firmware ? { firmware } : null).includes(nickelModManager);
    try {
        globalThis.__INSTALLABLES__ = {
            nickelmodmanager: { available: true, version: 'v0.3' },
            'nickelmodmanager-qt6': { available: true, version: 'v0.4' },
        };
        for (const firmware of ['4.23.15548', '4.46.23852', '6.0.276679', null]) assert.equal(selected(firmware), true);
        for (const firmware of ['4.22.15190', '4.23.15547', '5.18.270971', '7.0']) assert.equal(selected(firmware), false);
        assert.equal(featuresToInstall({ selectedFeatureIds: [] }, { firmware: '6.0' }).includes(nickelModManager), false);
        assert.equal(nickelModManager.default({ firmware: '6.0' }), true);
        assert.equal(nickelModManager.default({ firmware: '4.46' }), false);
        assert.match(nickelModManager.description({ firmware: '6.0' }), /restores enabled mods after supported Kobo OS updates/);
        assert.doesNotMatch(nickelModManager.description({ firmware: '4.46' }), /restores/);
        assert.equal(nickelModManager.version({ firmware: '6.0' }), 'v0.4');
        globalThis.__INSTALLABLES__['nickelmodmanager-qt6'].available = false;
        assert.equal(selected('6.0'), false);
        assert.equal(selected('4.46'), true);
        globalThis.__INSTALLABLES__.nickelmodmanager.available = false;
        globalThis.__INSTALLABLES__['nickelmodmanager-qt6'].available = true;
        assert.equal(selected('4.46'), false);
        assert.equal(selected('6.0'), true);
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

for (const [major, id, asset, prefix] of [
    [4, 'nickelmodmanager', 'NickelModManager.tgz', 'usr/local/Kobo/'],
    [6, 'nickelmodmanager-qt6', 'NickelModManager-Qt6.tgz', ''],
]) {
    test(`OS ${major} merges verified manager bytes and cancels a pending removal on reinstall`, async () => {
        const originalFetch = globalThis.fetch;
        const originalManifest = globalThis.__INSTALLABLES__;
        const pluginPath = `${prefix}imageformats/libnickelmm.so`;
        const archive = await buildTarGz([{ path: pluginPath, data: bytes('manager plugin'), mode: 0o755 }]);
        const base = await buildTarGz([{ path: `${prefix}imageformats/libnm.so`, data: bytes('menu plugin'), mode: 0o755 }]);
        const fetched = [];
        globalThis.__INSTALLABLES__ = {
            [id]: { version: 'v0.3', available: true, sha256: createHash('sha256').update(archive).digest('hex') },
        };
        globalThis.fetch = async (url) => {
            fetched.push(url);
            return url === `/assets/${asset}?v=v0.3` ? createResponse(archive) : createResponse('', { status: 404 });
        };
        try {
            const installer = createInstaller(base);
            installer.nickelMenuArchives.set(major === 6 ? 'nickelmenu-qt6' : 'nickelmenu', base);
            const result = await installer.buildKoboRootTgz([nickelModManager], () => {}, { firmware: `${major}.46` });
            const entries = await parseTarGz(result);
            assert.deepEqual(entries.map((entry) => entry.path).sort(), [`${prefix}imageformats/libnm.so`, pluginPath].sort());
            const manager = entries.find((entry) => entry.path === pluginPath);
            assert.deepEqual(manager.data, bytes('manager plugin'));
            assert.equal(manager.mode, 0o755);
            assert.ok(fetched.includes(`/assets/${asset}?v=v0.3`));

            const device = new RecordingDevice({
                textFiles: {
                    [markerPath]: 'Delete to uninstall',
                    '.adds/.nickel-mod-manager.initialized': '1\n',
                    '.adds/nickel-mod-manager/state.json': '{"saved":true}',
                },
            });
            device.deviceInfo = { firmware: `${major}.0` };
            await executeNickelMenuFeatureCleanups({ device, features: [nickelModManager] });
            assert.equal(await device.pathExists(markerPath.split('/')), false);
            await installer.installToDevice(device, [nickelModManager], () => {});
            assert.equal(await device.pathExists(markerPath.split('/')), true);
            assert.equal(await device.readFile(['.adds', '.nickel-mod-manager.initialized']), '1\n');
            assert.equal(await device.readFile(['.adds', 'nickel-mod-manager', 'state.json']), '{"saved":true}');
        } finally {
            globalThis.fetch = originalFetch;
            globalThis.__INSTALLABLES__ = originalManifest;
        }
    });
}

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
