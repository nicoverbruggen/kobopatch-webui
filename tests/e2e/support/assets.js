const fs = require('fs');
const path = require('path');
const { WEBROOT, WEBROOT_FIRMWARE, FIRMWARE_PATH } = require('./paths');

function hasNickelMenuAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelMenu.zip'))
    && fs.existsSync(path.join(WEBROOT, 'js', 'nickelmenu', 'features', 'custom-menu', '.cog.png'));
}

function hasKOReaderAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'koreader-kobo.zip'));
}

function hasCadmusAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'cadmus-kobo.tar.gz'));
}

function hasNickelClockAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelClock.zip'));
}

function hasFontAssets() {
  return fs.existsSync(path.join(WEBROOT, 'assets', 'KF_Readerly.zip'))
    && fs.existsSync(path.join(WEBROOT, 'assets', 'KF_Libron.zip'))
    && fs.existsSync(path.join(WEBROOT, 'assets', 'KF_Cartisse.zip'));
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
  hasCadmusAssets,
  hasNickelClockAssets,
  hasFontAssets,
  hasFirmwareZip,
  setupFirmwareSymlink,
  cleanupFirmwareSymlink,
};
