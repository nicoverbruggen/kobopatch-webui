// Firmware versions used for testing. Shell scripts read this via jq-compatible
// JSON output from: node -e "console.log(JSON.stringify(require('./tests/e2e/config/firmware-config')))"
//
// The primary version is used for WASM integration tests and E2E tests.
// `all` is every patch family patches/index.json still serves, newest first.
// The patch compatibility sweep runs over all of them, not just primary and
// secondary: patches/blacklist.json is rebuilt from scratch on every run, so a
// family left out here loses its entry while still being offered to devices,
// and test:patches:check then fails on the diff.

// Modern Kobo devices w/ more recent chipset (Libra Color, Clara Color, Clara BW)
const primary = {
    version: '4.46.23836',
    shortVersion: '4.46',
    url: 'https://ereaderfiles.kobo.com/firmwares/kobo13/Aug2026/kobo-update-4.46.23836.zip',
    patches: 'patches_4.46.zip',
    patchesSource: '4.46',
};

// The modern-device line 4.46 replaced. Still served, because 4.46 only started
// rolling out and most devices have not taken it yet.
const previous = {
    version: '4.45.23697',
    shortVersion: '4.45',
    url: 'https://ereaderfiles.kobo.com/firmwares/kobo13/May2026/kobo-update-4.45.23697.zip',
    patches: 'patches_4.45.zip',
    patchesSource: '4.45',
};

// Older Kobo devices (older chipset, sometimes SD card as storage, etc.)
const secondary = {
    version: '4.38.23697',
    shortVersion: '4.38',
    url: 'https://ereaderfiles.kobo.com/firmwares/kobo9/May2026/kobo-update-4.38.23697.zip',
    patches: 'patches_4.38.zip',
    patchesSource: '4.38',
};

module.exports = { primary, previous, secondary, all: [primary, previous, secondary] };
