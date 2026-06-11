import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');
const distDir = join(appDir, 'dist');
const devDistDir = join(appDir, 'dist-dev');
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
  runDevServer();
} else {
  console.log('Building...');
  await run('npm', ['run', 'build']);
  console.log('Serving at http://localhost:8888');
  await run('node', ['scripts/serve-dist.mjs']);
}

/**
 * Dev server: a watch build + static server that live in their own throwaway
 * dist-dev/ directory, so they never conflict with the production dist/ used by
 * the e2e and screenshot suites. The directory is removed on exit. Press q (or
 * Ctrl-C) to quit.
 */
function runDevServer() {
  // Fresh output dir, seeded with the prebuilt WASM so the watch build (which
  // preserves wasm/) doesn't recompile Go on startup.
  rmSync(devDistDir, { recursive: true, force: true });
  mkdirSync(join(devDistDir, 'wasm'), { recursive: true });
  cpSync(join(distDir, 'wasm', 'kobopatch.wasm'), join(devDistDir, 'wasm', 'kobopatch.wasm'));

  const childEnv = { DIST_DIR: devDistDir };
  // Children don't read stdin (the parent owns it for the quit key), so hand
  // them only stdout/stderr.
  const childStdio = ['ignore', 'inherit', 'inherit'];
  const builder = spawnLongRunning('node', ['scripts/build.mjs', '--watch'], { env: childEnv, stdio: childStdio });
  const server = spawnLongRunning('node', ['scripts/serve-dist.mjs'], { env: { ...childEnv, NO_CACHE: '1', LOG_REQUESTS: '1' }, stdio: childStdio });

  let shuttingDown = false;
  const shutDown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    for (const child of [builder, server]) {
      if (!child.killed) child.kill();
    }
    rmSync(devDistDir, { recursive: true, force: true });
    console.log('\nDev server stopped — removed dist-dev/.');
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

  // If a child dies on its own, tear the rest down too.
  builder.on('exit', () => shutDown(1));
  server.on('exit', () => shutDown(1));

  printDevBanner();
}

function printDevBanner() {
  const content = [
    'kobopatch-webui — dev server',
    '',
    'Local:    http://localhost:8888',
    'Output:   dist-dev/  (removed on exit)',
    'Watching: src/ for changes',
    'Requests: logged below as they are served',
    '',
    'Press q or Ctrl-C to quit',
  ];
  const width = Math.max(...content.map(line => line.length)) + 2;
  const top = '┌' + '─'.repeat(width) + '┐';
  const bottom = '└' + '─'.repeat(width) + '┘';
  const body = content.map(line => '│ ' + line.padEnd(width - 1) + '│').join('\n');
  console.log('\n' + top + '\n' + body + '\n' + bottom + '\n');
}
