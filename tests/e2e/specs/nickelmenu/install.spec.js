// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const JSZip = require('jszip');

const { FIRMWARE_PATH, WEBROOT, getOriginalTgzSha1 } = require('../../support/paths');
const { hasNickelMenuAssets, hasNickelClockAssets, hasKOReaderAssets, hasCadmusAssets, hasFontAssets, hasFirmwareZip } = require('../../support/assets');
const {
    injectMockDevice,
    connectMockDevice,
    overrideFirmwareURLs,
    goToManualMode,
    readMockFile,
    mockPathExists,
    getWrittenFiles,
    getRemovedEntries,
} = require('../../support/mock-device');
const { parseTar } = require('../../support/tar');
const {
    EXCLUDE_SYNC_FOLDERS_LINE,
    EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
    LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINE,
    LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
    QUADRUPLE_BACKSLASH_DOT,
    skipNmBackup,
    openNmSection,
} = require('../../support/nm-helpers');

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
        const presetCard = page.locator('#step-nickelmenu label.selection-card').filter({ has: page.locator('input[value="preset"]') });
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
        const sectionByTitle = (title) =>
            page.locator('details.nm-config-section', {
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
        await expect(page.getByRole('button', { name: 'Use Cog icon' }).locator('img')).toHaveAttribute('src', /\/assets\/\.cog\.png$/);
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
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-done-status')).toContainText('ready to download');
        // Feature-tracking events fire only for features actually included in the
        // install. Here that's additional fonts and the minimal-home tweaks.
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'add-fonts', data: undefined });
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'add-minimal-home', data: undefined });
        // Unselected features must not be tracked.
        expect(await page.evaluate(() => window.__trackedEvents.map((e) => e.eventName))).not.toEqual(
            expect.arrayContaining(['add-koreader', 'add-basic-tabs', 'add-sideloaded-mode']),
        );
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'flow-end', data: { result: 'nm-download' } });

        // Download instructions should be visible, and include eReader.conf step for sample config
        await expect(page.locator('#nm-download-instructions')).not.toBeHidden();
        // The screen points users at the bundled instructions.txt file.
        await expect(page.locator('#nm-download-instructions')).toContainText('instructions.txt');
        await expect(page.locator('#nm-download-conf-step')).not.toBeHidden();
        // Verify the correct pattern and description are shown (exclude-calibre is enabled)
        await expect(page.locator('#nm-download-conf-line')).toHaveText(EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE);
        await expect(page.locator('#nm-download-conf-desc')).toHaveText(
            'This prevents new books in the calibre folder from showing up in Kobo\'s list of books. Move Calibre-transferred books into a "calibre" folder first.',
        );

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
        const fontFiles = zipFiles.filter((f) => f.startsWith('fonts/') && f.endsWith('.ttf'));
        expect(fontFiles.length).toBeGreaterThan(0);
        // Must NOT contain screensaver (unchecked by default)
        expect(zipFiles.some((f) => f.startsWith('.kobo/screensaver/'))).toBe(false);

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
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-done-status')).toContainText('ready to download');

        // eReader.conf step should be hidden for nickelmenu-only
        await expect(page.locator('#nm-download-conf-step')).toBeHidden();

        // Verify ZIP contents — KoboRoot.tgz plus the install manifest
        expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
        const zipData = fs.readFileSync(await download.path());
        const zip = await JSZip.loadAsync(zipData);
        const zipFiles = Object.keys(zip.files).filter((f) => !zip.files[f].dir);

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
        await connectMockDevice(page, { hasNickelMenu: false, uiLocale: 'en' });

        // The device overview surfaces the detected UI language.
        await expect(page.locator('#device-language-row')).toBeVisible();
        await expect(page.locator('#device-language')).toHaveText('English');

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
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'add-fonts', data: undefined });
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'add-minimal-home', data: undefined });
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'add-basic-tabs', data: undefined });
        // Unselected features must not be tracked.
        expect(await page.evaluate(() => window.__trackedEvents.map((e) => e.eventName))).not.toEqual(
            expect.arrayContaining(['add-koreader', 'add-sideloaded-mode']),
        );
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'flow-end', data: { result: 'nm-write' } });
        await expect(page.locator('#nm-write-instructions')).not.toBeHidden();

        // Verify files written to mock device
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles, 'KoboRoot.tgz should be written').toContainEqual(expect.stringContaining('KoboRoot.tgz'));
        expect(writtenFiles, 'NickelMenu config should be written').toContainEqual(expect.stringContaining('webui-preset'));

        // Verify font files were written (Additional Fonts is on by default)
        const fontFiles = writtenFiles.filter((f) => f.includes('fonts/') && f.endsWith('.ttf'));
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
        // On an English device the tab labels are renamed (possessive dropped, "Stats" for Activity).
        expect(items).toContain('experimental :menu_main_15505_1_label: Books');
        expect(items).toContain('experimental :menu_main_15505_2_label: Stats');
        expect(items).toContain('experimental :menu_main_15505_3_label: Notes');
        expect(items).toContain('menu_item :library :Rescan books    :nickel_misc        :rescan_books_full');
        // Screensaver was not selected, so its toggle is absent from the menu.
        expect(items).not.toContain('menu_item :main :Screensaver');

        // Verify manifest records features and their files
        const manifestText = await readMockFile(page, '.kobopatch-webui', 'nickelmenu.json');
        const manifest = JSON.parse(manifestText);
        expect(manifest.selected).toEqual(expect.arrayContaining(['simplify-tabs', 'hide-recommendations', 'hide-notices', 'exclude-calibre']));
        expect(manifest.features['simplify-tabs']).toBeDefined();
        expect(manifest.features['simplify-tabs'].files.some((f) => f.path === '.adds/nm/scripts/toggle_tabs.sh')).toBe(true);
        expect(manifest.features['exclude-calibre']).toBeDefined();
        expect(manifest.meta.writer.name).toBe('kobopatch-webui');
        expect(manifest.meta.installed.firmware).toBe('4.45.23646');
        expect(manifest.meta.installed.channel).toBe('kobo13');
    });

    test('with device — failed write aborts and offers the audit log, leaving partial changes in place', async ({ page }) => {
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
        await expect(page.locator('#error-message')).toContainText('partly applied');
        // Connection tips are shown inline (no longer behind a disclosure panel).
        await expect(page.locator('#error-device-write-help')).toBeVisible();
        await expect(page.locator('#error-device-write-help ol li')).toHaveCount(3);
        await expect(page.locator('#btn-error-download-log')).toBeVisible();

        // The app aborts on the failed write without rolling anything back: files
        // written before the failure are left in place.
        expect(await mockPathExists(page, '.adds', 'nm', 'webui-preset')).toBe(true);

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-error-download-log')]);
        expect(download.suggestedFilename()).toMatch(/^\d{2}-\d{2}-\d{2}_\d{2}-\d{2}-install-nickelmenu\.log$/);
        const log = fs.readFileSync(await download.path(), 'utf8');
        expect(log).toContain('kobopatch-webui audit log');
        expect(log).toContain('Failed: Could not write .kobo/KoboRoot.tgz');
        expect(log).not.toContain('Rollback:');
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

    test('with device — unreadable Kobo eReader.conf fails instead of overwriting config', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

        await connectMockDevice(page, {
            hasNickelMenu: false,
            failReadPaths: ['.kobo/Kobo/Kobo eReader.conf'],
        });

        const confBefore = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
        expect(confBefore).toContain('[General]');
        expect(confBefore).toContain('some=setting');

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-error')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#error-title')).toContainText('NickelMenu could not be installed');
        await expect(page.locator('#error-message')).toContainText('An important configuration file could not be read');
        await expect(page.locator('#error-rollback-help')).toBeHidden();
        await expect(page.locator('#error-device-write-help')).toBeVisible();
        await expect(page.locator('#error-device-write-help')).not.toHaveAttribute('open', '');

        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles).not.toContain('KOBOeReader/.kobo/KoboRoot.tgz');
        expect(writtenFiles).not.toContain('KOBOeReader/.kobo/Kobo/Kobo eReader.conf');
        expect(await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf')).toBe(confBefore);
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

        const [backupDownload] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-backup-next')]);

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
        const configWrites = writtenFiles.filter((f) => !f.includes('KoboRoot.tgz') && !f.includes('.kobopatch-webui'));
        expect(configWrites).toHaveLength(0);
        // Manifest should be written with empty feature list
        const manifestText = await readMockFile(page, '.kobopatch-webui', 'nickelmenu.json');
        const manifest = JSON.parse(manifestText);
        expect(manifest.selected).toEqual([]);
        expect(manifest.features).toEqual({});
        expect(manifest.meta.writer.name).toBe('kobopatch-webui');
        expect(manifest.meta.installed.firmware).toBe('4.45.23646');
        expect(manifest.meta.installed.channel).toBe('kobo13');
        // Audit log should be written under .kobopatch-webui/logs/
        expect(writtenFiles.some((f) => f.includes('.kobopatch-webui/logs/') && f.includes('install-nickelmenu'))).toBe(true);
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
