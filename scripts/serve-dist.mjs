import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Served directory. Defaults to dist/; the dev server points it (via DIST_DIR)
// at its own throwaway build directory.
const DIST = process.env.DIST_DIR || join(import.meta.dirname, '..', 'dist');
const PORT = process.env.PORT || 8888;

const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || '';
const UMAMI_SCRIPT_URL = process.env.UMAMI_SCRIPT_URL || '';
const analyticsEnabled = !!(UMAMI_WEBSITE_ID && UMAMI_SCRIPT_URL);

// Pre-build the analytics snippet (injected before </head> in index.html)
let analyticsSnippet = '';
if (analyticsEnabled) {
    analyticsSnippet =
        `    <script>window.__ANALYTICS_ENABLED=true</script>\n` +
        `    <script defer src="${UMAMI_SCRIPT_URL}" data-website-id="${UMAMI_WEBSITE_ID}"></script>\n`;
}

// Cache the processed index.html (disabled when NO_CACHE is set, e.g. during --dev)
const noCache = !!process.env.NO_CACHE;
let cachedIndexHtml = null;
function getIndexHtml() {
    if (!noCache && cachedIndexHtml) return cachedIndexHtml;
    const indexPath = join(DIST, 'index.html');
    if (!existsSync(indexPath)) return null;
    let html = readFileSync(indexPath, 'utf-8');
    if (analyticsSnippet) {
        html = html.replace('</head>', analyticsSnippet + '</head>');
    }
    if (!noCache) cachedIndexHtml = html;
    return html;
}

// index.html is generated per request (analytics injection), so it can't use the
// on-disk `.br`/`.gz` siblings. Instead compress the injected result once and cache
// the variants + an ETag keyed on the bytes. In NO_CACHE (dev) we recompute, which
// is cheap for a ~60 KB document.
let indexVariants = null;
function getIndexVariants() {
    const html = getIndexHtml();
    if (html === null) return null;
    if (!noCache && indexVariants && indexVariants.html === html) return indexVariants;
    const identity = Buffer.from(html, 'utf-8');
    const v = {
        html,
        etag: `W/"idx-${createHash('md5').update(identity).digest('hex').slice(0, 12)}"`,
        identity,
        gz: gzipSync(identity, { level: 9 }),
        br: brotliCompressSync(identity),
    };
    if (!noCache) indexVariants = v;
    return v;
}

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.zip': 'application/zip',
    '.tgz': 'application/gzip',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
};

// Mirrors build.mjs's PRECOMPRESS_EXT: which file types may have `.br`/`.gz`
// siblings to negotiate. Anything else (zip/tgz/png/wasm-archives) is served as-is.
const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.svg', '.wasm', '.map', '.webmanifest', '.txt', '.xml']);

/**
 * Cache-Control policy. Three tiers:
 *  - index.html / root: always revalidate — it references the hash-busted assets.
 *  - hash-busted URLs (`?h=...`, e.g. bundle.js / style.css / kobopatch.wasm): the
 *    URL changes whenever the bytes do, so cache forever as immutable.
 *  - everything else (large `assets/*` archives, feature scripts, JSON): short TTL
 *    plus revalidation. NOT immutable, on purpose — `npm run update:installables`
 *    can replace `dist/assets/*` on a live container between rebuilds, and those
 *    URLs are not hash-busted, so clients must be able to pick up the new bytes
 *    (a conditional request returns a tiny 304 when unchanged — no 40 MB re-download).
 */
function cacheControl(pathname, search) {
    if (noCache) return 'no-cache';
    if (pathname === '/' || pathname.endsWith('/index.html')) return 'no-cache';
    if (/[?&]h=/.test(search)) return 'public, max-age=31536000, immutable';
    return 'public, max-age=300, must-revalidate';
}

/** Weak validator from a file's size+mtime — identifies the resource for 304s. */
function validators(stat) {
    return {
        etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
        lastModified: stat.mtime.toUTCString(),
    };
}

/** Whether a conditional request may be answered with 304 Not Modified. */
function notModified(req, etag, lastModified) {
    const inm = req.headers['if-none-match'];
    if (inm !== undefined) return inm.split(',').some((t) => t.trim() === etag);
    const ims = req.headers['if-modified-since'];
    if (ims && lastModified) return new Date(ims).getTime() >= new Date(lastModified).getTime();
    return false;
}

/**
 * Choose a precompressed sibling to serve, honouring the client's Accept-Encoding
 * (brotli preferred over gzip). Returns null to serve the identity file.
 *
 * A sibling is only used when it is at least as new as its source: if a compressible
 * asset is replaced on a live container without regenerating `.br`/`.gz` (e.g. a
 * future `update:installables` touching a JSON), the stale sibling is ignored and
 * the fresh identity file is served instead.
 */
function pickEncoding(filePath, srcStat, accept) {
    if (!COMPRESSIBLE.has(extname(filePath))) return null;
    const candidates = [];
    if (/\bbr\b/.test(accept)) candidates.push(['br', '.br']);
    if (/\bgzip\b/.test(accept)) candidates.push(['gzip', '.gz']);
    for (const [encoding, suffix] of candidates) {
        const cp = filePath + suffix;
        if (!existsSync(cp)) continue;
        const cpStat = statSync(cp);
        if (cpStat.mtimeMs >= srcStat.mtimeMs) return { encoding, path: cp, stat: cpStat };
    }
    return null;
}

// Per-request logging (enabled by the dev server so it reports which files it
// serves). Logged on 'finish' so it captures the final status across every
// response branch — 200s, redirects to index.html, and 404s alike.
const logRequests = !!process.env.LOG_REQUESTS;
const useColor = logRequests && process.stdout.isTTY;
const paint = (code, text) => useColor ? `\u001b[${code}m${text}\u001b[0m` : `${text}`;
function logServed(req, res, url) {
    res.on('finish', () => {
        const status = res.statusCode;
        const color = status >= 400 ? 31 : status >= 300 ? 33 : 32; // red / yellow / green
        console.log(`  ${paint(color, status)}  ${req.method} ${url.pathname}`);
    });
}

createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);
    if (logRequests) logServed(req, res, url);
    let filePath = join(DIST, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(DIST + '/') && filePath !== DIST) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    if (filePath.endsWith('/')) filePath = join(filePath, 'index.html');
    if (!extname(filePath) && existsSync(filePath + '/index.html')) filePath += '/index.html';

    const accept = req.headers['accept-encoding'] || '';

    // Serve processed index.html with analytics injection (compressed + revalidated).
    if (filePath.endsWith('index.html')) {
        const v = getIndexVariants();
        if (v) {
            const headers = { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding', 'ETag': v.etag };
            if (notModified(req, v.etag, null)) {
                res.writeHead(304, headers);
                res.end();
                return;
            }
            let body = v.identity;
            if (/\bbr\b/.test(accept)) { body = v.br; headers['Content-Encoding'] = 'br'; }
            else if (/\bgzip\b/.test(accept)) { body = v.gz; headers['Content-Encoding'] = 'gzip'; }
            headers['Content-Length'] = body.length;
            res.writeHead(200, headers);
            res.end(body);
            return;
        }
    }

    try {
        const srcStat = statSync(filePath);
        if (!srcStat.isFile()) throw new Error();

        const picked = pickEncoding(filePath, srcStat, accept);
        const serveStat = picked ? picked.stat : srcStat;

        // Validators identify the identity resource, so a conditional request 304s
        // regardless of which encoding the client cached (paired with Vary below).
        const { etag, lastModified } = validators(srcStat);
        const headers = {
            'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': cacheControl(url.pathname, url.search),
            'ETag': etag,
            'Last-Modified': lastModified,
        };
        if (COMPRESSIBLE.has(extname(filePath))) headers['Vary'] = 'Accept-Encoding';

        if (notModified(req, etag, lastModified)) {
            res.writeHead(304, headers);
            res.end();
            return;
        }

        // Content-Length (vs. chunked) lets the browser report download progress
        // for large assets — see fetchWithProgress in src/js/shell/dom.js. When a
        // precompressed sibling is served it reflects the on-wire (compressed) size.
        headers['Content-Length'] = serveStat.size;
        if (picked) headers['Content-Encoding'] = picked.encoding;
        res.writeHead(200, headers);
        createReadStream(picked ? picked.path : filePath).pipe(res);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}).listen(PORT, () => {
    console.log(`Serving dist on http://localhost:${PORT}` + (analyticsEnabled ? ' (analytics enabled)' : ''));
});
