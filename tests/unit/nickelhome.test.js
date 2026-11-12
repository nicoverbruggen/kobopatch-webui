import test from 'node:test';
import assert from 'node:assert/strict';
import { homeHiders } from '../../src/js/nickelmenu/features/hide-home-content/index.js';
import { buildTarGz } from '../../src/js/nickelmenu/archive.js';
import { featuresToInstall, featuresToRemove } from '../../src/js/nickelmenu/selection.js';
import { bytes, createResponse } from './test-helpers.js';

const os4 = { firmware: '4.46.23852' };
const os6 = { firmware: '6.0.279225' };
const ids = homeHiders.map((feature) => feature.id);

test('NickelHome isolates firmware packages, shares downloads and retries a failed Qt6 fetch', async () => {
    const originalFetch = globalThis.fetch;
    const originalManifest = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = {
        nickelhome: { available: true, version: 'qt5-test' },
        'nickelhome-qt6': { available: true, version: 'qt6-test' },
    };
    const path4 = 'usr/local/Kobo/imageformats/libnickelhome.so';
    const path6 = 'imageformats/libnickelhome.so';
    const archive4 = await buildTarGz([{ path: path4, data: bytes('Qt5'), mode: 0o755 }]);
    const archive6 = await buildTarGz([{ path: path6, data: bytes('Qt6'), mode: 0o755 }]);
    let failQt6 = true;
    const calls = [];
    globalThis.fetch = async (url) => {
        if (url === '/assets/index.json') return createResponse('', { json: {} });
        calls.push(url);
        if (url === '/assets/NickelHome.tgz?v=qt5-test') return createResponse(archive4);
        if (url === '/assets/NickelHome-Qt6.tgz?v=qt6-test') return createResponse(archive6, { status: failQt6 ? 503 : 200 });
        throw new Error(`Unexpected fetch: ${url}`);
    };
    const context = (deviceInfo) => ({ deviceInfo, progress() {} });
    try {
        const entries4 = await Promise.all(homeHiders.map((feature) => feature.koboRootEntries(context(os4))));
        assert.ok(entries4.every((entries) => entries.length === 1 && entries[0].path === path4));
        await assert.rejects(() => homeHiders[0].koboRootEntries(context(os6)), /503/);
        failQt6 = false;
        const entries6 = await Promise.all(homeHiders.map((feature) => feature.koboRootEntries(context(os6))));
        assert.ok(entries6.every((entries) => entries.length === 1 && entries[0].path === path6));
        assert.deepEqual(await homeHiders[0].koboRootEntries(context(os4)), entries4[0]);
        assert.deepEqual(calls, ['/assets/NickelHome.tgz?v=qt5-test', '/assets/NickelHome-Qt6.tgz?v=qt6-test', '/assets/NickelHome-Qt6.tgz?v=qt6-test']);
        assert.equal(homeHiders[0].version(os4), 'qt5-test');
        assert.equal(homeHiders[0].version(os6), 'qt6-test');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('NickelHome does not offer Qt5 payloads to OS 6 when its Qt6 asset is absent', () => {
    const original = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = { nickelhome: { available: true, version: 'v0.7' } };
    try {
        assert.equal(homeHiders[0].available(os4), true);
        assert.equal(homeHiders[0].available(os6), false);
        assert.ok(!featuresToInstall({ selectedFeatureIds: ids }, os6).some((feature) => ids.includes(feature.id)));
    } finally {
        globalThis.__INSTALLABLES__ = original;
    }
});

for (const deviceInfo of [os4, os6]) {
    test(`NickelHome retains its shared directory until the last hider is removed on ${deviceInfo.firmware}`, () => {
        const original = globalThis.__INSTALLABLES__;
        globalThis.__INSTALLABLES__ = {
            nickelhome: { available: true, version: 'v0.7' },
            'nickelhome-qt6': { available: true, version: 'v0.7' },
        };
        try {
            const session = { selectedFeatureIds: [ids[2]], installedNickelMenuFeatureIds: ids, nmWebuiPresetInstalled: true };
            assert.deepEqual(featuresToRemove(session, deviceInfo), []);
            session.selectedFeatureIds = [];
            const removed = featuresToRemove(session, deviceInfo);
            assert.equal(removed.length, 1);
            assert.ok(removed[0].modifyCleanup.paths.some((entry) => entry.path.join('/') === '.adds/nickel-home'));
            assert.ok(!removed[0].modifyCleanup.paths.some((entry) => entry.path.join('/') === '.adds/.nickel-home.initialized'));
        } finally {
            globalThis.__INSTALLABLES__ = original;
        }
    });
}
