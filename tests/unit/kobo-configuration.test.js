import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExcludeSyncFoldersLine, legacyBrokenExcludeSyncFoldersLines } from '../../src/js/kobo/sync-exclusions.js';
import {
    createExcludeSyncFoldersMatcher,
    getConfSetting,
    parseKoboConfiguration,
    removeConfSetting,
    removeExcludeSyncFoldersLine,
    setConfSetting,
    setExcludeSyncFoldersLine,
    validateExcludeSyncFoldersLine,
} from '../../src/js/kobo/configuration.js';

test('buildExcludeSyncFoldersLine returns the expected default regex line', () => {
    assert.equal(buildExcludeSyncFoldersLine(), String.raw`ExcludeSyncFolders=(\\.(?!kobo|adobe).+|([^.][^/]*/)+\\..+)`);
});

test('buildExcludeSyncFoldersLine returns the expected calibre regex line', () => {
    assert.equal(
        buildExcludeSyncFoldersLine({ excludeCalibre: true }),
        String.raw`ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)`,
    );
});

test('parseKoboConfiguration reads settings inside sections', () => {
    const parsed = parseKoboConfiguration(
        ['[ApplicationPreferences]', 'CurrentLocale=en_US', '', '[FeatureSettings]', 'ExcludeSyncFolders=(foo)', ''].join('\n'),
    );

    assert.equal(parsed.sections.length, 2);
    assert.equal(parsed.sections[1].name, 'FeatureSettings');
    assert.equal(parsed.sections[1].settings.ExcludeSyncFolders.value, '(foo)');
});

test('parseKoboConfiguration trims setting whitespace and keeps equals signs in values', () => {
    const parsed = parseKoboConfiguration(['[FeatureSettings]', '  ExcludeSyncFolders = (foo=bar)  '].join('\n'));

    assert.equal(parsed.sections[0].settings.ExcludeSyncFolders.value, '(foo=bar)');
});

test('getConfSetting reads a value, empty string, or undefined when absent', () => {
    const conf = '[General]\nx=1\n[Reading]\nwebkitTextRendering=optimizeLegibility\nreadingAlignment=\n';
    assert.equal(getConfSetting(conf, 'Reading', 'webkitTextRendering'), 'optimizeLegibility');
    assert.equal(getConfSetting(conf, 'Reading', 'readingAlignment'), '');
    assert.equal(getConfSetting(conf, 'Reading', 'readingFontFamily'), undefined);
    assert.equal(getConfSetting(conf, 'Missing', 'x'), undefined);
});

test('setConfSetting updates an existing empty key in place', () => {
    const conf = '[General]\nx=1\n[Reading]\nreadingAlignment=\nreadingFontFamily=\n';
    const updated = setConfSetting(conf, 'Reading', 'readingAlignment', 'Left');
    assert.match(updated, /readingAlignment=Left/);
    assert.doesNotMatch(updated, /readingAlignment=\n/);
    assert.match(updated, /readingFontFamily=\n/);
});

test('removeConfSetting drops a key and leaves the rest of the section intact', () => {
    const conf = '[General]\nx=1\n[Reading]\nwebkitTextRendering=optimizeLegibility\nreadingAlignment=Left\n';
    const updated = removeConfSetting(conf, 'Reading', 'webkitTextRendering');
    assert.doesNotMatch(updated, /webkitTextRendering/);
    assert.match(updated, /readingAlignment=Left/);
    assert.match(updated, /\[Reading\]/);
});

test('setConfSetting stores a value containing brackets and equals verbatim on one line', () => {
    const updated = setConfSetting('[S]\n', 'S', 'k', '[Evil]=x');

    assert.equal(updated, '[S]\nk=[Evil]=x\n');
    assert.equal(getConfSetting(updated, 'S', 'k'), '[Evil]=x');
});

test('setConfSetting creates the section and key from empty conf input', () => {
    assert.equal(setConfSetting('', 'FeatureSettings', 'k', 'v'), '[FeatureSettings]\nk=v\n');
});

test('setConfSetting preserves a malformed non-setting line while updating a key', () => {
    const updated = setConfSetting('[S]\njusttext\nk=1\n', 'S', 'k', '9');

    assert.equal(updated, '[S]\njusttext\nk=9\n');
});

// Pins current behavior for malformed duplicate section headers (Kobo never writes them).
// get and set agree on the LAST section of a repeated name. NEEDS REVIEW: many INI
// parsers merge duplicate sections instead.
test('setConfSetting and getConfSetting both target the last of duplicate section headers', () => {
    const conf = '[FeatureSettings]\nA=1\n[FeatureSettings]\nB=2\n';

    assert.equal(getConfSetting(conf, 'FeatureSettings', 'B'), '2');
    assert.equal(setConfSetting(conf, 'FeatureSettings', 'C', '3'), '[FeatureSettings]\nA=1\n[FeatureSettings]\nC=3\nB=2\n');
});

test('getConfSetting returns the first of duplicate keys', () => {
    assert.equal(getConfSetting('[S]\nk=1\nk=2\n', 'S', 'k'), '1');
});

test('getConfSetting is case sensitive for section and key names', () => {
    const conf = '[Section]\nKey=1\n';

    assert.equal(getConfSetting(conf, 'Section', 'Key'), '1');
    assert.equal(getConfSetting(conf, 'section', 'Key'), undefined);
    assert.equal(getConfSetting(conf, 'Section', 'key'), undefined);
});

// Pins current behavior. NEEDS REVIEW: removing the only key leaves an empty section
// header behind (no cleanup). Harmless for Kobo, but the caller may expect a cleanup.
test('removeConfSetting leaves an emptied section header behind', () => {
    assert.equal(removeConfSetting('[S]\nonly=1\n', 'S', 'only'), '[S]\n');
});

test('parseKoboConfiguration ignores section-less keys, comments, malformed and junk-header lines', () => {
    const parsed = parseKoboConfiguration(['loose=1', '[S]', ';comment=x', 'justtext', '[Bad] junk', 'real=2'].join('\n'));

    assert.equal(parsed.sections.length, 1);
    assert.equal(parsed.sections[0].name, 'S');
    assert.deepEqual(Object.keys(parsed.sections[0].settings), ['real']);
});

// Pins current behavior. NEEDS REVIEW: '#' is not excluded from key characters, so a
// '#'-prefixed line with an '=' is parsed as a setting rather than treated as a comment.
test('parseKoboConfiguration treats a leading-hash line with equals as a setting, not a comment', () => {
    const parsed = parseKoboConfiguration('[S]\n#note=hello\n');

    assert.equal(parsed.sections[0].settings['#note'].value, 'hello');
});

// Pins current behavior. NEEDS REVIEW: the `content = ''` default guards `undefined`
// but not `null`, so null input throws instead of being treated as empty.
test('getConfSetting throws on null conf input', () => {
    assert.throws(() => getConfSetting(null, 'S', 'k'), TypeError);
});

test('setExcludeSyncFoldersLine inserts FeatureSettings when it is missing', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine('[ApplicationPreferences]\nCurrentLocale=en_US\n', line);

    assert.equal(updated, ['[ApplicationPreferences]', 'CurrentLocale=en_US', '', '[FeatureSettings]', line, ''].join('\n'));
});

test('setExcludeSyncFoldersLine inserts the setting into an existing FeatureSettings section', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine('[FeatureSettings]\nFoo=bar\n', line);

    assert.equal(updated, `[FeatureSettings]\n${line}\nFoo=bar\n`);
});

test('setExcludeSyncFoldersLine replaces an existing setting without touching other sections', () => {
    const line = buildExcludeSyncFoldersLine({ excludeCalibre: true });
    const updated = setExcludeSyncFoldersLine(
        ['[FeatureSettings]', 'Foo=bar', 'ExcludeSyncFolders=(old)', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join('\n'),
        line,
    );

    assert.equal(updated, ['[FeatureSettings]', 'Foo=bar', line, '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join('\n'));
});

test('setExcludeSyncFoldersLine collapses duplicate settings in FeatureSettings only', () => {
    const line = buildExcludeSyncFoldersLine();
    const updated = setExcludeSyncFoldersLine(
        ['[FeatureSettings]', 'ExcludeSyncFolders=(old)', 'Foo=bar', 'ExcludeSyncFolders=(older)', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join(
            '\n',
        ),
        line,
    );

    assert.equal(updated, ['[FeatureSettings]', line, 'Foo=bar', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join('\n'));
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
    const updated = removeExcludeSyncFoldersLine(
        ['[FeatureSettings]', 'Foo=bar', 'ExcludeSyncFolders=(old)', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join('\n'),
    );

    assert.equal(updated, ['[FeatureSettings]', 'Foo=bar', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join('\n'));
});

test('removeExcludeSyncFoldersLine removes duplicate settings in FeatureSettings only', () => {
    const updated = removeExcludeSyncFoldersLine(
        ['[FeatureSettings]', 'ExcludeSyncFolders=(old)', 'Foo=bar', 'ExcludeSyncFolders=(older)', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join(
            '\n',
        ),
    );

    assert.equal(updated, ['[FeatureSettings]', 'Foo=bar', '[Other]', 'ExcludeSyncFolders=(leave-alone)', ''].join('\n'));
});

test('removeExcludeSyncFoldersLine preserves CRLF line endings', () => {
    const updated = removeExcludeSyncFoldersLine('[FeatureSettings]\r\nFoo=bar\r\nExcludeSyncFolders=(old)\r\n');

    assert.equal(updated, '[FeatureSettings]\r\nFoo=bar\r\n');
});

test('removeExcludeSyncFoldersLine preserves lack of trailing newline', () => {
    const updated = removeExcludeSyncFoldersLine('[FeatureSettings]\nFoo=bar\nExcludeSyncFolders=(old)');

    assert.equal(updated, '[FeatureSettings]\nFoo=bar');
});

for (const { mode, line } of [
    { mode: 'default', line: buildExcludeSyncFoldersLine() },
    { mode: 'calibre', line: buildExcludeSyncFoldersLine({ excludeCalibre: true }) },
]) {
    test(`validateExcludeSyncFoldersLine accepts the ${mode} generated regex`, () => {
        const result = validateExcludeSyncFoldersLine(line);

        assert.equal(result.valid, true);
        assert.equal(result.mode, mode);
        assert.deepEqual(result.errors, []);
    });
}

for (const mode of ['default', 'calibre']) {
    test(`validateExcludeSyncFoldersLine rejects the legacy broad ${mode} nested path regex`, () => {
        const result = validateExcludeSyncFoldersLine(legacyBrokenExcludeSyncFoldersLines[mode]);

        assert.equal(result.valid, false);
        assert.match(result.errors.join('\n'), /should not match fonts\/regular\.ttf/);
    });
}

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
