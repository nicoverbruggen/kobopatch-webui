const fs = require('fs');
const path = require('path');
const { WEBROOT, WEBROOT_FIRMWARE, FIRMWARE_PATH } = require('./paths');

function hasNickelMenuAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelMenu.zip'))
    && fs.existsSync(path.join(WEBROOT, 'js', 'nickelmenu', 'features', 'custom-menu', 'items'));
}

function hasKOReaderAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'koreader-kobo.zip'))
    && fs.existsSync(path.join(WEBROOT, 'assets', 'koreader-release.json'));
}

function hasReaderlyAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'KF_Readerly.zip'));
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
  hasKOReaderAssets,
  hasReaderlyAssets,
  hasFirmwareZip,
  setupFirmwareSymlink,
  cleanupFirmwareSymlink,
};
