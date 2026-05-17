const { setupFirmwareSymlink, cleanupFirmwareSymlink, hasFirmwareZip } = require('./helpers/assets');

module.exports = function globalSetup() {
    if (hasFirmwareZip()) setupFirmwareSymlink();

    // Return a teardown function (Playwright >= 1.30)
    return () => cleanupFirmwareSymlink();
};
