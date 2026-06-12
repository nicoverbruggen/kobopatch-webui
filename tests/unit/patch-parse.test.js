import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePatchYAML, replacePatchLines, yamlScalar } from '../../src/js/patches/ui.js';

test('parsePatchYAML reads name, enabled, description and patchGroup', () => {
    const yaml = [
        'Some patch:',
        '  - Enabled: yes',
        '  - Description: A short note',
        '  - PatchGroup: layout',
        '  - FindBaseAddress: foo',
        '',
        'Another patch:',
        '  - Enabled: no',
    ].join('\n');

    const patches = parsePatchYAML(yaml);
    assert.equal(patches.length, 2);

    const [first, second] = patches;
    assert.equal(first.name, 'Some patch');
    assert.equal(first.enabled, true);
    assert.equal(first.description, 'A short note');
    assert.equal(first.patchGroup, 'layout');
    assert.equal(first.lineStart, 0);
    // Range extends up to (and excluding) the next patch's starting line.
    assert.equal(first.lineEnd, 6);

    assert.equal(second.name, 'Another patch');
    assert.equal(second.enabled, false);
    assert.equal(second.lineStart, 6);
    assert.equal(second.lineEnd, 8);
});

test('parsePatchYAML recognizes quoted and comment-suffixed Enabled (no silent disable)', () => {
    // The old regex parser only matched `- Enabled: yes` anchored at both ends,
    // so these valid forms silently fell back to disabled. js-yaml accepts them.
    const quoted = parsePatchYAML('P:\n  - Enabled: "yes"\n');
    assert.equal(quoted[0].enabled, true);

    const commented = parsePatchYAML('P:\n  - Enabled: yes  # default on\n');
    assert.equal(commented[0].enabled, true);

    const spaced = parsePatchYAML('P:\n  - Enabled:    yes\n');
    assert.equal(spaced[0].enabled, true);
});

test('parsePatchYAML detects boundaries with trailing space after the name', () => {
    // A trailing space means the name no longer endsWith(":"); the key-name
    // detector handles it and still finds two patches.
    const patches = parsePatchYAML('First: \n  - Enabled: yes\nSecond:\n  - Enabled: no\n');
    assert.deepEqual(patches.map(p => p.name), ['First', 'Second']);
    assert.equal(patches[0].enabled, true);
});

test('parsePatchYAML reads multi-line block-scalar descriptions regardless of indent', () => {
    const yaml = [
        'Block patch:',
        '  - Enabled: no',
        '  - Description: |',
        '      line one',
        '      line two',
        '  - FindReplaceString: x',
    ].join('\n');

    const [patch] = parsePatchYAML(yaml);
    assert.equal(patch.description, 'line one\nline two');
});

test('parsePatchYAML returns [] for invalid YAML rather than corrupting boundaries', () => {
    assert.deepEqual(parsePatchYAML('some: random\n  - bad: indent'), []);
});

test('replacePatchLines swaps a line range without doubling or dropping newlines', () => {
    const raw = 'A:\n  - Enabled: yes\nB:\n  - Enabled: no\nC:\n  - Enabled: yes\n';
    // Replace the B block (lines 2..4) with an edited version.
    const updated = replacePatchLines(raw, 2, 4, 'B:\n  - Enabled: yes');
    assert.equal(updated, 'A:\n  - Enabled: yes\nB:\n  - Enabled: yes\nC:\n  - Enabled: yes\n');
});

test('replacePatchLines trims trailing newlines on the replacement', () => {
    const raw = 'A:\n  - Enabled: yes\nB:\n  - Enabled: no\n';
    const updated = replacePatchLines(raw, 0, 2, 'A:\n  - Enabled: no\n\n');
    assert.equal(updated, 'A:\n  - Enabled: no\nB:\n  - Enabled: no\n');
});

test('replacePatchLines round-trips through parsePatchYAML', () => {
    const raw = 'First:\n  - Enabled: yes\nSecond:\n  - Enabled: no\n';
    const patches = parsePatchYAML(raw);
    const second = patches.find(p => p.name === 'Second');
    const updated = replacePatchLines(raw, second.lineStart, second.lineEnd, 'Second:\n  - Enabled: yes');
    const reparsed = parsePatchYAML(updated);
    assert.equal(reparsed.find(p => p.name === 'Second').enabled, true);
    assert.equal(reparsed.find(p => p.name === 'First').enabled, true);
});

test('yamlScalar leaves plain names bare and quotes significant characters', () => {
    assert.equal(yamlScalar('Reduce top/bottom page spacer'), 'Reduce top/bottom page spacer');
    assert.equal(yamlScalar('Has: colon'), '"Has: colon"');
    assert.equal(yamlScalar('- leading dash'), '"- leading dash"');
    assert.equal(yamlScalar('yes'), '"yes"');
    assert.equal(yamlScalar('say "hi"'), '"say \\"hi\\""');
});
