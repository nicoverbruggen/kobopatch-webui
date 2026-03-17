// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

// Expected SHA1 checksums for Kobo Libra Color, firmware 4.45.23646,
// with only "Remove footer (row3) on new home screen" enabled.
const EXPECTED_SHA1 = {
  'usr/local/Kobo/libnickel.so.1.0.0': 'ef64782895a47ac85f0829f06fffa4816d23512d',
  'usr/local/Kobo/nickel': '80a607bac515457a6864be8be831df631a01005c',
  'usr/local/Kobo/libadobe.so': '02dc99c71c4fef75401cd49ddc2e63f928a126e1',
  'usr/local/Kobo/librmsdk.so.1.0.0': 'e3819260c9fc539a53db47e9d3fe600ec11633d5',
};

const FIRMWARE_PATH = process.env.FIRMWARE_ZIP
  || path.resolve(__dirname, '..', '..', 'kobopatch-wasm', 'testdata', 'kobo-update-4.45.23646.zip');

const WEBROOT = path.resolve(__dirname, '..', '..', 'web', 'public');
const WEBROOT_FIRMWARE = path.join(WEBROOT, '_test_firmware.zip');

// SHA1 of the original unmodified KoboRoot.tgz inside firmware 4.45.23646.
const ORIGINAL_TGZ_SHA1 = 'b5c3307e8e7ec036f4601135f0b741c37b899db4';

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

// Clean up the symlink after each test.
test.afterEach(() => {
  try { fs.unlinkSync(WEBROOT_FIRMWARE); } catch {}
});

/**
 * Check that NickelMenu assets exist in webroot.
 */
function hasNickelMenuAssets() {
  return fs.existsSync(path.join(WEBROOT, 'nickelmenu', 'NickelMenu.zip'))
    && fs.existsSync(path.join(WEBROOT, 'nickelmenu', 'kobo-config.zip'));
}

/**
 * Navigate to manual mode: click "Download files manually" on the connect step.
 */
async function goToManualMode(page) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('KoboPatch');
  await page.click('#btn-manual');
  await expect(page.locator('#step-mode')).not.toBeHidden();
}

/**
 * Override firmware download URLs to point at the local test server.
 */
async function overrideFirmwareURLs(page) {
  await page.evaluate(() => {
    for (const version of Object.keys(FIRMWARE_DOWNLOADS)) {
      for (const prefix of Object.keys(FIRMWARE_DOWNLOADS[version])) {
        FIRMWARE_DOWNLOADS[version][prefix] = '/_test_firmware.zip';
      }
    }
  });
}

/**
 * Set up firmware symlink for tests that need it.
 */
function setupFirmwareSymlink() {
  try { fs.unlinkSync(WEBROOT_FIRMWARE); } catch {}
  fs.symlinkSync(path.resolve(FIRMWARE_PATH), WEBROOT_FIRMWARE);
}

/**
 * Inject a mock File System Access API into the page, simulating a Kobo Libra Color.
 * The mock provides:
 *   - .kobo/version file with serial N4280A0000000 and firmware 4.45.23646
 *   - Optionally a .adds/nm/ directory (to simulate NickelMenu being installed)
 *   - In-memory filesystem that tracks all writes for verification
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {boolean} [opts.hasNickelMenu=false] - Whether .adds/nm/ exists on device
 */
async function injectMockDevice(page, opts = {}) {
  await page.evaluate(({ hasNickelMenu }) => {
    // In-memory filesystem for the mock device
    const filesystem = {
      '.kobo': {
        _type: 'dir',
        'version': {
          _type: 'file',
          content: 'N4280A0000000,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390',
        },
        'Kobo': {
          _type: 'dir',
          'Kobo eReader.conf': {
            _type: 'file',
            content: '[General]\nsome=setting\n',
          },
        },
      },
    };

    if (hasNickelMenu) {
      filesystem['.adds'] = {
        _type: 'dir',
        'nm': {
          _type: 'dir',
          'items': { _type: 'file', content: 'menu_item:main:test:skip:' },
        },
      };
    }

    // Expose filesystem for verification from tests
    window.__mockFS = filesystem;
    // Track written file paths (relative path string -> true)
    window.__mockWrittenFiles = {};

    function makeFileHandle(dirNode, fileName, pathPrefix) {
      return {
        getFile: async () => {
          const fileNode = dirNode[fileName];
          const content = fileNode ? (fileNode.content || '') : '';
          return {
            text: async () => content,
            arrayBuffer: async () => new TextEncoder().encode(content).buffer,
          };
        },
        createWritable: async () => {
          const chunks = [];
          return {
            write: async (chunk) => { chunks.push(chunk); },
            close: async () => {
              const first = chunks[0];
              const bytes = first instanceof Uint8Array ? first : new TextEncoder().encode(String(first));
              if (!dirNode[fileName]) dirNode[fileName] = { _type: 'file' };
              dirNode[fileName].content = new TextDecoder().decode(bytes);
              const fullPath = pathPrefix ? pathPrefix + '/' + fileName : fileName;
              window.__mockWrittenFiles[fullPath] = true;
            },
          };
        },
      };
    }

    function makeDirHandle(node, name, pathPrefix) {
      const currentPath = pathPrefix ? pathPrefix + '/' + name : name;
      return {
        name: name,
        kind: 'directory',
        getDirectoryHandle: async (childName, opts2) => {
          if (node[childName] && node[childName]._type === 'dir') {
            return makeDirHandle(node[childName], childName, currentPath);
          }
          if (opts2 && opts2.create) {
            node[childName] = { _type: 'dir' };
            return makeDirHandle(node[childName], childName, currentPath);
          }
          throw new DOMException('Not found: ' + childName, 'NotFoundError');
        },
        getFileHandle: async (childName, opts2) => {
          if (node[childName] && node[childName]._type === 'file') {
            return makeFileHandle(node, childName, currentPath);
          }
          if (opts2 && opts2.create) {
            node[childName] = { _type: 'file', content: '' };
            return makeFileHandle(node, childName, currentPath);
          }
          throw new DOMException('Not found: ' + childName, 'NotFoundError');
        },
      };
    }

    const rootHandle = makeDirHandle(filesystem, 'KOBOeReader', '');

    // Override showDirectoryPicker
    window.showDirectoryPicker = async () => rootHandle;
  }, { hasNickelMenu: opts.hasNickelMenu || false });
}

/**
 * Inject mock device, optionally override firmware URLs, and connect.
 * Firmware URLs must be overridden BEFORE connecting, because the app captures
 * the firmware URL during device detection (configureFirmwareStep).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {boolean} [opts.hasNickelMenu=false]
 * @param {boolean} [opts.overrideFirmware=false] - Override firmware URLs before connecting
 */
async function connectMockDevice(page, opts = {}) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('KoboPatch');
  await injectMockDevice(page, opts);
  if (opts.overrideFirmware) {
    await overrideFirmwareURLs(page);
  }
  await page.click('#btn-connect');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await expect(page.locator('#device-model')).toHaveText('Kobo Libra Colour');
  await expect(page.locator('#device-firmware')).toHaveText('4.45.23646');
  await expect(page.locator('#device-status')).toContainText('recognized');
}

/**
 * Read a file's content from the mock filesystem.
 */
async function readMockFile(page, ...pathParts) {
  return page.evaluate((parts) => {
    let node = window.__mockFS;
    for (const part of parts) {
      if (!node || !node[part]) return null;
      node = node[part];
    }
    return node && node._type === 'file' ? (node.content || '') : null;
  }, pathParts);
}

/**
 * Check whether a path exists in the mock filesystem.
 */
async function mockPathExists(page, ...pathParts) {
  return page.evaluate((parts) => {
    let node = window.__mockFS;
    for (const part of parts) {
      if (!node || !node[part]) return false;
      node = node[part];
    }
    return true;
  }, pathParts);
}

/**
 * Get the list of written file paths from the mock device.
 */
async function getWrittenFiles(page) {
  return page.evaluate(() => Object.keys(window.__mockWrittenFiles));
}

// ============================================================
// NickelMenu
// ============================================================

test.describe('NickelMenu', () => {
  test('no device — install with config via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await goToManualMode(page);

    // Mode selection: NickelMenu should be pre-selected (checked in HTML)
    await expect(page.locator('input[name="mode"][value="nickelmenu"]')).toBeChecked();
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // No option pre-selected — Continue should be disabled
    await expect(page.locator('#btn-nm-next')).toBeDisabled();

    // Select "Install NickelMenu and configure"
    await page.click('input[name="nm-option"][value="sample"]');
    await expect(page.locator('#nm-config-options')).not.toBeHidden();

    // Verify default checkbox states
    await expect(page.locator('input[name="nm-cfg-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-screensaver"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-simplify-home"]')).not.toBeChecked();

    // Enable simplifyHome for testing
    await page.check('input[name="nm-cfg-simplify-home"]');

    await expect(page.locator('#btn-nm-next')).toBeEnabled();
    await page.click('#btn-nm-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu');
    await expect(page.locator('#nm-review-list')).toContainText('Readerly fonts');

    // Write button should be hidden in manual mode
    await expect(page.locator('#btn-nm-write')).toBeHidden();
    // Download button visible
    await expect(page.locator('#btn-nm-download')).toBeVisible();

    // Click download and wait for done step
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('ready to download');

    // Download instructions should be visible, and include eReader.conf step for sample config
    await expect(page.locator('#nm-download-instructions')).not.toBeHidden();
    await expect(page.locator('#nm-download-conf-step')).not.toBeHidden();

    // Verify ZIP contents
    expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files);

    // Must contain KoboRoot.tgz
    expect(zipFiles).toContainEqual('.kobo/KoboRoot.tgz');
    // Must contain NickelMenu items config
    expect(zipFiles).toContainEqual('.adds/nm/items');
    // Must contain font files (fonts checkbox is checked by default)
    expect(zipFiles.some(f => f.startsWith('fonts/'))).toBe(true);
    // Must NOT contain screensaver (unchecked by default)
    expect(zipFiles.some(f => f.startsWith('.kobo/screensaver/'))).toBe(false);

    // Verify items file has simplifyHome modifications
    const itemsContent = await zip.file('.adds/nm/items').async('string');
    expect(itemsContent).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(itemsContent).toContain('experimental:hide_home_row3_enabled:1');
  });

  test('no device — install NickelMenu only via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await goToManualMode(page);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select "Install NickelMenu only"
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await expect(page.locator('#nm-config-options')).toBeHidden();

    await page.click('#btn-nm-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu (KoboRoot.tgz)');

    // Download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('ready to download');

    // eReader.conf step should be hidden for nickelmenu-only
    await expect(page.locator('#nm-download-conf-step')).toBeHidden();

    // Verify ZIP contents — should only contain KoboRoot.tgz
    expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files).filter(f => !zip.files[f].dir);

    expect(zipFiles).toEqual(['.kobo/KoboRoot.tgz']);
  });

  test('no device — remove option is disabled in manual mode', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await goToManualMode(page);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Remove option should be disabled (no device connected)
    await expect(page.locator('#nm-option-remove')).toHaveClass(/nm-option-disabled/);
    await expect(page.locator('input[name="nm-option"][value="remove"]')).toBeDisabled();
  });

  test('with device — install with config and write to Kobo', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // NickelMenu is pre-selected
    await expect(page.locator('input[name="mode"][value="nickelmenu"]')).toBeChecked();
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Remove option should be disabled (no NickelMenu installed)
    await expect(page.locator('#nm-option-remove')).toHaveClass(/nm-option-disabled/);

    // Select "Install NickelMenu and configure"
    await page.click('input[name="nm-option"][value="sample"]');
    await expect(page.locator('#nm-config-options')).not.toBeHidden();

    // Enable all options for testing
    await page.check('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-simplify-home"]');

    await page.click('#btn-nm-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu');
    await expect(page.locator('#nm-review-list')).toContainText('Readerly fonts');
    await expect(page.locator('#nm-review-list')).toContainText('Simplified tab menu');
    await expect(page.locator('#nm-review-list')).toContainText('Simplified homescreen');

    // Both buttons visible when device is connected
    await expect(page.locator('#btn-nm-write')).toBeVisible();
    await expect(page.locator('#btn-nm-download')).toBeVisible();

    // Write to device
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('installed');
    await expect(page.locator('#nm-write-instructions')).not.toBeHidden();

    // Verify files written to mock device
    const writtenFiles = await getWrittenFiles(page);
    expect(writtenFiles, 'KoboRoot.tgz should be written').toContainEqual(expect.stringContaining('KoboRoot.tgz'));
    expect(writtenFiles, 'NickelMenu items should be written').toContainEqual(expect.stringContaining('items'));

    // Verify eReader.conf was updated with ExcludeSyncFolders
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf, 'eReader.conf should contain ExcludeSyncFolders').toContain('ExcludeSyncFolders');
    expect(conf, 'eReader.conf should preserve existing settings').toContain('[General]');

    // Verify NickelMenu items file exists and has expected modifications
    const items = await readMockFile(page, '.adds', 'nm', 'items');
    expect(items, '.adds/nm/items should exist').not.toBeNull();
    // With simplifyHome enabled, the hide lines should be appended
    expect(items).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(items).toContain('experimental:hide_home_row3_enabled:1');
  });

  test('with device — install NickelMenu only and write to Kobo', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select "Install NickelMenu only"
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await expect(page.locator('#nm-config-options')).toBeHidden();

    await page.click('#btn-nm-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu (KoboRoot.tgz)');

    // Write to device
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('installed');

    // Verify only KoboRoot.tgz was written (no config files)
    const writtenFiles = await getWrittenFiles(page);
    expect(writtenFiles).toContainEqual(expect.stringContaining('KoboRoot.tgz'));
    // Should NOT have written items, fonts, etc.
    expect(writtenFiles.filter(f => !f.includes('KoboRoot.tgz'))).toHaveLength(0);
  });

  test('with device — remove NickelMenu', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { hasNickelMenu: true });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Remove option should be enabled (NickelMenu is installed)
    await expect(page.locator('#nm-option-remove')).not.toHaveClass(/nm-option-disabled/);
    await expect(page.locator('input[name="nm-option"][value="remove"]')).not.toBeDisabled();

    // Select remove
    await page.click('input[name="nm-option"][value="remove"]');
    await page.click('#btn-nm-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-summary')).toContainText('removal');

    // Download should be hidden for remove
    await expect(page.locator('#btn-nm-download')).toBeHidden();
    // Write should show "Remove from Kobo"
    await expect(page.locator('#btn-nm-write')).toContainText('Remove from Kobo');

    // Execute removal
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('removed');
    await expect(page.locator('#nm-reboot-instructions')).not.toBeHidden();

    // Verify files written to mock device
    const writtenFiles = await getWrittenFiles(page);
    expect(writtenFiles, 'KoboRoot.tgz should be written for update').toContainEqual(expect.stringContaining('KoboRoot.tgz'));
    expect(writtenFiles, 'uninstall marker should be written').toContainEqual(expect.stringContaining('uninstall'));

    // Verify the uninstall marker file exists
    const uninstallExists = await mockPathExists(page, '.adds', 'nm', 'uninstall');
    expect(uninstallExists, '.adds/nm/uninstall should exist').toBe(true);
  });
});

// ============================================================
// Custom patches
// ============================================================

test.describe('Custom patches', () => {
  test('no device — full manual mode patching pipeline', async ({ page }) => {
    test.skip(!fs.existsSync(FIRMWARE_PATH), `Firmware not found at ${FIRMWARE_PATH}`);

    setupFirmwareSymlink();
    await goToManualMode(page);

    // Select "Custom Patches" mode
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Manual version/model selection
    await expect(page.locator('#step-manual-version')).not.toBeHidden();

    await overrideFirmwareURLs(page);

    // Select firmware version
    await page.selectOption('#manual-version', '4.45.23646');
    await expect(page.locator('#manual-model')).not.toBeHidden();

    // Select Kobo Libra Colour (N428)
    await page.selectOption('#manual-model', 'N428');
    await expect(page.locator('#btn-manual-confirm')).toBeEnabled();
    await page.click('#btn-manual-confirm');

    // Wait for patches to load
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

    // Enable "Remove footer (row3) on new home screen"
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
    const patchSection = patchName.locator('xpath=ancestor::details');
    await patchSection.locator('summary').click();
    await expect(patchName).toBeVisible();
    await patchName.locator('xpath=ancestor::label').locator('input').check();

    // Verify patch count
    await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');
    await expect(page.locator('#btn-patches-next')).toBeEnabled();

    // Continue to build step
    await page.click('#btn-patches-next');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-version-label')).toHaveText('4.45.23646');
    await expect(page.locator('#firmware-device-label')).toHaveText('Kobo Libra Colour');

    // Build and wait for completion
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
    await expect(page.locator('#build-status')).toContainText('Kobo Libra Colour');

    // Download KoboRoot.tgz and verify checksums
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
    await expect(page.locator('#download-device-name')).toHaveText('Kobo Libra Colour');

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

  test('no device — restore original firmware', async ({ page }) => {
    test.skip(!fs.existsSync(FIRMWARE_PATH), `Firmware not found at ${FIRMWARE_PATH}`);

    setupFirmwareSymlink();
    await goToManualMode(page);

    // Select "Custom Patches" mode
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Manual version/model selection
    await expect(page.locator('#step-manual-version')).not.toBeHidden();

    await overrideFirmwareURLs(page);

    await page.selectOption('#manual-version', '4.45.23646');
    await page.selectOption('#manual-model', 'N428');
    await page.click('#btn-manual-confirm');

    // Wait for patches to load, then continue with zero patches
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);
    await expect(page.locator('#patch-count-hint')).toContainText('restore the original');
    await page.click('#btn-patches-next');

    // Verify build step shows restore text
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-description')).toContainText('without modifications');
    await expect(page.locator('#btn-build')).toContainText('Restore Original Software');

    // Build and wait for completion
    await page.click('#btn-build');

    const doneOrError = await Promise.race([
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      const errorMsg = await page.locator('#error-message').textContent();
      throw new Error(`Restore failed: ${errorMsg}`);
    }

    await expect(page.locator('#build-status')).toContainText('Software extracted');

    // Download KoboRoot.tgz and verify it matches the original
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
    const downloadPath = await download.path();
    const tgzData = fs.readFileSync(downloadPath);
    const actualHash = crypto.createHash('sha1').update(tgzData).digest('hex');
    expect(actualHash, 'restored KoboRoot.tgz SHA1 mismatch').toBe(ORIGINAL_TGZ_SHA1);
  });

  test('no device — both modes available in manual mode', async ({ page }) => {
    await page.goto('/');

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Both modes should be available in manual mode
    await expect(page.locator('input[name="mode"][value="patches"]')).not.toBeDisabled();
    await expect(page.locator('input[name="mode"][value="nickelmenu"]')).not.toBeDisabled();
  });

  test('with device — apply patches and verify checksums', async ({ page }) => {
    test.skip(!fs.existsSync(FIRMWARE_PATH), `Firmware not found at ${FIRMWARE_PATH}`);

    setupFirmwareSymlink();
    // Override firmware URLs BEFORE connecting so the app captures the local URL
    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Both modes should be available (firmware is supported)
    await expect(page.locator('input[name="mode"][value="patches"]')).not.toBeDisabled();

    // Select Custom Patches
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Patches step (patches should already be loaded from device detection)
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

    // Enable a patch
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
    const patchSection = patchName.locator('xpath=ancestor::details');
    await patchSection.locator('summary').click();
    await expect(patchName).toBeVisible();
    await patchName.locator('xpath=ancestor::label').locator('input').check();

    await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');
    await page.click('#btn-patches-next');

    // Build step
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-version-label')).toHaveText('4.45.23646');
    await expect(page.locator('#firmware-device-label')).toHaveText('Kobo Libra Colour');

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

    // Both write and download should be visible with device connected
    await expect(page.locator('#btn-write')).toBeVisible();
    await expect(page.locator('#btn-download')).toBeVisible();

    // Download and verify checksums
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

  test('with device — restore original firmware', async ({ page }) => {
    test.skip(!fs.existsSync(FIRMWARE_PATH), `Firmware not found at ${FIRMWARE_PATH}`);

    setupFirmwareSymlink();
    // Override firmware URLs BEFORE connecting so the app captures the local URL
    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Use the "Restore Unpatched Software" shortcut button on device screen
    await page.click('#btn-device-restore');

    // Build step should show restore mode
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-description')).toContainText('without modifications');
    await expect(page.locator('#btn-build')).toContainText('Restore Original Software');

    await page.click('#btn-build');

    const doneOrError = await Promise.race([
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      const errorMsg = await page.locator('#error-message').textContent();
      throw new Error(`Restore failed: ${errorMsg}`);
    }

    await expect(page.locator('#build-status')).toContainText('Software extracted');

    // Download and verify original
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
    const downloadPath = await download.path();
    const tgzData = fs.readFileSync(downloadPath);
    const actualHash = crypto.createHash('sha1').update(tgzData).digest('hex');
    expect(actualHash, 'restored KoboRoot.tgz SHA1 mismatch').toBe(ORIGINAL_TGZ_SHA1);
  });
});
