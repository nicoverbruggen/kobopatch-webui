// Firmware versions used for testing. Shell scripts read this via jq-compatible
// JSON output from: node -e "console.log(JSON.stringify(require('./tests/firmware-config')))"
//
// The primary version is used for WASM integration tests and E2E tests.
// Both primary and secondary are used for patch testing.
module.exports = {
  // Modern Kobo devices w/ more recent chipset (Libra Color, Clara Color, Clara BW)
  primary: {
    version: '4.45.23684',
    shortVersion: '4.45',
    url: 'https://ereaderfiles.kobo.com/firmwares/kobo13/Apr2026/kobo-update-4.45.23684.zip',
    patches: 'patches_4.45.zip',
    patchesSource: '4.45',
  },
  // Older Kobo devices (older chipset, sometimes SD card as storage, etc.)
  secondary: {
    version: '4.38.23684',
    shortVersion: '4.38',
    url: 'https://ereaderfiles.kobo.com/firmwares/kobo9/Apr2026/kobo-update-4.38.23684.zip',
    patches: 'patches_4.38.zip',
    patchesSource: '4.38',
  },
};
