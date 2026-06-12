// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, getOriginalTgzSha1 } = require('../support/paths');
const { hasNickelMenuAssets, hasKOReaderAssets, hasFontAssets, hasFirmwareZip } = require('../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, mockPathExists, getWrittenFiles, getRemovedEntries } = require('../support/mock-device');
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

test.describe('NickelMenu — install', () => {
  test('no device — install with config via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await goToManualMode(page);

    // Select NickelMenu and continue
    await page.click('input[name="mode"][value="nickelmenu"]');
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
    await expect(page.locator('#nm-config-options')).toContainText('Interface tweaks');
    await expect(page.locator('#nm-config-options')).toContainText('Text and typography');

    // Verify default checkbox states
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-screensaver"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-recommendations"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-row2col2"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-koreader"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-exclude-calibre"]')).not.toBeChecked();

    // Sideload mode is the one feature with a hint, so exactly one "?" badge shows.
    await expect(page.locator('.nm-config-help')).toHaveCount(1);

    // Enable home screen hiding options and exclude-calibre for testing
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.check('input[name="nm-cfg-hide-row2col2"]');
    await page.check('input[name="nm-cfg-hide-notices"]');
    await openNmSection(page, 'Advanced');
    await page.check('input[name="nm-cfg-exclude-calibre"]');

    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-backup-intro')).toContainText('Manual mode cannot create a backup for you');
    await expect(page.locator('#nm-backup-options')).toBeHidden();
    await expect(page.locator('#nm-manual-backup-instructions')).not.toBeHidden();
    await expect(page.locator('#nm-manual-backup-instructions')).toContainText('.kobo');
    await page.click('#btn-nm-backup-next');

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu');
    await expect(page.locator('#nm-review-list')).toContainText('additional fonts', { ignoreCase: true });
    await expect(page.locator('#nm-review-notices')).toBeHidden();

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
    // Verify the correct pattern and description are shown (exclude-calibre is enabled)
    await expect(page.locator('#nm-download-conf-line')).toHaveText(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
    await expect(page.locator('#nm-download-conf-desc')).toHaveText('This prevents new books in the calibre folder from showing up in Kobo\'s list of books. Move Calibre-transferred books into a "calibre" folder first.');

    // Verify ZIP contents
    expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files);

    // Must contain KoboRoot.tgz
    expect(zipFiles).toContainEqual('.kobo/KoboRoot.tgz');
    // Must contain NickelMenu items config
    expect(zipFiles).toContainEqual('.adds/nm/webui-preset');
    // Must contain font .ttf files (Additional Fonts is checked by default)
    const fontFiles = zipFiles.filter(f => f.startsWith('fonts/') && f.endsWith('.ttf'));
    expect(fontFiles.length).toBeGreaterThan(0);
    // Must NOT contain screensaver (unchecked by default)
    expect(zipFiles.some(f => f.startsWith('.kobo/screensaver/'))).toBe(false);

    // Verify items file has the selected home screen modifications
    const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
    expect(itemsContent).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(itemsContent).toContain('experimental:hide_home_row2col2_enabled:1');
    expect(itemsContent).toContain('experimental:hide_home_row3_enabled:1');
    expect(itemsContent).toContain('menu_item :library :Rescan books    :nickel_misc        :rescan_books_full');

    // Selecting home-screen hiders adds the universal "Toggle Minimal Home"
    // toggle item and ships its script under .adds/nm/scripts. The tabs toggle is
    // not added because simplify-tabs was left unchecked.
    expect(zipFiles).toContainEqual('.adds/nm/scripts/toggle_hidden_home.sh');
    expect(zipFiles).not.toContainEqual('.adds/nm/scripts/toggle_tabs.sh');
    expect(itemsContent).toContain('menu_item :main :Toggle Minimal Home :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_hidden_home.sh');
  });


  test('no device — install with KOReader via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');
    test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');

    await goToManualMode(page);

    // Select NickelMenu and continue
    await page.click('input[name="mode"][value="nickelmenu"]');
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
    await skipNmBackup(page);

    // Review step — should list KOReader
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('KOReader');
    await expect(page.locator('#nm-review-notices')).toBeVisible();
    await expect(page.locator('#nm-review-notices')).toContainText('Known issue with KOReader');
    await expect(page.locator('#nm-review-notices')).toContainText('while Bluetooth is enabled');
    await expect(page.locator('#nm-review-notices')).toContainText('NickelMenu to uninstall itself');

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
    expect(zipFiles).toContainEqual('.adds/nm/webui-preset');
    // KOReader files should be present under .adds/koreader/
    expect(zipFiles.some(f => f.startsWith('.adds/koreader/'))).toBe(true);
    // KOReader launcher should be the first menu item, just below the Tweak
    // tab header (first in MENU_ITEM_ORDER after the header).
    const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
    expect(itemsContent).toContain('menu_item:main:Open KOReader');
    const firstMenuItem = itemsContent.split('\n').find(line => line.startsWith('menu_item'));
    expect(firstMenuItem.startsWith('menu_item:main:Open KOReader')).toBe(true);
  });


  test('with device — install with KOReader writes files to device', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');
    test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: false });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Select "Install NickelMenu with preset"
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Enable KOReader
    await page.check('input[name="nm-cfg-koreader"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    // Review step
    await expect(page.locator('#nm-review-list')).toContainText('KOReader');
    await expect(page.locator('#nm-review-notices')).toBeVisible();
    await expect(page.locator('#nm-review-notices')).toContainText('Known issue with KOReader');
    await expect(page.locator('#nm-review-notices')).toContainText('while Bluetooth is enabled');
    await expect(page.locator('#nm-review-notices')).toContainText('NickelMenu to uninstall itself');

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


  test('with device — preset warns about Dark Mode on unsupported devices', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    // Kobo Aura HD (N204) is an older model that does not support Dark mode.
    await connectMockDevice(page, {
      serial: 'N204E0000000000',
      expectedModel: 'Kobo Aura HD',
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Pick the preset and continue to feature selection.
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    // The Dark Mode warning appears on the review step for this device.
    await expect(page.locator('#nm-review-notices')).toContainText('Dark Mode is not supported');
    await expect(page.locator('#nm-review-notices')).toContainText('Kobo Aura HD');

    // Writing to the device drops the Dark Mode line from .adds/nm/webui-preset.
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

    const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
    // The Dark Mode item is omitted entirely (it is no longer commented out).
    expect(items).not.toMatch(/Dark Mode/);
    expect(items).not.toMatch(/:dark_mode/);
  });


  test('with device — preset does not warn about Dark Mode on supported devices', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    // The default mock device is a Kobo Libra Colour, which supports Dark mode.
    await connectMockDevice(page);

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    // No Dark Mode warning on a device that supports it.
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-notices')).not.toContainText('Dark Mode is not supported');
  });


  test('with device — preset is blocked when conflicting add-ons are already installed', async ({ page }) => {
    await connectMockDevice(page, {
      hasNickelDbus: true,
      hasNickelSeries: true,
      hasNickelClock: true,
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-preset-conflict')).not.toBeHidden();
    await expect(page.locator('#nm-preset-conflict-summary')).toContainText('This Kobo seems to have been modded before');
    await expect(page.locator('#nm-preset-conflict-list')).toContainText('nickeldbus (.adds/nickeldbus)');
    await expect(page.locator('#nm-preset-conflict-list')).toContainText('nickelseries (.adds/nickelseries)');
    await expect(page.locator('#nm-preset-conflict-list')).toContainText('nickelclock (.adds/nickelclock)');
    await expect(page.locator('#btn-nm-preset-conflict-next')).toBeDisabled();

    await page.check('#nm-preset-conflict-ack');
    await expect(page.locator('#btn-nm-preset-conflict-next')).toBeEnabled();
    await page.click('#btn-nm-preset-conflict-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-preset-conflict')).not.toBeHidden();
    await page.click('#btn-nm-preset-conflict-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
  });


  test('no device — install NickelMenu only via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select "Install NickelMenu only" — goes directly to review (no features step)
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await page.click('#btn-nm-next');
    await skipNmBackup(page);

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


  test('with device — install with config and write to Kobo', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Continue to mode selection
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Select NickelMenu and continue
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Remove option should be disabled (no NickelMenu installed)
    await expect(page.locator('#nm-option-remove')).toHaveClass(/selection-card--disabled/);

    // Select "Install NickelMenu and configure"
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Enable all options for testing
    await page.check('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.check('input[name="nm-cfg-hide-notices"]');
    await openNmSection(page, 'Advanced');
    await page.check('input[name="nm-cfg-exclude-calibre"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    // Review step
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu');
    await expect(page.locator('#nm-review-list')).toContainText('additional fonts', { ignoreCase: true });
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
    expect(writtenFiles, 'NickelMenu config should be written').toContainEqual(expect.stringContaining('webui-preset'));

    // Verify font files were written (Additional Fonts is on by default)
    const fontFiles = writtenFiles.filter(f => f.includes('fonts/') && f.endsWith('.ttf'));
    expect(fontFiles.length, 'font .ttf files should be written').toBeGreaterThan(0);

    // Verify eReader.conf was updated with ExcludeSyncFolders including calibre exclusion
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf, 'eReader.conf should contain ExcludeSyncFolders').toContain('ExcludeSyncFolders');
    expect(conf, 'eReader.conf should preserve existing settings').toContain('[General]');
    // exclude-calibre is enabled -- calibre folder should be in the pattern
    expect(conf).toContain(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
    expect(conf).not.toContain(QUADRUPLE_BACKSLASH_DOT);

    // better-typography (on by default) applies its reading settings; with the
    // additional fonts also installed, KF Libron becomes the default font.
    expect(conf).toContain('webkitTextRendering=optimizeLegibility');
    expect(conf).toContain('readingAlignment=Left');
    expect(conf).toContain('readingFontFamily=KF Libron');

    // Verify NickelMenu items file exists and has expected modifications
    const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
    expect(items, '.adds/nm/webui-preset should exist').not.toBeNull();
    // With hide-recommendations and hide-notices enabled, the hide lines should be appended
    expect(items).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(items).toContain('experimental:hide_home_row3_enabled:1');
    // With simplify-tabs enabled, TAB_CONFIG should be prepended
    expect(items).toContain('experimental :menu_main_15505_enabled: 1');
    expect(items).toContain('menu_item :library :Rescan books    :nickel_misc        :rescan_books_full');
    // Screensaver was not selected, so its toggle is absent from the menu.
    expect(items).not.toContain('menu_item :main :Toggle Screensaver');
  });


  test('with device — selecting the screensaver adds its Tweak menu toggle and image', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: false });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await openNmSection(page, 'Advanced');
    await page.check('input[name="nm-cfg-screensaver"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // The toggle is inserted directly below Toggle Screenshots, and the sample
    // screensaver image is written.
    const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
    expect(items).toContain('menu_item :main :Toggle Screensaver :cmd_output');
    expect(items).toMatch(/menu_item :main :Toggle Screenshots[^\n]*\n\nmenu_item :main :Toggle Screensaver/);
    expect(await mockPathExists(page, '.kobo', 'screensaver', 'moon.png')).toBe(true);
  });


  test('with device — reading defaults are untouched when Better Typography is not selected', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Confirm the device starts with the empty Kobo reading defaults.
    const confBefore = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confBefore).toContain('readingAlignment=\n');
    expect(confBefore).toContain('readingFontFamily=\n');

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Turn off Better Typography (on by default); leave the fonts installing.
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-better-typography"]')).toBeChecked();
    await page.uncheck('input[name="nm-cfg-better-typography"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // The empty reading defaults must remain empty and no rendering line is added,
    // even though the additional fonts were installed.
    const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(conf).toContain('readingAlignment=\n');
    expect(conf).toContain('readingFontFamily=\n');
    expect(conf).not.toContain('readingAlignment=Left');
    expect(conf).not.toContain('readingFontFamily=KF Libron');
    expect(conf).not.toContain('webkitTextRendering');
  });


  test('with device — backup step can download important files before review', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: true, hasCalibreExclude: true });

    const confBefore = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
    expect(confBefore).toContain(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await page.click('#btn-nm-features-next');

    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#btn-nm-backup-next')).toBeEnabled();
    await expect(page.locator('#nm-manual-backup-instructions')).toBeHidden();

    const [backupDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-backup-next'),
    ]);

    expect(backupDownload.suggestedFilename()).toMatch(/^KoboPatch Backup \(N4280A0000000\) - \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.zip$/);
    const backupZip = await JSZip.loadAsync(fs.readFileSync(await backupDownload.path()));
    const backupFiles = Object.keys(backupZip.files);
    expect(backupFiles).toContain('.kobo/Kobo/Kobo eReader.conf');
    expect(backupFiles).toContain('.kobo/Kobo/affiliate.conf');
    expect(backupFiles).toContain('.kobo/markups/sample.annot');
    expect(backupFiles).toContain('.kobo/BookReader.sqlite');
    expect(backupFiles).toContain('.kobo/device.salt.conf');
    expect(backupFiles).toContain('.kobo/fonts.sqlite');
    expect(backupFiles).toContain('.kobo/KoboReader.sqlite');
    expect(backupFiles).toContain('.kobo/version');
    expect(backupFiles).toContain('.adds/nm/items');

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#btn-nm-download')).toBeVisible();
    await expect(page.locator('#btn-nm-write')).toBeVisible();
  });


  test('with device — install NickelMenu only and write to Kobo', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, { hasNickelMenu: false });

    // Continue to mode selection → select NickelMenu
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Select "Install NickelMenu only" — goes directly to review (no features step)
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await page.click('#btn-nm-next');
    await skipNmBackup(page);

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
    // Should NOT have written items, fonts, etc. (the audit log is a meta file,
    // not a config/feature file, so it is expected alongside KoboRoot.tgz.)
    const configWrites = writtenFiles.filter(
      f => !f.includes('KoboRoot.tgz') && !f.includes('.kobopatch-webui/'),
    );
    expect(configWrites).toHaveLength(0);
  });


  test('no device — feature selections preserved through back navigation', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Select preset → features
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();

    // Enable some features, disable Additional Fonts (on by default)
    await page.check('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-hide-notices"]');
    await page.uncheck('input[name="nm-cfg-additional-fonts"]');

    // Continue to review
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('Simplify navigation tabs');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen notices');
    await expect(page.locator('#nm-review-list')).not.toContainText('additional fonts', { ignoreCase: true });

    // Back to backup, then features — selections must be preserved
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-back');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).not.toBeChecked();

    // Back to config and then forward again — still preserved
    await page.click('#btn-nm-features-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).not.toBeChecked();

    // Now modify selections and verify review updates
    await page.uncheck('input[name="nm-cfg-simplify-tabs"]');
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#nm-review-list')).not.toContainText('Simplify navigation tabs');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen notices');
  });


  test('with device — legacy items from KP Web UI is unchecked by default and old items removed on install', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: true });

    // Replace default items content with one containing our heuristic string
    // so the flow detects it as a previous KP Web UI installation.
    await page.evaluate(() => {
      window.__mockFS['.adds']['nm']['items'] = {
        _type: 'file',
        content: [
          'experimental :menu_main_15505_label :Toggle',
          'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png',
          'menu_item :main :Toggle Typography :cmd_output :7000 :/mnt/onboard/.adds/scripts/toggle_typography.sh',
        ].join('\n'),
      };
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');

    // Backup step: checkbox should be visible and unchecked
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-keep-config-option')).toBeVisible();
    await expect(page.locator('#nm-keep-items')).not.toBeChecked();

    // Proceed with the install (unchecked by default → old items deleted)
    await page.click('input[name="nm-backup-option"][value="skip"]');
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    const writtenFiles = await getWrittenFiles(page);
    const removed = await getRemovedEntries(page);

    // New webui-preset should be written and old items file removed
    expect(writtenFiles.some(f => f.includes('webui-preset'))).toBe(true);
    expect(removed.some(e => e.path.includes('items'))).toBe(true);
  });


  test('with device — legacy items manually configured is checked by default and old items kept on install', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    // Default items content ("menu_item:main:test:skip:") does not contain
    // any heuristic strings, so the flow treats it as a manual config.
    await connectMockDevice(page, { hasNickelMenu: true });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');

    // Backup step: checkbox should be visible and checked
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-keep-config-option')).toBeVisible();
    await expect(page.locator('#nm-keep-items')).toBeChecked();

    // Proceed with the install (checked by default → old items kept)
    await page.click('input[name="nm-backup-option"][value="skip"]');
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    const writtenFiles = await getWrittenFiles(page);
    const removed = await getRemovedEntries(page);

    // New webui-preset should be written, but old items should NOT be removed
    expect(writtenFiles.some(f => f.includes('webui-preset'))).toBe(true);
    expect(removed.some(e => e.path.includes('items'))).toBe(false);
  });


  test('with device — no legacy items hides keep-config checkbox', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await connectMockDevice(page, { hasNickelMenu: false });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');

    // Backup step: checkbox should be hidden
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-keep-config-option')).toBeHidden();
  });


  test('no device — switching between preset and nickelmenu-only updates review', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Preset path: enable some features
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    // Review should list features
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
    await expect(page.locator('#nm-review-list')).toContainText('additional fonts', { ignoreCase: true });

    // Back to backup, back to features, back to config
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-back');
    await page.click('#btn-nm-features-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // Switch to nickelmenu-only
    await page.click('input[name="nm-option"][value="nickelmenu-only"]');
    await page.click('#btn-nm-next');
    await skipNmBackup(page);

    // Review should skip features step and show only NickelMenu
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('NickelMenu (KoboRoot.tgz)');
    await expect(page.locator('#nm-review-list')).not.toContainText('additional fonts', { ignoreCase: true });
    await expect(page.locator('#nm-review-list')).not.toContainText('Hide home screen');

    // Back to backup, then config, switch back to preset
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-back');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    // Features should still have previous selections
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('input[name="nm-cfg-hide-recommendations"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();

    // Review should show features again
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#nm-review-list')).toContainText('additional fonts', { ignoreCase: true });
    await expect(page.locator('#nm-review-list')).toContainText('Hide home screen recommendations');
  });
});
