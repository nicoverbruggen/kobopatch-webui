import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { countTableRows, bytesRange } from '../../src/js/kobo/sqlite-count.js';
import { countKoboUsers } from '../../src/js/kobo/signin.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'support', 'fixtures');
const fixture = (name) => new Uint8Array(readFileSync(join(fixturesDir, name)));

const MAGIC = 'SQLite format 3\0';

// Minimal in-memory SQLite builder. Just enough of the on-disk format for the
// reader under test: a file header, sqlite_master leaf/interior pages that map a
// table name to a rootpage, and table b-tree leaf/interior pages. Offsets written
// into cell pointers are page-relative, matching what the reader indexes with.
function makeDb(pageSize, pageCount) {
    const buf = new Uint8Array(pageSize * pageCount);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < MAGIC.length; i++) buf[i] = MAGIC.charCodeAt(i);
    dv.setUint16(16, pageSize === 65536 ? 1 : pageSize);
    const base = (pageNum) => (pageNum - 1) * pageSize;
    const hdrOf = (pageNum) => (pageNum === 1 ? 100 : 0);

    // sqlite_master leaf cell describing type='table', name=tbl_name=tableName,
    // rootpage=rootpage. Column lengths stay small so every serial type and the
    // record header fit in a single-byte varint.
    function writeMasterCell(dv, at, tableName, rootpage) {
        const name = [...tableName].map((c) => c.charCodeAt(0));
        const tbl = [...'table'].map((c) => c.charCodeAt(0));
        const stText = (len) => len * 2 + 13;
        const record = [5, stText(5), stText(name.length), stText(name.length), 1, ...tbl, ...name, ...name, rootpage & 0xff];
        let p = at;
        dv.setUint8(p++, record.length); // payload size varint
        dv.setUint8(p++, 1); // rowid varint
        for (const b of record) dv.setUint8(p++, b);
    }

    return {
        buffer: buf,
        // A leaf table page whose declared cell count is the reader's row count.
        leafTable(pageNum, rowCount) {
            const b = base(pageNum) + hdrOf(pageNum);
            dv.setUint8(b, 0x0d);
            dv.setUint16(b + 3, rowCount);
            return this;
        },
        // An interior table page: one cell per child plus a rightmost pointer.
        interiorTable(pageNum, childPages, rightmost) {
            const pb = base(pageNum);
            const h = hdrOf(pageNum);
            dv.setUint8(pb + h, 0x05);
            dv.setUint16(pb + h + 3, childPages.length);
            dv.setUint32(pb + h + 8, rightmost);
            let cellRel = 300; // page-relative; pages here are >= 512 bytes
            childPages.forEach((child, i) => {
                dv.setUint16(pb + h + 12 + i * 2, cellRel);
                dv.setUint32(pb + cellRel, child);
                cellRel += 8;
            });
            return this;
        },
        // A sqlite_master leaf page holding one table-definition row.
        schemaLeaf(pageNum, tableName, rootpage) {
            const pb = base(pageNum);
            const h = hdrOf(pageNum);
            dv.setUint8(pb + h, 0x0d);
            dv.setUint16(pb + h + 3, 1);
            const cellRel = h + 40;
            dv.setUint16(pb + h + 8, cellRel);
            writeMasterCell(dv, pb + cellRel, tableName, rootpage);
            return this;
        },
        // A sqlite_master interior page (schema is itself a table b-tree).
        schemaInterior(pageNum, childPages, rightmost) {
            return this.interiorTable(pageNum, childPages, rightmost);
        },
    };
}

const count = (bytes, table = 'user') => countTableRows(bytesRange(bytes), table);

test('countTableRows reads the user-table row count from real SQLite fixtures', async () => {
    assert.equal(await count(fixture('kobo-reader-factory-reset.sqlite')), 0);
    assert.equal(await count(fixture('kobo-reader-signed-in.sqlite')), 1);
});

test('countTableRows returns null for an absent table', async () => {
    assert.equal(await count(fixture('kobo-reader-signed-in.sqlite'), 'does_not_exist'), null);
});

test('countTableRows returns null for null, empty, non-SQLite, and sub-header inputs', async () => {
    assert.equal(await count(null), null);
    assert.equal(await count(new Uint8Array(0)), null);
    assert.equal(await count(new Uint8Array([1, 2, 3, 4])), null); // too short and bad magic
    // A full 100-byte header would still be shorter than the smallest page.
    assert.equal(await count(new Uint8Array(99)), null);
    // Valid length but wrong magic bytes.
    const badMagic = makeDb(512, 2).schemaLeaf(1, 'user', 2).leafTable(2, 3).buffer;
    badMagic[0] = 0x00;
    assert.equal(await count(badMagic), null);
});

test('countTableRows reads only the pages it needs, not the whole database', async () => {
    // A real KoboReader.sqlite is hundreds of MB; counting one tiny table should
    // touch a few KB. Assert we never request a range past the early pages.
    const db = fixture('kobo-reader-signed-in.sqlite');
    let maxEnd = 0;
    const trackingRange = async (offset, length) => {
        maxEnd = Math.max(maxEnd, offset + length);
        return db.subarray(offset, offset + length);
    };
    assert.equal(await countTableRows(trackingRange, 'user'), 1);
    // Generous ceiling: header + schema root + the user b-tree, well under 64 KB.
    assert.ok(maxEnd <= 64 * 1024, `read up to ${maxEnd} bytes`);
});

test('countTableRows counts rows in a single-leaf table, including empty tables', async () => {
    assert.equal(await count(makeDb(512, 2).schemaLeaf(1, 'user', 2).leafTable(2, 5).buffer), 5);
    assert.equal(await count(makeDb(512, 2).schemaLeaf(1, 'user', 2).leafTable(2, 0).buffer), 0);
});

test('countTableRows sums rows across an interior table b-tree', async () => {
    // rootpage 2 is interior with leaf children 3 and 4 plus rightmost leaf 5.
    const db = makeDb(512, 5).schemaLeaf(1, 'user', 2).interiorTable(2, [3, 4], 5).leafTable(3, 2).leafTable(4, 3).leafTable(5, 4).buffer;
    assert.equal(await count(db), 2 + 3 + 4);
});

test('countTableRows follows an interior sqlite_master b-tree to the table', async () => {
    // Page 1 schema is interior; the matching row lives on leaf schema page 2.
    const db = makeDb(512, 3).schemaInterior(1, [2], 2).schemaLeaf(2, 'user', 3).leafTable(3, 7).buffer;
    assert.equal(await count(db), 7);
});

test('countTableRows rejects invalid or unsupported page sizes', async () => {
    // Page size lives in header bytes 16-17; anything under 512 (0 special-cases
    // to nothing here) is rejected. 1 special-cases to 65536.
    for (const raw of [0, 2, 256, 511]) {
        const buf = new Uint8Array(1536);
        for (let i = 0; i < MAGIC.length; i++) buf[i] = MAGIC.charCodeAt(i);
        new DataView(buf.buffer).setUint16(16, raw);
        assert.equal(await count(buf), null, `raw page size ${raw}`);
    }
});

test('countTableRows tolerates a non-power-of-two page size (pins current leniency)', async () => {
    // needs review: SQLite requires a power-of-two page size, but the reader only
    // rejects sizes < 512 and otherwise trusts the header. A structurally valid db
    // with page size 1000 is read as-is rather than rejected.
    const db = makeDb(1000, 2).schemaLeaf(1, 'user', 2).leafTable(2, 6).buffer;
    assert.equal(await count(db), 6);
});

test('countTableRows handles boundary page size 65536 (encoded as 1)', async () => {
    const db = makeDb(65536, 2).schemaLeaf(1, 'user', 2).leafTable(2, 4).buffer;
    assert.equal(await count(db), 4);
});

test('countTableRows returns null when the root page points past end of file', async () => {
    // Schema says the table is on page 999, but the file is one page long.
    const db = makeDb(512, 1).schemaLeaf(1, 'user', 999).buffer;
    assert.equal(await count(db), null);
});

test('countTableRows returns null when the file is truncated before a declared page', async () => {
    // Valid schema pointing at page 2, but only page 1 is present in the buffer.
    const db = makeDb(512, 2).schemaLeaf(1, 'user', 2).leafTable(2, 3).buffer;
    assert.equal(await count(db.subarray(0, 512 + 8)), null);
});

test('countTableRows returns null on a self-referencing table interior page without hanging', async () => {
    // regression: a self-referencing interior page with fan-out >= 2 used to fan
    // the recursion out to ~2^64 calls before the depth guard tripped, hanging the
    // parser. Cycle detection must short-circuit it to null.
    const db = makeDb(512, 2).schemaLeaf(1, 'user', 2).interiorTable(2, [2], 2).buffer;
    assert.equal(await count(db), null);
});

test('countTableRows returns null on a self-referencing sqlite_master interior page without hanging', async () => {
    // regression: same exponential-blowup cycle, but in the schema b-tree walk.
    const db = makeDb(512, 1).schemaInterior(1, [1], 1).buffer;
    assert.equal(await count(db), null);
});

test('countKoboUsers reads the user count from the device, null when missing', async () => {
    const signedIn = fixture('kobo-reader-signed-in.sqlite');
    const factory = fixture('kobo-reader-factory-reset.sqlite');

    // Mirrors KoboDevice.readFileRange: slices the file, null when it's missing.
    const deviceWith = (bytes) => ({
        async readFileRange(_path, offset, length) {
            return bytes ? bytes.subarray(offset, offset + length) : null;
        },
    });

    assert.equal(await countKoboUsers(deviceWith(signedIn)), 1);
    assert.equal(await countKoboUsers(deviceWith(factory)), 0);
    assert.equal(await countKoboUsers(deviceWith(null)), null);
    assert.equal(await countKoboUsers(deviceWith(new Uint8Array(0))), null);
});
