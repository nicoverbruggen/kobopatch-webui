const path = require('path');

const firmwareConfig = require('../firmware-config');

const CACHED_ASSETS = path.resolve(__dirname, '..', 'cached_assets');
const WEBROOT = path.resolve(__dirname, '..', '..', 'web', 'dist');
const WEBROOT_FIRMWARE = path.join(WEBROOT, '_test_firmware.zip');

// Primary firmware entry (first in config) is used for E2E/integration tests.
const primary = firmwareConfig[0];
const FIRMWARE_PATH = path.join(CACHED_ASSETS, `kobo-update-${primary.version}.zip`);
const EXPECTED_SHA1 = primary.checksums;
const ORIGINAL_TGZ_SHA1 = primary.originalTgzChecksum;

module.exports = {
  firmwareConfig,
  FIRMWARE_PATH,
  WEBROOT,
  WEBROOT_FIRMWARE,
  EXPECTED_SHA1,
  ORIGINAL_TGZ_SHA1,
};
