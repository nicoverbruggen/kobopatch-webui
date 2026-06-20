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

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (text) => color('1', text);
const dim = (text) => color('2', text);
const green = (text) => color('32', text);
const red = (text) => color('31', text);
const yellow = (text) => color('33', text);

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
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

const results = [];

// Runs a named phase, timing it and recording the outcome for the final summary.
// `task` may return the string 'skipped' to mark the phase as skipped.
async function phase(name, task) {
  console.log(`\n${bold(`━━━ ${name} `.padEnd(60, '━'))}`);
  const start = performance.now();
  let status = 'passed';
  try {
    const outcome = await task();
    if (outcome === 'skipped') status = 'skipped';
  } catch (error) {
    status = 'failed';
    results.push({ name, status, duration: performance.now() - start });
    printSummary();
    console.error(`\n${red('✗')} ${name} failed:\n  ${error.message}`);
    process.exit(1);
  }
  const duration = performance.now() - start;
  results.push({ name, status, duration });
  const mark = status === 'skipped' ? yellow('○ skipped') : green('✓ done');
  console.log(dim(`    ${mark} in ${formatDuration(duration)}`));
}

function printSummary() {
  const totalWidth = Math.max(...results.map((r) => r.name.length), 'Phase'.length);
  const total = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n${bold('━━━ Test summary '.padEnd(60, '━'))}`);
  console.log(dim(`  ${'Phase'.padEnd(totalWidth)}   Status     Duration`));
  console.log(dim(`  ${'─'.repeat(totalWidth)}   ────────   ────────`));

  for (const { name, status, duration } of results) {
    const statusLabel =
      status === 'passed' ? green('passed '.padEnd(8))
      : status === 'skipped' ? yellow('skipped')
      : red('failed ');
    console.log(`  ${name.padEnd(totalWidth)}   ${statusLabel}   ${formatDuration(duration).padStart(8)}`);
  }

  console.log(dim(`  ${'─'.repeat(totalWidth)}   ────────   ────────`));
  console.log(`  ${bold('Total'.padEnd(totalWidth))}   ${' '.repeat(8)}   ${bold(formatDuration(total).padStart(8))}`);
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

const suiteStart = performance.now();

await phase('Install dependencies', () => run('npm', ['install']));

await phase('Lint', () => run('npx', ['eslint', '.']));

await phase('Unit tests', () => run('npm', ['run', 'test:unit']));

await phase('Build WASM', () => run(join(toolsDir, 'kobopatch-wasm/build.sh'), []));

await phase('Build web app', () => run('node', ['scripts/build.mjs']));

await phase('Validate dist resources', () => run('npm', ['run', 'validate:dist']));

await phase('Check patches blacklist', () => run('npm', ['run', 'test:patches:check']));

await phase('WASM integration test', () => {
  const primaryFirmware = join(cachedAssets, `kobo-update-${firmwareConfig.primary.version}.zip`);
  if (!existsSync(primaryFirmware)) return 'skipped';
  return run(join(toolsDir, 'kobopatch-wasm/test-integration.sh'), []);
});

await phase('E2E tests (Playwright)', () => {
  const e2eArgs = [];
  if (headed) e2eArgs.push('--headed');
  if (grep) e2eArgs.push('--', '--grep', grep);
  e2eArgs.push(...extraArgs);
  return run(join(e2eDir, 'scripts/run-e2e.sh'), e2eArgs);
});

await phase('Screenshots (Playwright)', () => run(join(e2eDir, 'scripts/run-screenshots.sh'), []));

printSummary();
console.log(`\n${green('✓ All test phases passed')} ${dim(`(${formatDuration(performance.now() - suiteStart)} total)`)}`);
