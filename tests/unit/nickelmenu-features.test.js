import test from 'node:test';
import assert from 'node:assert/strict';

import JSZip from 'jszip';

import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import { homeHiders } from '../../src/js/nickelmenu/features/hide-home-content/index.js';
import koreader from '../../src/js/nickelmenu/features/koreader/index.js';
import additionalFonts from '../../src/js/nickelmenu/features/additional-fonts/index.js';
import betterTypography from '../../src/js/nickelmenu/features/better-typography/index.js';
import screensaver from '../../src/js/nickelmenu/features/screensaver/index.js';
import simplifyTabs from '../../src/js/nickelmenu/features/simplify-tabs/index.js';
import sideloadedMode from '../../src/js/nickelmenu/features/sideloaded-mode/index.js';
import { revertableConfSettings } from '../../src/js/nickelmenu/installer.js';
import { createResponse, text } from './test-helpers.js';

const hideNotices = homeHiders.find(f => f.id === 'hide-notices');

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
        // webkitTextRendering is revertable (owned for removal); the others are
        // general preferences applied once and never reverted.
        { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility', revertable: true, revertTo: null },
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

test('Better Typography ships the toggle script and contributes its Tweak menu item at the Legibility slot', async () => {
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

    // menuItems() contributes the single "Toggle Typography" entry; its position
    // (the old "Legibility Toggle" slot) is set in features/menu-order.js.
    const entries = betterTypography.menuItems();
    assert.deepEqual(entries, [{
        id: 'typography',
        lines: ['menu_item :main :Toggle Typography :cmd_output :7000 :/mnt/onboard/.adds/scripts/toggle_typography.sh'],
    }]);
});

test('Sideload mode sets SideloadedMode under ApplicationPreferences and declares a 4.31 floor', () => {
    assert.equal(sideloadedMode.minimumVersion, '4.31');
    assert.equal(sideloadedMode.default, false);
    assert.deepEqual(sideloadedMode.confSettings(), [
        // Revertable: the flow detects the feature by this key and the uninstaller
        // removes the line (revertTo: null) on removal.
        { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true', revertable: true, revertTo: null },
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

test('Sideload mode cleanup is conf-only: detect/revert derive from its revertable setting', () => {
    const { cleanup } = sideloadedMode;
    assert.equal(cleanup.mode, 'optional');
    // No files and no separate detectConf/revertConf — the revertable conf
    // setting in confSettings is the single source for detection and revert.
    assert.equal(cleanup.detect, undefined);
    assert.equal(cleanup.detectConf, undefined);
    assert.equal(cleanup.revertConf, undefined);
    assert.deepEqual(revertableConfSettings(sideloadedMode), [
        { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true', revertable: true, revertTo: null },
    ]);
});

test('KOReader contributes its launcher entry at the top of the menu', () => {
    assert.deepEqual(koreader.menuItems(), [{
        id: 'koreader',
        lines: ['menu_item:main:Open KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh'],
    }]);
});

test('Better Typography cleanup detects and removes both the toggle script and the WebKit setting', () => {
    const { cleanup } = betterTypography;

    assert.equal(cleanup.mode, 'optional');
    // Detected by either the on-device script (cleanup.detect) or the conf line
    // (its revertable confSettings — the toggle can turn the conf line off while
    // leaving the script installed).
    assert.deepEqual(cleanup.detect, [['.adds', 'scripts', 'toggle_typography.sh']]);
    assert.deepEqual(cleanup.paths, [{ path: ['.adds', 'scripts', 'toggle_typography.sh'] }]);
    assert.deepEqual(cleanup.removeParentDirsIfEmpty, [['.adds', 'scripts']]);
    // The conf revert is derived from confSettings, not duplicated on cleanup.
    assert.equal(cleanup.detectConf, undefined);
    assert.equal(cleanup.revertConf, undefined);
    assert.deepEqual(revertableConfSettings(betterTypography), [
        { section: 'Reading', key: 'webkitTextRendering', value: 'optimizeLegibility', revertable: true, revertTo: null },
    ]);
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

test('NickelMenu postProcess features prepend tab config and append hide flags', () => {
    const files = [
        { path: '.adds/nm/items', data: 'menu_item :main :base' },
    ];

    const processed = hideNotices.postProcess(
        simplifyTabs.postProcess(files)
    );
    const items = processed[0].data;

    // simplify-tabs prepends its tab config block, hide-notices appends its flag.
    assert.match(items, /^experimental :menu_main_15505_0_enabled: 1\n/);
    assert.match(items, /menu_item :main :base\nexperimental:hide_home_row3_enabled:1\n$/);
});

test('simplify-tabs postProcess runs before sideloaded-mode so the home-tab override can be commented out', () => {
    // simulate a generated items file with the tab config from simplify-tabs
    const files = itemsFiles('experimental :menu_main_15505_label :Tweak', 'menu_item :main :Power :power :reboot');

    const withTabs = simplifyTabs.postProcess(files);
    const commented = sideloadedMode.postProcess(withTabs);
    const items = itemsText(commented);

    // The home-tab force-enable line (index 0) is commented out by sideloaded-mode
    assert.match(items, /^# Home tab hidden for Sideload mode/);
    assert.match(items, /^# experimental :menu_main_15505_0_enabled: 1/m);
    // Other tab config and menu items are left untouched
    assert.match(items, /^experimental :menu_main_15505_label :Tweak$/m);
    assert.match(items, /menu_item :main :Power :power :reboot/);
});

const AURA_HD = { serialPrefix: 'N204', model: 'Kobo Aura HD' };       // no Dark mode
const LIBRA_COLOUR = { serialPrefix: 'N428', model: 'Kobo Libra Colour' }; // Dark mode

function itemsFiles(...lines) {
    return [{ path: '.adds/nm/items', data: lines.join('\n') }];
}

function itemsText(files) {
    return files.find(f => f.path === '.adds/nm/items').data;
}

test('custom menu omits the Dark Mode item on unsupported devices', () => {
    const ids = customMenu.menuItems({ deviceInfo: AURA_HD }).map(e => e.id);
    assert.ok(!ids.includes('dark-mode'));
    // The rest of the base menu is still present.
    assert.ok(ids.includes('tweak-header'));
    assert.ok(ids.includes('screenshots'));
});

test('custom menu includes the Dark Mode item on supported devices', () => {
    const entries = customMenu.menuItems({ deviceInfo: LIBRA_COLOUR });
    const darkMode = entries.find(e => e.id === 'dark-mode');
    assert.deepEqual(darkMode.lines, ['menu_item :reader :Dark Mode        :nickel_setting     :toggle :dark_mode']);
});

test('custom menu includes the Dark Mode item when the device is unknown (manual mode)', () => {
    const ids = customMenu.menuItems({}).map(e => e.id);
    assert.ok(ids.includes('dark-mode'));
});

test('screensaver feature contributes its Tweak menu toggle near the top of the menu', () => {
    const entries = screensaver.menuItems();

    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'screensaver');
    assert.equal(entries[0].lines[0], 'menu_item :main :Toggle Screensaver :cmd_output :500 :quiet :test -e /mnt/onboard/.disabled/screensaver');
    assert.ok(entries[0].lines.some(l => /Screensaver is now ON/.test(l)));
});

test('custom menu reviewNotices warns only on unsupported devices', () => {
    assert.deepEqual(customMenu.reviewNotices({ deviceInfo: LIBRA_COLOUR }), []);
    assert.deepEqual(customMenu.reviewNotices({}), []);

    const notices = customMenu.reviewNotices({ deviceInfo: AURA_HD });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'warning');
    assert.match(notices[0].paragraphs[0], /Kobo Aura HD/);
});

test('custom menu install ships only the menu icon when no hiders are selected', async () => {
    const requested = [];
    const ctx = {
        features: [],
        async asset(path) {
            requested.push(path);
            return new TextEncoder().encode('asset');
        },
    };

    const files = await customMenu.install(ctx);

    assert.deepEqual(requested, ['.cog.png']);
    assert.deepEqual(files.map(file => file.path), ['.adds/nm/.cog.png']);
});

test('home-content hiders share one toggle item and append distinct flags', () => {
    // Every hider contributes the identical shared toggle entry (same id, same
    // script), so the installer can de-duplicate them into a single Tweak item.
    const toggleIds = homeHiders.map(h => h.menuItems()[0].id);
    assert.deepEqual(toggleIds, ['toggle-hidden-home', 'toggle-hidden-home', 'toggle-hidden-home']);
    assert.match(homeHiders[0].menuItems()[0].lines[0], /toggle_hidden_home\.sh$/);

    // ...but each appends its own experimental flag to the items file.
    const flags = homeHiders.map(h => {
        const files = h.postProcess([{ path: '.adds/nm/items', data: '' }]);
        return files.find(f => f.path === '.adds/nm/items').data.trim();
    });
    assert.deepEqual(flags, [
        'experimental:hide_home_row1col2_enabled:1',
        'experimental:hide_home_row2col2_enabled:1',
        'experimental:hide_home_row3_enabled:1',
    ]);
});

test('a home-content hider ships the shared toggle script to .adds/nm/scripts', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = null;
    globalThis.fetch = async (url) => {
        requestedUrl = url;
        return { ok: true, async arrayBuffer() { return new TextEncoder().encode('toggle home').buffer; } };
    };

    try {
        const files = await hideNotices.install();
        assert.equal(requestedUrl, 'js/nickelmenu/features/hide-home-content/scripts/toggle_hidden_home.sh');
        assert.deepEqual(files.map(file => file.path), ['.adds/nm/scripts/toggle_hidden_home.sh']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('simplify-tabs owns its navigation-tab toggle script and item', async () => {
    const requested = [];
    const ctx = {
        async asset(path) {
            requested.push(path);
            return new TextEncoder().encode('script');
        },
    };

    const files = await simplifyTabs.install(ctx);

    assert.deepEqual(requested, ['scripts/toggle_tabs.sh']);
    assert.deepEqual(files.map(file => file.path), ['.adds/nm/scripts/toggle_tabs.sh']);

    const items = simplifyTabs.menuItems();
    assert.deepEqual(items.map(e => e.id), ['toggle-tabs']);
    assert.match(items[0].lines[0], /toggle_tabs\.sh$/);
});

test('custom menu never contributes toggle items itself', () => {
    // The toggles are owned by the hide-home-content and simplify-tabs features.
    const ids = customMenu.menuItems({ features: [{ id: 'koreader' }] }).map(e => e.id);
    assert.ok(!ids.some(id => id.startsWith('toggle-')));
});
