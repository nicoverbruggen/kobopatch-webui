import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildExcludeSyncFoldersLine,
    legacyBrokenExcludeSyncFoldersLines,
} from '../../src/js/kobo/sync-exclusions.js';
import {
    createExcludeSyncFoldersMatcher,
    parseKoboConfiguration,
    removeExcludeSyncFoldersLine,
    setExcludeSyncFoldersLine,
    validateExcludeSyncFoldersLine,
} from '../../src/js/kobo/configuration.js';

test('buildExcludeSyncFoldersLine returns the expected default regex line', () => {
    assert.equal(
        buildExcludeSyncFoldersLine(),
        String.raw`ExcludeSyncFolders=(\\.(?!kobo|adobe).+|([^.][^/]*/)+\\..+)`
    );
});

test('buildExcludeSyncFoldersLine returns the expected calibre regex line', () => {
    assert.equal(
        buildExcludeSyncFoldersLine({ excludeCalibre: true }),
        String.raw`ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)`
    );
});

test('parseKoboConfiguration reads settings inside sections', () => {
    const parsed = parseKoboConfiguration([
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

test('parseKoboConfiguration trims setting whitespace and keeps equals signs in values', () => {
    const parsed = parseKoboConfiguration([
        '[FeatureSettings]',
        '  ExcludeSyncFolders = (foo=bar)  ',
    ].join('\n'));

    assert.equal(parsed.sections[0].settings.ExcludeSyncFolders.value, '(foo=bar)');
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

test('setExcludeSyncFoldersLine collapses duplicate settings in FeatureSettings only', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine([
        '[FeatureSettings]',
        'ExcludeSyncFolders=(old)',
        'Foo=bar',
        'ExcludeSyncFolders=(older)',
        '[Other]',
        'ExcludeSyncFolders=(leave-alone)',
        '',
    ].join('\n'), line);

    assert.equal(updated, [
        '[FeatureSettings]',
        line,
        'Foo=bar',
        '[Other]',
        'ExcludeSyncFolders=(leave-alone)',
        '',
    ].join('\n'));
});

test('setExcludeSyncFoldersLine preserves CRLF line endings', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine('[FeatureSettings]\r\nFoo=bar\r\n', line);

    assert.equal(updated, `[FeatureSettings]\r\n${line}\r\nFoo=bar\r\n`);
});

test('setExcludeSyncFoldersLine preserves lack of trailing newline when replacing', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine('[FeatureSettings]\nFoo=bar\nExcludeSyncFolders=(old)', line);

    assert.equal(updated, `[FeatureSettings]\nFoo=bar\n${line}`);
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

test('removeExcludeSyncFoldersLine removes duplicate settings in FeatureSettings only', () => {
    const updated = removeExcludeSyncFoldersLine([
        '[FeatureSettings]',
        'ExcludeSyncFolders=(old)',
        'Foo=bar',
        'ExcludeSyncFolders=(older)',
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

test('removeExcludeSyncFoldersLine preserves CRLF line endings', () => {
    const updated = removeExcludeSyncFoldersLine('[FeatureSettings]\r\nFoo=bar\r\nExcludeSyncFolders=(old)\r\n');

    assert.equal(updated, '[FeatureSettings]\r\nFoo=bar\r\n');
});

test('removeExcludeSyncFoldersLine preserves lack of trailing newline', () => {
    const updated = removeExcludeSyncFoldersLine('[FeatureSettings]\nFoo=bar\nExcludeSyncFolders=(old)');

    assert.equal(updated, '[FeatureSettings]\nFoo=bar');
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
    const result = validateExcludeSyncFoldersLine(legacyBrokenExcludeSyncFoldersLines.default);

    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /should not match fonts\/regular\.ttf/);
});

test('validateExcludeSyncFoldersLine rejects the legacy broad calibre nested path regex', () => {
    const result = validateExcludeSyncFoldersLine(legacyBrokenExcludeSyncFoldersLines.calibre);

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
