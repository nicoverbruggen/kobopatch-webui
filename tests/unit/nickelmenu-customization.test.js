import test from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveMenuCustomization,
    isDefaultMenuCustomization,
    createDefaultMenuCustomization,
    sanitizeMenuLabel,
    normalizeMenuLabel,
    isValidMenuLabel,
    findPresetIcon,
    NM_MENU_DEFAULT_LABEL,
    NM_MENU_LABEL_MAX_LENGTH,
    NM_MENU_ICON_DEFAULT_PATH,
    NM_MENU_ICON_CUSTOM_PNG_PATH,
    NM_MENU_ICON_CUSTOM_SVG_PATH,
    NM_MENU_PRESET_ICONS,
} from '../../src/js/nickelmenu/MenuCustomization.js';

// A NickelMenu config line is ':'-delimited and newline-terminated, so a label written into it
// must never be able to smuggle a ':' (extra field) or a newline (forged directive). Every label
// that reaches disk goes through sanitizeMenuLabel (directly or via normalizeMenuLabel), so these
// hostile inputs are the injection attack surface for the whole feature.
const HOSTILE_LABELS = [
    'Read:Mode', // NM delimiter
    'a\nexperimental :cmd_spawn', // forged line via LF
    'a\r\nexperimental :cmd_spawn', // forged line via CRLF
    'back\\slash', // backslash escape
    '  spaced  ', // leading/trailing whitespace
    '<b>bold</b>', // angle brackets / HTML
    'quote"quote', // double quote
    "apos'trophe", // single quote
    'emoji😀face', // astral emoji (surrogate pair)
    'éaccent', // combining acute accent
    '‮reversed', // RTL override control
    '\u0000\u0007bell', // NUL + control chars
    'tab\tsep', // tab
    ';;semi;;colon;;', // other separators
    'a;b|c&d$e', // shell metacharacters
];

const ICON_PATHS = new Set([NM_MENU_ICON_DEFAULT_PATH, NM_MENU_ICON_CUSTOM_PNG_PATH, NM_MENU_ICON_CUSTOM_SVG_PATH]);

// --- sanitizeMenuLabel: the security boundary -------------------------------------------------

test('sanitizeMenuLabel reduces every hostile label to a bare [A-Za-z0-9] whitelist', () => {
    for (const input of HOSTILE_LABELS) {
        const result = sanitizeMenuLabel(input);
        assert.match(result, /^[A-Za-z0-9]{0,10}$/, `hostile input ${JSON.stringify(input)} leaked a non-alphanumeric`);
    }
});

test('sanitizeMenuLabel cannot forge an extra NickelMenu directive when written into a config line', () => {
    const hostile = 'Pwn :menu_main_9_label :Evil\nexperimental :cmd_spawn :0 :reboot';
    const label = sanitizeMenuLabel(hostile);
    const line = `experimental :menu_main_15505_label :${label}`;
    assert.equal(line.split('\n').length, 1, 'a newline survived and forged a new config line');
    // 'experimental ' / 'menu_main_15505_label ' / label -> exactly three fields, no injected delimiter.
    assert.equal(line.split(':').length, 3, 'an unescaped ":" survived and forged an extra directive field');
});

test('sanitizeMenuLabel strips specific injection characters', () => {
    assert.equal(sanitizeMenuLabel('Read:Mode'), 'ReadMode');
    assert.equal(sanitizeMenuLabel('a\nb\r\nc'), 'abc');
    assert.equal(sanitizeMenuLabel('a\\b'), 'ab');
    assert.equal(sanitizeMenuLabel('<b>Hi</b>'), 'bHib');
});

test('sanitizeMenuLabel strips unicode, emoji, combining marks, and control characters', () => {
    assert.equal(sanitizeMenuLabel('😀x😀'), 'x'); // astral pair fully removed, no orphan surrogate
    assert.equal(sanitizeMenuLabel('é'), 'e'); // decomposed accent: base kept, mark dropped
    assert.equal(sanitizeMenuLabel('‮abc'), 'abc'); // RTL override dropped
    assert.equal(sanitizeMenuLabel('\u0000\u0007ab'), 'ab'); // NUL + BEL dropped
});

test('sanitizeMenuLabel truncates to the length limit, counting only surviving characters', () => {
    assert.equal(sanitizeMenuLabel('ABCDEFGHIJ').length, NM_MENU_LABEL_MAX_LENGTH); // exactly at limit
    assert.equal(sanitizeMenuLabel('ABCDEFGHIJK'), 'ABCDEFGHIJ'); // one over: truncated
    // Stripping happens before slicing, so junk must not consume the budget.
    assert.equal(sanitizeMenuLabel('!!!ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJ');
});

test('sanitizeMenuLabel coerces nullish and non-string input without throwing', () => {
    assert.equal(sanitizeMenuLabel(null), '');
    assert.equal(sanitizeMenuLabel(undefined), '');
    assert.equal(sanitizeMenuLabel(123), '123');
});

test('sanitizeMenuLabel is idempotent, so a sanitized label always passes isValidMenuLabel (or is empty)', () => {
    for (const input of HOSTILE_LABELS) {
        const once = sanitizeMenuLabel(input);
        assert.equal(sanitizeMenuLabel(once), once, `not idempotent for ${JSON.stringify(input)}`);
        if (once.length > 0) {
            assert.equal(isValidMenuLabel(once), true, `sanitized output ${JSON.stringify(once)} is not itself valid`);
        }
    }
});

// --- normalizeMenuLabel: the write path -------------------------------------------------------

test('normalizeMenuLabel strips non-alphanumerics, truncates, and defaults when empty', () => {
    assert.equal(normalizeMenuLabel('Read Mode'), 'ReadMode');
    assert.equal(normalizeMenuLabel('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJ');
    assert.equal(normalizeMenuLabel('!!!'), NM_MENU_DEFAULT_LABEL);
    assert.equal(normalizeMenuLabel(''), NM_MENU_DEFAULT_LABEL);
    assert.equal(normalizeMenuLabel('   '), NM_MENU_DEFAULT_LABEL); // whitespace-only collapses to default
    assert.equal(normalizeMenuLabel(null), NM_MENU_DEFAULT_LABEL);
});

test('normalizeMenuLabel output is always a safe label or the default', () => {
    for (const input of HOSTILE_LABELS) {
        const label = normalizeMenuLabel(input);
        assert.match(label, /^[A-Za-z0-9]{1,10}$/, `hostile input ${JSON.stringify(input)} produced an unsafe normalized label`);
    }
});

// --- isValidMenuLabel: the accept/reject gate -------------------------------------------------

test('isValidMenuLabel accepts only bare alphanumeric labels within the length limit', () => {
    for (const good of ['Toggle', 'A', 'ReadMode', 'ABCDEFGHIJ', '123']) {
        assert.equal(isValidMenuLabel(good), true, `should accept ${JSON.stringify(good)}`);
    }
    for (const bad of ['', '   ', 'Read Mode', 'a:b', 'a\nb', ' Toggle', 'Toggle ', 'ABCDEFGHIJK', '<b>', null, undefined]) {
        assert.equal(isValidMenuLabel(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
});

test('isValidMenuLabel agrees with sanitizeMenuLabel: a label is valid iff sanitizing is a no-op on non-empty input', () => {
    for (const input of [...HOSTILE_LABELS, 'Toggle', 'ABCDEFGHIJ', 'ABCDEFGHIJK', '']) {
        const sanitized = sanitizeMenuLabel(input);
        const expected = sanitized.length > 0 && String(input) === sanitized;
        assert.equal(isValidMenuLabel(input), expected, `disagreement for ${JSON.stringify(input)}`);
    }
});

// --- resolveMenuCustomization: label safety end to end ----------------------------------------

test('resolveMenuCustomization falls back to the default label and cog icon', () => {
    for (const input of [null, { icon: { type: 'default' } }, {}]) {
        const result = resolveMenuCustomization(input);
        assert.equal(result.label, NM_MENU_DEFAULT_LABEL);
        assert.equal(result.iconPath, NM_MENU_ICON_DEFAULT_PATH);
        assert.equal(result.iconFile, null);
    }
});

test('resolveMenuCustomization never emits an injectable label', () => {
    assert.equal(resolveMenuCustomization({ label: 'Read Mode' }).label, 'ReadMode');
    for (const input of HOSTILE_LABELS) {
        const { label } = resolveMenuCustomization({ label: input });
        assert.match(label, /^[A-Za-z0-9]{1,10}$/, `resolved label for ${JSON.stringify(input)} is injectable`);
    }
});

test('resolveMenuCustomization only ever emits a known, hardcoded icon path (no user-controlled path)', () => {
    const cases = [
        null,
        {},
        { icon: { type: 'default' } },
        { icon: { type: 'preset', id: 'cog' } },
        { icon: { type: 'preset', id: 'book' } },
        { icon: { type: 'preset', id: 'book', data: new Uint8Array([1]) } },
        { icon: { type: 'preset', id: 'does-not-exist' } },
        { icon: { type: 'upload', data: new Uint8Array([1]), mimeType: 'image/png' } },
        { icon: { type: 'upload', data: new Uint8Array([1]), mimeType: 'image/svg+xml' } },
        { icon: { type: 'upload', data: new Uint8Array([1]), mimeType: '../../../etc/passwd' } },
    ];
    for (const input of cases) {
        const { iconPath, iconFile } = resolveMenuCustomization(input);
        assert.ok(ICON_PATHS.has(iconPath), `iconPath escaped the whitelist: ${iconPath}`);
        if (iconFile) {
            assert.ok(ICON_PATHS.has(iconFile.path), `iconFile.path escaped the whitelist: ${iconFile.path}`);
        }
    }
});

test('resolveMenuCustomization treats the cog preset as the built-in default icon', () => {
    const result = resolveMenuCustomization({ label: 'Toggle', icon: { type: 'preset', id: 'cog' } });
    assert.equal(result.iconPath, NM_MENU_ICON_DEFAULT_PATH);
    assert.equal(result.iconFile, null);
});

test('resolveMenuCustomization writes a rasterized preset as a custom PNG', () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = resolveMenuCustomization({ icon: { type: 'preset', id: 'book', data } });
    assert.equal(result.iconPath, NM_MENU_ICON_CUSTOM_PNG_PATH);
    assert.ok(result.iconFile.data instanceof Uint8Array);
    assert.deepEqual(result.iconFile.data, data);
    assert.equal(result.iconFile.path, NM_MENU_ICON_CUSTOM_PNG_PATH);
});

test('resolveMenuCustomization writes a preset without raster data as its SVG', () => {
    const result = resolveMenuCustomization({ icon: { type: 'preset', id: 'book' } });
    assert.equal(result.iconPath, NM_MENU_ICON_CUSTOM_SVG_PATH);
    assert.equal(result.iconFile.path, NM_MENU_ICON_CUSTOM_SVG_PATH);
    assert.match(new TextDecoder().decode(result.iconFile.data), /^<svg/);
});

test('resolveMenuCustomization coerces plain-array icon data to a Uint8Array', () => {
    const preset = resolveMenuCustomization({ icon: { type: 'preset', id: 'book', data: [1, 2, 3] } });
    assert.ok(preset.iconFile.data instanceof Uint8Array);
    assert.deepEqual(preset.iconFile.data, new Uint8Array([1, 2, 3]));

    const upload = resolveMenuCustomization({ icon: { type: 'upload', data: [4, 5], mimeType: 'image/png' } });
    assert.ok(upload.iconFile.data instanceof Uint8Array);
    assert.deepEqual(upload.iconFile.data, new Uint8Array([4, 5]));
});

test('resolveMenuCustomization ignores an unknown preset and uses the default icon', () => {
    const result = resolveMenuCustomization({ icon: { type: 'preset', id: 'does-not-exist' } });
    assert.equal(result.iconPath, NM_MENU_ICON_DEFAULT_PATH);
    assert.equal(result.iconFile, null);
});

test('resolveMenuCustomization routes uploads by mime type', () => {
    const png = resolveMenuCustomization({
        icon: { type: 'upload', data: new Uint8Array([9]), mimeType: 'image/png' },
    });
    assert.equal(png.iconPath, NM_MENU_ICON_CUSTOM_PNG_PATH);
    assert.equal(png.iconFile.path, NM_MENU_ICON_CUSTOM_PNG_PATH);

    const svg = resolveMenuCustomization({
        icon: { type: 'upload', data: new Uint8Array([9]), mimeType: 'image/svg+xml' },
    });
    assert.equal(svg.iconPath, NM_MENU_ICON_CUSTOM_SVG_PATH);
    assert.equal(svg.iconFile.path, NM_MENU_ICON_CUSTOM_SVG_PATH);
});

// --- preset icon rendering & lookup -----------------------------------------------------------

test('preset icons render from Lucide node data with the expected SVG attributes', () => {
    const book = findPresetIcon('book');
    assert.equal(NM_MENU_PRESET_ICONS.length, 12);
    assert.match(book.svg, /^<svg /);
    assert.match(book.svg, /stroke="#111827"/);
    assert.match(book.svg, /stroke-width="1.0"/);
    assert.match(book.svg, /<path d="M12 5v16"\/>/);
});

test('findPresetIcon returns a known preset or null', () => {
    assert.equal(findPresetIcon('cog')?.id, 'cog');
    assert.equal(findPresetIcon('does-not-exist'), null);
});

// --- default customization helpers ------------------------------------------------------------

test('createDefaultMenuCustomization produces a customization recognized as the default', () => {
    const def = createDefaultMenuCustomization();
    assert.equal(def.label, NM_MENU_DEFAULT_LABEL);
    assert.deepEqual(def.icon, { type: 'default' });
    assert.equal(isDefaultMenuCustomization(def), true);
});

test('isDefaultMenuCustomization recognizes the default label + icon combination', () => {
    assert.equal(isDefaultMenuCustomization(null), true);
    assert.equal(isDefaultMenuCustomization({ label: 'Toggle', icon: { type: 'default' } }), true);
    assert.equal(isDefaultMenuCustomization({ label: 'Toggle' }), true);
    assert.equal(isDefaultMenuCustomization({ label: '', icon: { type: 'default' } }), true);
    assert.equal(isDefaultMenuCustomization({ label: 'Reader', icon: { type: 'default' } }), false);
    assert.equal(isDefaultMenuCustomization({ label: 'Toggle', icon: { type: 'preset', id: 'book' } }), false);
});
