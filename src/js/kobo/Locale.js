import { getConfSetting } from './Configuration.js';

/**
 * The Kobo UI language. Nickel stores it in Kobo eReader.conf as `CurrentLocale`
 * under `[ApplicationPreferences]` — a language subtag, optionally with a region
 * (e.g. `en`, `fr`, `de`, `pt`, or `en_US`, `fr_CA`). We key behaviour off the
 * language subtag, ignoring the region.
 */
const UI_LOCALE_SECTION = 'ApplicationPreferences';
const UI_LOCALE_KEY = 'CurrentLocale';

/**
 * The language subtag of a Kobo locale value, lower-cased (e.g. `en` from
 * `en_US`). Returns null when the value is empty or unparseable.
 */
function localeLanguage(locale) {
    if (!locale) return null;
    const match = String(locale)
        .trim()
        .match(/^[a-z]{2,3}/i);
    return match ? match[0].toLowerCase() : null;
}

/**
 * Whether a Kobo locale value is an English variant. A null/unknown locale is
 * NOT treated as English — callers decide what to do without a known language.
 */
function isEnglishLocale(locale) {
    return localeLanguage(locale) === 'en';
}

/**
 * Read the device UI locale from Kobo eReader.conf content. Returns the raw
 * `CurrentLocale` value (e.g. `en`, `fr_CA`) or null when absent.
 */
function readUiLocale(confContent) {
    if (!confContent) return null;
    const value = getConfSetting(confContent, UI_LOCALE_SECTION, UI_LOCALE_KEY);
    return value ? value.trim() : null;
}

/**
 * A human-readable language name for a Kobo locale value (e.g. `en` → "English",
 * `pt` → "Portuguese"), for display in the device overview. Falls back to the raw
 * value when the language can't be resolved.
 */
function localeDisplayName(locale) {
    const lang = localeLanguage(locale);
    if (!lang) return null;
    try {
        const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
        if (name && name !== lang) return name;
    } catch {
        // Intl.DisplayNames unsupported — fall through to the raw value.
    }
    return locale;
}

export { localeLanguage, isEnglishLocale, readUiLocale, localeDisplayName };
