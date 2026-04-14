const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const JSZip = require('jszip');

const { primary } = require('../firmware-config');

const CACHED_ASSETS = path.resolve(__dirname, '..', 'cached_assets');
const WEBROOT = path.resolve(__dirname, '..', '..', 'web', 'dist');
const WEBROOT_FIRMWARE = path.join(WEBROOT, '_test_firmware.zip');

const FIRMWARE_PATH = path.join(CACHED_ASSETS, `kobo-update-${primary.version}.zip`);

let cachedOriginalTgzSha1 = null;
// Computes the SHA1 of KoboRoot.tgz inside the firmware zip. Used as a
// reference for the "restore original firmware" flow.
async function getOriginalTgzSha1() {
  if (cachedOriginalTgzSha1) return cachedOriginalTgzSha1;
  const zip = await JSZip.loadAsync(fs.readFileSync(FIRMWARE_PATH));
  const entry = zip.file('KoboRoot.tgz');
  if (!entry) throw new Error(`KoboRoot.tgz not found in ${FIRMWARE_PATH}`);
  const data = await entry.async('nodebuffer');
  cachedOriginalTgzSha1 = crypto.createHash('sha1').update(data).digest('hex');
  return cachedOriginalTgzSha1;
}

module.exports = {
  FIRMWARE_PATH,
  WEBROOT,
  WEBROOT_FIRMWARE,
  getOriginalTgzSha1,
};
