import { build as viteBuild } from 'vite';
import { constants as fsConstants, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import JSZip from 'jszip';

const appDir = join(import.meta.dirname, '..');
const srcDir = join(appDir, 'src');
const distDir = process.env.DIST_DIR || join(appDir, 'dist');
const isDev = process.argv.includes('--dev');

function copyDir(src, dst, skip = new Set()) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
        if (entry === '.DS_Store') continue;
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

async function buildPatchZips() {
    const patchesSrcDir = join(appDir, 'patches');
    const patchesDistDir = join(distDir, 'patches');
    mkdirSync(patchesDistDir, { recursive: true });

    const index = JSON.parse(readFileSync(join(patchesSrcDir, 'index.json'), 'utf-8'));

    for (const entry of index) {
        const source = entry.filename.replace(/^patches_/, '').replace(/\.zip$/, '');
        const sourceDir = join(patchesSrcDir, source);
        const zip = new JSZip();

        function addDirToZip(dirPath, zipPath) {
            for (const name of readdirSync(dirPath)) {
                if (name.startsWith('.')) continue;
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

    cpSync(join(patchesSrcDir, 'index.json'), join(patchesDistDir, 'index.json'));

    for (const jsonFile of ['blacklist.json', 'downloads.json']) {
        const src = join(patchesSrcDir, jsonFile);
        if (existsSync(src)) cpSync(src, join(patchesDistDir, jsonFile));
    }
}

// Deliberately excludes already-compressed archives (.zip/.tgz/.gz) and images:
// their Content-Length must equal the streamed bytes fetchWithProgress reads.
const PRECOMPRESS_EXT = new Set(['.js', '.css', '.json', '.svg', '.wasm', '.map', '.webmanifest', '.txt', '.xml']);

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

function cleanDist() {
    if (!existsSync(distDir)) return;
    for (const entry of readdirSync(distDir)) {
        if (entry !== 'wasm') {
            rmSync(join(distDir, entry), { recursive: true, force: true });
        }
    }
}

// Keep the original paths for local tooling. Production pages request files that
// physically exist only in builds containing those bytes.
const fingerprintedAssets = new Map();
function assetUrl(relativePath) {
    const file = join(distDir, relativePath);
    if (isDev) return `/${relativePath}`;

    const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
    const url = `/static/${hash}/${basename(file)}`;
    fingerprintedAssets.set(file, join(distDir, url));
    return url;
}

function copyFingerprintedAssets() {
    for (const [file, destination] of fingerprintedAssets) {
        mkdirSync(dirname(destination), { recursive: true });
        for (const suffix of ['', '.br', '.gz']) {
            if (existsSync(file + suffix)) copyFileSync(file + suffix, destination + suffix, fsConstants.COPYFILE_FICLONE);
        }
    }
}

function copyWorkerFiles() {
    mkdirSync(join(distDir, 'js', 'workers'), { recursive: true });

    const wasmExecSrc = join(srcDir, 'js', 'wasm_exec.js');
    if (existsSync(wasmExecSrc)) {
        cpSync(wasmExecSrc, join(distDir, 'js', 'workers', 'wasm_exec.js'));
    }

    const workerSrc = join(srcDir, 'js', 'workers', 'patch-worker.js');
    if (existsSync(workerSrc)) {
        let workerContent = readFileSync(workerSrc, 'utf-8');
        const wasmFile = join(distDir, 'wasm', 'kobopatch.wasm');
        if (existsSync(wasmFile)) {
            workerContent = workerContent.replace('../../wasm/kobopatch.wasm', assetUrl('wasm/kobopatch.wasm'));
        }
        writeFileSync(join(distDir, 'js', 'workers', 'patch-worker.js'), workerContent);
    }
}

async function build() {
    cleanDist();

    await viteBuild({
        configFile: join(appDir, 'vite.config.mjs'),
        build: {
            outDir: distDir,
            emptyOutDir: false,
            minify: !isDev,
            sourcemap: isDev,
        },
    });

    copyDir(srcDir, distDir, new Set(['js', 'css', 'html', 'index.html']));
    await buildPatchZips();
    copyWorkerFiles();

    const index = join(distDir, 'index.html');
    const html = readFileSync(index, 'utf8')
        .replace(/\/?bundle\.js(?:\?[^"]*)?/, assetUrl('bundle.js'))
        .replace(/\/?css\/style\.css(?:\?[^"]*)?/, assetUrl('css/style.css'));
    writeFileSync(index, html);

    if (!isDev) {
        precompressDir(distDir);
        copyFingerprintedAssets();
    }

    console.log(`Built to ${distDir}`);
}

await build();
