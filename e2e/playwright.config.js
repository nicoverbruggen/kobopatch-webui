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
    },
  },
  webServer: {
    command: 'python3 -m http.server -d ../web/public 8889',
    port: 8889,
    reuseExistingServer: true,
  },
});
