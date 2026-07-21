import { createServer } from 'node:http';
import { appendFileSync, createReadStream, mkdirSync, readFileSync, statSync, existsSync, watch } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { storageDir } from './storage.mjs';

// A crash record also goes to the persistent storage volume, because the
// container filesystem — and with it the stdout the platform captured — can be
// gone by the time anyone investigates. Best-effort and one appended entry per
// crash; a bookkeeping failure must never mask the crash being recorded.
function recordCrash(kind, detail) {
    try {
        const dir = join(storageDir(), 'logs');
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, 'crash.log'), `${new Date().toISOString()} [${kind}] ${detail}\n\n`);
    } catch {
        // stdout still has the record.
    }
}

// Last-resort crash logging. This is a single-process server: one uncaught
// exception takes the whole site down until the platform restarts the
// container (see the decodeURIComponent guard below for the class of bug that
// has caused exactly that). Log the full stack, then exit non-zero so the
// restart policy still kicks in — never limp on in an unknown state.
process.on('uncaughtException', (err) => {
    const detail = err?.stack || err;
    console.error(`[fatal] uncaught exception: ${detail}`);
    recordCrash('uncaughtException', detail);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    const detail = reason?.stack || reason;
    console.error(`[fatal] unhandled rejection: ${detail}`);
    recordCrash('unhandledRejection', detail);
    process.exit(1);
});

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

// Redirect the whole site elsewhere. Meant for the dev deployment: set
// REDIRECT_URL=https://<production host> and every request 302s there (path
// and query preserved), so the dev domain can be parked on the production site
// between test rounds. Temporary redirect + no-store, so unsetting the
// variable takes effect immediately for anyone who visited meanwhile. An
// invalid value is ignored with a warning rather than crashing the server.
let redirectBase = null;
if (process.env.REDIRECT_URL) {
    try {
        redirectBase = new URL(process.env.REDIRECT_URL);
    } catch {
        console.error(`[warn] ignoring invalid REDIRECT_URL: ${process.env.REDIRECT_URL}`);
    }
}

// Parse an operator-facing boolean env var. Unlike a bare `!!process.env.X`, an
// explicit falsy value (`0`, `false`, `no`, `off`, empty) reads as off — so an
// operator can disable the flag by setting it to "0" instead of having to delete
// the variable entirely, which is the intuitive thing to reach for.
function envFlag(name) {
    const value = process.env[name];
    if (value === undefined) return false;
    return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

// Content-Security-Policy. Deployed behind a TLS-terminating proxy; this is the
// app's own defence-in-depth layer (see also the inline-hash strategy below).
// Set CSP_REPORT_ONLY=1 to ship it as `…-Report-Only` first — the browser logs
// violations without blocking, so a new third-party source can be caught before
// it breaks anything. Set it to 0 (or delete it) to enforce.
const cspReportOnly = envFlag('CSP_REPORT_ONLY');

function originOf(url) {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

// The analytics host (script + beacon) is only part of the policy when analytics
// is actually wired up, derived from the same env var that injects the snippet.
const umamiOrigin = analyticsEnabled ? originOf(UMAMI_SCRIPT_URL) : null;

// connect-src for the firmware downloads is read straight from downloads.json, so
// adding a new Kobo/mirror host there updates the policy with no code change.
function firmwareConnectOrigins() {
    try {
        const raw = readFileSync(join(DIST, 'patches', 'downloads.json'), 'utf-8');
        const origins = new Set();
        for (const match of raw.matchAll(/"(https?:\/\/[^"]+)"/g)) {
            const origin = originOf(match[1]);
            if (origin) origins.add(origin);
        }
        return [...origins];
    } catch {
        return [];
    }
}

// Hash every *bare* inline <script>/<style> block (no attributes) in the served
// HTML — the pre-paint theme bootstrap, the inlined critical CSS, and the
// runtime-injected analytics/live-reload snippets. Hashing the actual bytes means
// script-src/style-src never need 'unsafe-inline' and the hashes can never drift
// from the markup. JSON-LD (type="application/ld+json") and the module/analytics
// <script src> tags carry attributes, so they don't match and don't need hashing.
function inlineHashes(html, tag) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    const hashes = [];
    for (const match of html.matchAll(re)) {
        const digest = createHash('sha256').update(match[1], 'utf-8').digest('base64');
        hashes.push(`'sha256-${digest}'`);
    }
    return hashes;
}

let cspCache = null;
function getCsp() {
    if (!noCache && cspCache) return cspCache;
    const html = getIndexHtml() || '';

    const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...inlineHashes(html, 'script')];
    const styleSrc = ["'self'", 'https://fonts.googleapis.com', ...inlineHashes(html, 'style')];
    const connectSrc = ["'self'", ...firmwareConnectOrigins()];
    if (umamiOrigin) {
        scriptSrc.push(umamiOrigin);
        connectSrc.push(umamiOrigin);
    }

    const csp = [
        `default-src 'self'`,
        `script-src ${scriptSrc.join(' ')}`,
        `style-src ${styleSrc.join(' ')}`,
        `font-src 'self' https://fonts.gstatic.com`,
        // blob: is needed for the NickelMenu custom-icon flow, which loads the
        // uploaded file and the canvas-resized PNG/SVG previews from object URLs.
        `img-src 'self' data: blob:`,
        `connect-src ${connectSrc.join(' ')}`,
        `worker-src 'self'`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        `frame-ancestors 'none'`,
        `manifest-src 'self'`,
        `upgrade-insecure-requests`,
    ].join('; ');

    if (!noCache) cspCache = csp;
    return csp;
}

// CSP plus the companion hardening headers, applied to every response.
function securityHeaders() {
    return {
        [cspReportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy']: getCsp(),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    };
}

// CSS live-reload, enabled by the dev server (LIVE_RELOAD=1). When the watch build
// regenerates css/style.css, the server pushes a Server-Sent Event to connected
// browsers, which swap the stylesheet's href (cache-busted) in place. CSS-only — no
// full page reload — so the in-progress wizard state survives an edit. Changes to
// critical.css (inlined into index.html) still need a manual refresh.
const liveReload = !!process.env.LIVE_RELOAD;
const liveReloadSnippet = liveReload
    ? `    <script>
    (() => {
      const es = new EventSource('/__livereload');
      es.addEventListener('css', () => {
        for (const link of document.querySelectorAll('link[rel="stylesheet"][href*="style.css"]')) {
          const u = new URL(link.href, location.href);
          u.searchParams.set('h', Date.now());
          link.href = u.href;
        }
        console.info('[live-reload] CSS updated');
      });
    })();
    </script>
`
    : '';

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
    if (liveReloadSnippet) {
        html = html.replace('</head>', liveReloadSnippet + '</head>');
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

// Connected live-reload browsers (held-open SSE responses) and the broadcast that
// nudges them to swap the stylesheet after a CSS rebuild.
const sseClients = new Set();
function broadcastCss() {
    for (const client of sseClients) client.write('event: css\ndata: reload\n\n');
}

// Watch the served tree for the regenerated css/style.css and broadcast. DIST itself
// is never removed during a dev session (the watch build only rewrites its children),
// so a recursive watch on the root stays alive across rebuilds; we filter to the one
// output file and debounce the burst of events a rebuild produces.
function setupCssWatch() {
    let timer = null;
    try {
        watch(DIST, { recursive: true }, (_event, filename) => {
            if (!filename || filename.split(sep).join('/') !== 'css/style.css') return;
            clearTimeout(timer);
            timer = setTimeout(broadcastCss, 100);
        });
    } catch {
        // DIST not ready yet (build still creating it) — retry shortly.
        setTimeout(setupCssWatch, 500);
    }
}

createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);
    if (logRequests) logServed(req, res, url);

    if (redirectBase) {
        res.writeHead(302, {
            Location: new URL(url.pathname + url.search, redirectBase).href,
            'Cache-Control': 'no-store',
        });
        res.end();
        return;
    }

    // Live-reload SSE stream: held open, never logged as a served file.
    if (liveReload && url.pathname === '/__livereload') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        res.write('retry: 1000\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    // decodeURIComponent throws URIError on a malformed percent-escape (e.g. a
    // bare "%" or "%zz"). This runs before the try/catch around the file reads, so
    // an unguarded throw here would be an uncaught exception that takes down the
    // whole process — a one-request DoS. Send those to the homepage instead (a
    // temporary redirect, never cached, so a bad URL lands on the app).
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
        return;
    }

    let filePath = join(DIST, decodedPath);
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
                ...securityHeaders(),
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
            ...securityHeaders(),
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
        // pipeline, not pipe: pipe() forwards no errors, so a read failure
        // mid-stream (file swapped during a deploy, fd exhaustion) would crash
        // the process, and a client abort would leak the read stream's fd —
        // with the 40 MB archives that leak compounds toward EMFILE. pipeline
        // destroys both streams on either side failing; the errors themselves
        // (mostly routine aborts) need no handling beyond that.
        pipeline(createReadStream(picked ? picked.path : filePath), res, () => {});
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
})
    .on('error', (err) => {
        // Listen-time failures such as EADDRINUSE. Without a handler this
        // still crashes, but through the generic uncaughtException path; name
        // it here so a port conflict is recognizable at a glance in the logs.
        const detail = err?.stack || err;
        console.error(`[fatal] server error: ${detail}`);
        recordCrash('serverError', detail);
        process.exit(1);
    })
    .listen(PORT, () => {
        console.log(`Serving dist on http://localhost:${PORT}` + (analyticsEnabled ? ' (analytics enabled)' : ''));
        if (liveReload) setupCssWatch();
    });
