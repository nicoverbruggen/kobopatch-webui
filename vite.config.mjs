import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { defineConfig, transformWithEsbuild } from 'vite';
import JSZip from 'jszip';
import { generateVersion } from './scripts/version-generate.mjs';
import { expandIncludes } from './scripts/html-includes.mjs';

const appDir = import.meta.dirname;
const srcDir = join(appDir, 'src');
const distDir = process.env.DIST_DIR || join(appDir, 'dist');
const htmlDir = join(srcDir, 'html');

function installablesManifest() {
    const lockPath = join(appDir, 'installables.lock');
    if (!existsSync(lockPath)) return {};
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const manifest = {};
    for (const [name, entry] of Object.entries(lock.installables || {})) {
        manifest[name] = {
            version: entry.version,
            // The digest travels with the pin so a download can be checked against
            // what this build expected, rather than against whatever the server
            // happens to be serving after a redeploy.
            sha256: entry.sha256,
            available: existsSync(join(srcDir, 'assets', entry.asset)),
        };
    }
    return manifest;
}

function patchBlacklistUpdatedAt() {
    const blacklistPath = join(appDir, 'patches', 'blacklist.json');
    if (!existsSync(blacklistPath)) return null;
    return statSync(blacklistPath).mtime.toISOString();
}

function sendFile(res, filePath, contentType) {
    const stat = statSync(filePath);
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
}

async function patchZipBuffer(zipName) {
    const patchesSrcDir = join(appDir, 'patches');
    const index = JSON.parse(readFileSync(join(patchesSrcDir, 'index.json'), 'utf-8'));
    const entry = index.find((item) => item.filename === zipName);
    if (!entry) return null;

    const source = entry.filename.replace(/^patches_/, '').replace(/\.zip$/, '');
    const sourceDir = join(patchesSrcDir, source);
    if (!existsSync(sourceDir)) return null;

    const zip = new JSZip();
    function addFiles(dirPath, zipPath) {
        for (const name of readdirSync(dirPath)) {
            const fullPath = join(dirPath, name);
            const entryPath = zipPath ? `${zipPath}/${name}` : name;
            if (statSync(fullPath).isDirectory()) {
                zip.folder(entryPath);
                addFiles(fullPath, entryPath);
            } else {
                zip.file(entryPath, readFileSync(fullPath));
            }
        }
    }
    addFiles(sourceDir, '');
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function koboDevStaticPlugin() {
    const zipCache = new Map();
    const mime = {
        '.json': 'application/json',
        '.wasm': 'application/wasm',
        '.js': 'application/javascript',
    };

    return {
        name: 'kobopatch-dev-static',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url, 'http://localhost');

                if (url.pathname === '/js/workers/wasm_exec.js') {
                    sendFile(res, join(srcDir, 'js', 'wasm_exec.js'), 'application/javascript');
                    return;
                }

                if (url.pathname === '/wasm/kobopatch.wasm') {
                    const wasmPath = join(appDir, 'dist', 'wasm', 'kobopatch.wasm');
                    if (existsSync(wasmPath)) {
                        sendFile(res, wasmPath, 'application/wasm');
                        return;
                    }
                }

                if (url.pathname.startsWith('/patches/')) {
                    const relative = decodeURIComponent(url.pathname.slice('/patches/'.length));
                    const filePath = join(appDir, 'patches', relative);
                    if (relative.endsWith('.zip')) {
                        let body = zipCache.get(relative);
                        if (!body) {
                            body = await patchZipBuffer(relative);
                            if (body) zipCache.set(relative, body);
                        }
                        if (body) {
                            res.writeHead(200, {
                                'Content-Type': 'application/zip',
                                'Content-Length': body.length,
                                'Cache-Control': 'no-cache',
                            });
                            res.end(body);
                            return;
                        }
                    } else if (existsSync(filePath)) {
                        sendFile(res, filePath, mime[extname(filePath)] || 'application/octet-stream');
                        return;
                    }
                }

                next();
            });
        },
    };
}

function koboHtmlPlugin({ versionStr, versionLink, isDev }) {
    return {
        name: 'kobopatch-html',
        configureServer(server) {
            server.watcher.add(htmlDir);
        },
        handleHotUpdate({ file, server }) {
            const htmlRelative = relative(htmlDir, file).split(sep).join('/');
            if (htmlRelative.startsWith('../') || htmlRelative === '..' || !htmlRelative.endsWith('.html')) return;

            server.ws.send({
                type: 'full-reload',
                path: '*',
            });
            return [];
        },
        transformIndexHtml: {
            order: 'pre',
            async handler(html) {
                html = expandIncludes(html, htmlDir);

                const criticalCss = readFileSync(join(srcDir, 'css', 'critical.css'), 'utf-8');
                const { code } = await transformWithEsbuild(criticalCss, 'critical.css', {
                    loader: 'css',
                    minify: !isDev,
                });
                html = html.replace('<!-- @critical-css -->', `<style>${code.trimEnd()}</style>`);

                html = html.replace('<span id="commit-hash"></span>', `<span id="commit-hash">Version ${versionStr}</span>`);
                html = html.replace(
                    'id="commit-link" class="site-footer-link" href="https://github.com/nicoverbruggen/kobopatch-webui"',
                    `id="commit-link" class="site-footer-link" href="${versionLink}"`,
                );

                return html;
            },
        },
    };
}

export default defineConfig(async ({ command }) => {
    let versionStr = 'unknown';
    let versionLink = 'https://github.com/nicoverbruggen/kobopatch-webui';
    try {
        ({ versionStr, versionLink } = await generateVersion());
    } catch {}

    const isDev = command === 'serve';

    return {
        root: srcDir,
        base: '/',
        publicDir: false,
        plugins: [koboHtmlPlugin({ versionStr, versionLink, isDev }), koboDevStaticPlugin()],
        define: {
            'globalThis.__APP_VERSION__': JSON.stringify(versionStr),
            'globalThis.__DEV_BUILD__': JSON.stringify(isDev),
            'globalThis.__INSTALLABLES__': JSON.stringify(installablesManifest()),
            'globalThis.__PATCH_BLACKLIST_UPDATED__': JSON.stringify(patchBlacklistUpdatedAt()),
        },
        server: {
            host: '127.0.0.1',
            port: 8888,
            strictPort: true,
            fs: {
                allow: [appDir],
            },
        },
        build: {
            outDir: distDir,
            emptyOutDir: false,
            target: 'es2020',
            sourcemap: isDev,
            minify: !isDev,
            assetsInlineLimit: 0,
            rollupOptions: {
                input: join(srcDir, 'index.html'),
                output: {
                    entryFileNames: 'bundle.js',
                    chunkFileNames: 'assets/[name].js',
                    assetFileNames: (assetInfo) => {
                        if (assetInfo.name?.endsWith('.css') || assetInfo.names?.some((name) => name.endsWith('.css'))) return 'css/style.css';
                        if (assetInfo.originalFileNames?.some((name) => name.startsWith('favicon/'))) return 'favicon/[name][extname]';
                        return 'assets/[name][extname]';
                    },
                },
            },
        },
    };
});
