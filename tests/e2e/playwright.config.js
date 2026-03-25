const { defineConfig } = require('@playwright/test');

const serial = parseInt(process.env.SLOW_MO || '0', 10) > 0 || process.argv.includes('--headed');

module.exports = defineConfig({
  testDir: '.',
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
      serialMo: parseInt(process.env.SLOW_MO || '0', 10),
    },
  },
  webServer: {
    command: 'cd ../../web && npm install && node build.mjs && cd ../kobopatch-wasm && bash build.sh && cd ../web && PORT=8889 node serve.mjs',
    port: 8889,
    reuseExistingServer: true,
  },
});
