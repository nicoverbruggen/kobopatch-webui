import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTar, buildTarGz, parseTar, parseTarGz } from '../../src/js/nickelmenu/archive.js';

function bytes(value) {
    return new TextEncoder().encode(value);
}

test('buildTar round-trips paths, data, and modes through parseTar', () => {
    const entries = [
        { path: 'mnt/onboard/.adds/nickelclock/uninstall', data: bytes('delete me'), mode: 0o644 },
        { path: 'usr/local/Kobo/imageformats/libnickelclock.so', data: bytes('ELF binary-ish'), mode: 0o755 },
    ];

    const parsed = parseTar(buildTar(entries));

    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed.map(e => e.path), entries.map(e => e.path));
    assert.deepEqual(parsed[0].data, entries[0].data);
    assert.deepEqual(parsed[1].data, entries[1].data);
    // The executable bit on the plugin must survive the rebuild.
    assert.equal(parsed[0].mode, 0o644);
    assert.equal(parsed[1].mode, 0o755);
});

test('buildTar pads entries to 512-byte boundaries and ends with two zero blocks', () => {
    const tar = buildTar([{ path: 'a', data: bytes('x'), mode: 0o644 }]);
    // header (512) + one padded data block (512) + two zero end blocks (1024).
    assert.equal(tar.length, 512 * 4);
    assert.ok(tar.slice(512 * 2).every(b => b === 0));
});

test('buildTar defaults the file mode when none is given', () => {
    const [entry] = parseTar(buildTar([{ path: 'note.txt', data: bytes('hi') }]));
    assert.equal(entry.mode, 0o644);
});

test('buildTarGz produces a gzip stream parseTarGz can read back', async () => {
    const entries = [
        { path: 'dir/one', data: bytes('first'), mode: 0o644 },
        { path: 'dir/two', data: bytes('second'), mode: 0o600 },
    ];

    const parsed = await parseTarGz(await buildTarGz(entries));

    assert.deepEqual(parsed.map(e => e.path), ['dir/one', 'dir/two']);
    assert.deepEqual(parsed.map(e => e.mode), [0o644, 0o600]);
    assert.deepEqual(parsed[1].data, bytes('second'));
});

test('buildTar encodes long paths via the ustar prefix field', () => {
    const longDir = 'mnt/onboard/.adds/' + 'a'.repeat(120);
    const path = `${longDir}/file`;
    const [entry] = parseTar(buildTar([{ path, data: bytes('y'), mode: 0o644 }]));
    assert.equal(entry.path, path);
});
