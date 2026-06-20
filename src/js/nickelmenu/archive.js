const TAR_BLOCK_SIZE = 512;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

async function ungzip(bytes) {
    if (typeof globalThis.DecompressionStream !== 'function') {
        throw new Error('This browser does not support gzip decompression.');
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new globalThis.DecompressionStream('gzip'));
    return new Uint8Array(await new globalThis.Response(stream).arrayBuffer());
}

async function gzip(bytes) {
    if (typeof globalThis.CompressionStream !== 'function') {
        throw new Error('This browser does not support gzip compression.');
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new globalThis.CompressionStream('gzip'));
    return new Uint8Array(await new globalThis.Response(stream).arrayBuffer());
}

function isZeroBlock(bytes, offset) {
    for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
        if (bytes[offset + i] !== 0) return false;
    }
    return true;
}

function readString(bytes, offset, length) {
    const field = bytes.subarray(offset, offset + length);
    const nul = field.indexOf(0);
    return textDecoder.decode(nul === -1 ? field : field.subarray(0, nul)).trim();
}

function readOctal(bytes, offset, length) {
    const value = readString(bytes, offset, length).replace(/\0/g, '').trim();
    return value ? parseInt(value, 8) : 0;
}

function normalizeTarPath(path) {
    const normalized = path.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (!normalized) return null;
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error(`Unsafe tar path: ${path}`);
    }
    return normalized;
}

export function parseTar(bytes) {
    const files = [];

    for (let offset = 0; offset + TAR_BLOCK_SIZE <= bytes.length; ) {
        if (isZeroBlock(bytes, offset)) break;

        const name = readString(bytes, offset, 100);
        const prefix = readString(bytes, offset + 345, 155);
        const path = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
        const size = readOctal(bytes, offset + 124, 12);
        const type = String.fromCharCode(bytes[offset + 156] || 0);
        const dataStart = offset + TAR_BLOCK_SIZE;
        const dataEnd = dataStart + size;

        if (dataEnd > bytes.length) {
            throw new Error(`Truncated tar entry: ${path || name}`);
        }

        if ((type === '0' || type === '\0') && path) {
            files.push({
                path,
                mode: readOctal(bytes, offset + 100, 8),
                data: bytes.slice(dataStart, dataEnd),
            });
        }

        offset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    }

    return files;
}

export async function parseTarGz(bytes) {
    return parseTar(await ungzip(bytes));
}

const DEFAULT_FILE_MODE = 0o644;

function writeOctal(block, offset, length, value) {
    // Tar numeric fields are null-terminated octal: write `length - 1` digits
    // then a trailing NUL.
    const digits = (value >>> 0).toString(8).padStart(length - 1, '0');
    for (let i = 0; i < length - 1; i++) {
        block[offset + i] = digits.charCodeAt(i);
    }
    block[offset + length - 1] = 0;
}

function writeAscii(block, offset, length, value) {
    const encoded = textEncoder.encode(value);
    for (let i = 0; i < encoded.length && i < length; i++) {
        block[offset + i] = encoded[i];
    }
}

/**
 * Split a tar path into the 100-byte `name` field plus the 155-byte ustar
 * `prefix` field, so paths longer than 100 bytes still encode losslessly. Paths
 * that fit go entirely in `name` (prefix empty). Throws if no split keeps both
 * within bounds — none of the bundled mods come close to that limit.
 */
function splitTarPath(path) {
    if (textEncoder.encode(path).length <= 100) return { name: path, prefix: '' };

    let slash = path.lastIndexOf('/');
    while (slash > 0) {
        const prefix = path.slice(0, slash);
        const name = path.slice(slash + 1);
        if (textEncoder.encode(prefix).length <= 155 && textEncoder.encode(name).length <= 100) {
            return { name, prefix };
        }
        slash = path.lastIndexOf('/', slash - 1);
    }
    throw new Error(`Tar path too long to encode: ${path}`);
}

function buildTarHeader(entry) {
    const block = new Uint8Array(TAR_BLOCK_SIZE);
    const { name, prefix } = splitTarPath(entry.path);

    writeAscii(block, 0, 100, name);
    writeOctal(block, 100, 8, entry.mode ?? DEFAULT_FILE_MODE);
    writeOctal(block, 108, 8, 0); // uid
    writeOctal(block, 116, 8, 0); // gid
    writeOctal(block, 124, 12, entry.data.length);
    writeOctal(block, 136, 12, entry.mtime ?? Math.floor(Date.now() / 1000));
    block[156] = '0'.charCodeAt(0); // typeflag: normal file
    writeAscii(block, 257, 6, 'ustar'); // magic "ustar\0" (NUL already present)
    block[263] = '0'.charCodeAt(0); // version "00"
    block[264] = '0'.charCodeAt(0);
    writeAscii(block, 265, 32, 'root'); // uname
    writeAscii(block, 297, 32, 'root'); // gname
    writeAscii(block, 345, 155, prefix);

    // Checksum is computed with the checksum field filled with spaces, then
    // stored as six octal digits, a NUL, and a space.
    for (let i = 148; i < 156; i++) block[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK_SIZE; i++) sum += block[i];
    const checksum = sum.toString(8).padStart(6, '0');
    for (let i = 0; i < 6; i++) block[148 + i] = checksum.charCodeAt(i);
    block[154] = 0;
    block[155] = 0x20;

    return block;
}

/**
 * Build an uncompressed USTAR archive from `{ path, data, mode?, mtime? }`
 * entries. Each entry becomes a 512-byte header plus its NUL-padded data; the
 * archive ends with the conventional two zero blocks. Inverse of `parseTar`.
 */
export function buildTar(entries) {
    const blocks = [];
    let total = 0;
    const push = (block) => {
        blocks.push(block);
        total += block.length;
    };

    for (const entry of entries) {
        push(buildTarHeader(entry));
        push(entry.data);
        const padding = (TAR_BLOCK_SIZE - (entry.data.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
        if (padding) push(new Uint8Array(padding));
    }
    push(new Uint8Array(TAR_BLOCK_SIZE * 2)); // end-of-archive marker

    const out = new Uint8Array(total);
    let offset = 0;
    for (const block of blocks) {
        out.set(block, offset);
        offset += block.length;
    }
    return out;
}

/** Build a gzip-compressed tar (`.tar.gz`/`.tgz`) from tar entries. */
export async function buildTarGz(entries) {
    return gzip(buildTar(entries));
}
