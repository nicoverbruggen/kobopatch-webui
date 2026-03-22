const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');

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

let server;
let win;

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 900,
        icon: path.join(DIST, 'favicon', 'favicon-96x96.png'),
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true },
    });
    const localOrigin = `http://localhost:${server.address().port}`;

    win.loadURL(localOrigin);
    win.on('closed', () => { win = null; });

    const isExternal = (url) => {
        try { return new URL(url).origin !== localOrigin; } catch { return false; }
    };

    win.webContents.on('will-navigate', (e, url) => {
        if (isExternal(url)) { e.preventDefault(); shell.openExternal(url); }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isExternal(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
}

server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let filePath = path.join(DIST, decodeURIComponent(url.pathname));

    try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {}

    try {
        fs.statSync(filePath);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});

server.listen(0, '127.0.0.1', () => {
    app.whenReady().then(createWindow);
});

app.on('window-all-closed', () => { app.quit(); });

app.on('before-quit', () => { server.close(); });
