const { setupFirmwareSymlink, cleanupFirmwareSymlink, hasFirmwareZip } = require('../support/assets');

module.exports = function globalSetup() {
    if (hasFirmwareZip()) setupFirmwareSymlink();

    // Return a teardown function (Playwright >= 1.30)
    return () => cleanupFirmwareSymlink();
};
