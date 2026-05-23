#!/usr/bin/env node
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TARGETS = {
    src:  join(APP_DIR, 'src',  'assets'),
    dist: join(APP_DIR, 'dist', 'assets'),
};

const INSTALLABLES = [
    {
        name: 'nickelmenu',
        asset: 'NickelMenu.zip',
        versionFile: 'nickelmenu-release.json',
        // NickelMenu is pinned to a specific fork release rather than tracking "latest".
        fetchLatest: async () => ({
            version: 'fork-v1.1',
            url: 'https://github.com/nicoverbruggen/NickelMenu/releases/download/fork-v1.1/NickelMenu.zip',
        }),
    },
    {
        name: 'koreader',
        asset: 'koreader-kobo.zip',
        versionFile: 'koreader-release.json',
        fetchLatest: () => fetchLatestRelease('koreader/koreader', (n) => /^koreader-kobo-.*\.zip$/.test(n)),
    },
    {
        name: 'readerly',
        asset: 'KF_Readerly.zip',
        versionFile: 'readerly-release.json',
        fetchLatest: () => fetchLatestRelease('nicoverbruggen/readerly', (n) => n === 'KF_Readerly.zip'),
    },
];

async function fetchLatestRelease(repo, matcher) {
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'kobopatch-webui-installables' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const resp = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!resp.ok) throw new Error(`GitHub API ${repo}: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    const version = data.tag_name;
    const asset = (data.assets || []).find((a) => matcher(a.name));
    if (!version || !asset) throw new Error(`No matching asset in latest release of ${repo}`);
    return { version, url: asset.browser_download_url };
}

async function downloadTo(url, dest) {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText} (${url})`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const tmp = `${dest}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, dest);
    return buf.length;
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readCurrentVersion(dir, versionFile) {
    if (!versionFile) return null;
    const path = join(dir, versionFile);
    if (!existsSync(path)) return null;
    try {
        const json = JSON.parse(await readFile(path, 'utf8'));
        return typeof json.version === 'string' ? json.version : null;
    } catch {
        return null;
    }
}

async function ensureInstallable(item, target, opts, resolvedCache) {
    const dir = TARGETS[target];
    await mkdir(dir, { recursive: true });

    const assetPath = join(dir, item.asset);
    const assetExists = existsSync(assetPath);
    const currentVersion = await readCurrentVersion(dir, item.versionFile);

    // Setup fast path: if asked to skip-when-present and the asset is already on disk
    // (with a recorded version, or no version tracking), don't hit the network at all.
    if (opts.skipIfPresent && !opts.force && assetExists && (!item.versionFile || currentVersion)) {
        const tag = currentVersion ? ` (${currentVersion})` : '';
        console.log(`[${target}/${item.name}] already present${tag}, skipping.`);
        return;
    }

    // Resolve upstream once per run and share across targets.
    let resolved = resolvedCache.get(item.name);
    if (!resolved) {
        console.log(`[${item.name}] resolving latest release...`);
        resolved = await item.fetchLatest();
        resolvedCache.set(item.name, resolved);
    }
    const { version, url } = resolved;

    if (!opts.force && assetExists && currentVersion === version) {
        console.log(`[${target}/${item.name}] already up to date (${version}).`);
        return;
    }

    if (currentVersion && currentVersion !== version) {
        console.log(`[${target}/${item.name}] updating ${currentVersion} -> ${version}`);
    } else {
        console.log(`[${target}/${item.name}] installing ${version}`);
    }

    const size = await downloadTo(url, assetPath);
    if (item.versionFile) {
        await writeFile(join(dir, item.versionFile), `${JSON.stringify({ version })}\n`);
    }
    console.log(`[${target}/${item.name}] -> ${formatSize(size)}`);
}

function parseArgs(argv) {
    const opts = { force: false, targets: [], only: null, skipIfPresent: false };
    for (const arg of argv) {
        if (arg === '--force') opts.force = true;
        else if (arg === '--dist') opts.targets.push('dist');
        else if (arg === '--src') opts.targets.push('src');
        else if (arg === '--skip-if-present') opts.skipIfPresent = true;
        else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length);
        else {
            console.error(`Unknown argument: ${arg}`);
            console.error('Usage: installables.mjs (--src|--dist)... [--force] [--skip-if-present] [--only=<name>]');
            process.exit(2);
        }
    }
    if (opts.targets.length === 0) {
        console.error('Error: at least one of --src or --dist is required.');
        process.exit(2);
    }
    // Deduplicate while preserving order.
    opts.targets = [...new Set(opts.targets)];
    return opts;
}

const opts = parseArgs(process.argv.slice(2));
const items = opts.only
    ? INSTALLABLES.filter((i) => i.name === opts.only)
    : INSTALLABLES;

if (opts.only && items.length === 0) {
    console.error(`Unknown installable: ${opts.only}`);
    console.error(`Known: ${INSTALLABLES.map((i) => i.name).join(', ')}`);
    process.exit(2);
}

const resolvedCache = new Map();
for (const item of items) {
    for (const target of opts.targets) {
        await ensureInstallable(item, target, opts, resolvedCache);
    }
}

console.log(`Done. Installables ready in: ${opts.targets.map((t) => TARGETS[t]).join(', ')}.`);
