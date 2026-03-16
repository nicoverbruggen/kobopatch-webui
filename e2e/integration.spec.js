// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// Expected SHA1 checksums for Kobo Libra Color, firmware 4.45.23646,
// with only "Remove footer (row3) on new home screen" enabled.
const EXPECTED_SHA1 = {
  'usr/local/Kobo/libnickel.so.1.0.0': 'ef64782895a47ac85f0829f06fffa4816d23512d',
  'usr/local/Kobo/nickel': '80a607bac515457a6864be8be831df631a01005c',
  'usr/local/Kobo/libadobe.so': '02dc99c71c4fef75401cd49ddc2e63f928a126e1',
  'usr/local/Kobo/librmsdk.so.1.0.0': 'e3819260c9fc539a53db47e9d3fe600ec11633d5',
};

const FIRMWARE_PATH = process.env.FIRMWARE_ZIP
  || path.resolve(__dirname, '..', 'kobopatch-wasm', 'testdata', 'kobo-update-4.45.23646.zip');

const WEBROOT_FIRMWARE = path.resolve(__dirname, '..', 'web', 'public', '_test_firmware.zip');

/**
 * Parse a tar archive (uncompressed) and return a map of entry name -> Buffer.
 */
function parseTar(buffer) {
  const entries = {};
  let offset = 0;

  while (offset < buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;

    let name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '');
    if (prefix) name = prefix + '/' + name;
    name = name.replace(/^\.\//, '');

    const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0+$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];

    offset += 512;

    if (typeFlag === 48 || typeFlag === 0) {
      entries[name] = buffer.subarray(offset, offset + size);
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

// Clean up the symlink after the test.
test.afterEach(() => {
  try { fs.unlinkSync(WEBROOT_FIRMWARE); } catch {}
});

test('full manual mode patching pipeline', async ({ page }) => {
  if (!fs.existsSync(FIRMWARE_PATH)) {
    test.skip(true, `Firmware not found at ${FIRMWARE_PATH}`);
  }

  // Symlink the cached firmware into the webroot so the app can fetch it locally.
  try { fs.unlinkSync(WEBROOT_FIRMWARE); } catch {}
  fs.symlinkSync(path.resolve(FIRMWARE_PATH), WEBROOT_FIRMWARE);

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('KoboPatch');

  // Override the firmware download URLs to point at the local server.
  await page.evaluate(() => {
    for (const version of Object.keys(FIRMWARE_DOWNLOADS)) {
      for (const prefix of Object.keys(FIRMWARE_DOWNLOADS[version])) {
        FIRMWARE_DOWNLOADS[version][prefix] = '/_test_firmware.zip';
      }
    }
  });

  // Step 1: Switch to manual mode.
  await page.click('#btn-manual-from-auto');
  await expect(page.locator('#step-manual')).not.toBeHidden();

  // Step 2: Select firmware version.
  await page.selectOption('#manual-version', '4.45.23646');
  await expect(page.locator('#manual-model')).not.toBeHidden();

  // Step 3: Select Kobo Libra Colour (N428).
  await page.selectOption('#manual-model', 'N428');
  await expect(page.locator('#btn-manual-confirm')).toBeEnabled();
  await page.click('#btn-manual-confirm');

  // Step 4: Wait for patches to load.
  await expect(page.locator('#step-patches')).not.toBeHidden();
  await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

  // Step 5: Enable "Remove footer (row3) on new home screen".
  const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
  const patchSection = patchName.locator('xpath=ancestor::details');
  await patchSection.locator('summary').click();
  await expect(patchName).toBeVisible();
  await patchName.locator('xpath=ancestor::label').locator('input').check();

  // Verify patch count updated.
  await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');
  await expect(page.locator('#btn-patches-next')).toBeEnabled();

  // Step 6: Continue to build step.
  await page.click('#btn-patches-next');
  await expect(page.locator('#step-firmware')).not.toBeHidden();
  await expect(page.locator('#firmware-version-label')).toHaveText('4.45.23646');
  await expect(page.locator('#firmware-device-label')).toHaveText('Kobo Libra Colour');

  // Step 7: Build and wait for completion.
  await page.click('#btn-build');

  const doneOrError = await Promise.race([
    page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
    page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
  ]);

  if (doneOrError === 'error') {
    const errorMsg = await page.locator('#error-message').textContent();
    throw new Error(`Build failed: ${errorMsg}`);
  }

  await expect(page.locator('#build-status')).toContainText('Patching complete');

  // Step 8: Download KoboRoot.tgz and verify checksums.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-download'),
  ]);

  expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
  const downloadPath = await download.path();
  const tgzData = fs.readFileSync(downloadPath);

  const tarData = zlib.gunzipSync(tgzData);
  const entries = parseTar(tarData);

  for (const [name, expectedHash] of Object.entries(EXPECTED_SHA1)) {
    const data = entries[name];
    expect(data, `missing binary in output: ${name}`).toBeDefined();
    const actualHash = crypto.createHash('sha1').update(data).digest('hex');
    expect(actualHash, `SHA1 mismatch for ${name}`).toBe(expectedHash);
  }
});
