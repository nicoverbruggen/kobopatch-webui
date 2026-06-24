import test from 'node:test';
import assert from 'node:assert/strict';

import { PatchUI } from '../../src/js/patches/ui.js';
import { parsePatchYAML, replacePatchLines, yamlScalar } from '../../src/js/patches/patch-yaml.js';
import { buildPatchesManifest } from '../../src/js/flows/patches-execute.js';

/**
 * Build a PatchUI seeded with one file's worth of patches and their pristine
 * text, mirroring what loadFromZip captures, without needing a zip or the DOM.
 */
function seedUI(filename, raw) {
    const ui = new PatchUI();
    const parsed = parsePatchYAML(raw);
    ui.patchFiles[filename] = { raw, patches: parsed };
    ui.pristineText[filename] = {};
    for (const p of parsed) {
        ui.pristineText[filename][p.name] = ui._patchText(raw, p.lineStart, p.lineEnd);
    }
    return ui;
}

/** Mirror _saveEdit's data effects (raw replace + reparse + track) without the DOM render. */
function editPatch(ui, filename, patchName, newYaml) {
    const file = ui.patchFiles[filename];
    const p = file.patches.find((pp) => pp.name === patchName);
    file.raw = replacePatchLines(file.raw, p.lineStart, p.lineEnd, newYaml);
    file.patches = parsePatchYAML(file.raw);
    ui._trackEdit(filename, patchName, newYaml);
}

function fakeFile(name, size = 1) {
    return { name, size, async arrayBuffer() {} };
}

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
    assert.deepEqual(
        patches.map((p) => p.name),
        ['First', 'Second'],
    );
    assert.equal(patches[0].enabled, true);
});

test('parsePatchYAML reads multi-line block-scalar descriptions regardless of indent', () => {
    const yaml = ['Block patch:', '  - Enabled: no', '  - Description: |', '      line one', '      line two', '  - FindReplaceString: x'].join('\n');

    const [patch] = parsePatchYAML(yaml);
    assert.equal(patch.description, 'line one\nline two');
});

test('parsePatchYAML excludes detached section comments from the previous patch range', () => {
    const yaml = [
        'Last patch in section:',
        '  - Enabled: no',
        '  - ReplaceBytes: {FindH: AA, ReplaceH: BB}',
        '',
        '# The following patches belong to the next section.',
        '# They should not be edited as part of the previous patch.',
        '',
        'First patch in next section:',
        '  - Enabled: no',
    ].join('\n');

    const patches = parsePatchYAML(yaml);
    const first = patches[0];
    assert.equal(first.lineStart, 0);
    assert.equal(first.lineEnd, 4);

    const firstText = yaml.split('\n').slice(first.lineStart, first.lineEnd).join('\n');
    assert.match(firstText, /Last patch in section/);
    assert.doesNotMatch(firstText, /following patches/);
});

test('parsePatchYAML keeps adjacent top-level commented operations inside the patch range', () => {
    const yaml = [
        'Patch with optional operation:',
        '  - Enabled: no',
        '  - ReplaceBytes: {FindH: AA, ReplaceH: BB}',
        '  # choose one replacement:',
        '# - ReplaceBytes: {FindH: AA, ReplaceH: CC}',
        '',
        'Next patch:',
        '  - Enabled: no',
    ].join('\n');

    const patches = parsePatchYAML(yaml);
    const first = patches[0];
    const firstText = yaml.split('\n').slice(first.lineStart, first.lineEnd).join('\n');
    assert.match(firstText, /choose one replacement/);
    assert.match(firstText, /ReplaceH: CC/);
    assert.equal(first.lineEnd, 6);
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
    const second = patches.find((p) => p.name === 'Second');
    const updated = replacePatchLines(raw, second.lineStart, second.lineEnd, 'Second:\n  - Enabled: yes');
    const reparsed = parsePatchYAML(updated);
    assert.equal(reparsed.find((p) => p.name === 'Second').enabled, true);
    assert.equal(reparsed.find((p) => p.name === 'First').enabled, true);
});

test('edit tracking flags a modified patch and reports hasEdits', () => {
    const ui = seedUI('f.yaml', 'P:\n  - Enabled: no\n  - ReplaceString: a\nQ:\n  - Enabled: no\n');
    assert.equal(ui.hasEdits(), false);
    assert.equal(ui.isModified('f.yaml', 'P'), false);

    ui._trackEdit('f.yaml', 'P', 'P:\n  - Enabled: no\n  - ReplaceString: b\n');
    assert.equal(ui.isModified('f.yaml', 'P'), true);
    assert.equal(ui.isModified('f.yaml', 'Q'), false);
    assert.equal(ui.hasEdits(), true);
});

test('edit tracking clears the flag when an edit restores the pristine form', () => {
    const original = 'P:\n  - Enabled: no\n  - ReplaceString: a\n';
    const ui = seedUI('f.yaml', original);

    ui._trackEdit('f.yaml', 'P', 'P:\n  - Enabled: no\n  - ReplaceString: b\n');
    assert.equal(ui.isModified('f.yaml', 'P'), true);

    // Editing back to the original (ignoring trailing whitespace) clears it.
    ui._trackEdit('f.yaml', 'P', 'P:\n  - Enabled: no\n  - ReplaceString: a  \n');
    assert.equal(ui.isModified('f.yaml', 'P'), false);
    assert.equal(ui.hasEdits(), false);
});

test('edit tracking follows a renamed patch and drops the old name', () => {
    const ui = seedUI('f.yaml', 'P:\n  - Enabled: no\n');
    const editedName = ui._trackEdit('f.yaml', 'P', 'Renamed:\n  - Enabled: yes\n');
    assert.equal(editedName, 'Renamed');
    assert.equal(ui.isModified('f.yaml', 'P'), false);
    assert.equal(ui.isModified('f.yaml', 'Renamed'), true);
});

test('getCustomizations captures only edited patch blocks, keyed by file and name', () => {
    const ui = seedUI('f.yaml', 'P:\n  - Enabled: no\n  - FindReplaceString: a\nQ:\n  - Enabled: no\n');

    // No edits yet → nothing captured.
    assert.deepEqual(ui.getCustomizations(), {});

    // Edit P in place (the flow's _saveEdit updates raw + reparses + tracks).
    editPatch(ui, 'f.yaml', 'P', 'P:\n  - Enabled: no\n  - FindReplaceString: b\n');

    const custom = ui.getCustomizations();
    assert.deepEqual(Object.keys(custom), ['f.yaml']);
    assert.deepEqual(Object.keys(custom['f.yaml']), ['P']);
    assert.match(custom['f.yaml']['P'], /FindReplaceString: b/);
    // Q was never edited, so it is absent.
    assert.equal('Q' in custom['f.yaml'], false);
});

test('applyReloadManifest re-applies enabled overrides and manual edits to a fresh set', () => {
    // Fresh patch set as it would load from the zip for the device's firmware.
    const fresh = 'P:\n  - Enabled: no\n  - FindReplaceString: a\nQ:\n  - Enabled: no\n';
    const ui = seedUI('f.yaml', fresh);

    const manifest = {
        overrides: { 'f.yaml': { P: true, Q: false } },
        customized: { 'f.yaml': { P: 'P:\n  - Enabled: no\n  - FindReplaceString: edited\n' } },
    };

    const summary = ui.applyReloadManifest(manifest);
    assert.equal(summary.enabled, 1);
    assert.equal(summary.edits, 1);
    assert.equal(summary.missing, 0);
    // Both P and Q exist in the loaded set, so both override entries matched.
    assert.equal(summary.matched, 2);

    // P is enabled (from overrides) and its manual edit is applied and flagged.
    const p = ui.patchFiles['f.yaml'].patches.find((x) => x.name === 'P');
    assert.equal(p.enabled, true);
    assert.match(ui.patchFiles['f.yaml'].raw, /FindReplaceString: edited/);
    assert.equal(ui.isModified('f.yaml', 'P'), true);
    // Q stays disabled and untouched.
    assert.equal(ui.patchFiles['f.yaml'].patches.find((x) => x.name === 'Q').enabled, false);
});

test('applyReloadManifest reports re-applied patches and flags blacklisted ones as incompatible', () => {
    const ui = seedUI('f.yaml', 'P:\n  - Enabled: no\nQ:\n  - Enabled: no\nR:\n  - Enabled: no\n');
    // R is blacklisted for the loaded firmware; P and Q are fine.
    ui.firmwareVersion = '4.45.23646';
    ui.blacklist = { 4.45: { 'f.yaml': ['R'] } };

    const summary = ui.applyReloadManifest({ overrides: { 'f.yaml': { P: true, Q: false, R: true } }, customized: {} });

    // Only the enabled patches (P, R) are listed; the disabled Q is omitted.
    assert.deepEqual(summary.applied, [
        { name: 'P', filename: 'f.yaml', incompatible: false },
        { name: 'R', filename: 'f.yaml', incompatible: true },
    ]);
});

test('applyReloadManifest counts entries with no matching file or patch as missing', () => {
    const ui = seedUI('f.yaml', 'P:\n  - Enabled: no\n');
    const summary = ui.applyReloadManifest({
        overrides: { 'gone.yaml': { X: true } },
        customized: {
            'gone.yaml': { X: 'X:\n  - Enabled: yes\n' },
            'f.yaml': { Missing: 'Missing:\n  - Enabled: yes\n' },
        },
    });
    assert.equal(summary.edits, 0);
    assert.equal(summary.enabled, 0);
    assert.equal(summary.matched, 0);
    // gone.yaml/X plus f.yaml/Missing → two unmatched customizations.
    assert.equal(summary.missing, 2);
});

test('applyReloadManifest reports matches even when the restored selection enables nothing', () => {
    // A "restore original firmware" manifest lists every patch as disabled. These
    // still match the loaded set — the reload is valid, just enables nothing — so
    // the flow must not mistake it for a version mismatch.
    const ui = seedUI('f.yaml', 'P:\n  - Enabled: no\nQ:\n  - Enabled: yes\n');
    const summary = ui.applyReloadManifest({ overrides: { 'f.yaml': { P: false, Q: false } }, customized: {} });
    assert.equal(summary.matched, 2);
    assert.equal(summary.enabled, 0);
    assert.equal(summary.edits, 0);
    // Q, enabled by default, is turned off to match the restored (empty) selection.
    assert.equal(ui.patchFiles['f.yaml'].patches.find((p) => p.name === 'Q').enabled, false);
});

test('manifest round-trips overrides and edits back onto an identical fresh set', () => {
    const fresh = 'P:\n  - Enabled: no\n  - FindReplaceString: a\nQ:\n  - Enabled: no\n';

    // Session 1: user enables P and edits its value.
    const ui1 = seedUI('f.yaml', fresh);
    editPatch(ui1, 'f.yaml', 'P', 'P:\n  - Enabled: no\n  - FindReplaceString: custom\n');
    ui1.patchFiles['f.yaml'].patches.find((p) => p.name === 'P').enabled = true;
    const manifest = { overrides: ui1.getOverrides(), customized: ui1.getCustomizations() };

    // Session 2: reload onto a freshly loaded set reproduces selection + edit.
    const ui2 = seedUI('f.yaml', fresh);
    ui2.applyReloadManifest(manifest);
    assert.equal(ui2.patchFiles['f.yaml'].patches.find((p) => p.name === 'P').enabled, true);
    assert.match(ui2.patchFiles['f.yaml'].raw, /FindReplaceString: custom/);
    assert.equal(ui2.isModified('f.yaml', 'P'), true);
});

test('yamlScalar leaves plain names bare and quotes significant characters', () => {
    assert.equal(yamlScalar('Reduce top/bottom page spacer'), 'Reduce top/bottom page spacer');
    assert.equal(yamlScalar('Has: colon'), '"Has: colon"');
    assert.equal(yamlScalar('- leading dash'), '"- leading dash"');
    assert.equal(yamlScalar('yes'), '"yes"');
    assert.equal(yamlScalar('say "hi"'), '"say \\"hi\\""');
});

test('generateConfig emits the version, patch targets, and quoted overrides', () => {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.45.23646';
    ui.patchConfig = { 'src/nickel.yaml': 'usr/local/Kobo/nickel' };
    ui.patchFiles = {
        'src/nickel.yaml': {
            raw: '',
            patches: [
                { name: 'Plain name', enabled: true },
                { name: 'Has: colon', enabled: false },
            ],
        },
    };
    const cfg = ui.generateConfig();
    assert.match(cfg, /^version: "4\.45\.23646"$/m);
    assert.match(cfg, /^patchFormat: kobopatch$/m);
    assert.match(cfg, /^ {2}src\/nickel\.yaml: usr\/local\/Kobo\/nickel$/m);
    assert.match(cfg, /^ {4}Plain name: yes$/m);
    assert.match(cfg, /^ {4}"Has: colon": no$/m);
});

test('isBlacklisted matches on the short firmware version and exact file + name', () => {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.45.23646';
    ui.blacklist = { 4.45: { 'src/nickel.yaml': ['Allow rotation'] } };

    assert.equal(ui.isBlacklisted('src/nickel.yaml', 'Allow rotation'), true);
    assert.equal(ui.isBlacklisted('src/nickel.yaml', 'Other patch'), false);
    assert.equal(ui.isBlacklisted('src/other.yaml', 'Allow rotation'), false);
});

test('isBlacklisted returns false without a blacklist, firmware, or version match', () => {
    const noVersion = new PatchUI();
    noVersion.blacklist = { 4.45: { 'src/nickel.yaml': ['Allow rotation'] } };
    assert.equal(noVersion.isBlacklisted('src/nickel.yaml', 'Allow rotation'), false);

    const otherVersion = new PatchUI();
    otherVersion.blacklist = { 4.45: { 'src/nickel.yaml': ['Allow rotation'] } };
    otherVersion.firmwareVersion = '4.44.19619';
    assert.equal(otherVersion.isBlacklisted('src/nickel.yaml', 'Allow rotation'), false);

    const noBlacklist = new PatchUI();
    noBlacklist.firmwareVersion = '4.45.23646';
    assert.equal(noBlacklist.isBlacklisted('src/nickel.yaml', 'Allow rotation'), false);
});

test('getCurrentBlacklist returns names for the loaded firmware grouped by file', () => {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.45.23646';
    ui.patchFiles = {
        'src/nickel.yaml': { raw: '', patches: [] },
        'src/libnickel.so.1.0.0.yaml': { raw: '', patches: [] },
    };
    ui.blacklist = {
        4.45: {
            'src/libnickel.so.1.0.0.yaml': ['Allow rotation', 'Set KePub hyphenation'],
            'src/libadobe.so.yaml': ['Remove PDF map widget shown during panning'],
        },
        4.44: {
            'src/nickel.yaml': ['Other version only'],
        },
    };

    assert.deepEqual(ui.getCurrentBlacklist(), [
        {
            filename: 'src/libnickel.so.1.0.0.yaml',
            names: ['Allow rotation', 'Set KePub hyphenation'],
        },
        {
            filename: 'src/libadobe.so.yaml',
            names: ['Remove PDF map widget shown during panning'],
        },
    ]);
});

test('getCurrentBlacklist returns empty without a matching firmware blacklist', () => {
    const ui = new PatchUI();
    ui.firmwareVersion = '4.44.19619';
    ui.blacklist = { 4.45: { 'src/nickel.yaml': ['Allow rotation'] } };

    assert.deepEqual(ui.getCurrentBlacklist(), []);
});

test('buildPatchesManifest captures overrides, customizations, and install metadata', () => {
    const raw = 'First:\n  - Enabled: yes\nSecond:\n  - Enabled: no\n';
    const ui = seedUI('src/nickel.yaml', raw);
    editPatch(ui, 'src/nickel.yaml', 'Second', 'Second:\n  - Enabled: yes\n  - FindReplaceString: x\n');

    const manifest = buildPatchesManifest(ui, '4.45.23646', 'kobo9', [
        { path: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf', sourceName: 'Georgia.ttf', size: 1234 },
    ]);
    assert.deepEqual(manifest.overrides, ui.getOverrides());
    assert.deepEqual(manifest.customized, ui.getCustomizations());
    assert.equal(manifest.files[0].path, '.kobo/KoboRoot.tgz');
    assert.deepEqual(manifest.files[1], {
        path: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf',
        type: 'additional-file',
        sourceName: 'Georgia.ttf',
        size: 1234,
    });
    assert.equal(manifest.meta.writer.name, 'kobopatch-webui');
    assert.equal(manifest.meta.installed.firmware, '4.45.23646');
    assert.equal(manifest.meta.installed.channel, 'kobo9');
    assert.equal(typeof manifest.meta.installed.timestamp, 'string');
});

test('additional file validation reports duplicate destinations per item', () => {
    const ui = new PatchUI();
    ui.addAdditionalFiles([fakeFile('A.ttf'), fakeFile('B.ttf')]);
    ui.updateAdditionalFileDestination(1, 'usr/local/Kobo/fonts/shared.ttf');
    ui.updateAdditionalFileDestination(2, 'usr/local/Kobo/fonts/shared.ttf');

    const files = ui.getAdditionalFiles();
    assert.equal(files[0].validation.ok, false);
    assert.equal(files[1].validation.ok, false);
    assert.match(files[0].validation.message, /unique destination/);
    assert.deepEqual(ui.validateAdditionalFiles(), {
        ok: false,
        message: 'Each additional file needs a unique destination.',
    });
});
