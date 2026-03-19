import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = join(import.meta.dirname, 'dist');
const PORT = process.env.PORT || 8888;

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
    console.log(`Serving web/dist on http://localhost:${PORT}`);
});
