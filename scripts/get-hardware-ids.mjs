import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

import { parseTar } from '../src/js/nickelmenu/archive.js';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firmwareConfig = require('../tests/e2e/config/firmware-config.js');

const defaultOutput = 'tmp/hardware-ids.json';
const uuidPattern = /^00000000-0000-0000-0000-000000000\d{3}$/;
const modelPattern = /^(Kobo|tolino) /;
const productCodePattern = /^[A-Za-z][A-Za-z0-9]+$/;

function usage() {
    console.log(`Usage: npm run get-hardware-ids -- [options]

Extracts the reliable hardware table from libnickel.so.1.0.0 inside the cached
test firmware zips. The output is standalone firmware evidence: UUID, firmware
model, product code, platform, source firmware, and table offsets.

Options:
  --firmware <path>   Inspect an additional firmware ZIP. Can be repeated.
  --output <path>     Output JSON path. Default: ${defaultOutput}
  --help              Show this help text.
`);
}

function parseArgs(argv) {
    const opts = {
        firmware: [],
        output: defaultOutput,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const readValue = (name) => {
            const value = argv[++i];
            if (!value) throw new Error(`${name} requires a value`);
            return value;
        };

        if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg === '--firmware') {
            opts.firmware.push(resolve(repoRoot, readValue(arg)));
        } else if (arg === '--output') {
            opts.output = readValue(arg);
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    return opts;
}

function configuredFirmwarePaths() {
    return [firmwareConfig.primary, firmwareConfig.secondary].map((entry) => ({
        version: entry.version,
        path: join(repoRoot, 'tests/e2e/cached_assets', `kobo-update-${entry.version}.zip`),
    }));
}

async function readKoboRootTgz(firmwarePath) {
    const zip = await JSZip.loadAsync(await readFile(firmwarePath));
    const entry = zip.file('KoboRoot.tgz');
    if (!entry) throw new Error(`KoboRoot.tgz not found in ${firmwarePath}`);
    return new Uint8Array(await entry.async('nodebuffer'));
}

async function readLibnickel(firmwarePath) {
    const koboRootTgz = await readKoboRootTgz(firmwarePath);
    const entries = parseTar(gunzipSync(koboRootTgz));
    const libnickel = entries.find((entry) => entry.path === 'usr/local/Kobo/libnickel.so.1.0.0');
    if (!libnickel) throw new Error(`usr/local/Kobo/libnickel.so.1.0.0 not found in ${firmwarePath}`);
    return libnickel.data;
}

function cStringAt(bytes, offset) {
    if (offset <= 0 || offset >= bytes.length) return null;

    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    if (end === offset) return null;

    const value = Buffer.from(bytes.subarray(offset, end)).toString('ascii');
    if (!/^[\x20-\x7e]+$/.test(value)) return null;
    return value;
}

function extractDeviceTableRows(bytes, source) {
    const rows = [];
    const seen = new Set();

    for (let offset = 0; offset <= bytes.length - 16; offset += 4) {
        const productOffset = bytes.readUInt32LE(offset);
        const platformOffset = bytes.readUInt32LE(offset + 4);
        const uuidOffset = bytes.readUInt32LE(offset + 8);
        const modelOffset = bytes.readUInt32LE(offset + 12);

        const uuid = cStringAt(bytes, uuidOffset);
        if (!uuidPattern.test(uuid || '')) continue;

        const productCode = cStringAt(bytes, productOffset);
        const platform = cStringAt(bytes, platformOffset);
        const model = cStringAt(bytes, modelOffset);
        if (!productCodePattern.test(productCode || '')) continue;
        if (!productCodePattern.test(platform || '')) continue;
        if (!modelPattern.test(model || '')) continue;

        const key = `${offset}:${uuid}`;
        if (seen.has(key)) continue;
        seen.add(key);

        rows.push({
            uuid,
            model,
            product: productCode,
            platform,
            tableOffset: offset,
            stringOffsets: {
                product: productOffset,
                platform: platformOffset,
                uuid: uuidOffset,
                model: modelOffset,
            },
            source: {
                firmwareVersion: source.version,
                firmwarePath: source.path,
            },
        });
    }

    return rows;
}

async function extractHardwareIds(source) {
    const bytes = await readLibnickel(source.path);
    return extractDeviceTableRows(bytes, source);
}

function mergeRows(rows) {
    const byUuid = new Map();

    for (const row of rows) {
        if (!byUuid.has(row.uuid)) {
            byUuid.set(row.uuid, {
                uuid: row.uuid,
                models: new Set(),
                products: new Set(),
                platforms: new Set(),
                occurrences: [],
            });
        }

        const merged = byUuid.get(row.uuid);
        merged.models.add(row.model);
        merged.products.add(row.product);
        merged.platforms.add(row.platform);
        merged.occurrences.push({
            model: row.model,
            product: row.product,
            platform: row.platform,
            tableOffset: row.tableOffset,
            stringOffsets: row.stringOffsets,
            source: row.source,
        });
    }

    return [...byUuid.values()]
        .map((row) => ({
            uuid: row.uuid,
            model: firstSorted(row.models),
            models: [...row.models].sort(),
            product: firstSorted(row.products),
            products: [...row.products].sort(),
            platform: firstSorted(row.platforms),
            platforms: [...row.platforms].sort(),
            occurrences: row.occurrences.sort((a, b) => {
                const versionCompare = String(a.source.firmwareVersion || '').localeCompare(String(b.source.firmwareVersion || ''));
                return versionCompare || a.tableOffset - b.tableOffset;
            }),
        }))
        .sort((a, b) => a.uuid.localeCompare(b.uuid));
}

function firstSorted(values) {
    return [...values].sort()[0] || null;
}

function printTable(rows, sources, outputPath) {
    console.log('Firmware sources:');
    for (const source of sources) {
        console.log(`  ${source.version || 'manual'}  ${source.path}`);
    }
    console.log('');

    const widths = {
        uuid: 36,
        model: Math.max('Firmware model'.length, ...rows.map((row) => row.models.join(', ').length)),
        product: Math.max('Product'.length, ...rows.map((row) => row.products.join(', ').length)),
        platform: Math.max('Platform'.length, ...rows.map((row) => row.platforms.join(', ').length)),
        versions: Math.max('Firmware'.length, ...rows.map((row) => firmwareVersions(row).join(', ').length)),
    };

    const line = [
        'UUID'.padEnd(widths.uuid),
        'Firmware model'.padEnd(widths.model),
        'Product'.padEnd(widths.product),
        'Platform'.padEnd(widths.platform),
        'Firmware'.padEnd(widths.versions),
    ].join('  ');
    console.log(line);
    console.log('-'.repeat(line.length));

    for (const row of rows) {
        console.log(
            [
                row.uuid.padEnd(widths.uuid),
                row.models.join(', ').padEnd(widths.model),
                row.products.join(', ').padEnd(widths.product),
                row.platforms.join(', ').padEnd(widths.platform),
                firmwareVersions(row).join(', ').padEnd(widths.versions),
            ].join('  '),
        );
    }

    console.log('');
    console.log(`Wrote ${outputPath}`);
}

function firmwareVersions(row) {
    return [...new Set(row.occurrences.map((occurrence) => occurrence.source.firmwareVersion || 'manual'))].sort();
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        usage();
        return;
    }

    const sources = configuredFirmwarePaths();
    for (const firmwarePath of opts.firmware) {
        sources.push({ version: null, path: firmwarePath });
    }

    const missingSources = sources.filter((source) => !existsSync(source.path));
    if (missingSources.length) {
        throw new Error(
            'Missing firmware cache files:\n' +
                missingSources.map((source) => `  - ${source.path}`).join('\n') +
                '\nRun npm test and accept the firmware download prompt, or pass --firmware <zip>.',
        );
    }

    const extracted = [];
    for (const source of sources) {
        extracted.push(...(await extractHardwareIds(source)));
    }

    const hardwareIds = mergeRows(extracted);
    const output = {
        generatedAt: new Date().toISOString(),
        generatedBy: 'scripts/get-hardware-ids.mjs',
        sources,
        hardwareIds,
    };

    const outputPath = resolve(repoRoot, opts.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');

    printTable(hardwareIds, sources, opts.output);
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
