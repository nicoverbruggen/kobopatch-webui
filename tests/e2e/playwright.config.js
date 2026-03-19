const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 300_000,
  retries: 0,
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
    command: 'cd ../../web && npm install && node build.mjs && cd ../kobopatch-wasm && bash build.sh && cd ../web && python3 -m http.server -d dist 8889',
    port: 8889,
    reuseExistingServer: true,
  },
});
