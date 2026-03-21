const path = require('path');

const CACHED_ASSETS = path.resolve(__dirname, '..', '..', 'cached_assets');

const FIRMWARE_PATH = path.join(CACHED_ASSETS, 'kobo-update-4.45.23646.zip');

const WEBROOT = path.resolve(__dirname, '..', '..', '..', 'web', 'dist');
const WEBROOT_FIRMWARE = path.join(WEBROOT, '_test_firmware.zip');

// Expected SHA1 checksums for Kobo Libra Color, firmware 4.45.23646,
// with only "Remove footer (row3) on new home screen" enabled.
const EXPECTED_SHA1 = {
  'usr/local/Kobo/libnickel.so.1.0.0': 'ef64782895a47ac85f0829f06fffa4816d23512d',
  'usr/local/Kobo/nickel': '80a607bac515457a6864be8be831df631a01005c',
  'usr/local/Kobo/libadobe.so': '02dc99c71c4fef75401cd49ddc2e63f928a126e1',
  'usr/local/Kobo/librmsdk.so.1.0.0': 'e3819260c9fc539a53db47e9d3fe600ec11633d5',
};

// SHA1 of the original unmodified KoboRoot.tgz inside firmware 4.45.23646.
const ORIGINAL_TGZ_SHA1 = 'b5c3307e8e7ec036f4601135f0b741c37b899db4';

module.exports = {
  FIRMWARE_PATH,
  WEBROOT,
  WEBROOT_FIRMWARE,
  EXPECTED_SHA1,
  ORIGINAL_TGZ_SHA1,
};
