const fs = require('fs');
const path = require('path');
const { WEBROOT, WEBROOT_FIRMWARE, FIRMWARE_PATH } = require('./paths');

function hasNickelMenuAssets() {
  return fs.existsSync(path.join(WEBROOT, 'nickelmenu', 'NickelMenu.zip'))
    && fs.existsSync(path.join(WEBROOT, 'nickelmenu', 'features', 'custom-menu', 'items'));
}

function hasKoreaderAssets() {
  return fs.existsSync(path.join(WEBROOT, 'koreader', 'koreader-kobo.zip'))
    && fs.existsSync(path.join(WEBROOT, 'koreader', 'release.json'));
}

function hasFirmwareZip() {
  return fs.existsSync(FIRMWARE_PATH);
}

function setupFirmwareSymlink() {
  try { fs.unlinkSync(WEBROOT_FIRMWARE); } catch {}
  fs.symlinkSync(path.resolve(FIRMWARE_PATH), WEBROOT_FIRMWARE);
}

function cleanupFirmwareSymlink() {
  try { fs.unlinkSync(WEBROOT_FIRMWARE); } catch {}
}

module.exports = {
  hasNickelMenuAssets,
  hasKoreaderAssets,
  hasFirmwareZip,
  setupFirmwareSymlink,
  cleanupFirmwareSymlink,
};
