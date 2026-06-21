import { buildTarGz, parseTarGz } from '../nickelmenu/archive.js';

const ADDITIONAL_FILE_MODE = 0o777;
const ENCRYPTED_FONT_DIR = 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts';
const FONT_EXTENSIONS = new Set(['.otf', '.ttf', '.ttc']);
const textEncoder = new TextEncoder();

function fileExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function defaultAdditionalFileDestination(fileName) {
    const name = String(fileName || '')
        .split(/[\\/]/)
        .pop();
    if (!name) return '';
    if (FONT_EXTENSIONS.has(fileExtension(name))) {
        return `${ENCRYPTED_FONT_DIR}/${name}`;
    }
    return name;
}

export function normalizeAdditionalFileDestination(destination) {
    return String(destination || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '');
}

export function validateAdditionalFileDestination(destination) {
    const path = normalizeAdditionalFileDestination(destination);
    if (!path) return { ok: false, path, message: 'Enter a destination path.' };
    if (path.startsWith('/')) return { ok: false, path, message: 'Destination paths must not start with /.' };
    if (path.endsWith('/')) return { ok: false, path, message: 'Destination paths must name a file, not a folder.' };
    if (/[\x00-\x1f\x7f]/.test(path)) {
        return { ok: false, path, message: 'Destination paths must not contain control characters.' };
    }
    const parts = path.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
        return { ok: false, path, message: 'Destination paths must not contain empty, . or .. segments.' };
    }
    if (!canEncodeTarPath(path)) {
        return { ok: false, path, message: 'Destination path is too long for the KoboRoot.tgz tar format.' };
    }
    return { ok: true, path, message: '' };
}

function byteLength(value) {
    return textEncoder.encode(value).length;
}

function canEncodeTarPath(path) {
    if (byteLength(path) <= 100) return true;

    let slash = path.lastIndexOf('/');
    while (slash > 0) {
        const prefix = path.slice(0, slash);
        const name = path.slice(slash + 1);
        if (byteLength(prefix) <= 155 && byteLength(name) <= 100) return true;
        slash = path.lastIndexOf('/', slash - 1);
    }
    return false;
}

export async function readAdditionalFileEntry(item) {
    const validation = validateAdditionalFileDestination(item.destination);
    if (!validation.ok) throw new Error(validation.message);
    const data = new Uint8Array(await item.file.arrayBuffer());
    return {
        path: validation.path,
        data,
        mode: ADDITIONAL_FILE_MODE,
        sourceName: item.file.name,
        size: data.length,
    };
}

export async function mergeAdditionalFilesIntoTgz(tgzBytes, additionalEntries) {
    if (!additionalEntries.length) return tgzBytes;

    const existing = await parseTarGz(tgzBytes);
    const seen = new Set(existing.map((entry) => entry.path));
    for (const entry of additionalEntries) {
        if (seen.has(entry.path)) {
            throw new Error(`Additional file destination already exists: ${entry.path}`);
        }
        seen.add(entry.path);
    }

    return buildTarGz([...existing, ...additionalEntries]);
}
