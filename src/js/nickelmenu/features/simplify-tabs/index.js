import { prependToNmConfig } from '../helpers.js';
import { loadBundledAsset } from '../assets.js';
import { localeLanguage } from '../../../kobo/locale.js';
import { normalizeTabLabel, resolveTabVisibility } from './customization.js';

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
 * The strict per-language translation of the three tab labels, or null when we
 * have none for that language (a non-English language we don't translate) or the
 * locale is unknown. This is the raw translation lookup; the default the app
 * actually applies when the user hasn't customized comes from defaultTabLabels().
 */
export function tabLabelsFor(uiLocale) {
    const lang = localeLanguage(uiLocale);
    if (!lang) return null;
    return TAB_LABELS[lang] || null;
}

/**
 * The labels applied by default (no explicit customization) for a device locale.
 * A translated language uses its localized labels. An *unknown* locale — the
 * manual-connection / download flow, where we can't read the device language and
 * the app UI (and the dialog placeholders) are English — falls back to the
 * English defaults so the tabs are still renamed to "Books / Stats / Notes". A
 * *known* language we don't translate (e.g. Japanese) returns null, so the
 * `_label` lines are omitted and the device keeps its own native tab names.
 */
export function defaultTabLabels(uiLocale) {
    const lang = localeLanguage(uiLocale);
    if (!lang) return { ...TAB_LABELS.en };
    return TAB_LABELS[lang] ? { ...TAB_LABELS[lang] } : null;
}

/**
 * Resolve the three editable tab labels for the config. When the user has saved
 * explicit labels (via the customize dialog) they win, per-tab, with an empty
 * value meaning "omit this label line". Otherwise we fall back to the locale
 * defaults (English for an unknown locale, none for a known language we don't
 * translate — see defaultTabLabels()).
 */
export function resolveTabLabels(uiLocale, customization = null) {
    if (customization?.labels) {
        return {
            books: normalizeTabLabel(customization.labels.books),
            stats: normalizeTabLabel(customization.labels.stats),
            notes: normalizeTabLabel(customization.labels.notes),
        };
    }
    const auto = defaultTabLabels(uiLocale);
    return auto ? { ...auto } : { books: '', stats: '', notes: '' };
}

/**
 * Build the navigation-tab override block. The `_enabled`/`_default` lines are
 * language-neutral (they hide/show/reorder tabs); which of the three optional
 * tabs are shown comes from the customization's visibility (defaults: show
 * Stats, hide Notes and the store). The three `_label` lines are only added
 * when a (locale-default or user-set) label is available for that tab.
 */
export function tabOverrideLines(uiLocale, customization = null) {
    const labels = resolveTabLabels(uiLocale, customization);
    const visibility = resolveTabVisibility(customization);
    const lines = ['experimental :menu_main_15505_0_enabled: 1'];
    if (labels.books) lines.push(`experimental :menu_main_15505_1_label: ${labels.books}`);
    lines.push(`experimental :menu_main_15505_2_enabled: ${visibility.stats ? 1 : 0}`);
    if (labels.stats) lines.push(`experimental :menu_main_15505_2_label: ${labels.stats}`);
    lines.push(`experimental :menu_main_15505_3_enabled: ${visibility.notes ? 1 : 0}`);
    if (labels.notes) lines.push(`experimental :menu_main_15505_3_label: ${labels.notes}`);
    lines.push(
        `experimental :menu_main_15505_4_enabled: ${visibility.store ? 1 : 0}`,
        'experimental :menu_main_15505_5_enabled: 1',
        'experimental :menu_main_15505_default: 1',
        'experimental :menu_main_15505_enabled: 1',
    );
    return lines;
}

// Simplifies the bottom navigation tab bar. By default it surfaces reading
// stats as a separate "Stats" tab and hides the "My Notebooks" and "Discover"
// tabs, but the user can customize which optional tabs are shown and rename them
// via the "Customize" dialog (see ./customization.js and ./customization-dialog.js).
// This feature alone owns the navigation-tab override, so it also owns the Toggle-menu
// item and script that toggle it on the device — no capability flag or
// custom-menu coordination needed. The script comments or uncomments the tab
// override lines in the items file and reboots; it lives under .adds/nm/scripts
// so NickelMenu removal's recursive delete cleans it up.
export default {
    id: 'simplify-tabs',
    section: 'Interface Tweaks',
    title: 'Simplify navigation tabs',
    description:
        'Streamlines the bottom navigation tab bar. By default it surfaces your reading stats as a separate "Stats" tab and hides the "My Notebooks" and "Discover" tabs. Use Customize to choose which tabs are shown and rename them.',
    default: false,
    customization: {
        type: 'tabs',
        actionLabel: 'Customize',
        actionAriaLabel: 'Customize simplified navigation tabs',
    },

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

    // Prepend the navigation-tab override to the assembled items file. Which
    // optional tabs are shown and (optionally) their labels come from the user's
    // customization (ctx.tabsCustomization); without one, the tab labels default
    // to the connected device's UI language (English for an unknown locale — the
    // manual/download flow), while a known language we don't translate omits the
    // `_label` lines so the device keeps its own tab names (see defaultTabLabels).
    postProcess(files, ctx = {}) {
        return prependToNmConfig(tabOverrideLines(ctx.deviceInfo?.uiLocale, ctx.tabsCustomization).join('\n'))(files);
    },
};
