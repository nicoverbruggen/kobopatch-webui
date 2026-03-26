// Firmware versions used for testing. Shell scripts read this via jq-compatible
// JSON output from: node -e "console.log(JSON.stringify(require('./tests/firmware-config')))"
module.exports = [
  {
    version: '4.45.23646',
    shortVersion: '4.45',
    url: 'https://ereaderfiles.kobo.com/firmwares/kobo13/Mar2026/kobo-update-4.45.23646.zip',
    patches: 'patches_4.45.zip',
    checksums: {
      'usr/local/Kobo/libnickel.so.1.0.0': 'ef64782895a47ac85f0829f06fffa4816d23512d',
      'usr/local/Kobo/nickel': '80a607bac515457a6864be8be831df631a01005c',
      'usr/local/Kobo/libadobe.so': '02dc99c71c4fef75401cd49ddc2e63f928a126e1',
      'usr/local/Kobo/librmsdk.so.1.0.0': 'e3819260c9fc539a53db47e9d3fe600ec11633d5',
    },
    // SHA1 of the original unmodified KoboRoot.tgz inside the firmware zip.
    // Used to verify the "restore original firmware" flow extracts correctly.
    originalTgzChecksum: 'b5c3307e8e7ec036f4601135f0b741c37b899db4',
  },
];
