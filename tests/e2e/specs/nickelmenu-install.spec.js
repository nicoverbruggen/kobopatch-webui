// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const JSZip = require('jszip');

const { FIRMWARE_PATH, WEBROOT, getOriginalTgzSha1 } = require('../support/paths');
const { hasNickelMenuAssets, hasNickelClockAssets, hasKOReaderAssets, hasCadmusAssets, hasFontAssets, hasFirmwareZip } = require('../support/assets');
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

    await page.addInitScript(() => {
      window.__ANALYTICS_ENABLED = true;
      window.__trackedEvents = [];
      window.umami = {
        track: (eventName, data) => window.__trackedEvents.push({ eventName, data }),
      };
    });
    await goToManualMode(page);

    // Select NickelMenu and continue
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // NickelMenu configure step
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // "Install with preset" is preselected by default — Continue is enabled and
    // the preset card shows as selected.
    await expect(page.locator('input[name="nm-option"][value="preset"]')).toBeChecked();
    const presetCard = page.locator('#step-nickelmenu label.selection-card')
      .filter({ has: page.locator('input[value="preset"]') });
    await expect(presetCard).toHaveClass(/selection-card--selected/);
    await expect(page.locator('#btn-nm-next')).toBeEnabled();

    await page.click('#btn-nm-next');

    // Feature selection step
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('#nm-config-options')).toContainText('Interface tweaks');
    await expect(page.locator('#nm-config-options')).toContainText('Text and typography');
    await expect(page.getByRole('button', { name: 'Customize NickelMenu preset tab' })).toBeVisible();

    // Advanced and Legacy both start collapsed; a normal section stays open. And
    // Legacy renders below Advanced.
    const sectionByTitle = (title) => page.locator('details.nm-config-section', {
      has: page.locator('.nm-config-section-title', { hasText: title }),
    });
    await expect(sectionByTitle('Interface tweaks')).toHaveJSProperty('open', true);
    await expect(sectionByTitle('Advanced')).toHaveJSProperty('open', false);
    await expect(sectionByTitle('Legacy')).toHaveJSProperty('open', false);
    const advancedBox = await sectionByTitle('Advanced').boundingBox();
    const legacyBox = await sectionByTitle('Legacy').boundingBox();
    expect(legacyBox.y).toBeGreaterThan(advancedBox.y);

    // Verify default checkbox states
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-screensaver"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-simplify-tabs"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-recommendations"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-row2col2"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-hide-notices"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-koreader"]')).not.toBeChecked();
    await expect(page.locator('input[name="nm-cfg-exclude-calibre"]')).not.toBeChecked();

    // Features with a hint render a "?" badge labelled "More about <title>".
    // Assert Sideload Mode's badge specifically rather than a global count, since
    // other hinted features (e.g. NickelClock, when its assets are present) also
    // contribute badges.
    await expect(page.getByLabel('More about Enable Sideload Mode')).toHaveCount(1);

    await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
    await expect(page.locator('#nm-customize-dialog')).toBeVisible();
    await expect(page.locator('.nm-icon-choice')).toHaveCount(12);
    await expect(page.getByRole('button', { name: 'Use Cog icon' }).locator('img')).toHaveAttribute('src', /\/?js\/nickelmenu\/features\/custom-menu\/\.cog\.png$/);
    await page.fill('#nm-customize-label', 'ReadMode!');
    await expect(page.locator('#nm-customize-label')).toHaveValue('ReadMode');
    await page.getByRole('button', { name: 'Use Spark icon' }).click();
    await page.click('#btn-nm-customize-save');
    await expect(page.locator('#nm-customize-dialog')).toBeHidden();

    // Enable home screen hiding options and exclude-calibre for testing
    await page.check('input[name="nm-cfg-hide-recommendations"]');
    await page.check('input[name="nm-cfg-hide-row2col2"]');
    await page.check('input[name="nm-cfg-hide-notices"]');
    await openNmSection(page, 'Legacy');
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
    // Feature-tracking events fire only for features actually included in the
    // install. Here that's additional fonts and the minimal-home tweaks.
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'add-fonts', data: undefined },
    );
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'add-minimal-home', data: undefined },
    );
    // Unselected features must not be tracked.
    expect(await page.evaluate(() => window.__trackedEvents.map(e => e.eventName)))
      .not.toEqual(expect.arrayContaining(['add-koreader', 'add-basic-tabs', 'add-sideloaded-mode']));
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'flow-end', data: { result: 'nm-download' } },
    );

    // Download instructions should be visible, and include eReader.conf step for sample config
    await expect(page.locator('#nm-download-instructions')).not.toBeHidden();
    // The screen points users at the bundled instructions.txt file.
    await expect(page.locator('#nm-download-instructions')).toContainText('instructions.txt');
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
    expect(zipFiles).toContainEqual('.adds/nm/.custom-icon.png');
    expect(zipFiles).not.toContainEqual('.adds/nm/.cog.png');
    const customIconBytes = await zip.file('.adds/nm/.custom-icon.png').async('uint8array');
    expect(Array.from(customIconBytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // Must contain font .ttf files (Additional Fonts is checked by default)
    const fontFiles = zipFiles.filter(f => f.startsWith('fonts/') && f.endsWith('.ttf'));
    expect(fontFiles.length).toBeGreaterThan(0);
    // Must NOT contain screensaver (unchecked by default)
    expect(zipFiles.some(f => f.startsWith('.kobo/screensaver/'))).toBe(false);

    // Verify items file has the selected home screen modifications
    const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
    expect(itemsContent).toContain('experimental :menu_main_15505_label :ReadMode');
    expect(itemsContent).toContain('experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.custom-icon.png');
    expect(itemsContent).toContain('experimental:hide_home_row1col2_enabled:1');
    expect(itemsContent).toContain('experimental:hide_home_row2col2_enabled:1');
    expect(itemsContent).toContain('experimental:hide_home_row3_enabled:1');
    expect(itemsContent).toContain('menu_item :library :Rescan books    :nickel_misc        :rescan_books_full');

    // Selecting home-screen hiders adds the universal "Minimal Home"
    // toggle item and ships its script under .adds/nm/scripts. The tabs toggle is
    // not added because simplify-tabs was left unchecked.
    expect(zipFiles).toContainEqual('.adds/nm/scripts/toggle_hidden_home.sh');
    expect(zipFiles).not.toContainEqual('.adds/nm/scripts/toggle_tabs.sh');
    expect(itemsContent).toContain('menu_item :main :Minimal Home :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_hidden_home.sh');

    // The ZIP bundles plain-text instructions mirroring the on-screen steps,
    // including the credit header, the hard-lock disclaimer, and (for a preset)
    // the ExcludeSyncFolders config step.
    expect(zipFiles).toContainEqual('instructions.txt');
    const instructions = await zip.file('instructions.txt').async('string');
    expect(instructions).toContain('Generated by KoboPatch Web UI');
    expect(instructions).toContain('reset your Kobo');
    expect(instructions).toContain('https://help.kobo.com/hc/en-us/articles/360017605314');
    expect(instructions).toContain(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
    expect(instructions).toContain('install NickelMenu automatically.');
  });

  test('no device — uploaded SVG tab icon is resized to 64x64', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await goToManualMode(page);

    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
    await expect(page.locator('#nm-customize-dialog')).toBeVisible();
    await page.setInputFiles('#nm-customize-upload', {
      name: 'wide.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M1 5h18" stroke="black" fill="none"/></svg>'),
    });
    await expect(page.locator('#nm-customize-status')).toHaveText('SVG resized to 64x64.');
    await page.click('#btn-nm-customize-save');

    const additionalFonts = page.locator('input[name="nm-cfg-additional-fonts"]');
    if (await additionalFonts.isChecked()) {
      await additionalFonts.uncheck();
    }

    await page.click('#btn-nm-features-next');
    await page.click('#btn-nm-backup-next');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);

    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files);
    expect(zipFiles).toContainEqual('.adds/nm/.custom-icon.svg');
    expect(zipFiles).not.toContainEqual('.adds/nm/.custom-icon.png');
    const iconContent = await zip.file('.adds/nm/.custom-icon.svg').async('string');
    expect(iconContent).toContain('width="64"');
    expect(iconContent).toContain('height="64"');
    expect(iconContent).toContain('viewBox="0 0 20 10"');

    const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
    expect(itemsContent).toContain('experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.custom-icon.svg');
  });


  test('no device — install with Cadmus via manual download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasCadmusAssets(), 'Cadmus assets not found (run npm run setup:installables)');

    await goToManualMode(page);

    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await expect(page.locator('#nm-config-options')).toContainText('Reading Apps');
    await expect(page.locator('input[name="nm-cfg-cadmus"]')).not.toBeChecked();

    await page.uncheck('input[name="nm-cfg-additional-fonts"]');
    await page.check('input[name="nm-cfg-cadmus"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('Cadmus');
    await expect(page.locator('#nm-review-notices')).toBeHidden();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files);

    expect(zipFiles).toContainEqual('.adds/cadmus/cadmus.sh');
    expect(zipFiles).toContainEqual('.adds/cadmus/cadmus');
    expect(zipFiles.some(f => f.startsWith('.adds/cadmus/libs/'))).toBe(true);

    const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
    expect(itemsContent).toContain('menu_item:main:Open Cadmus');
  });

  test('no device — NickelClock merges into KoboRoot.tgz preserving original files', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasNickelClockAssets(), 'NickelClock assets not found (run npm run setup:installables)');

    // Read the unmerged entries from each source archive. Both ship as a zip
    // wrapping a gzipped tar; parseTar normalizes the leading "./" so names line
    // up with what the merged archive contains.
    async function tgzEntriesFromAsset(assetName) {
      const assetZip = await JSZip.loadAsync(fs.readFileSync(path.join(WEBROOT, 'assets', assetName)));
      const tgz = await assetZip.file('KoboRoot.tgz').async('nodebuffer');
      return parseTar(zlib.gunzipSync(tgz));
    }
    const nmEntries = await tgzEntriesFromAsset('NickelMenu.zip');
    const ncEntries = await tgzEntriesFromAsset('NickelClock.zip');

    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    // NickelClock is an Advanced feature; open the section and select only it.
    await openNmSection(page, 'Advanced');

    // Its row shows the asset version (right-aligned, separate from the title)
    // alongside a "learn more" link to the project.
    const nickelClockRow = page.locator('.nm-config-item', {
      has: page.locator('input[name="nm-cfg-nickelclock"]'),
    });
    await expect(nickelClockRow.locator('.nm-config-version')).toHaveText(/^v?\d/);
    await expect(nickelClockRow.locator('a.nm-config-help')).toHaveAttribute('href', 'https://github.com/shermp/NickelClock');

    // Layout: the version sits inline next to the title on the left, with the "?"
    // badge off on the right — so the version is much closer to the title than to
    // the badge.
    const titleBox = await nickelClockRow.locator('.nm-config-title').boundingBox();
    const versionBox = await nickelClockRow.locator('.nm-config-version').boundingBox();
    const helpBox = await nickelClockRow.locator('.nm-config-help').boundingBox();
    expect(versionBox.x).toBeGreaterThanOrEqual(titleBox.x);
    expect(versionBox.x).toBeLessThan(helpBox.x);
    expect(versionBox.x - titleBox.x).toBeLessThan(helpBox.x - versionBox.x);

    await page.uncheck('input[name="nm-cfg-additional-fonts"]');
    await page.check('input[name="nm-cfg-nickelclock"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-list')).toContainText('Install NickelClock');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-nm-download'),
    ]);
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

    // Unarchive the generated KoboRoot.tgz from the download package.
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    const mergedTgz = await zip.file('.kobo/KoboRoot.tgz').async('nodebuffer');
    const mergedEntries = parseTar(zlib.gunzipSync(mergedTgz));

    // The merged archive is exactly the union of both sources — no more, no less.
    const expectedNames = [...Object.keys(nmEntries), ...Object.keys(ncEntries)].sort();
    expect(Object.keys(mergedEntries).sort()).toEqual(expectedNames);

    // Sanity-check the two plugins and their marker/doc files are present...
    expect(mergedEntries['usr/local/Kobo/imageformats/libnm.so']).toBeDefined();
    expect(mergedEntries['usr/local/Kobo/imageformats/libnickelclock.so']).toBeDefined();
    expect(mergedEntries['mnt/onboard/.adds/nickelclock/uninstall']).toBeDefined();

    // ...and that every file's bytes are byte-for-byte identical to the original.
    for (const [name, data] of Object.entries({ ...nmEntries, ...ncEntries })) {
      expect(mergedEntries[name], `missing ${name} in merged tgz`).toBeDefined();
      expect(Buffer.compare(mergedEntries[name], data), `${name} bytes differ after merge`).toBe(0);
    }

    // NickelClock also contributes its "NickelClock" Toggle item and ships the
    // on-device toggle script that flips the clock on/off.
    const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
    expect(itemsContent).toContain('menu_item :main :NickelClock :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_nickelclock.sh');
    expect(Object.keys(zip.files)).toContainEqual('.adds/nm/scripts/toggle_nickelclock.sh');

    // ...and a prefilled settings.ini: roomier Margin=40, clock on, battery hidden.
    const settingsIni = await zip.file('.adds/nickelclock/settings.ini').async('string');
    expect(settingsIni).toContain('Margin=40');
    expect(settingsIni).toMatch(/\[Clock\]\nEnabled=true/);
    expect(settingsIni).toMatch(/\[Battery\]\nBatteryType=Level\nEnabled=false/);
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
    // NickelClock coexists with NickelMenu (it's an installable Advanced feature),
    // so an existing install is no longer treated as a conflict.
    await expect(page.locator('#nm-preset-conflict-list')).not.toContainText('nickelclock');
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

    // Verify ZIP contents — KoboRoot.tgz plus the install manifest
    expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
    const zipData = fs.readFileSync(await download.path());
    const zip = await JSZip.loadAsync(zipData);
    const zipFiles = Object.keys(zip.files).filter(f => !zip.files[f].dir);

    expect(zipFiles).toEqual(['.kobo/KoboRoot.tgz', '.kobopatch-webui/nickelmenu.json', 'instructions.txt']);

    // NickelMenu-only instructions skip the config step but keep the header,
    // disclaimer, and the universal install steps.
    const instructions = await zip.file('instructions.txt').async('string');
    expect(instructions).toContain('Generated by KoboPatch Web UI');
    expect(instructions).toContain('https://help.kobo.com/hc/en-us/articles/360017605314');
    expect(instructions).not.toContain('Kobo eReader.conf');
    expect(instructions).toContain('install NickelMenu automatically.');
  });


  test('with device — install with config and write to Kobo', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
    test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

    await page.addInitScript(() => {
      window.__ANALYTICS_ENABLED = true;
      window.__trackedEvents = [];
      window.umami = {
        track: (eventName, data) => window.__trackedEvents.push({ eventName, data }),
      };
    });
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
    await openNmSection(page, 'Legacy');
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
    // Feature-tracking events fire only for features actually included in the
    // install. Here that's additional fonts, minimal-home tweaks, and basic tabs.
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'add-fonts', data: undefined },
    );
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'add-minimal-home', data: undefined },
    );
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'add-basic-tabs', data: undefined },
    );
    // Unselected features must not be tracked.
    expect(await page.evaluate(() => window.__trackedEvents.map(e => e.eventName)))
      .not.toEqual(expect.arrayContaining(['add-koreader', 'add-sideloaded-mode']));
    await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual(
      { eventName: 'flow-end', data: { result: 'nm-write' } },
    );
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
    expect(items).not.toContain('menu_item :main :Screensaver');

    // Verify manifest records features and their files
    const manifestText = await readMockFile(page, '.kobopatch-webui', 'nickelmenu.json');
    const manifest = JSON.parse(manifestText);
    expect(manifest.selected).toEqual(
      expect.arrayContaining(['simplify-tabs', 'hide-recommendations', 'hide-notices', 'exclude-calibre']),
    );
    expect(manifest.features['simplify-tabs']).toBeDefined();
    expect(manifest.features['simplify-tabs'].files.some(f => f.path === '.adds/nm/scripts/toggle_tabs.sh')).toBe(true);
    expect(manifest.features['exclude-calibre']).toBeDefined();
    expect(manifest.meta.writer.name).toBe('kobopatch-webui');
    expect(manifest.meta.installed.firmware).toBe('4.45.23646');
    expect(manifest.meta.installed.model).toBe('N428');
  });

  test('with device — failed write offers audit log download', async ({ page }) => {
    test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

    await connectMockDevice(page, {
      failWritePaths: ['KOBOeReader/.kobo/KoboRoot.tgz'],
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-title')).toContainText('Writing to your device didn’t work');
    await expect(page.locator('#error-message')).toContainText('the installation could not be completed');
    await expect(page.locator('#error-device-write-help')).not.toBeHidden();
    await expect(page.locator('#btn-error-download-log')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-error-download-log'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^\d{2}-\d{2}-\d{2}_\d{2}-\d{2}-install-nickelmenu\.log$/);
    const log = fs.readFileSync(await download.path(), 'utf8');
    expect(log).toContain('kobopatch-webui audit log');
    expect(log).toContain('Failed: Could not write .kobo/KoboRoot.tgz');
    expect(await getWrittenFiles(page)).not.toContainEqual(expect.stringContaining('.kobopatch-webui/logs/'));
  });

  test('with device — preset card title becomes "(Re)install" when a prior KoboPatch Web UI install is detected', async ({ page }) => {
    // The webui-preset file is this tool's marker of a previous install.
    await connectMockDevice(page, {
      extraAddsFiles: [{ path: ['nm', 'webui-preset'], content: '# Generated by KoboPatch Web UI\n' }],
    });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    // A prior install is present, so the preset card invites a reinstall and the
    // Remove option is enabled.
    await expect(page.locator('#nm-option-preset-title')).toHaveText('(Re)install with preset (and customize)');
    await expect(page.locator('#nm-option-remove')).not.toHaveClass(/selection-card--disabled/);
  });

  test('with device — preset card title stays "Install" when no prior KoboPatch Web UI install is present', async ({ page }) => {
    // hasNickelMenu writes the legacy `.adds/nm/items` file (not our webui-preset
    // marker), so removal is enabled but the title must not switch to "(Re)install".
    await connectMockDevice(page, { hasNickelMenu: true });

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    await expect(page.locator('#nm-option-preset-title')).toHaveText('Install with preset (and customize)');
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
    await openNmSection(page, 'Legacy');
    await page.check('input[name="nm-cfg-screensaver"]');

    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);

    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

    // The toggle is inserted directly below Screenshots, and the sample
    // screensaver image is written.
    const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
    expect(items).toContain('menu_item :main :Screensaver :cmd_output');
    expect(items).toMatch(/menu_item :main :Screenshots[^\n]*\n\nmenu_item :main :Screensaver/);
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
      f => !f.includes('KoboRoot.tgz') && !f.includes('.kobopatch-webui'),
    );
    expect(configWrites).toHaveLength(0);
    // Manifest should be written with empty feature list
    const manifestText = await readMockFile(page, '.kobopatch-webui', 'nickelmenu.json');
    const manifest = JSON.parse(manifestText);
    expect(manifest.selected).toEqual([]);
    expect(manifest.features).toEqual({});
    expect(manifest.meta.writer.name).toBe('kobopatch-webui');
    expect(manifest.meta.installed.firmware).toBe('4.45.23646');
    expect(manifest.meta.installed.model).toBe('N428');
    // Audit log should be written under .kobopatch-webui/logs/
    expect(writtenFiles.some(f => f.includes('.kobopatch-webui/logs/') && f.includes('install-nickelmenu'))).toBe(true);
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
