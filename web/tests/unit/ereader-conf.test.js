import test from 'node:test';
import assert from 'node:assert/strict';

import excludeSyncFolders from '../../src/nickelmenu/exclude-sync-folders.cjs';
import {
    createExcludeSyncFoldersMatcher,
    parseEReaderConf,
    removeExcludeSyncFoldersLine,
    setExcludeSyncFoldersLine,
    validateExcludeSyncFoldersLine,
} from '../../src/js/domain/ereader-conf.js';

const { buildExcludeSyncFoldersLine, LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINES } = excludeSyncFolders;

test('parseEReaderConf reads settings inside sections', () => {
    const parsed = parseEReaderConf([
        '[ApplicationPreferences]',
        'CurrentLocale=en_US',
        '',
        '[FeatureSettings]',
        'ExcludeSyncFolders=(foo)',
        '',
    ].join('\n'));

    assert.equal(parsed.sections.length, 2);
    assert.equal(parsed.sections[1].name, 'FeatureSettings');
    assert.equal(parsed.sections[1].settings.ExcludeSyncFolders.value, '(foo)');
});

test('setExcludeSyncFoldersLine inserts FeatureSettings when it is missing', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine('[ApplicationPreferences]\nCurrentLocale=en_US\n', line);

    assert.equal(updated, [
        '[ApplicationPreferences]',
        'CurrentLocale=en_US',
        '',
        '[FeatureSettings]',
        line,
        '',
    ].join('\n'));
});

test('setExcludeSyncFoldersLine inserts the setting into an existing FeatureSettings section', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine('[FeatureSettings]\nFoo=bar\n', line);

    assert.equal(updated, `[FeatureSettings]\n${line}\nFoo=bar\n`);
});

test('setExcludeSyncFoldersLine replaces an existing setting without touching other sections', () => {
    const line = buildExcludeSyncFoldersLine({ excludeCalibre: true });
    const updated = setExcludeSyncFoldersLine([
        '[FeatureSettings]',
        'Foo=bar',
        'ExcludeSyncFolders=(old)',
        '[Other]',
        'ExcludeSyncFolders=(leave-alone)',
        '',
    ].join('\n'), line);

    assert.equal(updated, [
        '[FeatureSettings]',
        'Foo=bar',
        line,
        '[Other]',
        'ExcludeSyncFolders=(leave-alone)',
        '',
    ].join('\n'));
});

test('removeExcludeSyncFoldersLine removes the setting from FeatureSettings only', () => {
    const updated = removeExcludeSyncFoldersLine([
        '[FeatureSettings]',
        'Foo=bar',
        'ExcludeSyncFolders=(old)',
        '[Other]',
        'ExcludeSyncFolders=(leave-alone)',
        '',
    ].join('\n'));

    assert.equal(updated, [
        '[FeatureSettings]',
        'Foo=bar',
        '[Other]',
        'ExcludeSyncFolders=(leave-alone)',
        '',
    ].join('\n'));
});

test('validateExcludeSyncFoldersLine accepts the default generated regex', () => {
    const result = validateExcludeSyncFoldersLine(buildExcludeSyncFoldersLine());

    assert.equal(result.valid, true);
    assert.equal(result.mode, 'default');
    assert.deepEqual(result.errors, []);
});

test('validateExcludeSyncFoldersLine accepts the calibre generated regex', () => {
    const result = validateExcludeSyncFoldersLine(buildExcludeSyncFoldersLine({ excludeCalibre: true }));

    assert.equal(result.valid, true);
    assert.equal(result.mode, 'calibre');
    assert.deepEqual(result.errors, []);
});

test('validateExcludeSyncFoldersLine rejects the legacy broad nested path regex', () => {
    const result = validateExcludeSyncFoldersLine(LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINES.default);

    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /should not match fonts\/regular\.ttf/);
});

test('validateExcludeSyncFoldersLine rejects non-setting lines', () => {
    const result = validateExcludeSyncFoldersLine('NotExcludeSyncFolders=(foo)');

    assert.equal(result.valid, false);
    assert.equal(result.value, null);
    assert.match(result.errors.join('\n'), /Expected an ExcludeSyncFolders setting line/);
});

test('createExcludeSyncFoldersMatcher checks paths after normalizing Kobo escapes', () => {
    const value = validateExcludeSyncFoldersLine(buildExcludeSyncFoldersLine({ excludeCalibre: true })).value;
    const matcher = createExcludeSyncFoldersMatcher(value);

    assert.equal(matcher.test('.adds'), true);
    assert.equal(matcher.test('fonts/.hidden'), true);
    assert.equal(matcher.test('calibre'), true);
    assert.equal(matcher.test('.kobo'), false);
    assert.equal(matcher.test('.adobe'), false);
    assert.equal(matcher.test('fonts/regular.ttf'), false);
});
