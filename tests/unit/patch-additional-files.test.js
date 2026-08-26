import test from 'node:test';
import assert from 'node:assert/strict';

import {
    additionalFilesArchiveName,
    patchManifestBaseName,
    patchManifestName,
    buildAdditionalFilesTgz,
    defaultAdditionalFileDestination,
    mergeAdditionalFilesIntoTgz,
    normalizeAdditionalFileDestination,
    readAdditionalFileEntry,
    readAdditionalFilesArchive,
    validateAdditionalFileDestination,
} from '../../src/js/patches/additional-files.js';
import { sha256Hex } from '../../src/js/shell/digest.js';
import { buildTarGz, parseTarGz } from '../../src/js/nickelmenu/archive.js';

function bytes(value) {
    return new TextEncoder().encode(value);
}

function fakeFile(name, data) {
    const body = bytes(data);
    return {
        name,
        size: body.length,
        async arrayBuffer() {
            return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        },
    };
}

test('additional font files default to the encrypted firmware font directory', () => {
    assert.equal(defaultAdditionalFileDestination('Georgia.ttf'), 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf');
    assert.equal(defaultAdditionalFileDestination('Amasis.OTF'), 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Amasis.OTF');
    assert.equal(defaultAdditionalFileDestination('init.sh'), 'init.sh');
});

test('additional file destinations are normalized and validated', () => {
    assert.equal(
        normalizeAdditionalFileDestination('.\\usr\\local\\Trolltech\\QtEmbedded-4.6.2-arm\\lib\\fonts\\Georgia.ttf'),
        'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf',
    );
    assert.deepEqual(validateAdditionalFileDestination('usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf'), {
        ok: true,
        path: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf',
        message: '',
    });
    assert.equal(validateAdditionalFileDestination('').ok, false);
    assert.equal(validateAdditionalFileDestination('/usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf').ok, false);
    assert.equal(validateAdditionalFileDestination('usr/local/Kobo/../fonts/Georgia.ttf').ok, false);
    assert.equal(validateAdditionalFileDestination('usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/').ok, false);
    assert.equal(validateAdditionalFileDestination('usr/local/Kobo/fonts/bad\nname.ttf').ok, false);
    assert.equal(validateAdditionalFileDestination(`usr/local/Kobo/${'a'.repeat(180)}/font.ttf`).ok, false);
});

test('readAdditionalFileEntry returns a tar-ready entry with native kobopatch mode', async () => {
    const entry = await readAdditionalFileEntry({
        file: fakeFile('Georgia.ttf', 'font-bytes'),
        destination: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf',
    });

    assert.equal(entry.path, 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf');
    assert.equal(entry.sourceName, 'Georgia.ttf');
    assert.equal(entry.size, 10);
    assert.equal(entry.mode, 0o777);
    assert.deepEqual(entry.data, bytes('font-bytes'));
});

test('mergeAdditionalFilesIntoTgz appends validated entries and rejects duplicate targets', async () => {
    const tgz = await buildTarGz([{ path: 'usr/local/Kobo/nickel', data: bytes('elf'), mode: 0o755 }]);
    const merged = await mergeAdditionalFilesIntoTgz(tgz, [
        { path: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf', data: bytes('font'), mode: 0o777, sourceName: 'Georgia.ttf', size: 4 },
    ]);

    const entries = await parseTarGz(merged);
    assert.deepEqual(
        entries.map((entry) => entry.path),
        ['usr/local/Kobo/nickel', 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf'],
    );
    assert.equal(entries[1].mode, 0o777);
    assert.deepEqual(entries[1].data, bytes('font'));

    await assert.rejects(() => mergeAdditionalFilesIntoTgz(tgz, [{ path: 'usr/local/Kobo/nickel', data: bytes('dup'), mode: 0o777 }]), /already exists/);
});

test('the manifest archive name tracks the manifest base name', () => {
    assert.equal(patchManifestBaseName, 'custom-patches');
    assert.equal(patchManifestName, 'custom-patches.json');
    assert.equal(additionalFilesArchiveName, 'custom-patches-files.tgz');
});

test('readAdditionalFilesArchive round-trips the bytes built by buildAdditionalFilesTgz', async () => {
    const entries = [
        { path: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf', data: bytes('font-bytes'), mode: 0o777, sourceName: 'Georgia.ttf', size: 10 },
        { path: '.adds/extra.txt', data: bytes('hi!!'), mode: 0o777, sourceName: 'extra.txt', size: 4 },
    ];
    const archiveBytes = await buildAdditionalFilesTgz(entries);
    const archive = await readAdditionalFilesArchive(archiveBytes);

    // The archive is keyed by destination path, so it rejoins with a manifest's
    // additional-file entries (path → sourceName) to reconstruct each file.
    const manifestFiles = entries.map((e) => ({ path: e.path, type: 'additional-file', sourceName: e.sourceName, size: e.size }));
    const restored = manifestFiles.map((f) => ({ sourceName: f.sourceName, destination: f.path, data: archive.get(f.path) }));

    assert.deepEqual(
        restored.map((r) => [r.sourceName, r.destination]),
        [
            ['Georgia.ttf', 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf'],
            ['extra.txt', '.adds/extra.txt'],
        ],
    );
    assert.deepEqual(restored[0].data, bytes('font-bytes'));
    assert.deepEqual(restored[1].data, bytes('hi!!'));
});

test('sha256Hex is a deterministic lowercase hex digest', async () => {
    // Known SHA-256 of the ASCII string "abc".
    assert.equal(await sha256Hex(bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(await sha256Hex(bytes('abc')), await sha256Hex(bytes('abc')));
    assert.notEqual(await sha256Hex(bytes('abc')), await sha256Hex(bytes('abd')));
});
