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
    assert.deepEqual(
        parsed.map((e) => e.path),
        entries.map((e) => e.path),
    );
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
    assert.ok(tar.slice(512 * 2).every((b) => b === 0));
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

    assert.deepEqual(
        parsed.map((e) => e.path),
        ['dir/one', 'dir/two'],
    );
    assert.deepEqual(
        parsed.map((e) => e.mode),
        [0o644, 0o600],
    );
    assert.deepEqual(parsed[1].data, bytes('second'));
});

// Assemble a tar from raw entry specs, bypassing buildTar's path/length safety, so
// parseTar can be fed hostile or edge-case headers. Each spec: { name, prefix, type,
// mode, data, sizeField }. `sizeField` writes the octal size bytes verbatim (for
// malformed-size attacks). `endBlocks` (default true) appends the two zero end-blocks.
function rawTar(specs, { endBlocks = true } = {}) {
    const enc = new TextEncoder();
    const parts = [];
    for (const s of specs) {
        const h = new Uint8Array(512);
        const putStr = (off, len, str) => {
            const e = enc.encode(str);
            for (let i = 0; i < e.length && i < len; i++) h[off + i] = e[i];
        };
        const putOct = (off, len, v) => {
            const d = v.toString(8).padStart(len - 1, '0');
            for (let i = 0; i < len - 1; i++) h[off + i] = d.charCodeAt(i);
        };
        const data = s.data ?? new Uint8Array(0);
        putStr(0, 100, s.name ?? '');
        putOct(100, 8, s.mode ?? 0o644);
        if (s.sizeField != null) putStr(124, 12, s.sizeField);
        else putOct(124, 12, data.length);
        h[156] = (s.type ?? '0').charCodeAt(0);
        putStr(257, 6, 'ustar');
        putStr(345, 155, s.prefix ?? '');
        parts.push(h);
        if (data.length) {
            parts.push(data);
            const pad = (512 - (data.length % 512)) % 512;
            if (pad) parts.push(new Uint8Array(pad));
        }
    }
    if (endBlocks) parts.push(new Uint8Array(1024));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

// --- security: path traversal must be rejected, whether the escape rides in the name
// field or the ustar prefix field (parseTar validates the JOINED path). ---
test('parseTar rejects traversal and absolute paths in the name field', () => {
    for (const evil of ['../etc/passwd', '/etc/passwd', 'a/../../etc/passwd', '..']) {
        assert.throws(() => parseTar(buildTar([{ path: evil, data: bytes('x'), mode: 0o644 }])), /Unsafe tar path/, `should reject ${evil}`);
    }
});

test('parseTar rejects traversal smuggled through the ustar prefix field', () => {
    // regression: the safety check must apply to the joined prefix/name, not just name —
    // otherwise a header with prefix "../" and an innocent name would escape.
    assert.throws(() => parseTar(rawTar([{ prefix: '..', name: 'passwd' }])), /Unsafe tar path/);
    assert.throws(() => parseTar(rawTar([{ prefix: '/abs', name: 'passwd' }])), /Unsafe tar path/);
});

// --- boundaries: data round-trips exactly at the 512-byte block seam ---
test('buildTar round-trips data at and around 512-byte block boundaries', () => {
    for (const len of [0, 1, 511, 512, 513, 1024]) {
        const data = new Uint8Array(len).map((_, i) => (i * 7) % 251);
        const [entry] = parseTar(buildTar([{ path: 'f', data, mode: 0o644 }]));
        assert.equal(entry.data.length, len, `len ${len}: length`);
        assert.deepEqual(entry.data, data, `len ${len}: bytes`);
    }
});

// --- empty archive / undersized input must not read out of bounds ---
test('buildTar with no entries is just the two zero end-blocks and parses to []', () => {
    const tar = buildTar([]);
    assert.equal(tar.length, 1024);
    assert.ok(tar.every((b) => b === 0));
    assert.deepEqual(parseTar(tar), []);
});

test('parseTar tolerates empty and sub-header-sized input', () => {
    assert.deepEqual(parseTar(new Uint8Array(0)), []);
    assert.deepEqual(parseTar(new Uint8Array(100)), []);
    assert.deepEqual(parseTar(new Uint8Array(511)), []);
});

// --- truncated data is caught ---
test('parseTar throws when an entry claims more data than the archive holds', () => {
    // Header (only) claims 0o1750 = 1000 data bytes, but nothing follows it.
    const headerOnly = rawTar([{ name: 'f', sizeField: '00000001750' }], { endBlocks: false });
    assert.throws(() => parseTar(headerOnly), /Truncated/);
});

// --- path length boundaries at the 100-byte name field ---
test('buildTar round-trips a path at and just over the 100-byte name field', () => {
    for (const pathLen of [100, 101]) {
        const path = 'd/' + 'a'.repeat(pathLen - 2); // the slash lets 101 spill into the prefix
        const [entry] = parseTar(buildTar([{ path, data: bytes('x'), mode: 0o644 }]));
        assert.equal(entry.path, path, `path length ${pathLen}`);
    }
});

test('buildTar refuses a single path component too long for the 100-byte name field', () => {
    assert.throws(() => buildTar([{ path: 'a'.repeat(101), data: bytes('x'), mode: 0o644 }]), /too long/);
});

// --- non-file entries are skipped without derailing the surrounding files ---
test('parseTar skips directory entries and still returns the files around them', () => {
    const tar = rawTar([
        { name: 'a', type: '0', data: bytes('AAA') },
        { name: 'd/', type: '5' }, // directory entry, size 0
        { name: 'b', type: '0', data: bytes('BBB') },
    ]);
    const parsed = parseTar(tar);
    assert.deepEqual(
        parsed.map((e) => e.path),
        ['a', 'b'],
    );
    assert.deepEqual(parsed[1].data, bytes('BBB'));
});
