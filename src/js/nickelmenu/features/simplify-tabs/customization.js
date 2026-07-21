/**
 * customization.js — data model for the "Customize simplified tabs" dialog.
 *
 * Pure, DOM-free helpers so this can be imported both by the feature module
 * (index.js, which runs at install time) and the dialog wiring. Mirrors the
 * top-level nickelmenu/customization.js split: model here, dialog/DOM there.
 *
 * The customization has two parts:
 *  - `visibility`: which of the three optional bottom-nav tabs are shown. Home
 *    and My Books are always shown (and My Books is the default landing tab),
 *    so they are not offered here.
 *  - `labels`: the text for the Books / Stats / Notes tabs. `null` means "not
 *    customized" — the feature keeps its locale-aware default behaviour (see
 *    defaultTabLabels() in index.js): a translated language uses its localized
 *    labels, an unknown locale (manual/download flow) falls back to the English
 *    defaults, and a known language we don't translate omits labels entirely so
 *    the device keeps its own tab names. Once the user saves the dialog, `labels`
 *    becomes an explicit `{ books, stats, notes }` object (each value may be an
 *    empty string, meaning "keep the device's own name").
 */

export const TAB_LABEL_MAX_LENGTH = 12;

// The three tabs that carry an editable label.
export const TAB_LABEL_KEYS = ['books', 'stats', 'notes'];

// The three optional tabs whose visibility can be toggled. Home (0), My Books
// (1) and More (5) are always shown, so they are intentionally absent.
export const TAB_VISIBILITY_KEYS = ['stats', 'notes', 'store'];

// Default: surface reading stats, hide My Notebooks and the Discover store.
export const DEFAULT_TAB_VISIBILITY = { stats: true, notes: false, store: false };

export function createDefaultTabsCustomization() {
    return {
        labels: null,
        visibility: { ...DEFAULT_TAB_VISIBILITY },
    };
}

/**
 * Strip characters that would break a NickelMenu config line (newlines, tabs,
 * and the `:` field delimiter) and cap the length. Called live as the user
 * types, so it deliberately keeps interior spaces intact.
 */
export function sanitizeTabLabel(value) {
    return String(value ?? '')
        .replace(/[\r\n\t:]/g, '')
        .slice(0, TAB_LABEL_MAX_LENGTH);
}

// The value actually written to the config: sanitized and trimmed. An empty
// result means "omit the `_label` line for this tab".
export function normalizeTabLabel(value) {
    return sanitizeTabLabel(value).trim();
}

export function resolveTabVisibility(customization = null) {
    return { ...DEFAULT_TAB_VISIBILITY, ...(customization?.visibility || {}) };
}

export function cloneTabsCustomization(customization = null) {
    const source = customization || createDefaultTabsCustomization();
    return {
        labels: source.labels ? { ...source.labels } : null,
        visibility: resolveTabVisibility(source),
    };
}

export function isDefaultTabsCustomization(customization = null) {
    if (!customization) return true;
    // Any explicit label set counts as customized (even when equal to a locale
    // default — the user opted into fixed labels).
    if (customization.labels) return false;
    const visibility = resolveTabVisibility(customization);
    return TAB_VISIBILITY_KEYS.every((key) => visibility[key] === DEFAULT_TAB_VISIBILITY[key]);
}

/**
 * Count the tabs visible in the bottom navigation bar for a given customization.
 * Home, My Books and More are always shown (3); the three optional tabs add to
 * that when enabled.
 */
export function visibleTabCount(customization = null) {
    const visibility = resolveTabVisibility(customization);
    return 3 + TAB_VISIBILITY_KEYS.filter((key) => visibility[key]).length;
}
