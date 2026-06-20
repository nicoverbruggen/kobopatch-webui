// Developer-only, manually-run interoperability tool. Not part of the shipped
// app and not invoked at runtime. It queries Kobo's public, unauthenticated
// UpgradeCheck endpoint (api.kobobooks.com) the same way a device does, in order
// to map hardware UUIDs to firmware channels. Run it sparingly and do not abuse
// the public API, even though it is being served via Cloudflare's CDN.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = 'tmp/hardware-ids.json';
const defaultOutput = 'tmp/hardware-resolved.js';
const defaultApiBase = 'https://api.kobobooks.com';
const defaultAffiliate = 'kobo';
const defaultVersion = '0.0';
const defaultSerial = 'N000000000000';

function usage() {
    console.log(`Usage: npm run resolve-hardware-ids -- [options]

Reads ${defaultInput}, resolves channels through Kobo's UpgradeCheck endpoint,
and writes a reviewable version.js-shaped proposal.

Options:
  --input <path>       Hardware evidence JSON. Default: ${defaultInput}
  --output <path>      Generated JS proposal. Default: ${defaultOutput}
  --api-base <url>     UpgradeCheck API base. Default: ${defaultApiBase}
  --affiliate <name>   UpgradeCheck affiliate. Default: ${defaultAffiliate}
  --version <version>  Version sent to UpgradeCheck. Default: ${defaultVersion}
  --serial <serial>    Serial sent to UpgradeCheck. Default: ${defaultSerial}
  --help               Show this help text.
`);
}

function parseArgs(argv) {
    const opts = {
        input: defaultInput,
        output: defaultOutput,
        apiBase: defaultApiBase,
        affiliate: defaultAffiliate,
        version: defaultVersion,
        serial: defaultSerial,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const readValue = name => {
            const value = argv[++i];
            if (!value) throw new Error(`${name} requires a value`);
            return value;
        };

        if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg === '--input') {
            opts.input = readValue(arg);
        } else if (arg === '--output') {
            opts.output = readValue(arg);
        } else if (arg === '--api-base') {
            opts.apiBase = readValue(arg).replace(/\/+$/, '');
        } else if (arg === '--affiliate') {
            opts.affiliate = readValue(arg);
        } else if (arg === '--version') {
            opts.version = readValue(arg);
        } else if (arg === '--serial') {
            opts.serial = readValue(arg);
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    return opts;
}

async function readJson(path) {
    return JSON.parse(await readFile(resolve(repoRoot, path), 'utf8'));
}

function upgradeCheckUrl(opts, uuid) {
    const path = [
        '1.0',
        'UpgradeCheck',
        'Device',
        encodeURIComponent(uuid),
        encodeURIComponent(opts.affiliate),
        encodeURIComponent(opts.version),
        encodeURIComponent(opts.serial),
    ].join('/');

    return `${opts.apiBase}/${path}`;
}

function firmwareChannelFromUrl(url) {
    return String(url || '').match(/\/firmwares\/(kobo\d+)\//)?.[1] || null;
}

function firmwareVersionFromUrl(url) {
    return String(url || '').match(/\/kobo-update-([0-9.]+(?:-s)?)(?:-TF[0-9]+|-TouchFW-[0-9]+)?\.zip(?:[?#].*)?$/)?.[1] || null;
}

// Kobo's UpgradeCheck endpoint sits behind Cloudflare, which 500s requests made
// with undici's (global fetch) TLS fingerprint. Node's https client is accepted,
// so we use it directly instead of routing through a third-party CORS proxy.
function fetchJson(url) {
    return new Promise((resolvePromise, reject) => {
        const req = httpsGet(url, { headers: { Accept: '*/*' } }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`${res.statusCode} ${res.statusMessage || ''} from ${url}`.trim()));
                    return;
                }
                try {
                    resolvePromise(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
                }
            });
        });
        req.on('error', reject);
    });
}

async function resolveChannel(row, opts) {
    const url = upgradeCheckUrl(opts, row.uuid);
    const data = await fetchJson(url);
    const channel = firmwareChannelFromUrl(data.UpgradeURL);

    return {
        channel,
        source: channel ? 'UpgradeCheck' : null,
        upgradeType: data.UpgradeType ?? null,
        upgradeUrl: data.UpgradeURL || null,
        firmwareVersion: firmwareVersionFromUrl(data.UpgradeURL),
        request: {
            affiliate: opts.affiliate,
            version: opts.version,
            serial: opts.serial,
        },
    };
}

function jsString(value) {
    if (value === null || value === undefined) return 'null';
    return JSON.stringify(value);
}

function renderProposal({ hardwareIds, resolvedRows, opts }) {
    const proposalRows = resolvedRows.filter(row => row.resolved.channel);
    const ignoredRows = hardwareIds.hardwareIds.filter(row => !isKoboDevice(row));
    const unresolvedRows = resolvedRows.filter(row => !row.resolved.channel);

    const lines = [
        '// Generated by scripts/resolve-hardware-ids.mjs.',
        '// Review manually before copying anything into src/js/kobo/version.js.',
        '// serialPrefix is intentionally null unless a reliable resolver is added for it.',
        '// Non-Kobo and unresolved hardware UUIDs are recorded in metadata, not emitted here.',
        '',
        'const koboHardwareIds = {',
    ];

    for (const row of proposalRows) {
        const noteParts = [
            `channel: ${row.resolved.source}`,
            `firmware model: ${row.hardware.model}`,
            `product: ${row.hardware.products.join(', ')}`,
            `platform: ${row.hardware.platforms.join(', ')}`,
        ];

        if (row.resolved.firmwareVersion) {
            noteParts.push(`latest: ${row.resolved.firmwareVersion}`);
        }

        lines.push(`    // ${noteParts.join('; ')}`);
        lines.push(`    '${row.hardware.uuid}': { serialPrefix: null, channel: ${jsString(row.resolved.channel)}, model: ${jsString(row.model)} },`);
    }

    lines.push('};');
    lines.push('');
    lines.push('export { koboHardwareIds };');
    lines.push('');
    lines.push('export const hardwareResolutionMetadata = ');
    lines.push(JSON.stringify({
        generatedAt: new Date().toISOString(),
        generatedBy: 'scripts/resolve-hardware-ids.mjs',
        hardwareInputGeneratedAt: hardwareIds.generatedAt,
        request: {
            apiBase: opts.apiBase,
            affiliate: opts.affiliate,
            version: opts.version,
            serial: opts.serial,
        },
        sources: {
            input: resolve(repoRoot, opts.input),
        },
        ignored: ignoredRows
            .map(row => row.uuid),
        unresolved: unresolvedRows
            .map(row => row.hardware.uuid),
        omitted: [
            ...ignoredRows.map(row => row.uuid),
            ...unresolvedRows.map(row => row.hardware.uuid),
        ],
        upgradeResponses: Object.fromEntries(
            resolvedRows.map(row => [row.hardware.uuid, {
                channel: row.resolved.channel,
                upgradeType: row.resolved.upgradeType,
                firmwareVersion: row.resolved.firmwareVersion,
                upgradeUrl: row.resolved.upgradeUrl,
            }])
        ),
    }, null, 4).replace(/^/gm, '    '));
    lines.push(';');
    lines.push('');

    return lines.join('\n');
}

function printTable(rows, outputPath) {
    const widths = {
        uuid: 36,
        channel: Math.max('Channel'.length, ...rows.map(row => (row.resolved.channel || '').length)),
        source: Math.max('Source'.length, ...rows.map(row => (row.resolved.source || 'unresolved').length)),
        model: Math.max('Model'.length, ...rows.map(row => row.model.length)),
        product: Math.max('Product'.length, ...rows.map(row => row.hardware.products.join(', ').length)),
        platform: Math.max('Platform'.length, ...rows.map(row => row.hardware.platforms.join(', ').length)),
    };

    const header = [
        'UUID'.padEnd(widths.uuid),
        'Channel'.padEnd(widths.channel),
        'Source'.padEnd(widths.source),
        'Model'.padEnd(widths.model),
        'Product'.padEnd(widths.product),
        'Platform'.padEnd(widths.platform),
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const row of rows) {
        console.log([
            row.hardware.uuid.padEnd(widths.uuid),
            (row.resolved.channel || '').padEnd(widths.channel),
            (row.resolved.source || 'unresolved').padEnd(widths.source),
            row.model.padEnd(widths.model),
            row.hardware.products.join(', ').padEnd(widths.product),
            row.hardware.platforms.join(', ').padEnd(widths.platform),
        ].join('  '));
    }

    const unresolved = rows.filter(row => !row.resolved.channel);
    console.log('');
    if (unresolved.length) {
        console.warn(`Unresolved channels: ${unresolved.map(row => row.hardware.uuid).join(', ')}`);
    }
    console.log(`Wrote ${outputPath}`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        usage();
        return;
    }

    const hardwareIds = await readJson(opts.input);
    const resolvedRows = [];

    const koboHardwareIds = hardwareIds.hardwareIds.filter(isKoboDevice);
    const ignoredHardwareIds = hardwareIds.hardwareIds.filter(row => !isKoboDevice(row));

    if (ignoredHardwareIds.length) {
        console.log(`Ignoring ${ignoredHardwareIds.length} non-Kobo hardware IDs: ${ignoredHardwareIds.map(row => row.uuid).join(', ')}`);
        console.log('');
    }

    for (const hardware of koboHardwareIds) {
        const resolved = await resolveChannel(hardware, opts);
        resolvedRows.push({
            hardware,
            resolved,
            model: hardware.model,
        });
        console.log(`${hardware.uuid} -> ${resolved.channel || 'unresolved'}`);
    }

    const outputPath = resolve(repoRoot, opts.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderProposal({
        hardwareIds,
        resolvedRows,
        opts,
    }));

    console.log('');
    printTable(resolvedRows, opts.output);
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});

function isKoboDevice(row) {
    return row.model?.startsWith('Kobo ');
}
