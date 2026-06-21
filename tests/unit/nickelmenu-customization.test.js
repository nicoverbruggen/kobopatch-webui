import test from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveMenuCustomization,
    isDefaultMenuCustomization,
    normalizeMenuLabel,
    findPresetIcon,
    NM_MENU_DEFAULT_LABEL,
    NM_MENU_ICON_DEFAULT_PATH,
    NM_MENU_ICON_CUSTOM_PNG_PATH,
    NM_MENU_ICON_CUSTOM_SVG_PATH,
    NM_MENU_PRESET_ICONS,
} from '../../src/js/nickelmenu/customization.js';

test('resolveMenuCustomization falls back to the default label and cog icon', () => {
    for (const input of [null, { icon: { type: 'default' } }, {}]) {
        const result = resolveMenuCustomization(input);
        assert.equal(result.label, NM_MENU_DEFAULT_LABEL);
        assert.equal(result.iconPath, NM_MENU_ICON_DEFAULT_PATH);
        assert.equal(result.iconFile, null);
    }
});

test('resolveMenuCustomization normalizes the label', () => {
    assert.equal(resolveMenuCustomization({ label: 'Read Mode' }).label, 'ReadMode');
    assert.equal(resolveMenuCustomization({ label: '!!!' }).label, NM_MENU_DEFAULT_LABEL);
});

test('resolveMenuCustomization treats the cog preset as the built-in default icon', () => {
    const result = resolveMenuCustomization({ label: 'Toggle', icon: { type: 'preset', id: 'cog' } });
    assert.equal(result.iconPath, NM_MENU_ICON_DEFAULT_PATH);
    assert.equal(result.iconFile, null);
});

test('resolveMenuCustomization writes a rasterized preset as a custom PNG', () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = resolveMenuCustomization({ icon: { type: 'preset', id: 'book', data } });
    assert.equal(result.iconPath, NM_MENU_ICON_CUSTOM_PNG_PATH);
    assert.ok(result.iconFile.data instanceof Uint8Array);
    assert.deepEqual(result.iconFile.data, data);
    assert.equal(result.iconFile.path, NM_MENU_ICON_CUSTOM_PNG_PATH);
});

test('resolveMenuCustomization writes a preset without raster data as its SVG', () => {
    const result = resolveMenuCustomization({ icon: { type: 'preset', id: 'book' } });
    assert.equal(result.iconPath, NM_MENU_ICON_CUSTOM_SVG_PATH);
    assert.equal(result.iconFile.path, NM_MENU_ICON_CUSTOM_SVG_PATH);
    assert.match(new TextDecoder().decode(result.iconFile.data), /^<svg/);
});

test('preset icons render from Lucide node data with the expected SVG attributes', () => {
    const book = findPresetIcon('book');
    assert.equal(NM_MENU_PRESET_ICONS.length, 12);
    assert.match(book.svg, /^<svg /);
    assert.match(book.svg, /stroke="#111827"/);
    assert.match(book.svg, /stroke-width="1.0"/);
    assert.match(book.svg, /<path d="M12 7v14"\/>/);
});

test('resolveMenuCustomization ignores an unknown preset and uses the default icon', () => {
    const result = resolveMenuCustomization({ icon: { type: 'preset', id: 'does-not-exist' } });
    assert.equal(result.iconPath, NM_MENU_ICON_DEFAULT_PATH);
    assert.equal(result.iconFile, null);
});

test('resolveMenuCustomization routes uploads by mime type', () => {
    const png = resolveMenuCustomization({
        icon: { type: 'upload', data: new Uint8Array([9]), mimeType: 'image/png' },
    });
    assert.equal(png.iconPath, NM_MENU_ICON_CUSTOM_PNG_PATH);
    assert.equal(png.iconFile.path, NM_MENU_ICON_CUSTOM_PNG_PATH);

    const svg = resolveMenuCustomization({
        icon: { type: 'upload', data: new Uint8Array([9]), mimeType: 'image/svg+xml' },
    });
    assert.equal(svg.iconPath, NM_MENU_ICON_CUSTOM_SVG_PATH);
    assert.equal(svg.iconFile.path, NM_MENU_ICON_CUSTOM_SVG_PATH);
});

test('isDefaultMenuCustomization recognizes the default label + icon combination', () => {
    assert.equal(isDefaultMenuCustomization(null), true);
    assert.equal(isDefaultMenuCustomization({ label: 'Toggle', icon: { type: 'default' } }), true);
    assert.equal(isDefaultMenuCustomization({ label: 'Toggle' }), true);
    assert.equal(isDefaultMenuCustomization({ label: '', icon: { type: 'default' } }), true);
    assert.equal(isDefaultMenuCustomization({ label: 'Reader', icon: { type: 'default' } }), false);
    assert.equal(isDefaultMenuCustomization({ label: 'Toggle', icon: { type: 'preset', id: 'book' } }), false);
});

test('normalizeMenuLabel strips non-alphanumerics, truncates, and defaults when empty', () => {
    assert.equal(normalizeMenuLabel('Read Mode'), 'ReadMode');
    assert.equal(normalizeMenuLabel('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJ');
    assert.equal(normalizeMenuLabel('!!!'), NM_MENU_DEFAULT_LABEL);
    assert.equal(normalizeMenuLabel(''), NM_MENU_DEFAULT_LABEL);
});

test('findPresetIcon returns a known preset or null', () => {
    assert.equal(findPresetIcon('cog')?.id, 'cog');
    assert.equal(findPresetIcon('does-not-exist'), null);
});
