import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import JSZip from 'jszip';

import customMenu, { CUSTOM_MENU_ICON_URL, TOGGLE_SCREENSHOTS_SCRIPT_URL } from '../../src/js/nickelmenu/features/custom-menu/index.js';
import cadmus from '../../src/js/nickelmenu/features/cadmus/index.js';
import { homeHiders, TOGGLE_HIDDEN_HOME_SCRIPT_URL } from '../../src/js/nickelmenu/features/hide-home-content/index.js';
import koreader from '../../src/js/nickelmenu/features/koreader/index.js';
import additionalFonts from '../../src/js/nickelmenu/features/additional-fonts/index.js';
import betterTypography, { TOGGLE_TYPOGRAPHY_SCRIPT_URL } from '../../src/js/nickelmenu/features/better-typography/index.js';
import screensaver from '../../src/js/nickelmenu/features/screensaver/index.js';
import simplifyTabs, {
    TOGGLE_TABS_SCRIPT_URL,
    tabLabelsFor,
    defaultTabLabels,
    tabOverrideLines,
} from '../../src/js/nickelmenu/features/simplify-tabs/index.js';
import {
    createDefaultTabsCustomization,
    isDefaultTabsCustomization,
    normalizeTabLabel,
    sanitizeTabLabel,
    visibleTabCount,
} from '../../src/js/nickelmenu/features/simplify-tabs/customization.js';
import sideloadedMode from '../../src/js/nickelmenu/features/sideloaded-mode/index.js';
import { NM_ITEMS_FILE, NICKELHOME_CONFIG_FILE } from '../../src/js/nickelmenu/constants.js';
import { isValidMenuLabel, NM_MENU_ICON_CUSTOM_PNG_PATH, sanitizeMenuLabel } from '../../src/js/nickelmenu/customization.js';
import { FONT_FAMILIES } from '../../src/js/nickelmenu/features/additional-fonts/catalogue.js';
import { revertableConfSettings } from '../../src/js/kobo/configuration.js';
import { createResponse, text } from './test-helpers.js';

const hideNotices = homeHiders.find((f) => f.id === 'hide-notices');

async function createZip(entries) {
    const zip = new JSZip();
    for (const [path, data] of Object.entries(entries)) {
        zip.file(path, data);
    }
    return zip.generateAsync({ type: 'uint8array' });
}

// Test-only companion to createZip(): KOReader's unit test uses a tiny in-memory
// ZIP instead of the production archive, and Cadmus does the same with tar.gz so
// unit tests stay fast and do not depend on downloaded installable assets.
function createTarGzFixture(entries) {
    const blocks = [];

    for (const [path, value] of Object.entries(entries)) {
        const isDirectory = value === null;
        const data = isDirectory ? Buffer.alloc(0) : Buffer.from(value);
        const header = Buffer.alloc(512);
        header.write(path);
        header.write('0000755\0', 100);
        header.write('0000000\0', 108);
        header.write('0000000\0', 116);
        header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
        header.write('00000000000\0', 136);
        header.fill(' ', 148, 156);
        header.write(isDirectory ? '5' : '0', 156);
        header.write('ustar\0', 257);
        header.write('00', 263);

        let checksum = 0;
        for (const byte of header) checksum += byte;
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);

        blocks.push(header);
        if (!isDirectory) {
            blocks.push(data);
            const padding = (512 - (data.length % 512)) % 512;
            if (padding) blocks.push(Buffer.alloc(padding));
        }
    }

    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
}

// Set the build-time installables manifest (normally injected by Vite define)
// so features can resolve their pinned version and versioned asset URL in tests.
async function withManifest(manifest, fn) {
    const original = globalThis.__INSTALLABLES__;
    globalThis.__INSTALLABLES__ = manifest;
    try {
        await fn();
    } finally {
        globalThis.__INSTALLABLES__ = original;
    }
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

// An in-memory stand-in for a collection archive holding the catalogued files
// of the given families (each file's content is its own name).
async function createFontArchive(families, extraEntries = {}) {
    return createZip({
        ...Object.fromEntries(families.flatMap((family) => family.files.map((file) => [file, `data ${file}`]))),
        ...extraEntries,
    });
}

test('Additional Fonts installs the core collection by default, extracting only catalogued font files', async () => {
    const coreFamilies = FONT_FAMILIES.filter((family) => family.collection === 'core');
    const coreZip = await createFontArchive(coreFamilies, { 'LICENSE.txt': 'ignored non-font file' });

    // Only the core archive is mocked: fetching the extra archive would 404, so
    // this also proves a default install never downloads the larger extra set.
    await withMockFetch(new Map([['/assets/kobo-core-fonts.zip', createResponse(coreZip)]]), async () => {
        const files = await additionalFonts.install({ progress() {} });

        assert.deepEqual(
            files.map((file) => file.path),
            coreFamilies.flatMap((family) => family.files.map((file) => 'fonts/' + file)),
        );
        assert.ok(files.map((file) => file.path).includes('fonts/KF_Libron-Regular.ttf'));
        assert.ok(files.every((file) => file.data instanceof Uint8Array));
        assert.equal(text(files.find((file) => file.path === 'fonts/KF_Libron-Regular.ttf').data), 'data KF_Libron-Regular.ttf');
    });
});

test('Additional Fonts downloads only the archives its selection needs and strips ZIP directory prefixes', async () => {
    const readerly = FONT_FAMILIES.find((family) => family.id === 'readerly');
    assert.equal(readerly.collection, 'extra');

    const [regular, ...rest] = readerly.files;
    const extraZip = await createZip({
        // A directory prefix is stripped, so nested archive layouts still land in fonts/.
        ['Readerly/' + regular]: 'readerly regular',
        ...Object.fromEntries(rest.map((file) => [file, `data ${file}`])),
        'KF_Literata-Regular.ttf': 'not selected',
    });

    await withMockFetch(new Map([['/assets/kobo-extra-fonts.zip', createResponse(extraZip)]]), async () => {
        const files = await additionalFonts.install({ progress() {}, fontsCustomization: { families: ['readerly'] } });

        assert.deepEqual(files.map((file) => file.path).sort(), readerly.files.map((file) => 'fonts/' + file).sort());
        assert.equal(text(files.find((file) => file.path === 'fonts/' + regular).data), 'readerly regular');
    });
});

test('Additional Fonts fails loudly when an archive is missing a catalogued file', async () => {
    const libron = FONT_FAMILIES.find((family) => family.id === 'libron');
    const coreZip = await createZip({ [libron.files[0]]: 'only the regular weight' });

    await withMockFetch(new Map([['/assets/kobo-core-fonts.zip', createResponse(coreZip)]]), async () => {
        await assert.rejects(additionalFonts.install({ progress() {}, fontsCustomization: { families: ['libron'] } }), /core fonts archive is missing/);
    });
});

test('Additional Fonts cleanup detects any Regular weight and removes every catalogued font file', () => {
    const { cleanup } = additionalFonts;

    assert.equal(cleanup.mode, 'optional');
    assert.ok(cleanup.detect.every(([dir, file]) => dir === 'fonts' && file.endsWith('-Regular.ttf')));
    // Fonts installed by older app versions (Readerly/Libron/Cartisse) use the
    // same file names, so existing installs stay detected and removable.
    assert.ok(cleanup.detect.some(([, file]) => file === 'KF_Readerly-Regular.ttf'));

    const paths = cleanup.paths.map((entry) => entry.path.join('/'));
    for (const family of FONT_FAMILIES) {
        for (const file of family.files) {
            assert.ok(paths.includes('fonts/' + file), `cleanup misses fonts/${file}`);
        }
    }
});

test('Better typography and fixes exposes label and version', async () => {
    assert.equal(betterTypography.title, 'Better typography and fixes');

    await withManifest({ nickeltypefix: { version: 'v0.3', available: true } }, () => {
        assert.equal(betterTypography.version(), 'v0.3');
    });
    await withManifest({ nickeltypefix: { version: 'v0.3', available: false } }, () => {
        assert.equal(betterTypography.version(), null);
    });
});

test('Better typography and fixes sets reading rendering; default font only when Libron is installed', () => {
    const readingDefaults = [
        // webkitTextRendering is revertable (owned for removal).
        {
            section: 'Reading',
            key: 'webkitTextRendering',
            value: 'optimizeLegibility',
            revertable: true,
            revertTo: null,
        },
    ];

    // Without the additional fonts, the default reading font is left untouched.
    assert.deepEqual(betterTypography.confSettings({ features: [] }), readingDefaults);
    assert.deepEqual(betterTypography.confSettings(), readingDefaults);

    // With the additional fonts selected (the default selection includes
    // Libron), KF Libron becomes the default font.
    assert.deepEqual(betterTypography.confSettings({ features: [{ id: 'additional-fonts' }] }), [
        ...readingDefaults,
        { section: 'Reading', key: 'readingFontFamily', value: 'KF Libron' },
    ]);

    // A fonts selection without Libron leaves the default font untouched, so we
    // never point the reader at a font that isn't there.
    assert.deepEqual(
        betterTypography.confSettings({ features: [{ id: 'additional-fonts' }], fontsCustomization: { families: ['sourcerer'] } }),
        readingDefaults,
    );
});

test('Better typography and fixes ships the toggle script and contributes its Tweak menu item at the Legibility slot', async () => {
    const requested = [];
    const ctx = {
        async bundledAsset(url) {
            requested.push(url);
            return new TextEncoder().encode('#!/bin/sh\ntoggle');
        },
    };
    const installed = await betterTypography.install(ctx);
    assert.deepEqual(requested, [TOGGLE_TYPOGRAPHY_SCRIPT_URL]);
    assert.deepEqual(
        installed.map((f) => f.path),
        ['.adds/nm/scripts/toggle_typography.sh'],
    );

    // menuItems() contributes the single "Typography" entry; its position
    // (the old "Legibility Toggle" slot) is set in features/menu-order.js.
    const entries = betterTypography.menuItems();
    assert.deepEqual(entries, [
        {
            id: 'typography',
            lines: ['menu_item :main :Typography :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_typography.sh'],
        },
    ]);
});

test('Sideload Mode sets SideloadedMode under ApplicationPreferences and declares a 4.31 floor', () => {
    assert.equal(sideloadedMode.minimumVersion, '4.31');
    assert.equal(sideloadedMode.default, false);
    assert.deepEqual(sideloadedMode.confSettings(), [
        // Revertable: the flow detects the feature by this key and the uninstaller
        // removes the line (revertTo: null) on removal.
        { section: 'ApplicationPreferences', key: 'SideloadedMode', value: 'true', revertable: true, revertTo: null },
    ]);
});

test('Sideload Mode comments out the home-tab override so the home tab is hidden', () => {
    // simplify-tabs force-enables the home tab; Sideload Mode must comment it out.
    const files = itemsFiles('experimental :menu_main_15505_0_enabled: 1', 'experimental :menu_main_15505_1_label: Books');
    const result = itemsText(sideloadedMode.postProcess(files));
    const lines = result.split('\n');

    assert.equal(lines[0], '# Home tab hidden for Sideload Mode (no home screen when not signed in).');
    assert.equal(lines[1], '# experimental :menu_main_15505_0_enabled: 1');
    // Other tab settings are left untouched.
    assert.match(result, /^experimental :menu_main_15505_1_label: Books$/m);
});

test('Sideload Mode postProcess is a no-op when the home-tab override is absent', () => {
    // Without simplify-tabs there is no override line; Sideload Mode hides the
    // home tab on its own, so nothing in the items file changes.
    const files = itemsFiles('menu_item :main :Reboot :power :reboot');
    assert.equal(itemsText(sideloadedMode.postProcess(files)), 'menu_item :main :Reboot :power :reboot');
});

test('Sideload Mode cleanup is conf-only: detect/revert derive from its revertable setting', () => {
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
    assert.deepEqual(koreader.menuItems(), [
        {
            id: 'koreader',
            lines: ['menu_item:main:Open KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh'],
        },
    ]);
});

test('Cadmus contributes its launcher entry at the top of the menu', () => {
    assert.equal(cadmus.section, 'Alternative reading apps');
    assert.deepEqual(cadmus.menuItems(), [
        {
            id: 'cadmus',
            lines: ['menu_item:main:Open Cadmus:cmd_spawn:quiet:exec /mnt/onboard/.adds/cadmus/cadmus.sh'],
        },
    ]);
});

test('Better typography and fixes cleanup removes the toggle script, NickelTypeFix, and the WebKit setting', () => {
    const { cleanup } = betterTypography;

    assert.equal(cleanup.mode, 'optional');
    // The toggle script is cleaned up by explicit path (alongside NM recursive
    // .adds/nm deletion) for robustness; NickelTypeFix is removed by deleting
    // its directory (its uninstall_xflag makes the mod self-remove on reboot).
    // Detection is the revertable conf setting or the mod's directory.
    assert.deepEqual(cleanup.paths, [{ path: ['.adds', 'nm', 'scripts', 'toggle_typography.sh'] }, { path: ['.adds', 'nickel-type-fix'], recursive: true }]);
    assert.deepEqual(cleanup.detect, [['.adds', 'nickel-type-fix']]);
    assert.equal(cleanup.detectConf, undefined);
    assert.equal(cleanup.revertConf, undefined);
    assert.deepEqual(revertableConfSettings(betterTypography), [
        {
            section: 'Reading',
            key: 'webkitTextRendering',
            value: 'optimizeLegibility',
            revertable: true,
            revertTo: null,
        },
    ]);
});

test('KOReader install maps ZIP files under .adds/koreader', async () => {
    const zipData = await createZip({
        'koreader/koreader.sh': '#!/bin/sh',
        'defaults.lua': 'return {}',
    });
    const progressMessages = [];

    await withManifest({ koreader: { version: 'v2026.01', available: true } }, () =>
        withMockFetch(new Map([['/assets/koreader-kobo.zip?v=v2026.01', createResponse(zipData)]]), async () => {
            const files = await koreader.install({
                progress(message) {
                    progressMessages.push(message);
                },
            });

            assert.deepEqual(
                files.map((file) => file.path),
                ['.adds/koreader/koreader.sh', '.adds/koreader/defaults.lua'],
            );
            assert.equal(text(files[0].data), '#!/bin/sh');
            assert.deepEqual(progressMessages, ['Downloading KOReader v2026.01...', 'Extracting KOReader...']);
        }),
    );
});

test('Cadmus install maps tar.gz files under .adds/cadmus', async () => {
    const tarData = createTarGzFixture({
        './': null,
        './cadmus.sh': '#!/bin/sh',
        './libs/': null,
        './libs/libcadmus.so': 'library',
    });
    const progressMessages = [];

    await withManifest({ cadmus: { version: 'v0.10.1', available: true } }, () =>
        withMockFetch(new Map([['/assets/cadmus-kobo.tar.gz?v=v0.10.1', createResponse(tarData)]]), async () => {
            const files = await cadmus.install({
                progress(message) {
                    progressMessages.push(message);
                },
            });

            assert.deepEqual(
                files.map((file) => file.path),
                ['.adds/cadmus/cadmus.sh', '.adds/cadmus/libs/libcadmus.so'],
            );
            assert.equal(text(files[0].data), '#!/bin/sh');
            assert.deepEqual(progressMessages, ['Downloading Cadmus v0.10.1...', 'Extracting Cadmus...']);
        }),
    );
});

test('NickelMenu postProcess features prepend tab config; hide flags go to NickelHome config', () => {
    const files = [{ path: NM_ITEMS_FILE, data: 'menu_item :main :base' }];

    const processed = hideNotices.postProcess(simplifyTabs.postProcess(files));
    const items = processed.find((f) => f.path === NM_ITEMS_FILE).data;
    const homeCfg = processed.find((f) => f.path === NICKELHOME_CONFIG_FILE).data;

    // simplify-tabs prepends its tab config block to the items file...
    assert.match(items, /^experimental :menu_main_15505_0_enabled: 1\n/);
    // ...while hide-notices writes its flag to NickelHome's own config, not the items file.
    assert.doesNotMatch(items, /hide_home_row3_enabled/);
    assert.match(homeCfg, /hide_home_row3_enabled:1\n$/);
});

test('simplify-tabs renames tabs in English with the possessive dropped and "Stats" for Activity', () => {
    assert.deepEqual(tabLabelsFor('en'), { books: 'Books', stats: 'Stats', notes: 'Notes' });
    // Region variants resolve by language subtag.
    assert.deepEqual(tabLabelsFor('en_US'), { books: 'Books', stats: 'Stats', notes: 'Notes' });

    const lines = tabOverrideLines('en_GB');
    assert.ok(lines.includes('experimental :menu_main_15505_1_label: Books'));
    assert.ok(lines.includes('experimental :menu_main_15505_2_label: Stats'));
    assert.ok(lines.includes('experimental :menu_main_15505_3_label: Notes'));
});

test('simplify-tabs uses localized labels for a translated non-English language', () => {
    assert.deepEqual(tabLabelsFor('fr_CA'), { books: 'Livres', stats: 'Stats', notes: 'Notes' });

    const files = [{ path: NM_ITEMS_FILE, data: 'menu_item :main :base' }];
    const items = simplifyTabs.postProcess(files, { deviceInfo: { uiLocale: 'de' } })[0].data;
    assert.match(items, /^experimental :menu_main_15505_1_label: Bücher$/m);
    assert.match(items, /^experimental :menu_main_15505_2_label: Stats$/m);
    assert.match(items, /^experimental :menu_main_15505_3_label: Notizen$/m);
    // Structural lines are still present.
    assert.match(items, /^experimental :menu_main_15505_enabled: 1$/m);
});

test('simplify-tabs omits the label lines for an untranslated language so the device keeps its names', () => {
    assert.equal(tabLabelsFor('ja'), null);

    const files = [{ path: NM_ITEMS_FILE, data: 'menu_item :main :base' }];
    const items = simplifyTabs.postProcess(files, { deviceInfo: { uiLocale: 'ja' } })[0].data;
    assert.doesNotMatch(items, /_label:/);
    // The structural tab overrides are still applied.
    assert.match(items, /^experimental :menu_main_15505_0_enabled: 1$/m);
    assert.match(items, /^experimental :menu_main_15505_enabled: 1$/m);
});

test('simplify-tabs falls back to the English defaults when the locale is unknown (manual connection / download)', () => {
    // The raw translation lookup has nothing for an unknown locale...
    assert.equal(tabLabelsFor(null), null);
    assert.equal(tabLabelsFor(undefined), null);
    // ...but the applied default falls back to English so the tabs are still
    // renamed (matching the dialog placeholders and the pre-customization
    // behaviour), rather than leaving the device's own "My Books" names.
    assert.deepEqual(defaultTabLabels(null), { books: 'Books', stats: 'Stats', notes: 'Notes' });
    assert.deepEqual(defaultTabLabels(undefined), { books: 'Books', stats: 'Stats', notes: 'Notes' });

    // No ctx at all (download flow) and an explicit null locale both apply the
    // English default labels.
    const noCtx = simplifyTabs.postProcess([{ path: NM_ITEMS_FILE, data: 'base' }])[0].data;
    const nullLocale = simplifyTabs.postProcess([{ path: NM_ITEMS_FILE, data: 'base' }], { deviceInfo: { uiLocale: null } })[0].data;
    for (const items of [noCtx, nullLocale]) {
        assert.match(items, /^experimental :menu_main_15505_1_label: Books$/m);
        assert.match(items, /^experimental :menu_main_15505_2_label: Stats$/m);
        assert.match(items, /^experimental :menu_main_15505_3_label: Notes$/m);
    }
    assert.match(noCtx, /^experimental :menu_main_15505_0_enabled: 1$/m);
});

test('simplify-tabs visibility customization toggles the optional tab _enabled lines', () => {
    // Default customization matches the historical behaviour: show Stats, hide
    // Notes and the store.
    const def = tabOverrideLines('en', createDefaultTabsCustomization());
    assert.ok(def.includes('experimental :menu_main_15505_2_enabled: 1'));
    assert.ok(def.includes('experimental :menu_main_15505_3_enabled: 0'));
    assert.ok(def.includes('experimental :menu_main_15505_4_enabled: 0'));

    // Flip every optional tab: hide Stats, show Notes and the store.
    const custom = tabOverrideLines('en', { visibility: { stats: false, notes: true, store: true } });
    assert.ok(custom.includes('experimental :menu_main_15505_2_enabled: 0'));
    assert.ok(custom.includes('experimental :menu_main_15505_3_enabled: 1'));
    assert.ok(custom.includes('experimental :menu_main_15505_4_enabled: 1'));
    // Home / More / default / enabled remain structural.
    assert.ok(custom.includes('experimental :menu_main_15505_0_enabled: 1'));
    assert.ok(custom.includes('experimental :menu_main_15505_5_enabled: 1'));
    assert.ok(custom.includes('experimental :menu_main_15505_default: 1'));
});

test('simplify-tabs explicit labels win over the locale defaults, and a blank label omits its line', () => {
    // Explicit labels override even the localized defaults.
    const custom = { labels: { books: 'Library', stats: 'Activity', notes: 'Ideas' }, visibility: { stats: true, notes: false, store: false } };
    const lines = tabOverrideLines('de', custom);
    assert.ok(lines.includes('experimental :menu_main_15505_1_label: Library'));
    assert.ok(lines.includes('experimental :menu_main_15505_2_label: Activity'));
    assert.ok(lines.includes('experimental :menu_main_15505_3_label: Ideas'));
    assert.ok(!lines.some((l) => /_label:.*Bücher/.test(l)));

    // A blank (or whitespace-only) label omits just that tab's _label line while
    // keeping the others.
    const partial = tabOverrideLines('en', { labels: { books: 'Reads', stats: '', notes: '  ' } });
    assert.ok(partial.includes('experimental :menu_main_15505_1_label: Reads'));
    assert.ok(!partial.some((l) => l.startsWith('experimental :menu_main_15505_2_label:')));
    assert.ok(!partial.some((l) => l.startsWith('experimental :menu_main_15505_3_label:')));
});

test('simplify-tabs postProcess threads a tabsCustomization from the install context', () => {
    const files = [{ path: NM_ITEMS_FILE, data: 'menu_item :main :base' }];
    const items = simplifyTabs.postProcess(files, {
        deviceInfo: { uiLocale: 'en' },
        tabsCustomization: { labels: { books: 'Books', stats: 'Stats', notes: 'Notes' }, visibility: { stats: false, notes: true, store: true } },
    })[0].data;
    assert.match(items, /^experimental :menu_main_15505_2_enabled: 0$/m);
    assert.match(items, /^experimental :menu_main_15505_3_enabled: 1$/m);
    assert.match(items, /^experimental :menu_main_15505_4_enabled: 1$/m);
});

test('simplify-tabs label sanitizer strips config-breaking characters and caps length', () => {
    assert.equal(sanitizeTabLabel('My: Books\n'), 'My Books');
    assert.equal(sanitizeTabLabel('ThisIsAReallyLongLabel'), 'ThisIsAReall'); // 12 chars
    assert.equal(normalizeTabLabel('  spaced  '), 'spaced');
    assert.equal(visibleTabCount(createDefaultTabsCustomization()), 4);
    assert.equal(visibleTabCount({ visibility: { stats: true, notes: true, store: true } }), 6);
    assert.equal(isDefaultTabsCustomization(createDefaultTabsCustomization()), true);
    assert.equal(isDefaultTabsCustomization({ visibility: { stats: false } }), false);
    assert.equal(isDefaultTabsCustomization({ labels: { books: 'X' } }), false);
});

test('simplify-tabs postProcess runs before sideloaded-mode so the home-tab override can be commented out', () => {
    // simulate a generated items file with the tab config from simplify-tabs
    const files = itemsFiles('experimental :menu_main_15505_label :Toggle', 'menu_item :main :Power :power :reboot');

    const withTabs = simplifyTabs.postProcess(files);
    const commented = sideloadedMode.postProcess(withTabs);
    const items = itemsText(commented);

    // The home-tab force-enable line (index 0) is commented out by sideloaded-mode
    assert.match(items, /^# Home tab hidden for Sideload Mode/);
    assert.match(items, /^# experimental :menu_main_15505_0_enabled: 1/m);
    // Other tab config and menu items are left untouched
    assert.match(items, /^experimental :menu_main_15505_label :Toggle$/m);
    assert.match(items, /menu_item :main :Power :power :reboot/);
});

// Dark mode support is keyed on the hardware UUID, so these carry the real UUID
// (the serial prefix is included to mirror a parsed deviceInfo).
const AURA_HD = { hardwareId: '00000000-0000-0000-0000-000000000350', serialPrefix: 'N204', model: 'Kobo Aura HD' }; // no Dark mode
const LIBRA_COLOUR = { hardwareId: '00000000-0000-0000-0000-000000000390', serialPrefix: 'N428', model: 'Kobo Libra Colour' }; // Dark mode

function itemsFiles(...lines) {
    return [{ path: NM_ITEMS_FILE, data: lines.join('\n') }];
}

function itemsText(files) {
    return files.find((f) => f.path === NM_ITEMS_FILE).data;
}

test('custom menu omits the Dark Mode item on unsupported devices', () => {
    const ids = customMenu.menuItems({ deviceInfo: AURA_HD }).map((e) => e.id);
    assert.ok(!ids.includes('dark-mode'));
    // The rest of the base menu is still present.
    assert.ok(ids.includes('tweak-header'));
    assert.ok(ids.includes('screenshots'));
});

test('custom menu includes the Dark Mode item on supported devices', () => {
    const entries = customMenu.menuItems({ deviceInfo: LIBRA_COLOUR });
    const darkMode = entries.find((e) => e.id === 'dark-mode');
    assert.deepEqual(darkMode.lines, ['menu_item :reader :Dark Mode        :nickel_setting     :toggle :dark_mode']);
});

test('custom menu screenshot toggle reports the resulting state', () => {
    const screenshots = customMenu.menuItems().find((entry) => entry.id === 'screenshots');
    assert.deepEqual(screenshots.lines, [
        'menu_item :main :Screenshots :nickel_setting :toggle :screenshots',
        '    chain_success :cmd_output :1000 :/mnt/onboard/.adds/nm/scripts/toggle_screenshots.sh',
    ]);

    const script = readFileSync(new URL(TOGGLE_SCREENSHOTS_SCRIPT_URL), 'utf8');
    assert.match(script, /Screenshot mode is ON!/);
    assert.match(script, /Press the power button to take a screenshot\./);
    assert.match(script, /Important: the button cannot lock or wake your/);
    assert.match(script, /Kobo in this mode\. Remember to select Screenshots/);
    assert.match(script, /again when you're done\./);
    assert.match(script, /Screenshot mode is OFF!/);
    assert.match(script, /Your power button works normally again and can/);
    assert.match(script, /be used to lock or wake up your device\./);
});

test('custom menu includes the Dark Mode item when the device is unknown (manual mode)', () => {
    const ids = customMenu.menuItems({}).map((e) => e.id);
    assert.ok(ids.includes('dark-mode'));
});

test('custom menu uses the configured tab label and custom icon path', () => {
    const header = customMenu
        .menuItems({
            menuCustomization: {
                label: 'Read',
                icon: { type: 'preset', id: 'spark', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) },
            },
        })
        .find((e) => e.id === 'tweak-header');

    assert.deepEqual(header.lines, [
        'experimental :menu_main_15505_label :Read',
        `experimental :menu_main_15505_icon :/mnt/onboard/${NM_MENU_ICON_CUSTOM_PNG_PATH}`,
    ]);
});

test('custom menu label sanitization keeps only NickelMenu-safe text', () => {
    assert.equal(sanitizeMenuLabel('ReadMode!'), 'ReadMode');
    assert.equal(sanitizeMenuLabel('Read Mode'), 'ReadMode');
    assert.equal(sanitizeMenuLabel('Cats:Books'), 'CatsBooks');
    assert.equal(sanitizeMenuLabel('ABCDEFGHIJK'), 'ABCDEFGHIJ');

    assert.equal(isValidMenuLabel('ReadMode'), true);
    assert.equal(isValidMenuLabel('Read Mode'), false);
    assert.equal(isValidMenuLabel('ReadMode!'), false);
    assert.equal(isValidMenuLabel(''), false);
});

test('screensaver feature contributes its Tweak menu toggle near the top of the menu', () => {
    const entries = screensaver.menuItems();

    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'screensaver');
    assert.equal(entries[0].lines[0], 'menu_item :main :Screensaver :cmd_output :500 :quiet :test -e /mnt/onboard/.disabled/screensaver');
    assert.ok(entries[0].lines.some((l) => /Screensaver is now ON/.test(l)));
});

test('custom menu reviewNotices warns only on unsupported devices', () => {
    assert.deepEqual(customMenu.reviewNotices({ deviceInfo: LIBRA_COLOUR }), []);
    assert.deepEqual(customMenu.reviewNotices({}), []);

    const notices = customMenu.reviewNotices({ deviceInfo: AURA_HD });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'warning');
    assert.match(notices[0].paragraphs[0], /Kobo Aura HD/);
});

test('custom menu install ships the menu icon and screenshot toggle script', async () => {
    const requested = [];
    const ctx = {
        features: [],
        async bundledAsset(url) {
            requested.push(url);
            return new TextEncoder().encode('asset');
        },
    };

    const files = await customMenu.install(ctx);

    assert.deepEqual(requested, [TOGGLE_SCREENSHOTS_SCRIPT_URL, CUSTOM_MENU_ICON_URL]);
    assert.deepEqual(
        files.map((file) => file.path),
        ['.adds/nm/.cog.png', '.adds/nm/scripts/toggle_screenshots.sh'],
    );
});

test('home-content hiders share one toggle item and append distinct flags', () => {
    // Every hider contributes the identical shared toggle entry (same id, same
    // script), so the installer can de-duplicate them into a single Tweak item.
    const toggleIds = homeHiders.map((h) => h.menuItems()[0].id);
    assert.deepEqual(toggleIds, ['toggle-hidden-home', 'toggle-hidden-home', 'toggle-hidden-home']);
    assert.match(homeHiders[0].menuItems()[0].lines[0], /toggle_hidden_home\.sh$/);

    // ...but each writes its own hide flag to NickelHome's config (no experimental: prefix).
    const flags = homeHiders.map((h) => {
        const files = h.postProcess([]);
        const cfg = files.find((f) => f.path === NICKELHOME_CONFIG_FILE);
        return cfg.data
            .trim()
            .split('\n')
            .filter((l) => l.startsWith('hide_home_'))
            .join('\n');
    });
    assert.deepEqual(flags, ['hide_home_row1col2_enabled:1', 'hide_home_row2col2_enabled:1', 'hide_home_row3_enabled:1']);

    // The config carries NickelHome's master switch, which the "Minimal Home" toggle flips.
    assert.match(homeHiders[0].postProcess([]).find((f) => f.path === NICKELHOME_CONFIG_FILE).data, /^nhm_enabled:1$/m);

    // Multiple selected hiders merge into a single NickelHome config file (one nhm_enabled line).
    let merged = [];
    for (const h of homeHiders) merged = h.postProcess(merged);
    const cfg = merged.find((f) => f.path === NICKELHOME_CONFIG_FILE);
    assert.equal(merged.filter((f) => f.path === NICKELHOME_CONFIG_FILE).length, 1);
    assert.equal((cfg.data.match(/^nhm_enabled:1$/gm) || []).length, 1);
    assert.match(cfg.data, /hide_home_row1col2_enabled:1/);
    assert.match(cfg.data, /hide_home_row2col2_enabled:1/);
    assert.match(cfg.data, /hide_home_row3_enabled:1/);
});

test('the home hiders expose a single NickelHome cleanup covering both folder names', () => {
    // One shared cleanup, not one per hider, so removal shows a single "Remove NickelHome".
    const withCleanup = homeHiders.filter((h) => h.cleanup);
    assert.equal(withCleanup.length, 1);
    const c = withCleanup[0].cleanup;
    assert.equal(c.mode, 'optional');
    assert.equal(c.title, 'NickelHome');
    // Detects and removes both the current and the pre-v0.6 folder names.
    assert.deepEqual(c.detect, [
        ['.adds', 'nickel-home'],
        ['.adds', 'nickelhome'],
    ]);
    const removedDirs = c.paths.filter((p) => p.recursive).map((p) => p.path.join('/'));
    assert.ok(removedDirs.includes('.adds/nickel-home'));
    assert.ok(removedDirs.includes('.adds/nickelhome'));
});

test('a home-content hider ships the shared toggle script to .adds/nm/scripts', async () => {
    // The hider fetches the shared script by its Vite-tracked URL, which the
    // installer routes through its per-run, de-duplicating asset cache.
    let requestedUrl = null;
    const ctx = {
        async bundledAsset(url) {
            requestedUrl = url;
            return new TextEncoder().encode('toggle home');
        },
    };

    const files = await hideNotices.install(ctx);
    assert.equal(requestedUrl, TOGGLE_HIDDEN_HOME_SCRIPT_URL);
    assert.deepEqual(
        files.map((file) => file.path),
        ['.adds/nm/scripts/toggle_hidden_home.sh'],
    );
});

test('simplify-tabs owns its navigation-tab toggle script and item', async () => {
    const requested = [];
    const ctx = {
        async bundledAsset(url) {
            requested.push(url);
            return new TextEncoder().encode('script');
        },
    };

    const files = await simplifyTabs.install(ctx);

    assert.deepEqual(requested, [TOGGLE_TABS_SCRIPT_URL]);
    assert.deepEqual(
        files.map((file) => file.path),
        ['.adds/nm/scripts/toggle_tabs.sh'],
    );

    const items = simplifyTabs.menuItems();
    assert.deepEqual(
        items.map((e) => e.id),
        ['toggle-tabs'],
    );
    assert.match(items[0].lines[0], /toggle_tabs\.sh$/);
});

test('custom menu never contributes toggle items itself', () => {
    // The toggles are owned by the hide-home-content and simplify-tabs features.
    const ids = customMenu.menuItems({ features: [{ id: 'koreader' }] }).map((e) => e.id);
    assert.ok(!ids.some((id) => id.startsWith('toggle-')));
});
