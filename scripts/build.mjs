import esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync, watch } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'zlib';
import { execSync } from 'child_process';
import JSZip from 'jszip';
import { generateVersion } from './version-generate.mjs';

const appDir = join(import.meta.dirname, '..');
const srcDir = join(appDir, 'src');
// Output directory. Defaults to dist/, but the dev server overrides it (via
// DIST_DIR) with a throwaway directory so it never overwrites the production
// dist/ that the e2e and screenshot suites build and serve.
const distDir = process.env.DIST_DIR || join(appDir, 'dist');
const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

function copyDir(src, dst, skip = new Set()) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
        if (skip.has(entry)) continue;
        const srcPath = join(src, entry);
        const dstPath = join(dst, entry);
        if (statSync(srcPath).isDirectory()) {
            copyDir(srcPath, dstPath);
        } else {
            cpSync(srcPath, dstPath);
        }
    }
}

/**
 * Build patch zip files from source directories and copy metadata JSON files.
 * Reads patches/index.json, zips each source directory,
 * and writes the results to dist/patches/.
 */
async function buildPatchZips() {
    const patchesSrcDir = join(appDir, 'patches');
    const patchesDistDir = join(distDir, 'patches');
    mkdirSync(patchesDistDir, { recursive: true });

    const index = JSON.parse(readFileSync(join(patchesSrcDir, 'index.json'), 'utf-8'));

    // Build a zip for each entry
    for (const entry of index) {
        const source = entry.filename.replace(/^patches_/, '').replace(/\.zip$/, '');
        const sourceDir = join(patchesSrcDir, source);
        const zip = new JSZip();

        function addDirToZip(dirPath, zipPath) {
            for (const name of readdirSync(dirPath)) {
                const fullPath = join(dirPath, name);
                const entryPath = zipPath ? `${zipPath}/${name}` : name;
                if (statSync(fullPath).isDirectory()) {
                    zip.folder(entryPath);
                    addDirToZip(fullPath, entryPath);
                } else {
                    zip.file(entryPath, readFileSync(fullPath));
                }
            }
        }

        addDirToZip(sourceDir, '');
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        writeFileSync(join(patchesDistDir, entry.filename), zipBuffer);
    }

    // Copy JSON metadata files
    cpSync(join(patchesSrcDir, 'index.json'), join(patchesDistDir, 'index.json'));

    for (const jsonFile of ['blacklist.json', 'downloads.json']) {
        const src = join(patchesSrcDir, jsonFile);
        if (existsSync(src)) cpSync(src, join(patchesDistDir, jsonFile));
    }
}

// Extensions worth precompressing. Deliberately excludes already-compressed
// archives (.zip/.tgz/.gz) and images: re-compressing them wastes CPU for ~0
// gain, and — crucially — the asset download-progress UI assumes the served
// Content-Length equals the on-wire byte count it streams (see
// scripts/serve-dist.mjs and fetchWithProgress in src/js/shell/dom.js). Adding
// Content-Encoding to those archives would make the compressed Content-Length
// smaller than the decompressed stream the browser reads, breaking the percentage.
const PRECOMPRESS_EXT = new Set(['.js', '.css', '.json', '.svg', '.wasm', '.map', '.webmanifest', '.txt', '.xml']);

/**
 * Write `.gz` and `.br` siblings next to each compressible file in `dir`, so the
 * production server (scripts/serve-dist.mjs) can serve them with Content-Encoding
 * at zero per-request CPU. Only kept when actually smaller; tiny files are skipped
 * (compression overhead isn't worth it and can grow them). Brotli quality is eased
 * for multi-MB files (e.g. the WASM blob) where q11 is disproportionately slow.
 */
function precompressDir(dir) {
    for (const name of readdirSync(dir)) {
        if (name.endsWith('.gz') || name.endsWith('.br')) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            precompressDir(full);
            continue;
        }
        if (!PRECOMPRESS_EXT.has(extname(name)) || st.size < 1024) continue;

        const data = readFileSync(full);
        const gz = gzipSync(data, { level: 9 });
        if (gz.length < st.size) writeFileSync(full + '.gz', gz);

        const quality = st.size > 1_000_000 ? 9 : 11;
        const br = brotliCompressSync(data, {
            params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: quality,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: st.size,
            },
        });
        if (br.length < st.size) writeFileSync(full + '.br', br);
    }
}

/**
 * Derive the build-time installables manifest from `installables.lock`: each id's
 * pinned version, plus whether its asset is present in `src/assets/` (i.e. this
 * build will ship it). Injected into the bundle via esbuild `define` so the app
 * reads versions/availability with no runtime `*-release.json` fetch.
 */
function installablesManifest() {
    const lockPath = join(appDir, 'installables.lock');
    if (!existsSync(lockPath)) return {};
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const manifest = {};
    for (const [name, entry] of Object.entries(lock.installables || {})) {
        manifest[name] = {
            version: entry.version,
            available: existsSync(join(srcDir, 'assets', entry.asset)),
        };
    }
    return manifest;
}

async function build() {
    // Clean dist/ (preserve wasm/ which is built separately)
    if (existsSync(distDir)) {
        for (const entry of readdirSync(distDir)) {
            if (entry !== 'wasm') {
                rmSync(join(distDir, entry), { recursive: true, force: true });
            }
        }
    }

    // Get version string early so it's available for JS bundle and HTML.
    let versionStr = 'unknown';
    let versionLink = 'https://github.com/nicoverbruggen/kobopatch-webui';
    try {
        ({ versionStr, versionLink } = await generateVersion());
    } catch {}

    const installables = installablesManifest();

    // Build JS bundle
    await esbuild.build({
        entryPoints: [join(srcDir, 'js', 'app.js')],
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        outfile: join(distDir, 'bundle.js'),
        minify: !isDev && !isWatch,
        sourcemap: isDev || isWatch,
        logLevel: 'warning',
        define: {
            'globalThis.__APP_VERSION__': JSON.stringify(versionStr),
            // True only for the watch build, which is exclusively what the local
            // dev server (`npm run dev`) runs — so the UI can mark itself "DEV".
            'globalThis.__DEV_BUILD__': JSON.stringify(isWatch),
            // Installable add-on versions + availability, from installables.lock.
            'globalThis.__INSTALLABLES__': JSON.stringify(installables),
        },
    });

    // Copy all of src/ to dist/, skipping js/ (bundled separately), css/ (minified), and index.html (generated)
    copyDir(srcDir, distDir, new Set(['js', 'css', 'index.html']));

    // NickelMenu feature modules include runtime-fetched preset assets.
    copyDir(join(srcDir, 'js', 'nickelmenu'), join(distDir, 'js', 'nickelmenu'));

    // Build patch zips from source directories in patches/
    await buildPatchZips();

    // Bundle and minify CSS (@import statements are resolved by esbuild)
    mkdirSync(join(distDir, 'css'), { recursive: true });
    await esbuild.build({
        entryPoints: [join(srcDir, 'css', 'style.css')],
        bundle: true,
        outfile: join(distDir, 'css', 'style.css'),
        minify: !isDev && !isWatch,
        logLevel: 'warning',
    });

    // Copy worker files from src/js/workers/ (not bundled, served separately)
    mkdirSync(join(distDir, 'js', 'workers'), { recursive: true });

    // Copy wasm_exec.js as-is
    const wasmExecSrc = join(srcDir, 'js', 'wasm_exec.js');
    if (existsSync(wasmExecSrc)) {
        cpSync(wasmExecSrc, join(distDir, 'js', 'workers', 'wasm_exec.js'));
    }

    // Copy patch-worker.js with WASM hash injected
    const workerSrc = join(srcDir, 'js', 'workers', 'patch-worker.js');
    if (existsSync(workerSrc)) {
        let workerContent = readFileSync(workerSrc, 'utf-8');
        const wasmFile = join(distDir, 'wasm', 'kobopatch.wasm');
        if (existsSync(wasmFile)) {
            const wasmHash = createHash('md5').update(readFileSync(wasmFile)).digest('hex').slice(0, 8);
            workerContent = workerContent.replace("kobopatch.wasm'", `kobopatch.wasm?h=${wasmHash}'`);
        }
        writeFileSync(join(distDir, 'js', 'workers', 'patch-worker.js'), workerContent);
    }

    // Generate cache-busted index.html
    const bundleContent = readFileSync(join(distDir, 'bundle.js'));
    const bundleHash = createHash('md5').update(bundleContent).digest('hex').slice(0, 8);

    const cssContent = readFileSync(join(distDir, 'css/style.css'));
    const cssHash = createHash('md5').update(cssContent).digest('hex').slice(0, 8);

    let html = readFileSync(join(srcDir, 'index.html'), 'utf-8');

    // Expand <!-- include: path --> directives with the contents of
    // src/html/<path>. Repeats until no directives remain, supporting nesting.
    const includeRe = /<!--\s*include:\s*([\w./-]+)\s*-->/g;
    while (includeRe.test(html)) {
        html = html.replace(includeRe, (_, p) => readFileSync(join(srcDir, 'html', p), 'utf-8'));
    }

    // Inline critical.css into the <head> so :root tokens and loading styles
    // are available before style.css arrives on slow connections.
    const criticalCss = readFileSync(join(srcDir, 'css', 'critical.css'), 'utf-8');
    const { code: criticalMinified } = await esbuild.transform(criticalCss, {
        loader: 'css',
        minify: !isDev && !isWatch,
    });
    html = html.replace('<!-- @critical-css -->', `<style>${criticalMinified.trimEnd()}</style>`);

    // Remove all <script src="js/..."> tags
    html = html.replace(/\s*<script src="js\/[^"]*"><\/script>\n/g, '');
    // Add the bundle script before </body>
    html = html.replace('</body>', `    <script src="/bundle.js?h=${bundleHash}"></script>\n</body>`);

    // Update CSS cache bust
    html = html.replace(/css\/style\.css(?:\?[^"]*)?/, `css/style.css?h=${cssHash}`);

    // Inject version string and link
    html = html.replace('<span id="commit-hash"></span>', `<span id="commit-hash">Version ${versionStr}</span>`);
    html = html.replace(
        'id="commit-link" class="site-footer-link" href="https://github.com/nicoverbruggen/kobopatch-webui"',
        `id="commit-link" class="site-footer-link" href="${versionLink}"`,
    );

    writeFileSync(join(distDir, 'index.html'), html);

    // Precompress static assets for the production server. Skipped for dev/watch
    // builds: brotli is slow, and the dev server (NO_CACHE) serves identity anyway.
    // index.html is intentionally not on disk-compressed here — serve-dist.mjs
    // injects analytics into it at request time and compresses that result itself.
    if (!isDev && !isWatch) {
        precompressDir(distDir);
    }

    console.log(`Built to ${distDir} (bundle: ${bundleHash}, css: ${cssHash}, version: ${versionStr})`);
}

await build();

// Watch mode: rebuild on source changes
if (isWatch) {
    let rebuildTimer = null;

    watch(srcDir, { recursive: true }, (eventType, filename) => {
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(async () => {
            console.log(`\nChange detected: ${filename}`);
            try {
                await build();
            } catch (err) {
                console.error('Build failed:', err.message);
            }
        }, 200);
    });

    console.log('Watching src/ for changes...');
}

// Dev server mode
if (isDev) {
    const ctx = await esbuild.context({
        entryPoints: [join(srcDir, 'js', 'app.js')],
        bundle: true,
        format: 'iife',
        target: ['es2020'],
        outfile: join(distDir, 'bundle.js'),
        minify: false,
        sourcemap: true,
        logLevel: 'warning',
        define: {
            'globalThis.__INSTALLABLES__': JSON.stringify(installablesManifest()),
        },
    });

    await ctx.watch();

    const { host, port } = await ctx.serve({
        servedir: distDir,
        port: 8889,
    });

    console.log(`Dev server running at http://${host}:${port}`);
}
