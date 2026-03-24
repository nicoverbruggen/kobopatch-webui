// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, EXPECTED_SHA1, ORIGINAL_TGZ_SHA1 } = require('./helpers/paths');
const { hasNickelMenuAssets, hasKoreaderAssets, hasReaderlyAssets, hasFirmwareZip, setupFirmwareSymlink, cleanupFirmwareSymlink } = require('./helpers/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, mockPathExists, getWrittenFiles } = require('./helpers/mock-device');
const { parseTar } = require('./helpers/tar');

test.afterEach(() => {
  cleanupFirmwareSymlink();
});

// ============================================================
// NickelMenu
// ============================================================

test.describe('NickelMenu', () => {
  test('no device — install with config via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasReaderlyAssets(), 'Readerly assets not found (run readerly/setup.sh)');

    await goToManualMode(page);

    // Mode selection: NickelMenu should be pre-selected (checked in HTML)
    await expect(page.locator('input[name="mode"][value="nickelmenu"]')).toBeChecked();
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // No option pre-selected — Continue should be disabled
    await expect(page.locator('#btn-nm-next')).toBeDisabled();

    // Select "Install NickelMenu and configure"
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Verify default checkbox states
    await expect(page.locator('input[name="nm-cfg-readerly-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-screensaver"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-recommendations"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-koreader"]')).not.toBeChecked();

    // Enable both home screen hiding options for testing
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.check('input[name="nm-cfg-hide-notices"]');

    await page.click('#btn-nm-features-next');

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
    // Must contain Readerly .ttf font files (readerly-fonts is checked by default)
    const fontFiles = zipFiles.filter(f => f.startsWith('fonts/') && f.endsWith('.ttf'));
    expect(fontFiles.length).toBeGreaterThan(0);
    // Must NOT contain screensaver (unchecked by default)
    expect(zipFiles.some(f => f.startsWith('.kobo/screensaver/'))).toBe(false);

    // Verify items file has hide-recommendations and hide-notices modifications
    const itemsContent = await zip.file('.adds/nm/items').async('string');
    expect(itemsContent).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(itemsContent).toContain('experimental:hide_home_row3_enabled:1');
  });

  test('no device — install with KOReader via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasReaderlyAssets(), 'Readerly assets not found (run readerly/setup.sh)');
    test.skip(!hasKoreaderAssets(), 'KOReader assets not found (run koreader/setup.sh)');

    await goToManualMode(page);

    // Mode selection
    await expect(page.locator('input[name="mode"][value="nickelmenu"]')).toBeChecked();
    await page.click('#btn-mode-next');

    // NickelMenu configure step — select "Install NickelMenu with preset"
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // KOReader checkbox should be visible and unchecked by default
    await expect(page.locator('input[name="nm-cfg-koreader"]')).not.toBeChecked();

    // Enable KOReader
    await page.check('input[name="nm-cfg-koreader"]');

    await page.click('#btn-nm-features-next');

    // Review step — should list KOReader
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('KOReader');

    // Download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

    // Verify ZIP contents include KOReader files
    expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files);

    expect(zipFiles).toContainEqual('.kobo/KoboRoot.tgz');
    expect(zipFiles).toContainEqual('.adds/nm/items');
    // KOReader files should be present under .adds/koreader/
    expect(zipFiles.some(f => f.startsWith('.adds/koreader/'))).toBe(true);
    // KOReader launcher should be at the top of the items file
    const itemsContent = await zip.file('.adds/nm/items').async('string');
    expect(itemsContent.startsWith('menu_item:main:KOReader')).toBe(true);
  });

  test('with device — install with KOReader writes files to device', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasReaderlyAssets(), 'Readerly assets not found (run readerly/setup.sh)');
    test.skip(!hasKoreaderAssets(), 'KOReader assets not found (run koreader/setup.sh)');

    await connectMockDevice(page, { hasNickelMenu: false });

    await page.click('#btn-device-next');
    await page.click('#btn-mode-next');

    // Select "Install NickelMenu with preset"
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Enable KOReader
    await page.check('input[name="nm-cfg-koreader"]');

    await page.click('#btn-nm-features-next');

    // Review step
    await expect(page.locator('#nm-review-list')).toContainText('KOReader');

    // Write to device
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#nm-done-status')).toContainText('installed');

    // Verify KOReader files were written to mock device
    const writtenFiles = await getWrittenFiles(page);
    expect(writtenFiles.some(f => f.includes('koreader'))).toBe(true);

    // Verify the .adds/koreader directory was created in mock FS
    const koreaderDirExists = await mockPathExists(page, '.adds', 'koreader');
    expect(koreaderDirExists, '.adds/koreader/ should exist').toBe(true);
  });

  test('no device — install NickelMenu only via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await goToManualMode(page);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select "Install NickelMenu only" — goes directly to review (no features step)
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
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
    test.skip(!hasReaderlyAssets(), 'Readerly assets not found (run readerly/setup.sh)');

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
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Enable all options for testing
    await page.check('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.check('input[name="nm-cfg-hide-notices"]');

    await page.click('#btn-nm-features-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu');
    await expect(page.locator('#nm-review-list')).toContainText('Readerly fonts');
    await expect(page.locator('#nm-review-list')).toContainText('Simplify navigation tabs');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen notices');

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

    // Verify Readerly font files were written (readerly-fonts is on by default)
    const fontFiles = writtenFiles.filter(f => f.includes('fonts/') && f.endsWith('.ttf'));
    expect(fontFiles.length, 'Readerly .ttf fonts should be written').toBeGreaterThan(0);

    // Verify eReader.conf was updated with ExcludeSyncFolders
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf, 'eReader.conf should contain ExcludeSyncFolders').toContain('ExcludeSyncFolders');
    expect(conf, 'eReader.conf should preserve existing settings').toContain('[General]');

    // Verify NickelMenu items file exists and has expected modifications
    const items = await readMockFile(page, '.adds', 'nm', 'items');
    expect(items, '.adds/nm/items should exist').not.toBeNull();
    // With hide-recommendations and hide-notices enabled, the hide lines should be appended
    expect(items).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(items).toContain('experimental:hide_home_row3_enabled:1');
    // With simplify-tabs enabled, TAB_CONFIG should be prepended
    expect(items).toContain('experimental :menu_main_15505_enabled: 1');
  });

  test('with device — install NickelMenu only and write to Kobo', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select "Install NickelMenu only" — goes directly to review (no features step)
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
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

    // No extra features installed — uninstall options should be hidden
    await expect(page.locator('#nm-uninstall-options')).toBeHidden();

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

  test('with device — remove NickelMenu with feature cleanup', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKoreader: true,
      hasReaderlyFonts: true,
      hasScreensaver: true,
    });

    await page.click('#btn-device-next');
    await page.click('#btn-mode-next');

    // Select remove
    await page.click('input[name="nm-option"][value="remove"]');

    // Uninstall checkboxes should appear for all 3 detected features
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    await expect(page.locator('input[name="nm-uninstall-readerly-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-uninstall-screensaver"]')).toBeChecked();

    // Uncheck screensaver (keep it)
    await page.uncheck('input[name="nm-uninstall-screensaver"]');

    await page.click('#btn-nm-next');

    // Review should list KOReader and Readerly but not Screensaver
    await expect(page.locator('#nm-review-summary')).toContainText('removal');
    await expect(page.locator('#nm-review-list')).toContainText('KOReader');
    await expect(page.locator('#nm-review-list')).toContainText('Readerly');
    await expect(page.locator('#nm-review-list')).not.toContainText('Screensaver');

    // Execute removal
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#nm-done-status')).toContainText('removed');

    // NickelMenu uninstall marker should exist
    expect(await mockPathExists(page, '.adds', 'nm', 'uninstall')).toBe(true);

    // KOReader directory should be removed
    expect(await mockPathExists(page, '.adds', 'koreader')).toBe(false);

    // Readerly fonts should be removed
    expect(await mockPathExists(page, 'fonts', 'KF_Readerly-Regular.ttf')).toBe(false);
    expect(await mockPathExists(page, 'fonts', 'KF_Readerly-Bold.ttf')).toBe(false);

    // Screensaver should NOT be removed (unchecked)
    expect(await mockPathExists(page, '.kobo', 'screensaver', 'moon.png')).toBe(true);
  });

  test('with device — remove NickelMenu, go back, checklist preserved', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      hasNickelMenu: true,
      hasKoreader: true,
      hasReaderlyFonts: true,
    });

    await page.click('#btn-device-next');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select remove
    await page.click('input[name="nm-option"][value="remove"]');

    // Uninstall checkboxes should appear
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    await expect(page.locator('input[name="nm-uninstall-readerly-fonts"]')).toBeChecked();

    // Uncheck one option
    await page.uncheck('input[name="nm-uninstall-readerly-fonts"]');

    await page.click('#btn-nm-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-summary')).toContainText('removal');

    // Go back
    await page.click('#btn-nm-review-back');

    // Checklist should still be visible with preserved state
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await expect(page.locator('input[name="nm-uninstall-koreader"]')).toBeChecked();
    // Readerly should still be unchecked (state preserved)
    await expect(page.locator('input[name="nm-uninstall-readerly-fonts"]')).not.toBeChecked();
  });

  test('no device — feature selections preserved through back navigation', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasReaderlyAssets(), 'Readerly assets not found (run readerly/setup.sh)');

    await goToManualMode(page);
    await page.click('#btn-mode-next');

    // Select preset → features
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Enable some features, disable readerly-fonts (on by default)
    await page.check('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-hide-notices"]');
    await page.uncheck('input[name="nm-cfg-readerly-fonts"]');

    // Continue to review
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('Simplify navigation tabs');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen notices');
    await expect(page.locator('#nm-review-list')).not.toContainText('Readerly fonts');

    // Back to features — selections must be preserved
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-readerly-fonts"]')).not.toBeChecked();

    // Back to config and then forward again — still preserved
    await page.click('#btn-nm-features-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-readerly-fonts"]')).not.toBeChecked();

    // Now modify selections and verify review updates
    await page.uncheck('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#nm-review-list')).not.toContainText('Simplify navigation tabs');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen notices');
  });

  test('no device — switching between preset and nickelmenu-only updates review', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasReaderlyAssets(), 'Readerly assets not found (run readerly/setup.sh)');

    await goToManualMode(page);
    await page.click('#btn-mode-next');

    // Preset path: enable some features
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.click('#btn-nm-features-next');

    // Review should list features
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
    await expect(page.locator('#nm-review-list')).toContainText('Readerly fonts');

    // Back to features, back to config
    await page.click('#btn-nm-review-back');
    await page.click('#btn-nm-features-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Switch to nickelmenu-only
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await page.click('#btn-nm-next');

    // Review should skip features step and show only NickelMenu
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu (KoboRoot.tgz)');
    await expect(page.locator('#nm-review-list')).not.toContainText('Readerly');
    await expect(page.locator('#nm-review-list')).not.toContainText('Hide home screen');

    // Back to config, switch back to preset
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Features should still have previous selections
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-hide-recommendations"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-readerly-fonts"]')).toBeChecked();

    // Review should show features again
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#nm-review-list')).toContainText('Readerly fonts');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
  });
});

// ============================================================
// Custom patches
// ============================================================

test.describe('Custom patches', () => {
  test('no device — full manual mode patching pipeline', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

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
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

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

  test('with device — incompatible version 5.x shows error', async ({ page }) => {
    await page.goto('/');
    await injectMockDevice(page, { firmware: '5.0.0' });
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    // Device info should be displayed
    await expect(page.locator('#step-device')).not.toBeHidden();
    await expect(page.locator('#device-model')).toHaveText('Kobo Libra Colour');
    await expect(page.locator('#device-firmware')).toHaveText('5.0.0');

    // Status message should show incompatibility warning
    await expect(page.locator('#device-status')).toContainText('incompatible');
    await expect(page.locator('#device-status')).toContainText('NickelMenu does not support it');
    await expect(page.locator('#device-status')).toHaveClass(/error/);

    // Continue and restore buttons should be hidden, but Back should be visible
    await expect(page.locator('#btn-device-next')).toBeHidden();
    await expect(page.locator('#btn-device-restore')).toBeHidden();
    await expect(page.locator('#btn-device-back')).toBeVisible();

    // Back should return to connect step
    await page.click('#btn-device-back');
    await expect(page.locator('#step-connect')).not.toBeHidden();
  });

  test('with device — unknown model shows warning and requires checkbox', async ({ page }) => {
    await page.goto('/');
    await injectMockDevice(page, { serial: 'X9990A0000000' });
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    // Device info should be displayed with unknown model
    await expect(page.locator('#step-device')).not.toBeHidden();
    await expect(page.locator('#device-model')).toContainText('Unknown');
    await expect(page.locator('#device-firmware')).toHaveText('4.45.23646');

    // Warning should be visible with GitHub link
    await expect(page.locator('#device-unknown-warning')).not.toBeHidden();
    await expect(page.locator('#device-unknown-warning')).toContainText('file an issue on GitHub');
    await expect(page.locator('#device-unknown-warning a')).toHaveAttribute('href', 'https://github.com/nicoverbruggen/kobopatch-webui/issues/new');

    // Checkbox should be visible, Continue should be disabled
    await expect(page.locator('#device-unknown-ack')).not.toBeHidden();
    await expect(page.locator('#btn-device-next')).toBeVisible();
    await expect(page.locator('#btn-device-next')).toBeDisabled();

    // Restore Software should be hidden (no firmware URL for unknown model)
    await expect(page.locator('#btn-device-restore')).toBeHidden();

    // Checking the checkbox enables Continue
    await page.check('#device-unknown-checkbox');
    await expect(page.locator('#btn-device-next')).toBeEnabled();

    // Custom patches should be disabled in mode selection (no firmware URL)
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await expect(page.locator('input[name="mode"][value="patches"]')).toBeDisabled();
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
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

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
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

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

  test('with device — build failure shows Go Back and returns to patches', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    setupFirmwareSymlink();
    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Select Custom Patches
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Enable "Remove footer (row3) on new home screen"
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
    const patchSection = patchName.locator('xpath=ancestor::details');
    await patchSection.locator('summary').click();
    await patchName.locator('xpath=ancestor::label').locator('input').check();
    await page.click('#btn-patches-next');

    // Mock the WASM patcher to simulate a failure
    await page.evaluate(() => {
      KoboPatchRunner.prototype.patchFirmware = async function () {
        throw new Error('Patch failed to apply: symbol not found');
      };
    });

    // Build — should fail due to mock
    await page.click('#btn-build');

    await expect(page.locator('#step-error')).not.toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#error-message')).toContainText('Build failed');
    await expect(page.locator('#btn-error-back')).toBeVisible();

    // "Select different patches" should return to patches step
    await page.click('#btn-error-back');
    await expect(page.locator('#step-patches')).not.toBeHidden();
  });

  test('with device — real patch failure with Go Back (Allow rotation)', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    setupFirmwareSymlink();
    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Select Custom Patches
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Enable "Allow rotation on all devices" — marked as not working on 4.45.23646
    const patchName = page.locator('.patch-name', { hasText: 'Allow rotation on all devices' }).first();
    const patchSection = patchName.locator('xpath=ancestor::details');
    await patchSection.locator('summary').click();
    await expect(patchName).toBeVisible();
    await patchName.locator('xpath=ancestor::label').locator('input').check();
    await page.click('#btn-patches-next');

    // Build
    await page.click('#btn-build');

    const doneOrError = await Promise.race([
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      // Build failed — "Select different patches" should return to patches step
      await page.click('#btn-error-back');
      await expect(page.locator('#step-patches')).not.toBeHidden();
    } else {
      // Build succeeded — check if the patch was skipped
      const logText = await page.locator('#build-log').textContent();
      console.log('Build log:', logText);
      const hasSkip = logText.includes('SKIP') && logText.includes('Allow rotation on all devices');
      expect(hasSkip, 'Expected "Allow rotation" to be skipped or fail').toBe(true);
    }
  });

  test('with device — back navigation through auto mode flow', async ({ page }) => {
    await page.goto('/');
    await injectMockDevice(page);
    await page.click('#btn-connect');

    // Step 1a: Connection instructions
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();

    // Back from instructions returns to connect step
    await page.click('#btn-connect-instructions-back');
    await expect(page.locator('#step-connect')).not.toBeHidden();

    // Forward again through instructions
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    // Step 1: Device
    await expect(page.locator('#step-device')).not.toBeHidden();

    // Device → Mode
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → Patches
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-patches')).not.toBeHidden();

    // Patches → Back → Mode
    await page.click('#btn-patches-back');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → NickelMenu config
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // NM config → Back → Mode
    await page.click('#btn-nm-back');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → NM config → Continue (nickelmenu-only) → NM review
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[value="nickelmenu-only"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();

    // NM review → Back → NM config (skips features for nickelmenu-only)
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // NM config → select preset → Continue → Features step
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Features → Continue → NM review
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();

    // NM review → Back → Features (for preset)
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Features → Back → NM config
    await page.click('#btn-nm-features-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // NM config → Back → Mode
    await page.click('#btn-nm-back');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → Back → Device
    await page.click('#btn-mode-back');
    await expect(page.locator('#step-device')).not.toBeHidden();

    // Device → Back → Connect
    await page.click('#btn-device-back');
    await expect(page.locator('#step-connect')).not.toBeHidden();

    // After going back from device, switching to manual mode should not
    // carry stale device state (patches should not appear pre-loaded).
    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await expect(page.locator('input[name="mode"][value="patches"]')).not.toBeDisabled();
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    // Manual + patches should go to version selection (not straight to patches)
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
  });

  test('no device — back navigation through manual mode flow', async ({ page }) => {
    await page.goto('/');
    await goToManualMode(page);

    // Step 1: Mode
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → Patches → Version selection
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();

    // Version → Back → Mode
    await page.click('#btn-manual-version-back');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → NickelMenu config
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // NM config → Back → Mode
    await page.click('#btn-nm-back');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → Patches → Version selection
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();

    // Select version and model, confirm
    await page.selectOption('#manual-version', '4.45.23646');
    await page.locator('#manual-model').waitFor({ state: 'visible' });
    await page.selectOption('#manual-model', 'N428');
    await page.click('#btn-manual-confirm');
    await expect(page.locator('#step-patches')).not.toBeHidden();

    // Patches → Back → Version
    await page.click('#btn-patches-back');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();

    // Version → Back → Mode
    await page.click('#btn-manual-version-back');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Mode → Back → Connect
    await page.click('#btn-mode-back');
    await expect(page.locator('#step-connect')).not.toBeHidden();
  });
});

// ============================================================
// Build output
// ============================================================

test.describe('Build output', () => {
  const path = require('path');
  const distDir = path.join(__dirname, '..', '..', 'web', 'dist');

  test('CSS cache-bust hash is present on style.css link', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).toMatch(/css\/style\.css\?h=[0-9a-f]{8}/);
  });

  test('JS cache-bust hash is present on bundle.js script', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).toMatch(/bundle\.js\?h=[0-9a-f]{8}/);
  });

  test('critical CSS is inlined with :root tokens', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    // :root block should be inside an inline <style> tag, not in a <link>
    expect(html).toMatch(/<style>[^<]*:root\{[^}]*--primary:/);
    // var() references should be used (not hardcoded hex colors for themed values)
    expect(html).toMatch(/<style>[^<]*var\(--primary\)/);
  });

  test('style.css does not contain a :root block', async () => {
    const css = fs.readFileSync(path.join(distDir, 'css', 'style.css'), 'utf-8');
    expect(css).not.toContain(':root');
  });

  test('--primary-hover differs from --primary', async () => {
    const critical = fs.readFileSync(
      path.join(__dirname, '..', '..', 'web', 'src', 'css', 'critical.css'), 'utf-8'
    );
    const primary = critical.match(/--primary:\s*([^;]+);/);
    const hover = critical.match(/--primary-hover:\s*([^;]+);/);
    expect(primary).not.toBeNull();
    expect(hover).not.toBeNull();
    expect(primary[1].trim()).not.toBe(hover[1].trim());
  });

  test('no jszip script tag in built HTML', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).not.toContain('jszip');
  });

  test('no unreplaced template placeholders in built HTML', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).not.toMatch(/\{\{[\w-]+\}\}/);
    expect(html).not.toContain('@critical-css');
  });
});
