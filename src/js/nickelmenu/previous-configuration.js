/**
 * Recover the previous NickelMenu choices from the manifest and generated
 * config already present on a connected Kobo. The recovered values live only
 * in the current wizard session until the user installs again.
 */

import { createDefaultMenuCustomization, NM_MENU_ICON_DEFAULT_PATH } from './customization.js';
import { FONT_FAMILIES } from './features/additional-fonts/catalogue.js';
import { createDefaultTabsCustomization } from './features/simplify-tabs/customization.js';

const onboardPrefix = '/mnt/onboard/';
const legacyFontFamilyIds = ['readerly', 'libron', 'cartisse'];

function base64ToBytes(value) {
    try {
        const binary = globalThis.atob(value);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

function parseManifest(text) {
    try {
        const manifest = JSON.parse(text);
        return manifest && typeof manifest === 'object' ? manifest : null;
    } catch {
        return null;
    }
}

function configLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*#\s?/, '').trim());
}

function configValue(lines, key) {
    const prefix = `experimental :${key}`;
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (!line) return null;
    const separator = line.indexOf(':', prefix.length);
    return separator === -1 ? null : line.slice(separator + 1).trim();
}

function selectedFeatureIds(manifest) {
    if (!Array.isArray(manifest?.selected)) return [];
    return [...new Set(manifest.selected.filter((id) => typeof id === 'string' && id.length > 0))];
}

function predatesSelectableFontCatalogue(manifest) {
    const match = /^(\d+)\.(\d+)/.exec(String(manifest?.meta?.writer?.version || ''));
    if (!match) return false;
    const [, major, minor] = match.map(Number);
    return major < 1 || (major === 1 && minor < 53);
}

function selectedFontFamilies(manifest, featureIds) {
    if (!featureIds.includes('additional-fonts')) return null;

    const savedFamilies = manifest?.configuration?.fonts?.families;
    if (Array.isArray(savedFamilies)) {
        const known = new Set(FONT_FAMILIES.map((family) => family.id));
        const families = [...new Set(savedFamilies.filter((id) => known.has(id)))];
        if (families.length > 0) return { families };
    }

    const paths = manifest?.features?.['additional-fonts']?.files;
    const recordedFiles = new Set(
        Array.isArray(paths)
            ? paths
                  .map((entry) => entry?.path)
                  .filter((path) => typeof path === 'string')
                  .map((path) => path.split('/').pop())
            : [],
    );
    const families = FONT_FAMILIES.filter((family) => family.files.every((file) => recordedFiles.has(file))).map((family) => family.id);
    if (families.length > 0) return { families };

    // Before the selectable ebook-fonts catalogue, Additional Fonts always
    // installed these three families.
    if (predatesSelectableFontCatalogue(manifest)) {
        return { families: legacyFontFamilyIds.filter((id) => FONT_FAMILIES.some((family) => family.id === id)) };
    }
    return null;
}

function tabsCustomization(lines, featureIds) {
    if (!featureIds.includes('simplify-tabs')) return null;

    const defaults = createDefaultTabsCustomization();
    const enabled = (index, fallback) => {
        const value = configValue(lines, `menu_main_15505_${index}_enabled`);
        return value === null ? fallback : value === '1';
    };

    return {
        labels: {
            books: configValue(lines, 'menu_main_15505_1_label') || '',
            stats: configValue(lines, 'menu_main_15505_2_label') || '',
            notes: configValue(lines, 'menu_main_15505_3_label') || '',
        },
        visibility: {
            stats: enabled(2, defaults.visibility.stats),
            notes: enabled(3, defaults.visibility.notes),
            store: enabled(4, defaults.visibility.store),
        },
    };
}

function savedTabsCustomization(manifest, featureIds) {
    if (!featureIds.includes('simplify-tabs')) return null;
    const saved = manifest?.configuration?.tabs;
    if (!saved || typeof saved !== 'object') return null;

    const defaults = createDefaultTabsCustomization();
    return {
        labels:
            saved.labels && typeof saved.labels === 'object'
                ? {
                      books: String(saved.labels.books || ''),
                      stats: String(saved.labels.stats || ''),
                      notes: String(saved.labels.notes || ''),
                  }
                : null,
        visibility: {
            stats: typeof saved.visibility?.stats === 'boolean' ? saved.visibility.stats : defaults.visibility.stats,
            notes: typeof saved.visibility?.notes === 'boolean' ? saved.visibility.notes : defaults.visibility.notes,
            store: typeof saved.visibility?.store === 'boolean' ? saved.visibility.store : defaults.visibility.store,
        },
    };
}

function menuCustomization(lines, featureIds) {
    if (!featureIds.includes('custom-menu')) return { customization: null, iconPath: null };

    const customization = createDefaultMenuCustomization();
    customization.label = configValue(lines, 'menu_main_15505_label') || customization.label;

    const configuredPath = configValue(lines, 'menu_main_15505_icon');
    if (!configuredPath || configuredPath === onboardPrefix + NM_MENU_ICON_DEFAULT_PATH) {
        return { customization, iconPath: null };
    }

    const iconPath = configuredPath.startsWith(onboardPrefix) ? configuredPath.slice(onboardPrefix.length) : null;
    return { customization, iconPath };
}

function savedMenuCustomization(manifest, featureIds) {
    if (!featureIds.includes('custom-menu')) return null;
    const saved = manifest?.configuration?.menu;
    if (!saved || typeof saved !== 'object') return null;

    const customization = createDefaultMenuCustomization();
    if (typeof saved.label === 'string' && saved.label) customization.label = saved.label;

    const data = typeof saved.icon?.data === 'string' ? base64ToBytes(saved.icon.data) : null;
    if (data) {
        const mimeType = saved.icon.mimeType === 'image/svg+xml' ? 'image/svg+xml' : 'image/png';
        customization.icon = {
            type: 'upload',
            name: mimeType === 'image/svg+xml' ? '.custom-icon.svg' : '.custom-icon.png',
            mimeType,
            data,
        };
    }
    return customization;
}

export function parsePreviousNickelMenuConfiguration(manifestText, presetText) {
    const manifest = parseManifest(manifestText);
    if (!manifest) return null;

    const featureIds = selectedFeatureIds(manifest);
    const lines = configLines(presetText);
    const menu = menuCustomization(lines, featureIds);
    const savedMenu = savedMenuCustomization(manifest, featureIds);

    return {
        selectedFeatureIds: featureIds,
        menuCustomization: savedMenu || menu.customization,
        menuIconPath: savedMenu?.icon?.data ? null : menu.iconPath,
        tabsCustomization: savedTabsCustomization(manifest, featureIds) || tabsCustomization(lines, featureIds),
        fontsCustomization: selectedFontFamilies(manifest, featureIds),
    };
}
