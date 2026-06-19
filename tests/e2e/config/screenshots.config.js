const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config.js');

module.exports = defineConfig({
  ...base,
  testMatch: 'screenshots.mjs',
  projects: [
    {
      name: 'desktop',
      use: { ...base.use, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 },
    },
    {
      name: 'mobile',
      use: {
        ...base.use,
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
