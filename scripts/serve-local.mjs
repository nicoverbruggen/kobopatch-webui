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
    stdio: 'inherit',
  });
}

if (process.argv.includes('--fake-analytics')) {
  process.env.UMAMI_WEBSITE_ID = 'fake';
  process.env.UMAMI_SCRIPT_URL = 'data:,';
}

await run('node', [join(appDir, 'tools/installables/installables.mjs'), '--src', '--skip-if-present']);

console.log('Building JS bundle...');
await run('npm', ['install', '--silent']);
await run('npm', ['run', 'build']);

if (!existsSync(join(distDir, 'wasm/kobopatch.wasm'))) {
  console.log('WASM binary not found, building...');
  if (!existsSync(join(wasmDir, 'kobopatch-src'))) {
    await run(join(wasmDir, 'setup.sh'), []);
  }
  await run(join(wasmDir, 'build.sh'), []);
}

if (devMode) {
  console.log('Serving at http://localhost:8888 (dev mode, watching for changes)');
  const server = spawnLongRunning('node', ['scripts/serve-dist.mjs'], { env: { NO_CACHE: '1' } });
  const stopServer = () => {
    if (!server.killed) server.kill();
  };
  process.on('exit', stopServer);
  process.on('SIGINT', () => {
    stopServer();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    stopServer();
    process.exit(143);
  });
  await run('node', ['scripts/build.mjs', '--watch']);
} else {
  console.log('Serving at http://localhost:8888');
  await run('node', ['scripts/serve-dist.mjs']);
}
