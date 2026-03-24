import esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync, watch } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const webDir = import.meta.dirname;
const repoDir = join(webDir, '..');
const srcDir = join(webDir, 'src');
const distDir = join(webDir, 'dist');
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

async function build() {
    // Clean dist/ (preserve wasm/ which is built separately)
    if (existsSync(distDir)) {
        for (const entry of readdirSync(distDir)) {
            if (entry !== 'wasm') {
                rmSync(join(distDir, entry), { recursive: true, force: true });
            }
        }
    }

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
    });

    // Copy all of src/ to dist/, skipping js/ (bundled separately), css/ (minified), and index.html (generated)
    copyDir(srcDir, distDir, new Set(['js', 'css', 'index.html']));

    // Minify CSS
    mkdirSync(join(distDir, 'css'), { recursive: true });
    const cssSrc = readFileSync(join(srcDir, 'css', 'style.css'), 'utf-8');
    const { code: cssMinified } = await esbuild.transform(cssSrc, {
        loader: 'css',
        minify: !isDev && !isWatch,
    });
    writeFileSync(join(distDir, 'css', 'style.css'), cssMinified);

    // Copy worker files from src/js/ (not bundled, served separately)
    mkdirSync(join(distDir, 'js'), { recursive: true });

    // Copy wasm_exec.js as-is
    const wasmExecSrc = join(srcDir, 'js', 'wasm_exec.js');
    if (existsSync(wasmExecSrc)) {
        cpSync(wasmExecSrc, join(distDir, 'js', 'wasm_exec.js'));
    }

    // Copy patch-worker.js with WASM hash injected
    const workerSrc = join(srcDir, 'js', 'patch-worker.js');
    if (existsSync(workerSrc)) {
        let workerContent = readFileSync(workerSrc, 'utf-8');
        const wasmFile = join(distDir, 'wasm', 'kobopatch.wasm');
        if (existsSync(wasmFile)) {
            const wasmHash = createHash('md5').update(readFileSync(wasmFile)).digest('hex').slice(0, 8);
            workerContent = workerContent.replace(
                "kobopatch.wasm'",
                `kobopatch.wasm?h=${wasmHash}'`
            );
        }
        writeFileSync(join(distDir, 'js', 'patch-worker.js'), workerContent);
    }

    // Get git version string
    let versionStr = 'unknown';
    let versionLink = 'https://github.com/nicoverbruggen/kobopatch-webui';
    try {
        const fullHash = process.env.SOURCE_COMMIT
            ?? String(execSync('git rev-parse HEAD', { cwd: repoDir })).trim();
        versionStr = fullHash.slice(0, 7);
        versionLink = `https://github.com/nicoverbruggen/kobopatch-webui/tree/${fullHash}`;
    } catch {}

    // Generate cache-busted index.html
    const bundleContent = readFileSync(join(distDir, 'bundle.js'));
    const bundleHash = createHash('md5').update(bundleContent).digest('hex').slice(0, 8);

    const cssContent = readFileSync(join(distDir, 'css/style.css'));
    const cssHash = createHash('md5').update(cssContent).digest('hex').slice(0, 8);

    let html = readFileSync(join(srcDir, 'index.html'), 'utf-8');

    // Inline critical.css into the <head> so :root tokens and loading styles
    // are available before style.css arrives on slow connections.
    const criticalCss = readFileSync(join(srcDir, 'css', 'critical.css'), 'utf-8');
    const { code: criticalMinified } = await esbuild.transform(criticalCss, {
        loader: 'css',
        minify: !isDev && !isWatch,
    });
    html = html.replace(
        '<!-- @critical-css -->',
        `<style>${criticalMinified.trimEnd()}</style>`
    );

    // Remove all <script src="js/..."> tags
    html = html.replace(/\s*<script src="js\/[^"]*"><\/script>\n/g, '');
    // Add the bundle script before </body>
    html = html.replace(
        '</body>',
        `    <script src="/bundle.js?h=${bundleHash}"></script>\n</body>`
    );

    // Update CSS cache bust
    html = html.replace(
        /css\/style\.css(?:\?[^"]*)?/,
        `css/style.css?h=${cssHash}`
    );

    // Inject version string and link
    html = html.replace('<span id="commit-hash"></span>', `<span id="commit-hash">Version ${versionStr}</span>`);
    html = html.replace(
        'id="commit-link" class="site-footer-link" href="https://github.com/nicoverbruggen/kobopatch-webui"',
        `id="commit-link" class="site-footer-link" href="${versionLink}"`
    );

    writeFileSync(join(distDir, 'index.html'), html);

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
    });

    await ctx.watch();

    const { host, port } = await ctx.serve({
        servedir: distDir,
        port: 8889,
    });

    console.log(`Dev server running at http://${host}:${port}`);
}
