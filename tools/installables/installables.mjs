#!/usr/bin/env node
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK_PATH = join(APP_DIR, 'installables.lock');

// `--check` hits the GitHub API once per tracked installable, so throttle it: the
// timestamp of the last completed check is recorded here, and a check within the
// window is skipped (unless `--force`). Lives under the gitignored tmp/ dir.
const CHECK_STAMP_PATH = join(APP_DIR, 'tmp', 'last-installable-check');
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const TARGET_ROOTS = {
    src: 'src/assets',
    dist: 'dist/assets',
};

const TARGETS = {
    src: join(APP_DIR, TARGET_ROOTS.src),
    dist: join(APP_DIR, TARGET_ROOTS.dist),
};

// Each installable declares where its asset comes from. `repo` + `match` resolves
// the download via the GitHub releases API; `pinned` is an explicit version+url
// (NickelMenu tracks a specific fork release, not "latest"). `name` is the lock key
// and the id used by the build-time manifest (see scripts/build.mjs).
const INSTALLABLES = [
    {
        name: 'nickelmenu',
        asset: 'NickelMenu.zip',
        pinned: {
            version: 'fork-v1.1',
            url: 'https://github.com/nicoverbruggen/NickelMenu/releases/download/fork-v1.1/NickelMenu.zip',
        },
    },
    {
        name: 'nickelclock',
        asset: 'NickelClock.zip',
        repo: 'shermp/NickelClock',
        match: (n) => /^NickelClock-.*\.zip$/.test(n),
    },
    {
        // Upstream publishes a bare KoboRoot.tgz; stored under a distinct local
        // name so it can't be confused with the generated .kobo/KoboRoot.tgz.
        name: 'nickeltypefix',
        asset: 'NickelTypeFix.tgz',
        repo: 'nicoverbruggen/NickelTypeFix',
        match: (n) => n === 'KoboRoot.tgz',
    },
    {
        // Same shape as NickelTypeFix: a bare KoboRoot.tgz under a distinct local name.
        name: 'nickelcoverfix',
        asset: 'NickelCoverFix.tgz',
        repo: 'nicoverbruggen/NickelCoverFix',
        match: (n) => n === 'KoboRoot.tgz',
    },
    {
        // Same shape as NickelTypeFix: a bare KoboRoot.tgz under a distinct local name.
        name: 'nickeldissolve',
        asset: 'NickelDissolve.tgz',
        repo: 'nicoverbruggen/NickelDissolve',
        match: (n) => n === 'KoboRoot.tgz',
    },
    {
        name: 'koreader',
        asset: 'koreader-kobo.zip',
        repo: 'koreader/koreader',
        match: (n) => /^koreader-kobo-.*\.zip$/.test(n),
    },
    { name: 'cadmus', asset: 'cadmus-kobo.tar.gz', repo: 'OGKevin/cadmus', match: (n) => n === 'cadmus-kobo.tar.gz' },
    {
        name: 'readerly',
        asset: 'KF_Readerly.zip',
        repo: 'nicoverbruggen/readerly',
        match: (n) => n === 'KF_Readerly.zip',
    },
    { name: 'libron', asset: 'KF_Libron.zip', repo: 'nicoverbruggen/libron', match: (n) => n === 'KF_Libron.zip' },
    {
        name: 'cartisse',
        asset: 'KF_Cartisse.zip',
        repo: 'nicoverbruggen/cartisse',
        match: (n) => n === 'KF_Cartisse.zip',
    },
];

// A stalled GitHub download otherwise hangs the whole setup forever (no body
// timeout in fetch). Abort a transfer that makes no progress for this long, and
// retry a few times, so setup fails fast with a clear error instead of hanging
// (most visibly on the large cadmus archive).
const API_TIMEOUT_MS = 5_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const DOWNLOAD_ATTEMPTS = 3;

function githubHeaders() {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kobopatch-webui-installables' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    return headers;
}

function pickAsset(release, item) {
    const version = release.tag_name;
    const asset = (release.assets || []).find((a) => item.match(a.name));
    if (!version || !asset) throw new Error(`No matching asset in release ${version || '?'} of ${item.repo}`);
    return { version, url: asset.browser_download_url };
}

// Resolve the *latest* upstream release (used by `update`). Pinned items skip the API.
async function resolveLatest(item) {
    if (item.pinned) return item.pinned;
    const resp = await fetch(`https://api.github.com/repos/${item.repo}/releases/latest`, {
        headers: githubHeaders(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`GitHub API ${item.repo}: ${resp.status} ${resp.statusText}`);
    return pickAsset(await resp.json(), item);
}

async function sha256File(path) {
    return createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
}

async function downloadOnce(url, dest) {
    // Abort the transfer if no bytes arrive for DOWNLOAD_IDLE_TIMEOUT_MS — an idle
    // timer (reset on each chunk), not an overall deadline, so a slow but progressing
    // download of a large asset is never cut off.
    const controller = new AbortController();
    let idleTimer;
    const armIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(new Error('stalled: no data received')), DOWNLOAD_IDLE_TIMEOUT_MS);
    };

    try {
        armIdleTimer();
        const resp = await fetch(url, { redirect: 'follow', signal: controller.signal });
        if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText} (${url})`);

        const total = Number(resp.headers.get('content-length')) || 0;
        const chunks = [];
        let received = 0;
        for await (const chunk of resp.body) {
            armIdleTimer();
            chunks.push(chunk);
            received += chunk.length;
            if (total && process.stdout.isTTY) {
                process.stdout.write(`\r    ${formatSize(received)} / ${formatSize(total)} (${Math.floor((received / total) * 100)}%)`);
            }
        }
        if (total && process.stdout.isTTY) process.stdout.write('\r\x1b[K');

        const buf = Buffer.concat(chunks);
        const tmp = `${dest}.tmp`;
        await writeFile(tmp, buf);
        await rename(tmp, dest);
        return buf;
    } finally {
        clearTimeout(idleTimer);
    }
}

async function downloadTo(url, dest) {
    let lastErr;
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            return await downloadOnce(url, dest);
        } catch (err) {
            lastErr = err;
            if (attempt < DOWNLOAD_ATTEMPTS) {
                console.warn(`  download attempt ${attempt}/${DOWNLOAD_ATTEMPTS} failed (${err.message}); retrying...`);
            }
        }
    }
    throw new Error(`Download failed after ${DOWNLOAD_ATTEMPTS} attempts: ${lastErr.message} (${url})`);
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readLock() {
    if (!existsSync(LOCK_PATH)) return { lockfileVersion: 1, installables: {} };
    return JSON.parse(await readFile(LOCK_PATH, 'utf8'));
}

// Write a frontend-consumable asset index next to the served assets. The lockfile
// (installables.lock) isn't served, so the app reads sizes from /assets/index.json
// to show the expected download size. Keyed by installable id; sizes are byte-exact
// because the lock pins each asset. Regenerated for every target the tool touches.
async function writeIndex(target, lock) {
    const index = {};
    for (const [name, entry] of Object.entries(lock.installables || {})) {
        index[name] = { asset: entry.asset, version: entry.version, size: entry.size };
    }
    const dir = TARGETS[target];
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    console.log(`[${target}] wrote index.json (${Object.keys(index).length} entries)`);
}

async function writeLock(lock) {
    await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
}

// setup: install exactly what the lock pins (like `npm ci`). Downloads from the
// locked URL and verifies the locked sha256; reuses an on-disk asset whose hash
// already matches. Never touches "latest" — reproducible across CI and deploys.
async function setupInstallable(item, target, lock) {
    const entry = lock.installables[item.name];
    if (!entry) {
        // A tracked installable whose upstream has not published a release yet
        // (so there is nothing to pin). Skip with a warning — the matching
        // feature stays unavailable in the app until the lock gains an entry.
        console.warn(
            `[${item.name}] not in installables.lock (no published release yet?) — skipping. Run \`npm run update:installables -- --only=${item.name}\` once a release exists.`,
        );
        return;
    }

    const dir = TARGETS[target];
    await mkdir(dir, { recursive: true });
    const assetPath = join(dir, item.asset);

    if (existsSync(assetPath) && (await sha256File(assetPath)) === entry.sha256) {
        console.log(`[${target}/${item.name}] present and verified (${entry.version}), skipping.`);
        return;
    }

    console.log(`[${target}/${item.name}] fetching ${entry.version}`);
    const buf = await downloadTo(entry.url, assetPath);
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== entry.sha256) {
        throw new Error(`[${item.name}] sha256 mismatch: lock ${entry.sha256.slice(0, 12)}… got ${got.slice(0, 12)}… (${entry.url})`);
    }
    console.log(`[${target}/${item.name}] -> ${formatSize(buf.length)} (verified)`);
}

// update: resolve the latest upstream release, download, and rewrite the lock
// entry (version/url/sha256/size). The resolved bytes are written to every target.
// Run by a maintainer; commit the updated installables.lock.
async function updateInstallable(item, targets, lock) {
    console.log(`[${item.name}] resolving latest release...`);
    const { version, url } = await resolveLatest(item);

    const existing = lock.installables[item.name];
    const firstDir = TARGETS[targets[0]];
    await mkdir(firstDir, { recursive: true });
    const firstPath = join(firstDir, item.asset);

    const buf = await downloadTo(url, firstPath);
    const sha256 = createHash('sha256').update(buf).digest('hex');

    for (const target of targets.slice(1)) {
        const dir = TARGETS[target];
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, item.asset), buf);
    }

    const changed = !existing || existing.version !== version || existing.sha256 !== sha256;
    lock.installables[item.name] = { asset: item.asset, version, url, sha256, size: buf.length };
    const note = !existing ? 'added' : changed ? `${existing.version} -> ${version}` : `unchanged (${version})`;
    console.log(`[${item.name}] ${note} -> ${formatSize(buf.length)}`);
}

// check: compare an item's locked version against the latest upstream release.
// Read-only and best-effort — it never rewrites the lock, and a failed lookup is
// reported as a warning rather than throwing. Pinned items are not tracked.
async function checkInstallable(item, lock) {
    const entry = lock.installables[item.name];
    if (item.pinned) return { name: item.name, status: 'pinned', version: entry?.version };
    try {
        const { version } = await resolveLatest(item);
        const current = entry?.version ?? null;
        return current === version ? { name: item.name, status: 'current', version } : { name: item.name, status: 'outdated', current, latest: version };
    } catch (err) {
        return { name: item.name, status: 'error', message: err.message };
    }
}

// Age (ms) of the last completed check, or null if never checked / unreadable.
async function lastCheckAgeMs() {
    try {
        const when = Date.parse((await readFile(CHECK_STAMP_PATH, 'utf8')).trim());
        return Number.isNaN(when) ? null : Date.now() - when;
    } catch {
        return null;
    }
}

async function writeCheckStamp() {
    await mkdir(dirname(CHECK_STAMP_PATH), { recursive: true });
    await writeFile(CHECK_STAMP_PATH, `${new Date().toISOString()}\n`);
}

function parseArgs(argv) {
    const opts = { update: false, check: false, force: false, targets: [], only: null, cachePaths: false };
    for (const arg of argv) {
        if (arg === '--update') opts.update = true;
        else if (arg === '--check') opts.check = true;
        // For --check, bypass the 12h throttle. A no-op for setup (the lock-based
        // setup already skips assets whose hash matches).
        else if (arg === '--force') opts.force = true;
        else if (arg === '--dist') opts.targets.push('dist');
        else if (arg === '--src') opts.targets.push('src');
        else if (arg === '--cache-paths') opts.cachePaths = true;
        // Accepted for backward compatibility (CI/shell scripts); a no-op since the
        // lock-based setup already skips assets whose hash matches.
        else if (arg === '--skip-if-present') continue;
        else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length);
        else {
            console.error(`Unknown argument: ${arg}`);
            console.error('Usage: installables.mjs (--src|--dist)... [--update] [--check] [--cache-paths] [--only=<name>]');
            process.exit(2);
        }
    }
    // --check is target-independent (it only compares the lock against upstream).
    if (!opts.check && opts.targets.length === 0) {
        console.error('Error: at least one of --src or --dist is required.');
        process.exit(2);
    }
    opts.targets = [...new Set(opts.targets)];
    return opts;
}

function checkLabel(item) {
    return item.pinned ? `[${item.name}] pinned, no remote update check needed` : `[${item.name}] checking ${item.repo} (timeout ${API_TIMEOUT_MS / 1000}s)`;
}

function printCachePaths(items, targets) {
    const paths = [];
    for (const target of targets) {
        const root = TARGET_ROOTS[target];
        for (const item of items) paths.push(`${root}/${item.asset}`);
    }
    console.log(paths.join('\n'));
}

const opts = parseArgs(process.argv.slice(2));
const items = opts.only ? INSTALLABLES.filter((i) => i.name === opts.only) : INSTALLABLES;

if (opts.only && items.length === 0) {
    console.error(`Unknown installable: ${opts.only}`);
    console.error(`Known: ${INSTALLABLES.map((i) => i.name).join(', ')}`);
    process.exit(2);
}

if (opts.cachePaths) {
    printCachePaths(items, opts.targets);
    process.exit(0);
}

const lock = await readLock();

if (opts.check) {
    const ageMs = await lastCheckAgeMs();
    if (!opts.force && ageMs !== null && ageMs < CHECK_INTERVAL_MS) {
        console.log(`Installables checked ${(ageMs / 3_600_000).toFixed(1)}h ago; skipping (at most once per 12h — pass --force to override).`);
        process.exit(0);
    }

    const reports = [];
    for (const item of items) {
        console.log(checkLabel(item));
        const report = await checkInstallable(item, lock);
        reports.push(report);

        if (report.status === 'current') console.log(`[${report.name}] up to date (${report.version})`);
        else if (report.status === 'pinned') console.log(`[${report.name}] pinned (${report.version ?? 'unknown'}), not tracked for updates`);
        else if (report.status === 'outdated') console.warn(`[${report.name}] update available (${report.current ?? 'none'} -> ${report.latest})`);
        else if (report.status === 'error') console.warn(`[${report.name}] could not check for updates: ${report.message}`);
    }

    const trackable = reports.filter((r) => r.status !== 'pinned');
    const outdated = reports.filter((r) => r.status === 'outdated');
    const errors = reports.filter((r) => r.status === 'error');

    if (outdated.length) {
        console.warn('\n⚠ Updates available for installables:');
        for (const r of outdated) console.warn(`  - ${r.name}: ${r.current ?? 'none'} → ${r.latest}`);
        console.warn('\nRun `npm run update:installables` to refresh installables.lock (maintainer task).');
    } else if (errors.length < trackable.length) {
        console.log('\nAll tracked installables are up to date.');
    }

    // Only stamp when at least one lookup succeeded, so a network outage retries
    // on the next run instead of being throttled for 12h.
    if (errors.length < trackable.length) await writeCheckStamp();

    // Soft check: informational only, never fails the caller (e.g. `npm run verify`).
    process.exit(0);
}

if (opts.update) {
    // One unresolvable installable (e.g. a repo with no release yet) must not
    // abort the whole update run: warn, keep its existing lock entry (if any),
    // and still write the lock for the items that did resolve.
    const failed = [];
    for (const item of items) {
        try {
            await updateInstallable(item, opts.targets, lock);
        } catch (err) {
            failed.push(item.name);
            console.warn(`[${item.name}] update failed: ${err.message}`);
        }
    }
    await writeLock(lock);
    if (failed.length) console.warn(`\n⚠ Not updated: ${failed.join(', ')}`);
    for (const target of opts.targets) await writeIndex(target, lock);
    console.log(`Done. Updated installables.lock and assets in: ${opts.targets.map((t) => TARGETS[t]).join(', ')}.`);
} else {
    for (const item of items) {
        for (const target of opts.targets) await setupInstallable(item, target, lock);
    }
    for (const target of opts.targets) await writeIndex(target, lock);
    console.log(`Done. Installables ready in: ${opts.targets.map((t) => TARGETS[t]).join(', ')}.`);
}
