import test from 'node:test';
import assert from 'node:assert/strict';

import additionalFonts from '../../src/js/nickelmenu/features/additional-fonts/index.js';
import { FONT_COLLECTIONS, FONT_FAMILIES } from '../../src/js/nickelmenu/features/additional-fonts/catalogue.js';
import {
    cloneFontsCustomization,
    createDefaultFontsCustomization,
    fontCollectionsToDownload,
    isDefaultFontsCustomization,
    isFontFamilySelected,
    resolveSelectedFamilyIds,
    selectedFontCount,
    selectedFontFamilies,
} from '../../src/js/nickelmenu/features/additional-fonts/customization.js';

const coreIds = FONT_FAMILIES.filter((family) => family.collection === 'core').map((family) => family.id);

test('generated font catalogue is consistent', () => {
    assert.deepEqual(
        FONT_COLLECTIONS.map((collection) => collection.id),
        ['core', 'extra'],
    );
    for (const collection of FONT_COLLECTIONS) {
        assert.ok(collection.installable.startsWith('ebook-fonts-'));
        assert.ok(collection.asset.endsWith('.zip'));
        assert.ok(
            FONT_FAMILIES.some((family) => family.collection === collection.id),
            `collection ${collection.id} has no families`,
        );
    }

    const ids = new Set();
    for (const family of FONT_FAMILIES) {
        assert.ok(!ids.has(family.id), `duplicate family id ${family.id}`);
        ids.add(family.id);
        assert.ok(['core', 'extra'].includes(family.collection));
        assert.ok(family.files.length > 0);
        // The Regular weight leads, since removal detection keys off files[0].
        assert.match(family.files[0], /^KF_.+-Regular\.ttf$/);
        for (const file of family.files) assert.match(file, /^KF_.+\.ttf$/);
    }

    // The families the app copy and the default-font logic rely on.
    for (const id of ['libron', 'sourcerer', 'cartisse']) {
        assert.equal(FONT_FAMILIES.find((family) => family.id === id)?.collection, 'core', `${id} should be in core`);
    }
    assert.equal(FONT_FAMILIES.find((family) => family.id === 'readerly')?.collection, 'extra');
});

test('default fonts customization resolves to the core collection', () => {
    const customization = createDefaultFontsCustomization();
    assert.ok(isDefaultFontsCustomization(customization));
    assert.ok(isDefaultFontsCustomization(null));
    assert.deepEqual(resolveSelectedFamilyIds(customization), coreIds);
    assert.deepEqual(resolveSelectedFamilyIds(null), coreIds);
    assert.equal(selectedFontCount(customization), coreIds.length);
    assert.ok(isFontFamilySelected(customization, 'libron'));
    assert.ok(!isFontFamilySelected(customization, 'readerly'));
});

test('an explicit selection is preserved and unknown family ids are dropped', () => {
    const customization = { families: ['readerly', 'libron', 'no-such-family'] };
    assert.ok(!isDefaultFontsCustomization(customization));
    assert.deepEqual(resolveSelectedFamilyIds(customization), ['readerly', 'libron']);
    assert.deepEqual(
        selectedFontFamilies(customization).map((family) => family.id),
        // Catalogue order, not selection order.
        ['libron', 'readerly'],
    );
    assert.equal(selectedFontCount(customization), 2);
});

test('cloneFontsCustomization copies the selection without sharing the array', () => {
    assert.deepEqual(cloneFontsCustomization(null), { families: null });
    const original = { families: ['libron'] };
    const clone = cloneFontsCustomization(original);
    assert.deepEqual(clone, original);
    clone.families.push('sourcerer');
    assert.deepEqual(original.families, ['libron']);
});

test('additional fonts reconciliation removes families dropped from the previous selection', async () => {
    const removed = [];
    await additionalFonts.reconcile({
        previousConfiguration: { fontsCustomization: { families: ['libron', 'readerly'] } },
        fontsCustomization: { families: ['libron'] },
        device: {
            async removeEntry(path) {
                removed.push(path.join('/'));
            },
        },
    });

    const readerly = FONT_FAMILIES.find((family) => family.id === 'readerly');
    assert.deepEqual(
        removed,
        readerly.files.map((file) => `fonts/${file}`),
    );
});

test('fontCollectionsToDownload only lists the archives the selection needs', () => {
    assert.deepEqual(
        fontCollectionsToDownload(null).map((collection) => collection.id),
        ['core'],
    );
    assert.deepEqual(
        fontCollectionsToDownload({ families: ['readerly'] }).map((collection) => collection.id),
        ['extra'],
    );
    assert.deepEqual(
        fontCollectionsToDownload({ families: ['libron', 'readerly'] }).map((collection) => collection.id),
        ['core', 'extra'],
    );
    assert.deepEqual(fontCollectionsToDownload({ families: [] }), []);
});
