const TAR_BLOCK_SIZE = 512;
const textDecoder = new TextDecoder();

async function ungzip(bytes) {
    if (typeof globalThis.DecompressionStream !== 'function') {
        throw new Error('This browser does not support gzip decompression.');
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new globalThis.DecompressionStream('gzip'));
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

    for (let offset = 0; offset + TAR_BLOCK_SIZE <= bytes.length;) {
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
