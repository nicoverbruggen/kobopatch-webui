const { defineConfig } = require('@playwright/test');
const path = require('path');

const serial = parseInt(process.env.SLOW_MO || '0', 10) > 0 || process.argv.includes('--headed');
const testsDir = __dirname;
const appDir = path.resolve(testsDir, '../..');

module.exports = defineConfig({
  testDir: testsDir,
  testMatch: '*.spec.js',
  timeout: 300_000,
  retries: 0,
  workers: serial ? 1 : 4,
  fullyParallel: !serial,
  globalSetup: './global-setup.js',
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
    command: `cd ${JSON.stringify(appDir)} && PORT=8889 node scripts/serve.mjs`,
    port: 8889,
    reuseExistingServer: true,
  },
});
