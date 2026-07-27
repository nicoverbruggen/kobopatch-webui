/**
 * customization.js — data model for the "Select additional fonts" dialog.
 *
 * Pure, DOM-free helpers so this can be imported both by the feature module
 * (index.js, which runs at install time) and the dialog wiring, mirroring the
 * simplify-tabs split. The catalogue of families comes from ./catalogue.js
 * (generated from the pinned ebook-fonts archives).
 *
 * The customization holds `families`: `null` means "not customized", which
 * installs the curated core collection. Once the user saves the dialog it
 * becomes an explicit array of family ids drawn from FONT_FAMILIES.
 */

import { FONT_COLLECTIONS, FONT_FAMILIES } from './catalogue.js';

export function createDefaultFontsCustomization() {
    return { families: null };
}

export function cloneFontsCustomization(customization = null) {
    return { families: customization?.families ? [...customization.families] : null };
}

export function isDefaultFontsCustomization(customization = null) {
    return !customization?.families;
}

/**
 * The family ids the customization selects: the explicit selection when the
 * user saved one (unknown ids dropped, so a stale saved selection survives a
 * catalogue update), otherwise the core collection.
 */
export function resolveSelectedFamilyIds(customization = null) {
    if (!customization?.families) {
        return FONT_FAMILIES.filter((f) => f.collection === 'core').map((f) => f.id);
    }
    const known = new Set(FONT_FAMILIES.map((f) => f.id));
    return customization.families.filter((id) => known.has(id));
}

/** The catalogue entries for the selected families, in catalogue order. */
export function selectedFontFamilies(customization = null) {
    const selected = new Set(resolveSelectedFamilyIds(customization));
    return FONT_FAMILIES.filter((f) => selected.has(f.id));
}

export function selectedFontCount(customization = null) {
    return resolveSelectedFamilyIds(customization).length;
}

export function isFontFamilySelected(customization, familyId) {
    return resolveSelectedFamilyIds(customization).includes(familyId);
}

/** The collections whose archive must be downloaded for the selection. */
export function fontCollectionsToDownload(customization = null) {
    const selected = selectedFontFamilies(customization);
    return FONT_COLLECTIONS.filter((collection) => selected.some((f) => f.collection === collection.id));
}
