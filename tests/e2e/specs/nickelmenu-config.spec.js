// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, getOriginalTgzSha1 } = require('../support/paths');
const { hasNickelMenuAssets, hasKOReaderAssets, hasFontAssets, hasFirmwareZip } = require('../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, mockPathExists, getWrittenFiles } = require('../support/mock-device');
const { parseTar } = require('../support/tar');
const {
  EXCLUDE_SYNC_FOLDERS_LINE,
  EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
  LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINE,
  LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
  QUADRUPLE_BACKSLASH_DOT,
  skipNmBackup,
  openNmSection,
  goToNmFeatures,
} = require('../support/nm-helpers');

test.describe('NickelMenu — configuration', () => {
  test('with device — install with config without exclude-calibre omits calibre from pattern', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Select "Install NickelMenu and configure"
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step — leave exclude-calibre unchecked (default)
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    // Verify exclude-calibre is unchecked by default
    await expect(page.locator('input[name="nm-cfg-exclude-calibre"]')).not.toBeChecked();

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    // Review and download (not write) to test download instructions
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // Download instructions should show the non-calibre pattern
    await expect(page.locator('#nm-download-instructions')).not.toBeHidden();
    await expect(page.locator('#nm-download-conf-step')).not.toBeHidden();
    await expect(page.locator('#nm-download-conf-line')).toHaveText(EXCLUDE_SYNC_FOLDERS_LINE);
    await expect(page.locator('#nm-download-conf-desc')).toHaveText('This prevents the Kobo from incorrectly identifying certain files as books in your library.');

    // Verify ZIP does NOT contain eReader.conf
    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    expect(Object.keys(zip.files)).not.toContain('.kobo/Kobo/Kobo eReader.conf');

    // Verify eReader.conf on device was NOT modified (download mode doesn't write to device)
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf).not.toContain('ExcludeSyncFolders');
  });


  test('with device — replaces existing calibre exclusion when checkbox is unchecked', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    // Start with a config that already has the calibre exclusion
    await connectMockDevice(page, { hasNickelMenu: false, hasCalibreExclude: true });

    // Verify initial state
    const confBefore = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confBefore).toContain(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection — leave exclude-calibre unchecked
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-exclude-calibre"]')).not.toBeChecked();

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // Verify the old calibre pattern was replaced with the non-calibre version
    const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confAfter).not.toContain('ExcludeSyncFolders=(calibre|');
    expect(confAfter).toContain(EXCLUDE_SYNC_FOLDERS_LINE);
    expect(confAfter).not.toContain(QUADRUPLE_BACKSLASH_DOT);
    // Existing settings should be preserved
    expect(confAfter).toContain('some=setting');
  });


  for (const { name, initialLine, expectedLine, enableCalibre } of [
    {
      name: 'non-calibre',
      initialLine: LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINE,
      expectedLine: EXCLUDE_SYNC_FOLDERS_LINE,
      enableCalibre: false,
    },
    {
      name: 'calibre',
      initialLine: LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
      expectedLine: EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
      enableCalibre: true,
    },
  ]) {
    test(`with device — repairs legacy malformed ${name} ExcludeSyncFolders value`, async ({ page }) => {
      test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
      test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

      await connectMockDevice(page, {
        hasNickelMenu: false,
        eReaderConf: '[General]\nsome=setting\n[FeatureSettings]\n' + initialLine + '\n',
      });

      const confBefore = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
      expect(confBefore).toContain(initialLine);

      await page.click('#btn-device-next');
      await page.click('input[name="mode"][value="nickelmenu"]');
      await page.click('#btn-mode-next');

      await page.click('input[name="nm-option"][value="preset"]');
      await page.click('#btn-nm-next');

      if (enableCalibre) {
        await openNmSection(page, 'Legacy');
        await page.check('input[name="nm-cfg-exclude-calibre"]');
      }

      await page.click('#btn-nm-features-next');
      await skipNmBackup(page);
      await expect(page.locator('#step-nm-review')).not.toBeHidden();
      await page.click('#btn-nm-write');
      await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

      const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
      expect(confAfter).not.toContain(initialLine);
      expect(confAfter).toContain(expectedLine);
      expect(confAfter).not.toContain(QUADRUPLE_BACKSLASH_DOT);
      expect(confAfter).toContain('some=setting');
    });
  }


  test('with device — factory-reset Kobo (not signed in) recommends Sideload Mode', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { signedIn: false });
    await goToNmFeatures(page);

    // The recommendation banner shows, and the Advanced section it points at is
    // auto-expanded so the Sideload Mode option is visible.
    await expect(page.locator('#nm-sideloaded-banner')).toBeVisible();
    await expect(page.locator('#nm-sideloaded-banner')).toContainText('Sideload Mode');
    await expect(page.locator('input[name="nm-cfg-sideloaded-mode"]')).toBeVisible();
    await expect(page.locator('input[name="nm-cfg-sideloaded-mode"]')).toBeEnabled();
  });


  test('with device — signed-in Kobo does not recommend Sideload Mode', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { signedIn: true });
    await goToNmFeatures(page);

    await expect(page.locator('#nm-sideloaded-banner')).toBeHidden();
  });


  test('with device — enabling Sideload Mode writes SideloadedMode to the config', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { signedIn: false });
    await goToNmFeatures(page);

    // Also enable simplify-tabs, which force-enables the home tab — Sideloaded
    // Mode must then comment that override out so the home tab is hidden.
    await page.check('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-sideloaded-mode"]');
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    // The review step warns about what Sideload Mode does.
    await expect(page.locator('#nm-review-notices')).toContainText('Home tab is hidden');
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf).toContain('[ApplicationPreferences]');
    expect(conf).toContain('SideloadedMode=true');

    // The home-tab override is commented out in the NickelMenu items file.
    const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
    expect(items).toContain('# experimental :menu_main_15505_0_enabled: 1');
  });


  test('with device — removing Sideload Mode reverts the config setting', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      eReaderConf: '[General]\nsome=setting\n[ApplicationPreferences]\nSideloadedMode=true\n',
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');

    // Detected via its conf setting and offered for removal.
    await expect(page.locator('input[name="nm-uninstall-sideloaded-mode"]')).toBeChecked();
    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf).not.toContain('SideloadedMode');
    expect(conf).toContain('some=setting');
  });


  test('with device — Sideload Mode is disabled on Kobo software older than 4.31', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    // 4.28 is below Sideload Mode's 4.31 minimum (but still a supported OS).
    await connectMockDevice(page, { firmware: '4.28.17820', signedIn: false });
    await goToNmFeatures(page);

    const checkbox = page.locator('input[name="nm-cfg-sideloaded-mode"]');
    await expect(checkbox).toBeDisabled();
    const item = page.locator('.nm-config-item', { has: checkbox });
    await expect(item.locator('.nm-config-disabled-reason')).toContainText('4.31');

    // The feature isn't available, so we don't recommend it even though the
    // device isn't signed in.
    await expect(page.locator('#nm-sideloaded-banner')).toBeHidden();
  });

});
