import test from 'node:test';
import assert from 'node:assert/strict';

import JSZip from 'jszip';

import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import hideNotices from '../../src/js/nickelmenu/features/hide-notices/index.js';
import koreader from '../../src/js/nickelmenu/features/koreader/index.js';
import readerlyFonts from '../../src/js/nickelmenu/features/readerly-fonts/index.js';
import simplifyTabs from '../../src/js/nickelmenu/features/simplify-tabs/index.js';
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

test('Readerly font install strips ZIP directories and ignores non-font files', async () => {
    const zipData = await createZip({
        'Readerly/KF_Readerly-Regular.ttf': 'regular font',
        'Readerly/KF_Readerly-Bold.ttf': 'bold font',
        'Readerly/LICENSE.txt': 'license',
        '__MACOSX/KF_Readerly-Italic.ttf': 'ignored directory prefix still stripped',
    });

    await withMockFetch(new Map([
        ['/assets/KF_Readerly.zip', createResponse(zipData)],
    ]), async () => {
        const files = await readerlyFonts.install({ progress() {} });

        assert.deepEqual(files.map(file => file.path), [
            'fonts/KF_Readerly-Regular.ttf',
            'fonts/KF_Readerly-Bold.ttf',
            'fonts/KF_Readerly-Italic.ttf',
        ]);
        assert.equal(text(files[0].data), 'regular font');
        assert.ok(files.every(file => file.data instanceof Uint8Array));
    });
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
        ['scripts/legibility_status.sh', 'legibility'],
        ['scripts/toggle_wk_rendering.sh', 'toggle'],
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
        'scripts/legibility_status.sh',
        'scripts/toggle_wk_rendering.sh',
    ]);
    assert.deepEqual(files.map(file => file.path), [
        '.adds/nm/items',
        '.adds/nm/.cog.png',
        '.adds/scripts/legibility_status.sh',
        '.adds/scripts/toggle_wk_rendering.sh',
    ]);
});
