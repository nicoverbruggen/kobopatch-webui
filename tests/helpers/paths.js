const path = require('path');

const { primary } = require('../firmware-config');

const CACHED_ASSETS = path.resolve(__dirname, '..', 'cached_assets');
const WEBROOT = path.resolve(__dirname, '..', '..', 'web', 'dist');
const WEBROOT_FIRMWARE = path.join(WEBROOT, '_test_firmware.zip');

const FIRMWARE_PATH = path.join(CACHED_ASSETS, `kobo-update-${primary.version}.zip`);
const EXPECTED_SHA1 = primary.checksums;
const ORIGINAL_TGZ_SHA1 = primary.originalTgzChecksum;

module.exports = {
  FIRMWARE_PATH,
  WEBROOT,
  WEBROOT_FIRMWARE,
  EXPECTED_SHA1,
  ORIGINAL_TGZ_SHA1,
};
