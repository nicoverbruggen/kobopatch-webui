import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');
const distDir = join(appDir, 'dist');
const wasmDir = join(appDir, 'tools/kobopatch-wasm');
const devMode = process.argv.includes('--dev');

function run(command, args, options = {}) {
    const result = spawn(command, args, {
        cwd: options.cwd ?? appDir,
        env: { ...process.env, ...options.env },
        stdio: options.stdio ?? 'inherit',
    });

    return new Promise((resolve, reject) => {
        result.on('error', reject);
        result.on('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`));
        });
    });
}

function spawnLongRunning(command, args, options = {}) {
    return spawn(command, args, {
        cwd: options.cwd ?? appDir,
        env: { ...process.env, ...options.env },
        stdio: options.stdio ?? 'inherit',
    });
}

if (process.argv.includes('--fake-analytics')) {
    process.env.UMAMI_WEBSITE_ID = 'fake';
    process.env.UMAMI_SCRIPT_URL = 'data:,';
}

await run('node', [join(appDir, 'tools/installables/installables.mjs'), '--src', '--skip-if-present']);

await run('npm', ['install', '--silent']);

// Build the WASM binary once into the canonical dist/wasm and reuse it; the
// Go compile is slow, so we never want it on the dev server's hot path.
if (!existsSync(join(distDir, 'wasm/kobopatch.wasm'))) {
    console.log('WASM binary not found, building...');
    if (!existsSync(join(wasmDir, 'kobopatch-src'))) {
        await run(join(wasmDir, 'setup.sh'), []);
    }
    await run(join(wasmDir, 'build.sh'), []);
}

if (devMode) {
    await runDevServer();
} else {
    console.log('Building...');
    await run('npm', ['run', 'build']);
    console.log('Serving at http://localhost:8888');
    await run('node', ['scripts/serve-dist.mjs']);
}

/**
 * Dev server: Vite serves src/index.html directly, with real module/CSS hot reload.
 * The custom Vite plugin serves the few generated/static resources that live
 * outside src/ during production builds: patch ZIPs, the WASM binary, and
 * wasm_exec.js at the worker-relative path.
 */
async function runDevServer() {
    const viteBin = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
    const server = spawnLongRunning('node', [viteBin, '--host', '127.0.0.1', '--port', '8888'], { stdio: ['ignore', 'inherit', 'inherit'] });

    let shuttingDown = false;
    const shutDown = (code = 0) => {
        if (shuttingDown) return;
        shuttingDown = true;

        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        if (!server.killed) server.kill();
        console.log('\nDev server stopped.');
        process.exit(code);
    };

    // Raw mode suppresses the default SIGINT, so Ctrl-C (\u0003) and Ctrl-D
    // (\u0004) arrive here as data instead of signals.
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (key) => {
            if (key === 'q' || key === 'Q' || key === '\u0003' || key === '\u0004') shutDown(0);
        });
    }
    process.on('SIGINT', () => shutDown(130));
    process.on('SIGTERM', () => shutDown(143));

    // If Vite dies on its own, tear down too.
    server.on('exit', () => shutDown(1));

    printDevBanner();
}

function printDevBanner() {
    const content = [
        'kobopatch-webui — dev server',
        '',
        'Local:    http://localhost:8888',
        'Server:   Vite',
        'Watching: src/, patches/',
        'Reload:   Vite hot reload',
        '',
        'Press q or Ctrl-C to quit',
    ];
    const width = Math.max(...content.map((line) => line.length)) + 2;
    const top = '┌' + '─'.repeat(width) + '┐';
    const bottom = '└' + '─'.repeat(width) + '┘';
    const body = content.map((line) => '│ ' + line.padEnd(width - 1) + '│').join('\n');
    console.log('\n' + top + '\n' + body + '\n' + bottom + '\n');
}
