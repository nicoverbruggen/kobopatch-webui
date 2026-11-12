import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { parseKoboVersion } from '../../src/js/kobo/version.js';
import { Session } from '../../src/js/shell/session.js';
import { nickelMenuDeviceInfo, nickelMenuPackage } from '../../src/js/nickelmenu/firmware.js';
import { featuresToInstall, featuresToRemove, featureDisabledReason } from '../../src/js/nickelmenu/selection.js';
import { NICKELMENU_FEATURES } from '../../src/js/nickelmenu/features/index.js';
import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import koreader from '../../src/js/nickelmenu/features/koreader/index.js';
import typography from '../../src/js/nickelmenu/features/better-typography/index.js';
import { NickelMenuInstaller } from '../../src/js/nickelmenu/installer.js';
import { executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { RecordingDevice, bytes, createResponse } from './test-helpers.js';

const os6 = { firmware: '6.0.276679' };
const os4 = { firmware: '4.46.23852' };

test('KOReader review explains the OS 6 exit workaround and keeps the OS 4 Bluetooth warning', () => {
    const notice6 = JSON.stringify(koreader.reviewNotices({ deviceInfo: os6 }));
    assert.match(notice6, /hides the normal Exit action/);
    assert.match(notice6, /power button/);
    assert.ok(!notice6.includes('Bluetooth'));
    assert.match(JSON.stringify(koreader.reviewNotices({ deviceInfo: os4 })), /Bluetooth/);
});

function seededInstaller() {
    const installer = new NickelMenuInstaller();
    installer.nickelMenuArchives.set('nickelmenu', bytes('OS 4 archive'));
    installer.nickelMenuArchives.set('nickelmenu-qt6', bytes('OS 6 archive'));
    return installer;
}

test('Kobo OS 6 connects while unknown future firmware stays blocked', () => {
    for (const firmware of ['6.0.0', '6.0.276679', '6.1.12345']) {
        const info = parseKoboVersion(`N428000000000,0,${firmware},0,0,00000000-0000-0000-0000-000000000390`);
        assert.equal(info.isIncompatible, false);
        assert.equal(info.incompatibleReason, null);
    }
    for (const firmware of ['5.18.270971', '7.0', 'invalid']) assert.throws(() => nickelMenuPackage({ firmware }), /4.x and 6.x only/);
});

test('manual firmware selection overrides an old connected device and resets with the session', () => {
    const session = new Session();
    session.device = { deviceInfo: os4 };
    session.manualMode = true;
    session.manualNickelMenuFirmware = '6';
    assert.equal(nickelMenuPackage(nickelMenuDeviceInfo(session)).filename, 'Kobo.tgz');
    session.manualNickelMenuFirmware = '4';
    assert.equal(nickelMenuPackage(nickelMenuDeviceInfo(session)).filename, 'KoboRoot.tgz');
    session.manualMode = false;
    session.device.deviceInfo = os6;
    assert.equal(nickelMenuPackage(nickelMenuDeviceInfo(session)).filename, 'Kobo.tgz');
    session.reset();
    assert.equal(session.manualNickelMenuFirmware, '4');
});

test('OS 6 accepts supported features and rejects stale unsupported selections from OS 4', () => {
    const available = koreader.available;
    const originalManifest = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = { 'nickelmodmanager-qt6': { available: true, version: 'v0.3' } };
    koreader.available = true;
    const session = {
        selectedFeatureIds: NICKELMENU_FEATURES.map((f) => f.id),
        installedNickelMenuFeatureIds: NICKELMENU_FEATURES.map((f) => f.id),
        nmWebuiPresetInstalled: true,
    };
    try {
        assert.deepEqual(
            featuresToInstall(session, os6).map((f) => f.id),
            ['custom-menu', 'simplify-tabs', 'nickelmodmanager', 'additional-fonts', 'koreader'],
        );
        assert.equal(featureDisabledReason(typography, os6), 'Not yet available for Kobo OS 6.');
        session.selectedFeatureIds = ['custom-menu', 'nickelmodmanager', 'additional-fonts', 'koreader'];
        assert.deepEqual(featuresToRemove(session, os6), []);
        session.selectedFeatureIds = ['custom-menu', 'nickelmodmanager', 'additional-fonts'];
        assert.deepEqual(
            featuresToRemove(session, os6).map((f) => f.id),
            ['koreader'],
        );
    } finally {
        koreader.available = available;
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

test('OS 6 preset omits Invert Display while OS 4 keeps it', () => {
    assert.ok(customMenu.menuItems({ deviceInfo: os4 }).some((entry) => entry.id === 'invert-reboot'));
    const entries = customMenu.menuItems({ deviceInfo: os6 });
    assert.ok(!entries.some((entry) => entry.id === 'invert-reboot'));
    assert.ok(entries.some((entry) => entry.id === 'dark-mode'));
});

test('one installer caches OS 4 and OS 6 independently and does not reuse OS 4 after an OS 6 download failure', async () => {
    const originalFetch = globalThis.fetch;
    const originalManifest = globalThis.__INSTALLABLES__;
    const installer = new NickelMenuInstaller();
    const data = { nickelmenu: bytes('OS 4'), 'nickelmenu-qt6': bytes('OS 6') };
    globalThis.__INSTALLABLES__ = Object.fromEntries(
        Object.entries(data).map(([id, archive]) => [
            id,
            {
                available: true,
                version: 'test',
                sha256: createHash('sha256').update(archive).digest('hex'),
            },
        ]),
    );
    let failOs6 = true;
    const calls = [];
    globalThis.fetch = async (url) => {
        if (url === '/assets/NickelMenu.tgz?v=test') {
            calls.push('4');
            return createResponse(data.nickelmenu);
        }
        if (url === '/assets/NickelMenu-Qt6.tgz?v=test') {
            calls.push('6');
            return createResponse(data['nickelmenu-qt6'], { status: failOs6 ? 503 : 200 });
        }
        return createResponse('', { status: 404 });
    };
    try {
        await installer.loadNickelMenu(() => {}, os4);
        await assert.rejects(() => installer.loadNickelMenu(() => {}, os6));
        await assert.rejects(() => installer.getKoboRootTgz(os6), /not loaded/);
        failOs6 = false;
        await installer.loadNickelMenu(() => {}, os6);
        await installer.loadNickelMenu(() => {}, os4);
        assert.deepEqual(await installer.getKoboRootTgz(os4), data.nickelmenu);
        assert.deepEqual(await installer.getKoboRootTgz(os6), data['nickelmenu-qt6']);
        assert.deepEqual(calls, ['4', '6', '6']);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.__INSTALLABLES__ = originalManifest;
    }
});

for (const [deviceInfo, filename, content] of [
    [os6, 'Kobo.tgz', 'OS 6 archive'],
    [os4, 'KoboRoot.tgz', 'OS 4 archive'],
]) {
    test(`${filename} is used for device writes, download ZIPs, instructions and removal`, async () => {
        const installer = seededInstaller();
        const device = new RecordingDevice();
        device.deviceInfo = deviceInfo;
        await installer.installToDevice(device, [], () => {});
        assert.deepEqual(
            device.writes.map((write) => write.path),
            ['.kobopatch-webui/nickelmenu.json', `.kobo/${filename}`],
        );
        const zip = await JSZip.loadAsync(await installer.buildDownloadZip([], () => {}, deviceInfo));
        assert.equal(await zip.file(`.kobo/${filename}`).async('string'), content);
        const other = filename === 'Kobo.tgz' ? 'KoboRoot.tgz' : 'Kobo.tgz';
        assert.equal(zip.file(`.kobo/${other}`), null);
        const instructions = await zip.file('instructions.txt').async('string');
        assert.ok(instructions.includes(`.kobo/${filename}`));
        assert.ok(!instructions.includes(`.kobo/${other}`));
        const removal = new RecordingDevice();
        removal.deviceInfo = deviceInfo;
        await executeNickelMenuRemoval({ device: removal, installer, shouldRemoveSyncExclusions: async () => false });
        assert.deepEqual(
            removal.writes.map((write) => write.path),
            ['.adds/nm/uninstall', `.kobo/${filename}`],
        );
    });
}

test('the OS 6 installer rejects unsupported real features before writing any files', async () => {
    const device = new RecordingDevice();
    device.deviceInfo = os6;
    const installer = seededInstaller();
    await assert.rejects(() => installer.installToDevice(device, [typography], () => {}), /Not yet available for Kobo OS 6/);
    assert.deepEqual(device.writes, []);
    assert.deepEqual(device.removals, []);
    await assert.rejects(() => installer.buildDownloadZip([typography], () => {}, os6), /Not yet available for Kobo OS 6/);
});
