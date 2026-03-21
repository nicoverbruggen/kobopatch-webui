import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = join(import.meta.dirname, 'dist');
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

// Cache the processed index.html at startup
let cachedIndexHtml = null;
function getIndexHtml() {
    if (cachedIndexHtml) return cachedIndexHtml;
    const indexPath = join(DIST, 'index.html');
    if (!existsSync(indexPath)) return null;
    let html = readFileSync(indexPath, 'utf-8');
    if (analyticsSnippet) {
        html = html.replace('</head>', analyticsSnippet + '</head>');
    }
    cachedIndexHtml = html;
    return cachedIndexHtml;
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

createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);
    let filePath = join(DIST, decodeURIComponent(url.pathname));

    if (filePath.endsWith('/')) filePath = join(filePath, 'index.html');
    if (!extname(filePath) && existsSync(filePath + '/index.html')) filePath += '/index.html';

    // Serve processed index.html with analytics injection
    if (filePath.endsWith('index.html')) {
        const html = getIndexHtml();
        if (html) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
            return;
        }
    }

    try {
        const stat = statSync(filePath);
        if (!stat.isFile()) throw new Error();
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        createReadStream(filePath).pipe(res);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}).listen(PORT, () => {
    console.log(`Serving web/dist on http://localhost:${PORT}` + (analyticsEnabled ? ' (analytics enabled)' : ''));
});
