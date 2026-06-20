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
        etag: `"idx-${createHash('md5').update(identity).digest('hex').slice(0, 12)}"`,
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
 * Cache-Control policy. Two tiers:
 *  - versioned URLs (`?h=<content hash>` on bundle.js / style.css / kobopatch.wasm,
 *    or `?v=<pinned version>` on the `assets/*` add-on archives): the URL changes
 *    whenever the bytes do, so cache forever as immutable. This is what lets a CDN
 *    serve the 40 MB archives without ever revalidating.
 *  - everything else (index.html, `*.json` metadata, feature scripts): `no-cache` —
 *    stored, but revalidated before reuse. There
 *    is deliberately no `max-age` window: nothing here is fetched repeatedly within
 *    seconds (the archives are fetched once, on demand, at install time), so a TTL
 *    would save no round-trips while being the only place stale bytes could serve
 *    after a deploy. Paired with the content-hash ETag, an unchanged asset (incl. a
 *    40 MB archive) is reused on a tiny 304 — `no-cache` does not mean re-download —
 *    while a deploy or `update:installables` bump is picked up on the next request.
 *
 * `compressible` is false for the binary archives (zip/tgz/png/wasm), which are
 * already compressed. For those we add `no-transform`: it tells any TLS-terminating
 * reverse proxy in front of this (HTTP/1.1-only) Node server not to gzip them. That
 * recompression saves ~0 bytes but drops Content-Length (the proxy switches to
 * chunked), and without Content-Length the browser can't show download progress —
 * `fetchWithProgress` falls back to a single unmetered read. `no-transform` (RFC 7234)
 * is the standard signal to forbid that; honoured by nginx's gzip module and others.
 */
function cacheControl(search, compressible) {
    const base = noCache ? 'no-cache' : /[?&][hv]=/.test(search) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return compressible ? base : `${base}, no-transform`;
}

// Strong content-hash ETag, memoized per server lifetime. The validator is the
// hash of the file's *bytes*, not its size+mtime — so a slight edit that leaves
// the size unchanged still yields a new ETag. This is what makes a deploy reliably
// override caches: the URLs of these assets don't change, and crucially the fetched
// GitHub archives (KOReader/Cadmus/fonts) aren't tied to any commit hash, so only
// their content identifies them.
//
// The memo (keyed by size+mtime) just avoids re-hashing on every request within one
// process. It self-clears exactly when content can change: a deploy starts a fresh
// container (empty memo → re-hash), and `update:installables` rewrites files with a
// new mtime (memo miss → re-hash). Unchanged files keep their hash, so large archives
// still answer revalidation with 304 instead of re-downloading.
const etagCache = new Map();
function contentEtag(filePath, stat) {
    const hit = etagCache.get(filePath);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.etag;
    const etag = `"${createHash('md5').update(readFileSync(filePath)).digest('hex').slice(0, 16)}"`;
    etagCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, etag });
    return etag;
}

/** Whether a conditional request may be answered with 304 Not Modified. */
function notModified(req, etag) {
    const inm = req.headers['if-none-match'];
    return inm !== undefined && inm.split(',').some((t) => t.trim() === etag);
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
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : `${text}`);
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
            const headers = {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache',
                Vary: 'Accept-Encoding',
                ETag: v.etag,
            };
            if (notModified(req, v.etag)) {
                res.writeHead(304, headers);
                res.end();
                return;
            }
            let body = v.identity;
            if (/\bbr\b/.test(accept)) {
                body = v.br;
                headers['Content-Encoding'] = 'br';
            } else if (/\bgzip\b/.test(accept)) {
                body = v.gz;
                headers['Content-Encoding'] = 'gzip';
            }
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

        // The ETag hashes the identity bytes, so it 304s regardless of which encoding
        // the client cached (paired with Vary below) and changes iff the content does.
        const etag = contentEtag(filePath, srcStat);
        const compressible = COMPRESSIBLE.has(extname(filePath));
        const headers = {
            'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': cacheControl(url.search, compressible),
            ETag: etag,
        };
        if (compressible) headers['Vary'] = 'Accept-Encoding';

        if (notModified(req, etag)) {
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
