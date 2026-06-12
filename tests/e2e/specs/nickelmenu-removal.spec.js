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
} = require('../support/nm-helpers');

test.describe('NickelMenu — removal', () => {
  test('no device — remove option shows manual removal instructions', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await page.addInitScript(() => {
      window.__ANALYTICS_ENABLED = true;
      window.__trackedEvents = [];
      window.umami = {
        track: (eventName, data) => window.__trackedEvents.push({ eventName, data }),
      };
    });
    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    await expect(page.locator('#nm-option-remove')).not.toHaveClass(/selection-card--disabled/);
    await expect(page.locator('#nm-option-remove')).not.toHaveClass(/selection-card--danger/);
    await expect(page.locator('input[name="nm-option"][value="remove"]')).not.toBeDisabled();
    await expect(page.locator('#step-nav')).toContainText('Install');

    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('#step-nav')).not.toContainText('Install');
    await expect(page.locator('#step-nav')).toContainText('Remove');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-manual-remove')).not.toBeHidden();
    await expect(page.locator('#step-nav')).not.toContainText('Install');
    await expect(page.locator('#step-nav')).toContainText('Remove');
    await expect(page.locator('#btn-nm-manual-remove-back')).toHaveCount(0);
    await expect(page.locator('#nm-manual-remove-instructions')).toHaveClass(/install-instructions/);
    await expect(page.locator('#step-nm-manual-remove')).toContainText('.adds/nm');
    await expect(page.locator('#step-nm-manual-remove')).toContainText('uninstall');
    await expect(page.locator('#step-nm-manual-remove')).toContainText('long-pressing the power button');
    await expect(page.locator('#step-nm-manual-remove')).not.toContainText('KoboRoot.tgz');
    await expect(page.locator('#step-nm-manual-remove')).toContainText('ExcludeSyncFolders=');
    await expect(page.locator('#nm-manual-remove-retry')).toBeVisible();
    await expect(page.locator('#nm-manual-remove-retry')).toHaveText('You can always restart the entire flow by reloading the page, if you want to try again for another configuration or undo the changes that were made.');
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({
      eventName: 'flow-end',
      data: { result: 'nm-remove-manual' },
    });
  });


  test('with device — remove NickelMenu', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await page.addInitScript(() => {
      window.__ANALYTICS_ENABLED = true;
      window.__trackedEvents = [];
      window.umami = {
        track: (eventName, data) => window.__trackedEvents.push({ eventName, data }),
      };
    });
    await connectMockDevice(page, { hasNickelMenu: true });

    // Continue to mode selection → select NickelMenu
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Remove option should be enabled (NickelMenu is installed)
    await expect(page.locator('#nm-option-remove')).not.toHaveClass(/selection-card--disabled/);
    await expect(page.locator('input[name="nm-option"][value="remove"]')).not.toBeDisabled();

    // Select remove
    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('#step-nav')).not.toContainText('Install');
    await expect(page.locator('#step-nav')).toContainText('Remove');

    // No extra features installed — uninstall options should be hidden
    await expect(page.locator('#nm-uninstall-options')).toBeHidden();

    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-backup-options')).not.toBeHidden();
    await skipNmBackup(page);

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-summary')).toContainText('removal');

    // Review list should show NickelMenu even with no extra features
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu');

    // Download should be hidden for remove
    await expect(page.locator('#btn-nm-download')).toBeHidden();
    // Write should show "Remove from Kobo"
    await expect(page.locator('#btn-nm-write')).toContainText('Remove from Kobo');
    await expect(page.evaluate(() => window.__trackedEvents)).resolves.not.toContainEqual({
      eventName: 'flow-end',
      data: { result: 'nm-remove' },
    });

    // Execute removal
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('removed');
    await expect(page.locator('#nm-reboot-instructions')).not.toBeHidden();
    await expect(page.locator('#nm-manual-remove-retry')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({
      eventName: 'flow-end',
      data: { result: 'nm-remove' },
    });
    await expect(page.evaluate(() => window.__trackedEvents)).resolves.not.toContainEqual({
      eventName: 'flow-end',
      data: { result: 'nm-remove-manual' },
    });

    // Verify files written to mock device
    const writtenFiles = await getWrittenFiles(page);
    expect(writtenFiles, 'KoboRoot.tgz should be written for update').toContainEqual(expect.stringContaining('KoboRoot.tgz'));
    expect(writtenFiles, 'uninstall marker should be written').toContainEqual(expect.stringContaining('uninstall'));

    // Verify the uninstall marker file exists
    const uninstallExists = await mockPathExists(page, '.adds', 'nm', 'uninstall');
    expect(uninstallExists, '.adds/nm/uninstall should exist').toBe(true);

    const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confAfter).not.toContain('ExcludeSyncFolders');
    expect(confAfter).toContain('some=setting');

    // Verify audit log is written under .kobopatch-webui/logs/ with the removal type
    expect(writtenFiles.some(f => f.includes('.kobopatch-webui/logs/') && f.includes('remove-nickelmenu'))).toBe(true);
  });


  test('with device — remove NickelMenu keeps sync exclusions when other .adds directories remain', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasCalibreExclude: true,
      extraAddsDirs: ['kobocloud'],
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');
    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    expect(await mockPathExists(page, '.adds', 'nm', 'uninstall')).toBe(true);
    expect(await mockPathExists(page, '.adds', 'kobocloud')).toBe(true);

    const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confAfter).toContain(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
  });


  test('with device — remove NickelMenu repairs persisted legacy sync exclusions when another .adds directory remains', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      eReaderConf: '[General]\nsome=setting\n[FeatureSettings]\n' + LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE + '\n',
      extraAddsDirs: ['kobocloud'],
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');
    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    expect(await mockPathExists(page, '.adds', 'nm', 'uninstall')).toBe(true);
    expect(await mockPathExists(page, '.adds', 'kobocloud')).toBe(true);

    const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confAfter).not.toContain(LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
    expect(confAfter).not.toContain('ExcludeSyncFolders=(calibre|');
    expect(confAfter).toContain(EXCLUDE_SYNC_FOLDERS_LINE);
    expect(confAfter).toContain('some=setting');
  });


  test('with device — remove NickelMenu with feature cleanup', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKOReader: true,
      hasAdditionalFonts: true,
      hasScreensaver: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Select remove
    await page.click('input[name="nm-option"][value="remove"]');

    // Uninstall checkboxes should appear for all 3 detected features
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    await expect(page.locator('input[name="nm-uninstall-additional-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-uninstall-screensaver"]')).toBeChecked();
    // Better typography wasn't applied (no webkit setting in conf), so it's absent.
    await expect(page.locator('input[name="nm-uninstall-better-typography"]')).toHaveCount(0);

    // Uncheck screensaver (keep it)
    await page.uncheck('input[name="nm-uninstall-screensaver"]');

    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await skipNmBackup(page);

    // Review should list KOReader and the additional fonts but not Screensaver
    await expect(page.locator('#nm-review-summary')).toContainText('removal');
    await expect(page.locator('#nm-review-list')).toContainText('KOReader');
    await expect(page.locator('#nm-review-list')).toContainText('additional fonts', { ignoreCase: true });
    await expect(page.locator('#nm-review-list')).not.toContainText('Screensaver');

    // Execute removal
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('removed');

    // NickelMenu uninstall marker should exist
    expect(await mockPathExists(page, '.adds', 'nm', 'uninstall')).toBe(true);

    // KOReader directory should be removed
    expect(await mockPathExists(page, '.adds', 'koreader')).toBe(false);

    // Additional font files should be removed across all three families
    expect(await mockPathExists(page, 'fonts', 'KF_Readerly-Regular.ttf')).toBe(false);
    expect(await mockPathExists(page, 'fonts', 'KF_Libron-Regular.ttf')).toBe(false);
    expect(await mockPathExists(page, 'fonts', 'KF_Cartisse-Regular.ttf')).toBe(false);

    // Screensaver should NOT be removed (unchecked)
    expect(await mockPathExists(page, '.kobo', 'screensaver', 'moon.png')).toBe(true);
  });


  test('with device — better typography is detected by its conf setting and reverts only the WebKit tweak', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    // NickelMenu installed, with the better-typography settings already applied.
    await connectMockDevice(page, {
      hasNickelMenu: true,
      eReaderConf: '[General]\nsome=setting\n[Reading]\nwebkitTextRendering=optimizeLegibility\nreadingAlignment=Left\nreadingFontFamily=KF Libron\n',
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');

    // Detected via its conf setting, offered for removal with its own label.
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-better-typography"]')).toBeChecked();
    await expect(page.locator('#nm-uninstall-options')).toContainText('Turn off better typography');

    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await expect(page.locator('#nm-review-list')).toContainText('Better typography');

    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // Only the WebKit setting is removed; alignment and reading font are kept.
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf).not.toContain('webkitTextRendering');
    expect(conf).toContain('readingAlignment=Left');
    expect(conf).toContain('readingFontFamily=KF Libron');
  });


  test('with device — better typography is left alone when its removal is unchecked', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      eReaderConf: '[General]\nsome=setting\n[Reading]\nwebkitTextRendering=optimizeLegibility\n',
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');

    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await page.uncheck('input[name="nm-uninstall-better-typography"]');

    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // Unchecked, so the WebKit setting remains.
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf).toContain('webkitTextRendering=optimizeLegibility');
  });

  test('with device — removal review lists kept features separately from removals', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKOReader: true,
      hasAdditionalFonts: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();

    // Keep the additional fonts; remove KOReader alongside NickelMenu.
    await page.uncheck('input[name="nm-uninstall-additional-fonts"]');

    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await skipNmBackup(page);

    await expect(page.locator('#step-nm-review')).not.toBeHidden();

    // Removals list covers NickelMenu + the feature kept for removal, not the kept one.
    const removals = page.locator('#nm-review-list');
    await expect(removals).toContainText('NickelMenu');
    await expect(removals).toContainText('KOReader');
    await expect(removals).not.toContainText('additional fonts', { ignoreCase: true });

    // Kept card surfaces the feature left installed, and only that one.
    const keptCard = page.locator('#nm-review-kept');
    await expect(keptCard).toBeVisible();
    await expect(keptCard).toContainText('will be kept');
    const keptList = page.locator('#nm-review-kept-list');
    await expect(keptList).toContainText('additional fonts', { ignoreCase: true });
    await expect(keptList).not.toContainText('KOReader');
  });


  test('with device — removal review hides the kept card when nothing is kept', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKOReader: true,
      hasAdditionalFonts: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();

    // Leave every cleanup checkbox checked so nothing is kept.
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await skipNmBackup(page);

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('additional fonts', { ignoreCase: true });
    await expect(page.locator('#nm-review-kept')).toBeHidden();
  });


  test('with device — remove NickelMenu removes sync exclusions after selected .adds features are cleaned up', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKOReader: true,
      hasCalibreExclude: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();

    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    expect(await mockPathExists(page, '.adds', 'koreader')).toBe(false);

    const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confAfter).not.toContain('ExcludeSyncFolders');
    expect(confAfter).toContain('some=setting');
  });


  test('with device — remove NickelMenu keeps sync exclusions when an .adds feature is left installed', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKOReader: true,
      hasCalibreExclude: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    await page.uncheck('input[name="nm-uninstall-koreader"]');

    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    expect(await mockPathExists(page, '.adds', 'koreader')).toBe(true);

    const confAfter = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confAfter).toContain(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
  });


  test('with device — remove NickelMenu, go back, checklist preserved', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKOReader: true,
      hasAdditionalFonts: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select remove
    await page.click('input[name="nm-option"][value="remove"]');

    // Uninstall checkboxes should appear
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    await expect(page.locator('input[name="nm-uninstall-additional-fonts"]')).toBeChecked();

    // Uncheck one option
    await page.uncheck('input[name="nm-uninstall-additional-fonts"]');

    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await skipNmBackup(page);

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-summary')).toContainText('removal');

    // Go back
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-back');

    // Checklist should still be visible with preserved state
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    // Additional Fonts should still be unchecked (state preserved)
    await expect(page.locator('input[name="nm-uninstall-additional-fonts"]')).not.toBeChecked();
  });

});
