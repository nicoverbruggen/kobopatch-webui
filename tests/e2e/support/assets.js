const fs = require('fs');
const path = require('path');
const { WEBROOT, WEBROOT_FIRMWARE, FIRMWARE_PATH } = require('./paths');

function hasNickelMenuAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelMenu.tgz')) && fs.existsSync(path.join(WEBROOT, 'assets', '.cog.png'));
}

function hasKOReaderAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'koreader-kobo.zip'));
}

function hasSimpleUIAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'simpleui.koplugin.zip'));
}

function hasCadmusAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'cadmus-kobo.tar.gz'));
}

function hasNickelClockAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelClock.zip'));
}

function hasNickelTypeFixAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelTypeFix.tgz'));
}

function hasNickelCoverFixAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelCoverFix.tgz'));
}

function hasNickelDissolveAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'NickelDissolve.tgz'));
}

function hasFontAssets() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'kobo-core-fonts.zip')) && fs.existsSync(path.join(WEBROOT, 'assets', 'kobo-extra-fonts.zip'));
}

function hasFontPreviews() {
    return fs.existsSync(path.join(WEBROOT, 'assets', 'font-previews.json'));
}

function hasFirmwareZip() {
    return fs.existsSync(FIRMWARE_PATH);
}

function setupFirmwareSymlink() {
    try {
        fs.unlinkSync(WEBROOT_FIRMWARE);
    } catch {}
    fs.symlinkSync(path.resolve(FIRMWARE_PATH), WEBROOT_FIRMWARE);
}

function cleanupFirmwareSymlink() {
    try {
        fs.unlinkSync(WEBROOT_FIRMWARE);
    } catch {}
}

module.exports = {
    hasNickelMenuAssets,
    hasKOReaderAssets,
    hasSimpleUIAssets,
    hasCadmusAssets,
    hasNickelClockAssets,
    hasNickelTypeFixAssets,
    hasNickelCoverFixAssets,
    hasNickelDissolveAssets,
    hasFontAssets,
    hasFontPreviews,
    hasFirmwareZip,
    setupFirmwareSymlink,
    cleanupFirmwareSymlink,
};
