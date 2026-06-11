// Minimal read-only SQLite reader: counts the rows in a single table by walking
// the database file's b-tree directly, with no SQL engine and no dependency.
//
// We only ever need to answer "does the `user` table have any rows" — that's how
// we tell a Kobo signed into an account from a factory-reset one — so pulling in
// a full SQLite/WASM build (hundreds of KB) would be wildly oversized for the
// job. Everything here is read-only and best-effort: any malformed or
// unsupported input returns null so the caller can treat the result as unknown.
//
// SQLite file format reference: https://www.sqlite.org/fileformat2.html

const HEADER_MAGIC = 'SQLite format 3\0';

const LEAF_TABLE = 0x0d;
const INTERIOR_TABLE = 0x05;

// Read a SQLite varint (big-endian, 1–9 bytes; the high bit of each of the
// first 8 bytes is a continuation flag, and a 9th byte contributes all 8 bits).
// Returns [value, bytesConsumed]. Values here are small, so a Number is fine.
function readVarint(view, offset) {
    let result = 0;
    for (let i = 0; i < 9; i++) {
        const byte = view.getUint8(offset + i);
        if (i === 8) return [result * 256 + byte, 9];
        result = result * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return [result, i + 1];
    }
    return [result, 9];
}

// Byte length of a value stored with the given record serial type.
function serialTypeSize(type) {
    if (type >= 12) return Math.floor((type - 12) / 2); // text/blob
    return [0, 1, 2, 3, 4, 6, 8, 8, 0, 0][type] ?? 0;   // null/ints/float/0/1
}

function readText(view, offset, serialType) {
    if (serialType < 13 || serialType % 2 === 0) return null;
    const length = (serialType - 13) / 2;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    return new TextDecoder().decode(bytes);
}

function readInteger(view, offset, serialType) {
    if (serialType === 8) return 0;
    if (serialType === 9) return 1;
    const size = serialTypeSize(serialType);
    if (size === 0 || size > 6) return null;
    let value = view.getUint8(offset);
    if (value & 0x80) value -= 0x100; // sign-extend the first byte
    for (let i = 1; i < size; i++) value = value * 256 + view.getUint8(offset + i);
    return value;
}

// A page's b-tree header starts after the 100-byte file header on page 1, and at
// the very start of every other page. Pages are numbered from 1.
function pageStart(pageNum, pageSize) {
    return (pageNum - 1) * pageSize;
}
function headerStart(pageNum, pageSize) {
    return pageStart(pageNum, pageSize) + (pageNum === 1 ? 100 : 0);
}

// Parse one sqlite_master leaf cell. Returns the table's rootpage when the row
// describes `type='table' AND name=tableName`, else null. sqlite_master columns
// are (type, name, tbl_name, rootpage, sql); only the long `sql` column can
// overflow a page, and it comes last, so the columns we read are always present
// in the in-page payload.
function matchMasterRow(view, cellOffset, tableName) {
    let pos = cellOffset;
    pos += readVarint(view, pos)[1]; // payload size (unused)
    pos += readVarint(view, pos)[1]; // rowid

    const recordStart = pos;
    const [headerSize, headerLen] = readVarint(view, recordStart);
    let typePos = recordStart + headerLen;
    const headerEnd = recordStart + headerSize;

    const serialTypes = [];
    while (typePos < headerEnd && serialTypes.length < 4) {
        const [type, used] = readVarint(view, typePos);
        serialTypes.push(type);
        typePos += used;
    }
    if (serialTypes.length < 4) return null;

    let valueOffset = recordStart + headerSize;
    const offsets = [];
    for (const type of serialTypes) {
        offsets.push(valueOffset);
        valueOffset += serialTypeSize(type);
    }

    if (readText(view, offsets[0], serialTypes[0]) !== 'table') return null;
    if (readText(view, offsets[1], serialTypes[1]) !== tableName) return null;
    return readInteger(view, offsets[3], serialTypes[3]);
}

// Walk the sqlite_master table b-tree (rooted at page 1) to find a table's
// rootpage. Interior pages are recursed; leaf cells are matched.
function findTableRootpage(view, pageSize, tableName, pageNum = 1, depth = 0) {
    if (depth > 64) return null;
    const header = headerStart(pageNum, pageSize);
    const type = view.getUint8(header);
    const cells = view.getUint16(header + 3);
    const base = pageStart(pageNum, pageSize);

    if (type === LEAF_TABLE) {
        const pointers = header + 8;
        for (let i = 0; i < cells; i++) {
            const cell = base + view.getUint16(pointers + i * 2);
            const rootpage = matchMasterRow(view, cell, tableName);
            if (rootpage !== null) return rootpage;
        }
        return null;
    }
    if (type === INTERIOR_TABLE) {
        const pointers = header + 12;
        for (let i = 0; i < cells; i++) {
            const child = view.getUint32(base + view.getUint16(pointers + i * 2));
            const found = findTableRootpage(view, pageSize, tableName, child, depth + 1);
            if (found !== null) return found;
        }
        return findTableRootpage(view, pageSize, tableName, view.getUint32(header + 8), depth + 1);
    }
    return null;
}

// Sum the row count of a table b-tree by adding up the cell counts of its leaf
// pages (recursing through interior pages).
function countBtreeRows(view, pageSize, pageNum, depth = 0) {
    if (depth > 64) return null;
    const header = headerStart(pageNum, pageSize);
    const type = view.getUint8(header);
    const cells = view.getUint16(header + 3);

    if (type === LEAF_TABLE) return cells;
    if (type !== INTERIOR_TABLE) return null;

    const base = pageStart(pageNum, pageSize);
    const pointers = header + 12;
    let total = 0;
    for (let i = 0; i < cells; i++) {
        const child = view.getUint32(base + view.getUint16(pointers + i * 2));
        const sub = countBtreeRows(view, pageSize, child, depth + 1);
        if (sub === null) return null;
        total += sub;
    }
    const rightmost = countBtreeRows(view, pageSize, view.getUint32(header + 8), depth + 1);
    if (rightmost === null) return null;
    return total + rightmost;
}

/**
 * Count the rows in `tableName` within a SQLite database given as bytes.
 * Returns null if the file isn't a SQLite database, the table doesn't exist, or
 * anything about the format is unexpected — callers treat null as "unknown".
 *
 * @param {Uint8Array} bytes
 * @param {string} tableName
 * @returns {number|null}
 */
export function countTableRows(bytes, tableName) {
    try {
        if (!bytes || bytes.length < 100) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        for (let i = 0; i < HEADER_MAGIC.length; i++) {
            if (view.getUint8(i) !== HEADER_MAGIC.charCodeAt(i)) return null;
        }

        const rawPageSize = view.getUint16(16);
        const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
        if (pageSize < 512 || bytes.length < pageSize) return null;

        const rootpage = findTableRootpage(view, pageSize, tableName);
        if (rootpage === null || rootpage < 1) return null;

        return countBtreeRows(view, pageSize, rootpage);
    } catch {
        return null;
    }
}
