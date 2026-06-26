import { prependToNmConfig } from '../helpers.js';
import { loadBundledAsset } from '../assets.js';
import { localeLanguage } from '../../../kobo/locale.js';

export const TOGGLE_TABS_SCRIPT_URL = new URL('./scripts/toggle_tabs.sh', import.meta.url).href;

// Per-language text for the three tabs this feature renames. The wording mirrors
// Kobo's own labels with the possessive dropped ("My Books" → "Books", "My
// Notebooks" → "Notes"). For the activity tab, English shortens "Activity" to
// "Stats"; per language we use whichever term is shortest — the pan-European
// clipping "Stats" where it reads naturally (en/fr/de/nl), otherwise the native
// "Activity" term, which is also the device's own label for that tab (it
// "Attività", es "Actividad", pt "Atividade"). Only languages with a vetted entry
// get renamed labels; any other language (or an unknown locale, e.g. the
// manual-connection/download flow) keeps the device's own native tab names — see
// tabLabelsFor().
export const TAB_LABELS = {
    en: { books: 'Books', stats: 'Stats', notes: 'Notes' },
    fr: { books: 'Livres', stats: 'Stats', notes: 'Notes' },
    de: { books: 'Bücher', stats: 'Stats', notes: 'Notizen' },
    nl: { books: 'Boeken', stats: 'Stats', notes: 'Notities' },
    it: { books: 'Libri', stats: 'Attività', notes: 'Note' },
    es: { books: 'Libros', stats: 'Actividad', notes: 'Notas' },
    pt: { books: 'Livros', stats: 'Atividade', notes: 'Notas' },
};

/**
 * The tab labels to apply for a device locale, or null when none should be set
 * (a non-English language we have no translation for, or an unknown locale). A
 * null result means the structural tab overrides are still written but the
 * `_label` lines are omitted, so the device keeps its localized tab names.
 */
export function tabLabelsFor(uiLocale) {
    const lang = localeLanguage(uiLocale);
    if (!lang) return null;
    return TAB_LABELS[lang] || null;
}

/**
 * Build the navigation-tab override block. The `_enabled`/`_default` lines are
 * language-neutral (they hide/show/reorder tabs) and always included; the three
 * `_label` lines are only added when we have labels for the device language.
 */
export function tabOverrideLines(uiLocale) {
    const labels = tabLabelsFor(uiLocale);
    const lines = ['experimental :menu_main_15505_0_enabled: 1'];
    if (labels) lines.push(`experimental :menu_main_15505_1_label: ${labels.books}`);
    lines.push('experimental :menu_main_15505_2_enabled: 1');
    if (labels) lines.push(`experimental :menu_main_15505_2_label: ${labels.stats}`);
    lines.push('experimental :menu_main_15505_3_enabled: 0');
    if (labels) lines.push(`experimental :menu_main_15505_3_label: ${labels.notes}`);
    lines.push(
        'experimental :menu_main_15505_4_enabled: 0',
        'experimental :menu_main_15505_5_enabled: 1',
        'experimental :menu_main_15505_default: 1',
        'experimental :menu_main_15505_enabled: 1',
    );
    return lines;
}

// Simplifies the bottom navigation tab bar: hides the "My Notebooks" and
// "Discover" tabs and surfaces reading stats as a separate "Stats" tab. This
// feature alone owns the navigation-tab override, so it also owns the Toggle-menu
// item and script that toggle it on the device — no capability flag or
// custom-menu coordination needed. The script comments or uncomments the tab
// override lines in the items file and reboots; it lives under .adds/nm/scripts
// so NickelMenu removal's recursive delete cleans it up.
export default {
    id: 'simplify-tabs',
    section: 'Interface tweaks',
    title: 'Simplify navigation tabs',
    description:
        'Hides the "My Notebooks" and "Discover" tabs from the bottom navigation tab bar, and this also makes your reading stats available as a separate "Stats" tab.',
    default: false,

    // Ship the on-device toggle script.
    async install(ctx = {}) {
        const data = ctx.bundledAsset ? await ctx.bundledAsset(TOGGLE_TABS_SCRIPT_URL) : await loadBundledAsset(TOGGLE_TABS_SCRIPT_URL);
        return [{ path: '.adds/nm/scripts/toggle_tabs.sh', data }];
    },

    // Contribute the "Simple Tabs" Toggle-menu item. Its position (just after
    // the home-content toggle) is set by 'toggle-tabs' in ../menu-order.js.
    menuItems() {
        return [
            {
                id: 'toggle-tabs',
                lines: ['menu_item :main :Simple Tabs :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_tabs.sh'],
            },
        ];
    },

    // Prepend the navigation-tab override to the assembled items file. The tab
    // labels are localized to the connected device's UI language; on a language
    // we don't translate (or an unknown locale) the `_label` lines are omitted so
    // the device keeps its own tab names.
    postProcess(files, ctx = {}) {
        return prependToNmConfig(tabOverrideLines(ctx.deviceInfo?.uiLocale).join('\n'))(files);
    },
};
