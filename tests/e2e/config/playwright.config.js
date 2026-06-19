const { defineConfig } = require('@playwright/test');
const path = require('path');

const serial = parseInt(process.env.SLOW_MO || '0', 10) > 0 || process.argv.includes('--headed');
const configDir = __dirname;
const e2eDir = path.resolve(configDir, '..');
const appDir = path.resolve(e2eDir, '../..');
const testResultsDir = path.join(appDir, 'tmp', 'test-results', 'e2e');

module.exports = defineConfig({
  testDir: path.join(e2eDir, 'specs'),
  testMatch: '*.spec.js',
  outputDir: testResultsDir,
  timeout: 300_000,
  retries: 0,
  workers: serial ? 1 : 4,
  fullyParallel: !serial,
  globalSetup: path.join(configDir, 'global-setup.js'),
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:8889',
    actionTimeout: 10_000,
    launchOptions: {
      args: ['--disable-dev-shm-usage'],
      slowMo: parseInt(process.env.SLOW_MO || '0', 10),
    },
  },
  webServer: {
    command: `cd ${JSON.stringify(appDir)} && PORT=8889 node scripts/serve-dist.mjs`,
    port: 8889,
    reuseExistingServer: true,
  },
});
