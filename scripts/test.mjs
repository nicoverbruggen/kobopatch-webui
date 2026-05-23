import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const appDir = join(import.meta.dirname, '..');
const e2eDir = join(appDir, 'tests/e2e');
const toolsDir = join(appDir, 'tools');
const cachedAssets = join(e2eDir, 'cached_assets');
const firmwareConfigPath = join(e2eDir, 'config/firmware-config.js');
const require = createRequire(import.meta.url);
const firmwareConfig = require(firmwareConfigPath);

let headed = false;
let grep = '';
const extraArgs = [];

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--headed') {
    headed = true;
    process.env.SLOW_MO = '1000';
  } else if (arg === '--test') {
    grep = process.argv[index + 1] ?? '';
    index += 1;
  } else {
    extraArgs.push(arg);
  }
}

function run(command, args, options = {}) {
  const result = spawn(command, args, {
    cwd: options.cwd ?? appDir,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });

  return new Promise((resolve, reject) => {
    result.on('error', reject);
    result.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`));
    });
  });
}

async function download(url, filePath) {
  await run('curl', ['-fL', '--progress-bar', '-o', `${filePath}.tmp`, url]);
  renameSync(`${filePath}.tmp`, filePath);
}

const missing = [firmwareConfig.primary, firmwareConfig.secondary]
  .map(({ version, url }) => ({ version, url, file: join(cachedAssets, `kobo-update-${version}.zip`) }))
  .filter(({ file }) => !existsSync(file));

if (missing.length > 0) {
  console.log('The following firmware test assets are not cached locally (~150 MB each):');
  for (const { version } of missing) console.log(`  - ${version}`);
  console.log('');
  const rl = createInterface({ input, output });
  const answer = await rl.question('Download them now? Tests that need firmware will be skipped otherwise. [y/N] ');
  rl.close();

  if (/^y$/i.test(answer)) {
    mkdirSync(cachedAssets, { recursive: true });
    for (const { version, url, file } of missing) {
      console.log(`Downloading firmware ${version}...`);
      await download(url, file);
      console.log('');
    }
  }
}

if (!existsSync(join(toolsDir, 'kobopatch-wasm/kobopatch-src'))) {
  await run(join(toolsDir, 'kobopatch-wasm/setup.sh'), []);
}

await run('node', [join(toolsDir, 'installables/installables.mjs'), '--src', '--skip-if-present']);

console.log('=== Installing dependencies ===');
await run('npm', ['install']);

console.log('\n=== Linting ===');
await run('npx', ['eslint', '.']);

console.log('\n=== Running unit tests ===');
await run('npm', ['run', 'test:unit']);

console.log('\n=== Building WASM ===');
await run(join(toolsDir, 'kobopatch-wasm/build.sh'), []);

console.log('\n=== Building web app ===');
await run('node', ['scripts/build.mjs']);

console.log('\n=== Validating dist resources ===');
await run('npm', ['run', 'validate:dist']);

console.log('\n=== Checking patches/blacklist.json is up to date ===');
await run('npm', ['run', 'test:patches:check']);

console.log('\n=== Running WASM integration test ===');
const primaryFirmware = join(cachedAssets, `kobo-update-${firmwareConfig.primary.version}.zip`);
if (existsSync(primaryFirmware)) {
  await run(join(toolsDir, 'kobopatch-wasm/test-integration.sh'), []);
} else {
  console.log('Skipped (firmware not downloaded)');
}

console.log('\n=== Running E2E tests (Playwright) ===');
const e2eArgs = [];
if (headed) e2eArgs.push('--headed');
if (grep) e2eArgs.push('--', '--grep', grep);
e2eArgs.push(...extraArgs);
await run(join(e2eDir, 'scripts/run-e2e.sh'), e2eArgs);
