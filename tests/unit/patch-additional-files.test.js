import test from 'node:test';
import assert from 'node:assert/strict';

import {
    defaultAdditionalFileDestination,
    mergeAdditionalFilesIntoTgz,
    normalizeAdditionalFileDestination,
    readAdditionalFileEntry,
    validateAdditionalFileDestination,
} from '../../src/js/patches/additional-files.js';
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
