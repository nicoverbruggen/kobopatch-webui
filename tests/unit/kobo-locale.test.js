import test from 'node:test';
import assert from 'node:assert/strict';

import { localeLanguage, isEnglishLocale, readUiLocale, localeDisplayName } from '../../src/js/kobo/Locale.js';

test('localeLanguage extracts the lower-cased language subtag', () => {
    assert.equal(localeLanguage('en'), 'en');
    assert.equal(localeLanguage('en_US'), 'en');
    assert.equal(localeLanguage('fr-CA'), 'fr');
    assert.equal(localeLanguage('PT'), 'pt');
    assert.equal(localeLanguage(''), null);
    assert.equal(localeLanguage(null), null);
    assert.equal(localeLanguage(undefined), null);
});

test('isEnglishLocale recognizes English variants only', () => {
    assert.equal(isEnglishLocale('en'), true);
    assert.equal(isEnglishLocale('en_US'), true);
    assert.equal(isEnglishLocale('en-GB'), true);
    assert.equal(isEnglishLocale('fr'), false);
    assert.equal(isEnglishLocale('de_DE'), false);
    // Unknown locale is NOT treated as English.
    assert.equal(isEnglishLocale(null), false);
    assert.equal(isEnglishLocale(''), false);
});

test('readUiLocale reads CurrentLocale from [ApplicationPreferences]', () => {
    const conf = ['[ApplicationPreferences]', 'CurrentLocale=fr', 'Other=1', '', '[FeatureSettings]', 'Foo=bar'].join('\n');
    assert.equal(readUiLocale(conf), 'fr');
});

test('readUiLocale returns null when the key or conf is absent', () => {
    assert.equal(readUiLocale('[FeatureSettings]\nFoo=bar\n'), null);
    assert.equal(readUiLocale(''), null);
    assert.equal(readUiLocale(null), null);
});

test('localeDisplayName resolves a human-readable language name', () => {
    assert.equal(localeDisplayName('en'), 'English');
    assert.equal(localeDisplayName('fr_FR'), 'French');
    assert.equal(localeDisplayName('pt'), 'Portuguese');
    assert.equal(localeDisplayName(null), null);
});
