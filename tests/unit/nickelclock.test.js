import test from 'node:test';
import assert from 'node:assert/strict';

import JSZip from 'jszip';

import nickelclock from '../../src/js/nickelmenu/features/nickelclock/index.js';
import { menuItemPosition } from '../../src/js/nickelmenu/features/menu-order.js';
import { buildTarGz } from '../../src/js/nickelmenu/archive.js';
import { executeNickelMenuRemoval } from '../../src/js/nickelmenu/uninstaller.js';
import { NICKELMENU_FEATURES } from '../../src/js/nickelmenu/installer.js';
import {
    RecordingDevice,
    createInstaller,
    createProgressRecorder,
} from './test-helpers.js';

function bytes(value) {
    return new TextEncoder().encode(value);
}

const nickelclockEntries = [
    { path: 'mnt/onboard/.adds/nickelclock/uninstall', data: bytes('Delete this file...'), mode: 0o644 },
    { path: 'usr/local/Kobo/imageformats/libnickelclock.so', data: bytes('clock plugin'), mode: 0o755 },
];

// Serve a synthetic NickelClock release: a release json plus a NickelClock.zip
// wrapping a real KoboRoot.tgz, mirroring the published asset layout.
function useNickelClockAssetFetch() {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url) => {
        if (url === '/assets/nickelclock-release.json') {
            return { ok: true, status: 200, async json() { return { version: 'v0.4.0' }; } };
        }
        if (url === '/assets/NickelClock.zip') {
            const zip = new JSZip();
            zip.file('KoboRoot.tgz', await buildTarGz(nickelclockEntries));
            const buf = await zip.generateAsync({ type: 'uint8array' });
            return {
                ok: true,
                status: 200,
                async arrayBuffer() {
                    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                },
            };
        }
        if (url === 'js/nickelmenu/features/nickelclock/scripts/toggle_nickelclock.sh') {
            const data = bytes('#!/bin/sh\n');
            return {
                ok: true,
                status: 200,
                async arrayBuffer() {
                    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                },
            };
        }
        return { ok: false, status: 404 };
    };

    return () => { globalThis.fetch = originalFetch; };
}

// A real gzipped tar to stand in for NickelMenu's base KoboRoot.tgz, so the
// installer can parse it and merge NickelClock's entries.
async function baseNickelMenuTgz() {
    return buildTarGz([
        { path: 'usr/local/Kobo/imageformats/libnm.so', data: bytes('nm plugin'), mode: 0o755 },
    ]);
}

test('nickelclock is an Advanced feature registered in the NickelMenu feature list', () => {
    assert.ok(NICKELMENU_FEATURES.includes(nickelclock));
    assert.equal(nickelclock.section, 'Advanced');
    assert.equal(nickelclock.default, false);
});

test('contributes a "NickelClock" Toggle item and ships its toggle script', async () => {
    const requested = [];
    const ctx = {
        async asset(relativePath) {
            requested.push(relativePath);
            return new TextEncoder().encode('#!/bin/sh\n');
        },
    };

    const files = await nickelclock.install(ctx);
    assert.deepEqual(requested, ['scripts/toggle_nickelclock.sh']);
    assert.deepEqual(files.map(f => f.path), [
        '.adds/nm/scripts/toggle_nickelclock.sh',
        '.adds/nickelclock/settings.ini',
    ]);

    const items = nickelclock.menuItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'nickelclock');
    assert.match(
        items[0].lines[0],
        /^menu_item :main :NickelClock :cmd_output :7000 :\/mnt\/onboard\/\.adds\/nm\/scripts\/toggle_nickelclock\.sh$/
    );
});

test('its Toggle item id is registered in MENU_ITEM_ORDER', () => {
    // An unregistered menu-item id throws during install, so assert it resolves.
    assert.doesNotThrow(() => menuItemPosition('nickelclock'));
});

test('ships a prefilled settings.ini (Margin=40, clock on) marked ifAbsent', async () => {
    const ctx = { async asset() { return new TextEncoder().encode('#!/bin/sh\n'); } };
    const files = await nickelclock.install(ctx);

    const settings = files.find(f => f.path === '.adds/nickelclock/settings.ini');
    assert.ok(settings, 'expected a settings.ini file');
    // ifAbsent so a user-edited settings.ini is never clobbered on reinstall.
    assert.equal(settings.ifAbsent, true);

    const ini = new TextDecoder().decode(settings.data);
    assert.match(ini, /^\[General\]\nMargin=40$/m);
    assert.match(ini, /^\[Clock\]\nEnabled=true$/m);
    // Battery indicator is hidden by default (full default block).
    assert.match(ini, /^\[Battery\]\nBatteryType=Level\nEnabled=false\nPlacement=Header\nPosition=Right\nLevelTemplate=%1%$/m);
});

test('installToDevice writes the prefilled settings.ini on a fresh install but keeps an existing one', async () => {
    const settingsPath = '.adds/nickelclock/settings.ini';
    const baseTgz = await baseNickelMenuTgz();

    // Fresh device: settings.ini does not exist yet, so it is written.
    const restoreFetch = useNickelClockAssetFetch();
    const fresh = new RecordingDevice();
    try {
        await createInstaller(baseTgz).installToDevice(fresh, [nickelclock], createProgressRecorder());
    } finally {
        restoreFetch();
    }
    assert.ok(fresh.writePaths().includes(settingsPath));
    assert.match(new TextDecoder().decode(fresh.writeFor(settingsPath).data), /Margin=40/);

    // Device with a user-edited settings.ini: it is kept, not overwritten.
    const restoreFetch2 = useNickelClockAssetFetch();
    const existing = new RecordingDevice({
        textFiles: { [settingsPath]: '[General]\nMargin=80\n\n[Clock]\nEnabled=false\n' },
    });
    try {
        await createInstaller(baseTgz).installToDevice(existing, [nickelclock], createProgressRecorder());
    } finally {
        restoreFetch2();
    }
    assert.ok(!existing.writePaths().includes(settingsPath), 'should not overwrite an existing settings.ini');
});

test('koboRootEntries downloads NickelClock and returns its KoboRoot.tgz entries', async () => {
    const restore = useNickelClockAssetFetch();
    try {
        const entries = await nickelclock.koboRootEntries({ progress() {} });
        assert.deepEqual(entries.map(e => e.path), nickelclockEntries.map(e => e.path));
        assert.equal(entries.find(e => e.path.endsWith('.so')).mode, 0o755);
    } finally {
        restore();
    }
});

test('koboRootEntries throws a helpful error when the release asset is missing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    try {
        await assert.rejects(
            () => nickelclock.koboRootEntries({ progress() {} }),
            /NickelClock assets not available/
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('optional cleanup removes the .adds/nickelclock directory during NickelMenu removal', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/nickelclock',
            { path: '.adds/nickelclock/uninstall', kind: 'file' },
            { path: '.adds/nickelclock/settings.ini', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [nickelclock],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: createProgressRecorder(),
    });

    const removal = device.removalFor('.adds/nickelclock');
    assert.ok(removal, 'expected .adds/nickelclock to be removed');
    assert.deepEqual(removal.options, { recursive: true });
    // The whole NickelClock footprint is gone; its plugin self-removes on reboot.
    assert.equal(await device.pathExists(['.adds', 'nickelclock', 'settings.ini']), false);
});
