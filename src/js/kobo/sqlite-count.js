// Minimal read-only SQLite reader: counts the rows in a single table by walking
// the database file's b-tree directly, with no SQL engine and no dependency.
//
// We only ever need to answer "does the `user` table have any rows" — that's how
// we tell a Kobo signed into an account from a factory-reset one — so pulling in
// a full SQLite/WASM build (hundreds of KB) would be wildly oversized for the
// job. Everything here is read-only and best-effort: any malformed or
// unsupported input returns null so the caller can treat the result as unknown.
//
// Pages are fetched on demand through a `readRange(offset, length)` callback, so
// counting `user` rows reads only the header, the schema b-tree, and the table's
// own (tiny) b-tree — a handful of KB — instead of loading the whole database
// (KoboReader.sqlite is routinely hundreds of MB). Offsets within a page are
// page-relative, matching the SQLite cell-pointer convention.
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
    return [0, 1, 2, 3, 4, 6, 8, 8, 0, 0][type] ?? 0; // null/ints/float/0/1
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
// the very start of every other page. Pages are numbered from 1. Cell pointers
// and the cell offsets they hold are relative to the start of the page, so a
// per-page DataView is indexed directly.
function btreeHeaderOffset(pageNum) {
    return pageNum === 1 ? 100 : 0;
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
// rootpage. Interior pages are recursed; leaf cells are matched. Pages are
// fetched lazily through `getPage`.
async function findTableRootpage(getPage, tableName, pageNum = 1, depth = 0, visited = new Set()) {
    // A b-tree is a tree, so any page seen twice in one walk means the file's
    // page pointers form a cycle. Bail rather than recurse: without this guard a
    // self-referencing interior page with fan-out >= 2 fans out to ~2^depth calls
    // before the depth limit trips, which hangs on hostile input.
    if (depth > 64 || visited.has(pageNum)) return null;
    visited.add(pageNum);
    const view = await getPage(pageNum);
    if (!view) return null;
    const header = btreeHeaderOffset(pageNum);
    const type = view.getUint8(header);
    const cells = view.getUint16(header + 3);

    if (type === LEAF_TABLE) {
        const pointers = header + 8;
        for (let i = 0; i < cells; i++) {
            const cell = view.getUint16(pointers + i * 2);
            const rootpage = matchMasterRow(view, cell, tableName);
            if (rootpage !== null) return rootpage;
        }
        return null;
    }
    if (type === INTERIOR_TABLE) {
        const pointers = header + 12;
        for (let i = 0; i < cells; i++) {
            const child = view.getUint32(view.getUint16(pointers + i * 2));
            const found = await findTableRootpage(getPage, tableName, child, depth + 1, visited);
            if (found !== null) return found;
        }
        return findTableRootpage(getPage, tableName, view.getUint32(header + 8), depth + 1, visited);
    }
    return null;
}

// Sum the row count of a table b-tree by adding up the cell counts of its leaf
// pages (recursing through interior pages). Only b-tree page headers and cell
// pointers are read, never the cell payloads, so this stays cheap.
async function countBtreeRows(getPage, pageNum, depth = 0, visited = new Set()) {
    // See findTableRootpage: a page revisited within one walk is a pointer cycle.
    // Stop instead of recursing so a self-referencing interior page can't fan the
    // recursion out exponentially and hang.
    if (depth > 64 || visited.has(pageNum)) return null;
    visited.add(pageNum);
    const view = await getPage(pageNum);
    if (!view) return null;
    const header = btreeHeaderOffset(pageNum);
    const type = view.getUint8(header);
    const cells = view.getUint16(header + 3);

    if (type === LEAF_TABLE) return cells;
    if (type !== INTERIOR_TABLE) return null;

    const pointers = header + 12;
    let total = 0;
    for (let i = 0; i < cells; i++) {
        const child = view.getUint32(view.getUint16(pointers + i * 2));
        const sub = await countBtreeRows(getPage, child, depth + 1, visited);
        if (sub === null) return null;
        total += sub;
    }
    const rightmost = await countBtreeRows(getPage, view.getUint32(header + 8), depth + 1, visited);
    if (rightmost === null) return null;
    return total + rightmost;
}

function hasHeaderMagic(view) {
    for (let i = 0; i < HEADER_MAGIC.length; i++) {
        if (view.getUint8(i) !== HEADER_MAGIC.charCodeAt(i)) return false;
    }
    return true;
}

/**
 * Count the rows in `tableName` within a SQLite database read through a
 * `readRange(offset, length)` callback returning a Uint8Array (or null/short at
 * EOF or on error). Reads only the pages it needs, so a huge database costs a
 * few KB. Returns null if the source isn't a SQLite database, the table doesn't
 * exist, or anything about the format is unexpected — callers treat null as
 * "unknown".
 *
 * @param {(offset: number, length: number) => Promise<Uint8Array|null>} readRange
 * @param {string} tableName
 * @returns {Promise<number|null>}
 */
export async function countTableRows(readRange, tableName) {
    try {
        const headerBytes = await readRange(0, 100);
        if (!headerBytes || headerBytes.length < 100) return null;
        const headerView = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
        if (!hasHeaderMagic(headerView)) return null;

        const rawPageSize = headerView.getUint16(16);
        const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
        if (pageSize < 512) return null;

        // Cache pages within a single count: the schema root (page 1) is revisited
        // and a malformed file could otherwise re-read the same page repeatedly.
        const pageCache = new Map();
        async function getPage(pageNum) {
            if (pageNum < 1) return null;
            if (pageCache.has(pageNum)) return pageCache.get(pageNum);
            const bytes = await readRange((pageNum - 1) * pageSize, pageSize);
            // Must hold at least the b-tree header (and, for interior pages, the
            // right-most pointer) we index into.
            const minLength = btreeHeaderOffset(pageNum) + 12;
            const view = bytes && bytes.length >= minLength ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
            pageCache.set(pageNum, view);
            return view;
        }

        const rootpage = await findTableRootpage(getPage, tableName);
        if (rootpage === null || rootpage < 1) return null;

        return await countBtreeRows(getPage, rootpage);
    } catch {
        return null;
    }
}

/**
 * Adapt an in-memory Uint8Array to the `readRange` callback `countTableRows`
 * expects. Handy for tests and for callers that already hold the whole buffer;
 * device code should pass a real range reader instead so it never loads the
 * entire file.
 *
 * @param {Uint8Array|null} bytes
 * @returns {(offset: number, length: number) => Promise<Uint8Array|null>}
 */
export function bytesRange(bytes) {
    return async function readRange(offset, length) {
        if (!bytes) return null;
        return bytes.subarray(offset, offset + length);
    };
}
