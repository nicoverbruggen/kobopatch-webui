import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePreviousNickelMenuConfiguration } from '../../src/js/nickelmenu/previous-configuration.js';
import { FONT_FAMILIES } from '../../src/js/nickelmenu/features/additional-fonts/catalogue.js';

function familyFiles(...ids) {
    return FONT_FAMILIES.filter((family) => ids.includes(family.id)).flatMap((family) => family.files.map((file) => ({ path: `fonts/${file}`, type: 'file' })));
}

test('recovers features, font families, tabs, and menu customization', () => {
    const manifest = {
        selected: ['custom-menu', 'simplify-tabs', 'additional-fonts'],
        features: {
            'additional-fonts': {
                files: familyFiles('libron', 'readerly'),
            },
        },
        meta: { writer: { version: '1.53' } },
    };
    const preset = `
experimental :menu_main_15505_1_label: Library
experimental :menu_main_15505_2_enabled: 0
experimental :menu_main_15505_2_label: Progress
experimental :menu_main_15505_3_enabled: 1
experimental :menu_main_15505_3_label: Notes
experimental :menu_main_15505_4_enabled: 1
experimental :menu_main_15505_label :Read
experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.custom-icon.svg
`;

    assert.deepEqual(parsePreviousNickelMenuConfiguration(JSON.stringify(manifest), preset), {
        selectedFeatureIds: ['custom-menu', 'simplify-tabs', 'additional-fonts'],
        menuCustomization: { label: 'Read', icon: { type: 'default' } },
        menuIconPath: '.adds/nm/.custom-icon.svg',
        tabsCustomization: {
            labels: { books: 'Library', stats: 'Progress', notes: 'Notes' },
            visibility: { stats: false, notes: true, store: true },
        },
        fontsCustomization: { families: ['libron', 'readerly'] },
    });
});

test('recovers the three fixed font families used before version 1.53', () => {
    const manifest = {
        selected: ['additional-fonts'],
        features: { 'additional-fonts': { files: [] } },
        meta: { writer: { version: '1.52' } },
    };

    const configuration = parsePreviousNickelMenuConfiguration(JSON.stringify(manifest), '');
    assert.deepEqual(configuration.fontsCustomization, { families: ['readerly', 'libron', 'cartisse'] });
});

test('does not invent a font selection for a current manifest without recorded files', () => {
    const manifest = {
        selected: ['additional-fonts'],
        features: { 'additional-fonts': { files: [] } },
        meta: { writer: { version: '1.53' } },
    };

    assert.equal(parsePreviousNickelMenuConfiguration(JSON.stringify(manifest), '').fontsCustomization, null);
});

test('prefers customizations embedded in the manifest after on-device preset files are removed', () => {
    const manifest = {
        selected: ['custom-menu', 'simplify-tabs', 'additional-fonts'],
        features: {},
        configuration: {
            menu: {
                label: 'Read',
                icon: { mimeType: 'image/png', data: btoa('tiny icon') },
            },
            tabs: {
                labels: { books: 'Library', stats: 'Progress', notes: '' },
                visibility: { stats: true, notes: false, store: false },
            },
            fonts: { families: ['readerly', 'libron', 'cartisse'] },
        },
        meta: { writer: { version: '1.54' } },
    };

    const configuration = parsePreviousNickelMenuConfiguration(JSON.stringify(manifest), null);
    assert.equal(configuration.menuCustomization.label, 'Read');
    assert.equal(new TextDecoder().decode(configuration.menuCustomization.icon.data), 'tiny icon');
    assert.deepEqual(configuration.tabsCustomization.labels, { books: 'Library', stats: 'Progress', notes: '' });
    assert.deepEqual(configuration.fontsCustomization, { families: ['readerly', 'libron', 'cartisse'] });
    assert.equal(configuration.menuIconPath, null);
});
