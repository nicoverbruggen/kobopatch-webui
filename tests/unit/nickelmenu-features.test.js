import test from 'node:test';
import assert from 'node:assert/strict';

import JSZip from 'jszip';

import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import hideNotices from '../../src/js/nickelmenu/features/hide-notices/index.js';
import koreader from '../../src/js/nickelmenu/features/koreader/index.js';
import additionalFonts from '../../src/js/nickelmenu/features/additional-fonts/index.js';
import betterTypography from '../../src/js/nickelmenu/features/better-typography/index.js';
import screensaver from '../../src/js/nickelmenu/features/screensaver/index.js';
import simplifyTabs from '../../src/js/nickelmenu/features/simplify-tabs/index.js';
import sideloadedMode from '../../src/js/nickelmenu/features/sideloaded-mode/index.js';
import { createResponse, text } from './test-helpers.js';

async function createZip(entries) {
    const zip = new JSZip();
    for (const [path, data] of Object.entries(entries)) {
        zip.file(path, data);
    }
    return zip.generateAsync({ type: 'uint8array' });
}

async function withMockFetch(responses, fn) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const response = responses.get(url);
        return response ?? createResponse('', { status: 404 });
    };

    try {
        await fn();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test('Additional Fonts install bundles all three families, strips ZIP dirs and ignores non-font files', async () => {
    const readerlyZip = await createZip({
        'Readerly/KF_Readerly-Regular.ttf': 'readerly regular',
        'Readerly/KF_Readerly-Bold.ttf': 'readerly bold',
        'Readerly/LICENSE.txt': 'license',
        '__MACOSX/KF_Readerly-Italic.ttf': 'ignored directory prefix still stripped',
    });
    const libronZip = await createZip({
        'KF_Libron-Regular.ttf': 'libron regular',
    });
    const cartisseZip = await createZip({
        'KF_Cartisse-Regular.ttf': 'cartisse regular',
    });

    await withMockFetch(new Map([
        ['/assets/KF_Readerly.zip', createResponse(readerlyZip)],
        ['/assets/KF_Libron.zip', createResponse(libronZip)],
        ['/assets/KF_Cartisse.zip', createResponse(cartisseZip)],
    ]), async () => {
        const files = await additionalFonts.install({ progress() {} });

        assert.deepEqual(files.map(file => file.path), [
            'fonts/KF_Readerly-Regular.ttf',
            'fonts/KF_Readerly-Bold.ttf',
            'fonts/KF_Readerly-Italic.ttf',
            'fonts/KF_Libron-Regular.ttf',
            'fonts/KF_Cartisse-Regular.ttf',
        ]);
        assert.equal(text(files[0].data), 'readerly regular');
        assert.ok(files.every(file => file.data instanceof Uint8Array));
    });
});

test('Better Typography sets reading rendering and alignment; default font only when fonts are installed', () => {
    const readingDefaults = [
        { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility' },
        { section: 'Reading', key: 'readingAlignment', value: 'Left' },
    ];

    // Without the additional fonts, the default reading font is left untouched.
    assert.deepEqual(betterTypography.confSettings({ features: [] }), readingDefaults);
    assert.deepEqual(betterTypography.confSettings(), readingDefaults);

    // With the additional fonts selected, KF Libron becomes the default font.
    assert.deepEqual(
        betterTypography.confSettings({ features: [{ id: 'additional-fonts' }] }),
        [...readingDefaults, { section: 'Reading', key: 'readingFontFamily', value: 'KF Libron' }],
    );
});

test('Better Typography ships the toggle script and inserts its Tweak menu item after the header', async () => {
    // install() ships the on-device toggle script from the feature's own assets.
    const requested = [];
    const ctx = {
        async asset(path) {
            requested.push(path);
            return new TextEncoder().encode('#!/bin/sh\ntoggle');
        },
    };
    const installed = await betterTypography.install(ctx);
    assert.deepEqual(requested, ['scripts/toggle_typography.sh']);
    assert.deepEqual(installed.map(f => f.path), ['.adds/scripts/toggle_typography.sh']);

    // postProcess() inserts the single "Typography Toggle" entry right after the
    // menu header (the same placement the screensaver toggle uses).
    const files = itemsFiles(
        'experimental :menu_main_15505_label :Tweak',
        'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png',
        '',
        'menu_item :main :Screenshots :nickel_setting :toggle :screenshots',
    );
    const result = itemsText(betterTypography.postProcess(files));
    const lines = result.split('\n');
    const headerIndex = lines.findIndex(l => /menu_main_15505_icon/.test(l));
    assert.equal(lines[headerIndex + 1], '');
    assert.equal(lines[headerIndex + 2], 'menu_item :main :Typography Mode    :cmd_output :7000 :/mnt/onboard/.adds/scripts/toggle_typography.sh');
    // The old two-entry Legibility pair is gone, replaced by one toggle.
    assert.doesNotMatch(result, /Legibility/);
    // Existing items are preserved.
    assert.match(result, /^menu_item :main :Screenshots/m);
});

test('Sideload mode sets SideloadedMode under ApplicationPreferences and declares a 4.31 floor', () => {
    assert.equal(sideloadedMode.minimumVersion, '4.31');
    assert.equal(sideloadedMode.default, false);
    assert.deepEqual(sideloadedMode.confSettings(), [
        { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true' },
    ]);
});

test('Sideload mode comments out the home-tab override so the home tab is hidden', () => {
    // simplify-tabs force-enables the home tab; Sideload mode must comment it out.
    const files = itemsFiles(
        'experimental :menu_main_15505_0_enabled: 1',
        'experimental :menu_main_15505_1_label: Books',
    );
    const result = itemsText(sideloadedMode.postProcess(files));
    const lines = result.split('\n');

    assert.equal(lines[0], '# Home tab hidden for Sideload mode (no home screen when not signed in).');
    assert.equal(lines[1], '# experimental :menu_main_15505_0_enabled: 1');
    // Other tab settings are left untouched.
    assert.match(result, /^experimental :menu_main_15505_1_label: Books$/m);
});

test('Sideload mode postProcess is a no-op when the home-tab override is absent', () => {
    // Without simplify-tabs there is no override line; Sideload mode hides the
    // home tab on its own, so nothing in the items file changes.
    const files = itemsFiles('menu_item :main :Reboot :power :reboot');
    assert.equal(itemsText(sideloadedMode.postProcess(files)), 'menu_item :main :Reboot :power :reboot');
});

test('Sideload mode cleanup detects and reverts only its own conf key', () => {
    const setting = { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true' };
    const { cleanup } = sideloadedMode;
    assert.equal(cleanup.mode, 'optional');
    assert.deepEqual(cleanup.detectConf, [setting]);
    assert.deepEqual(cleanup.revertConf, [{ ...setting, revertTo: null }]);
});

test('Better Typography postProcess is a no-op when the items file is absent', () => {
    const files = [{ path: '.adds/koreader/koreader.sh', data: '#!/bin/sh' }];
    assert.deepEqual(betterTypography.postProcess(files), files);
});

test('Better Typography cleanup detects and removes both the toggle script and the WebKit setting', () => {
    const webkit = { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility' };
    const { cleanup } = betterTypography;

    assert.equal(cleanup.mode, 'optional');
    // Detected by either the on-device script or the conf line (the toggle can
    // turn the conf line off while leaving the script installed).
    assert.deepEqual(cleanup.detect, [['.adds', 'scripts', 'toggle_typography.sh']]);
    assert.deepEqual(cleanup.detectConf, [webkit]);
    assert.deepEqual(cleanup.paths, [{ path: ['.adds', 'scripts', 'toggle_typography.sh'] }]);
    assert.deepEqual(cleanup.removeParentDirsIfEmpty, [['.adds', 'scripts']]);
    assert.deepEqual(cleanup.revertConf, [{ ...webkit, revertTo: null }]);
});

test('KOReader install maps ZIP files under .adds/koreader', async () => {
    const zipData = await createZip({
        'koreader/koreader.sh': '#!/bin/sh',
        'defaults.lua': 'return {}',
    });
    const progressMessages = [];

    await withMockFetch(new Map([
        ['/assets/koreader-release.json', createResponse('', { json: { version: 'v2026.01' } })],
        ['/assets/koreader-kobo.zip', createResponse(zipData)],
    ]), async () => {
        const files = await koreader.install({
            progress(message) {
                progressMessages.push(message);
            },
        });

        assert.deepEqual(files.map(file => file.path), [
            '.adds/koreader/koreader.sh',
            '.adds/koreader/defaults.lua',
        ]);
        assert.equal(text(files[0].data), '#!/bin/sh');
        assert.deepEqual(progressMessages, [
            'Fetching KOReader release info...',
            'Downloading KOReader v2026.01...',
            'Extracting KOReader...',
        ]);
    });
});

test('NickelMenu post-process features preserve launcher ordering', () => {
    const files = [
        { path: '.adds/nm/items', data: 'menu_item :main :base' },
    ];

    const processed = hideNotices.postProcess(
        simplifyTabs.postProcess(
            koreader.postProcess(files)
        )
    );
    const items = processed[0].data;

    assert.match(items, /^experimental :menu_main_15505_0_enabled: 1\n/);
    assert.match(items, /menu_item:main:KOReader:cmd_spawn:quiet:exec \/mnt\/onboard\/\.adds\/koreader\/koreader\.sh\n\nmenu_item :main :base/);
    assert.match(items, /menu_item :main :base\nexperimental:hide_home_row3_enabled:1\n$/);
});

const AURA_HD = { serialPrefix: 'N204', model: 'Kobo Aura HD' };       // no Dark mode
const LIBRA_COLOUR = { serialPrefix: 'N428', model: 'Kobo Libra Colour' }; // Dark mode

function itemsFiles(...lines) {
    return [{ path: '.adds/nm/items', data: lines.join('\n') }];
}

function itemsText(files) {
    return files.find(f => f.path === '.adds/nm/items').data;
}

test('custom menu comments out Dark Mode on unsupported devices', () => {
    const files = itemsFiles(
        'menu_item :main :Screenshots :nickel_setting :toggle :screenshots',
        'menu_item :reader :Dark Mode :nickel_setting :toggle :dark_mode',
    );

    const result = itemsText(customMenu.postProcess(files, { deviceInfo: AURA_HD }));

    assert.match(
        result,
        /# Unsupported on your device so this line is commented out\.\n# menu_item :reader :Dark Mode :nickel_setting :toggle :dark_mode/
    );
    // Unrelated items are left untouched.
    assert.match(result, /^menu_item :main :Screenshots/m);
});

test('custom menu leaves Dark Mode intact on supported devices', () => {
    const files = itemsFiles('menu_item :reader :Dark Mode :nickel_setting :toggle :dark_mode');
    const result = itemsText(customMenu.postProcess(files, { deviceInfo: LIBRA_COLOUR }));
    assert.equal(result, 'menu_item :reader :Dark Mode :nickel_setting :toggle :dark_mode');
});

test('custom menu leaves Dark Mode intact when the device is unknown (e.g. manual mode)', () => {
    const files = itemsFiles('menu_item :reader :Dark Mode :nickel_setting :toggle :dark_mode');
    const result = itemsText(customMenu.postProcess(files, {}));
    assert.equal(result, 'menu_item :reader :Dark Mode :nickel_setting :toggle :dark_mode');
});

test('screensaver feature inserts its Tweak menu toggle right after the menu header', () => {
    const files = itemsFiles(
        'experimental :menu_main_15505_label :Tweak',
        'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png',
        '',
        'menu_item :main :Screenshots :nickel_setting :toggle :screenshots',
    );

    const result = itemsText(screensaver.postProcess(files));
    const lines = result.split('\n');

    // The toggle is added immediately below the icon header (its original spot).
    const headerIndex = lines.findIndex(l => /menu_main_15505_icon/.test(l));
    assert.equal(lines[headerIndex + 1], '');
    assert.equal(lines[headerIndex + 2], 'menu_item :main :Screensaver :cmd_output :500 :quiet :test -e /mnt/onboard/.disabled/screensaver');
    assert.match(result, /Screensaver is now ON/);
    // Existing items are preserved.
    assert.match(result, /^menu_item :main :Screenshots/m);
});

test('custom menu reviewNotices warns only on unsupported devices', () => {
    assert.deepEqual(customMenu.reviewNotices({ deviceInfo: LIBRA_COLOUR }), []);
    assert.deepEqual(customMenu.reviewNotices({}), []);

    const notices = customMenu.reviewNotices({ deviceInfo: AURA_HD });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'warning');
    assert.match(notices[0].paragraphs[0], /Kobo Aura HD/);
});

test('custom menu install fetches the real preset asset paths', async () => {
    const requested = [];
    const assets = new Map([
        ['items', 'menu'],
        ['.cog.png', 'cog'],
    ]);
    const ctx = {
        async asset(path) {
            requested.push(path);
            return new TextEncoder().encode(assets.get(path));
        },
    };

    const files = await customMenu.install(ctx);

    assert.deepEqual(requested, [
        'items',
        '.cog.png',
    ]);
    assert.deepEqual(files.map(file => file.path), [
        '.adds/nm/items',
        '.adds/nm/.cog.png',
    ]);
});
