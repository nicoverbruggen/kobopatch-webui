// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const JSZip = require('jszip');

const { FIRMWARE_PATH, WEBROOT, getOriginalTgzSha1 } = require('../../support/paths');
const {
    hasNickelMenuAssets,
    hasNickelClockAssets,
    hasNickelTypeFixAssets,
    hasKOReaderAssets,
    hasSimpleUIAssets,
    hasCadmusAssets,
    hasFontAssets,
    hasFirmwareZip,
} = require('../../support/assets');
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
    test('no device — install with Cadmus via manual download', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasCadmusAssets(), 'Cadmus assets not found (run npm run setup:installables)');

        await goToManualMode(page);

        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await expect(page.locator('#nm-config-options')).toContainText('Alternative reading apps');
        await expect(page.locator('input[name="nm-cfg-cadmus"]')).not.toBeChecked();

        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        // Better typography and fixes would add the NickelTypeFix notice; deselect it so
        // this test can assert the review step shows no notices at all.
        await page.uncheck('input[name="nm-cfg-better-typography"]');
        await openNmSection(page, 'Alternative reading apps');
        await page.check('input[name="nm-cfg-cadmus"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-list')).toContainText('Cadmus');
        await expect(page.locator('#nm-review-notices')).toBeHidden();

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

        const zipData = fs.readFileSync(await download.path());
        const zip = await JSZip.loadAsync(zipData);
        const zipFiles = Object.keys(zip.files);

        expect(zipFiles).toContainEqual('.adds/cadmus/cadmus.sh');
        expect(zipFiles).toContainEqual('.adds/cadmus/cadmus');
        expect(zipFiles.some((f) => f.startsWith('.adds/cadmus/libs/'))).toBe(true);

        const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
        expect(itemsContent).toContain('menu_item:main:Cadmus');
        expect(itemsContent).toContain('chain_success :cmd_output :1000 :/mnt/onboard/.adds/nm/scripts/toggle_screenshots.sh');
        expect(zipFiles).toContainEqual('.adds/nm/scripts/toggle_screenshots.sh');
    });

    test('no device — NickelClock merges into KoboRoot.tgz preserving original files', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelClockAssets(), 'NickelClock assets not found (run npm run setup:installables)');

        // Read the unmerged entries from each source archive. NickelMenu ships as a
        // bare gzipped tar; NickelClock ships as a zip wrapping one. parseTar
        // normalizes the leading "./" so names line up with the merged archive.
        function tgzEntries(tgz) {
            return parseTar(zlib.gunzipSync(tgz));
        }
        async function tgzEntriesFromZipAsset(assetName) {
            const assetZip = await JSZip.loadAsync(fs.readFileSync(path.join(WEBROOT, 'assets', assetName)));
            return tgzEntries(await assetZip.file('KoboRoot.tgz').async('nodebuffer'));
        }
        const nmEntries = tgzEntries(fs.readFileSync(path.join(WEBROOT, 'assets', 'NickelMenu.tgz')));
        const ncEntries = await tgzEntriesFromZipAsset('NickelClock.zip');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        // Its row shows the asset version (right-aligned, separate from the title)
        // alongside a "learn more" link to the project.
        const nickelClockRow = page.locator('.nm-config-item', {
            has: page.locator('input[name="nm-cfg-nickelclock"]'),
        });
        await expect(nickelClockRow.locator('.nm-config-title')).toContainText('Display clock when reading');
        await expect(nickelClockRow.locator('.nm-config-version')).toHaveText(/^v?\d/);
        await expect(nickelClockRow.locator('a.nm-config-help')).toHaveAttribute('href', 'https://github.com/shermp/NickelClock');

        // Layout: the version sits inline after the title, before the "?" badge.
        const titleBox = await nickelClockRow.locator('.nm-config-title').boundingBox();
        const versionBox = await nickelClockRow.locator('.nm-config-version').boundingBox();
        const helpBox = await nickelClockRow.locator('.nm-config-help').boundingBox();
        expect(versionBox.x).toBeGreaterThanOrEqual(titleBox.x);
        expect(versionBox.x).toBeLessThan(helpBox.x);
        expect(versionBox.x + versionBox.width).toBeLessThan(helpBox.x);

        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        // Better typography and fixes would merge NickelTypeFix into the archive too;
        // deselect it so the merge is exactly NickelMenu + NickelClock.
        await page.uncheck('input[name="nm-cfg-better-typography"]');
        await page.check('input[name="nm-cfg-nickelclock"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-list')).toContainText('Display clock when reading');

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
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
    });

    test('no device — Better typography and fixes merges NickelTypeFix into KoboRoot.tgz preserving original files', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelTypeFixAssets(), 'NickelTypeFix assets not found (run npm run setup:installables)');

        // NickelMenu and NickelTypeFix both ship as a bare KoboRoot.tgz.
        const nmEntries = parseTar(zlib.gunzipSync(fs.readFileSync(path.join(WEBROOT, 'assets', 'NickelMenu.tgz'))));
        const ntfEntries = parseTar(zlib.gunzipSync(fs.readFileSync(path.join(WEBROOT, 'assets', 'NickelTypeFix.tgz'))));

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        // Better typography and fixes (which folds in NickelTypeFix) is selected by
        // default; only skip the large font download.
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await expect(page.locator('input[name="nm-cfg-better-typography"]')).toBeChecked();
        const typographyRow = page.locator('.nm-config-item', {
            has: page.locator('input[name="nm-cfg-better-typography"]'),
        });
        await expect(typographyRow.locator('.nm-config-title')).toContainText('Better typography and fixes');
        await expect(typographyRow.locator('.nm-config-version')).toHaveText(/^v?\d/);

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        // The review step announces the bundled NickelTypeFix mod.
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-notices')).toBeVisible();
        await expect(page.locator('#nm-review-notices')).toContainText('NickelTypeFix');

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

        // Unarchive the generated KoboRoot.tgz from the download package.
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const mergedTgz = await zip.file('.kobo/KoboRoot.tgz').async('nodebuffer');
        const mergedEntries = parseTar(zlib.gunzipSync(mergedTgz));

        // The merged archive is exactly the union of both sources — no more, no less.
        const expectedNames = [...Object.keys(nmEntries), ...Object.keys(ntfEntries)].sort();
        expect(Object.keys(mergedEntries).sort()).toEqual(expectedNames);

        // Both plugins travel, along with NickelTypeFix's uninstall_xflag marker
        // (whose absence later triggers the mod's self-uninstall)...
        expect(mergedEntries['usr/local/Kobo/imageformats/libnm.so']).toBeDefined();
        expect(mergedEntries['usr/local/Kobo/imageformats/libnickeltypefix.so']).toBeDefined();
        expect(mergedEntries['mnt/onboard/.adds/nickel-type-fix/uninstall']).toBeDefined();

        // ...and every file's bytes are byte-for-byte identical to the original.
        for (const [name, data] of Object.entries({ ...nmEntries, ...ntfEntries })) {
            expect(mergedEntries[name], `missing ${name} in merged tgz`).toBeDefined();
            expect(Buffer.compare(mergedEntries[name], data), `${name} bytes differ after merge`).toBe(0);
        }
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

        // KOReader lives in the collapsed "Alternative reading apps" section.
        await openNmSection(page, 'Alternative reading apps');
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
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

        // Verify ZIP contents include KOReader files
        expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
        const zipData = fs.readFileSync(await download.path());
        const zip = await JSZip.loadAsync(zipData);
        const zipFiles = Object.keys(zip.files);

        expect(zipFiles).toContainEqual('.kobo/KoboRoot.tgz');
        expect(zipFiles).toContainEqual('.adds/nm/webui-preset');
        // KOReader files should be present under .adds/koreader/
        expect(zipFiles.some((f) => f.startsWith('.adds/koreader/'))).toBe(true);
        // KOReader launcher should be the first menu item, just below the Tweak
        // tab header (first in MENU_ITEM_ORDER after the header).
        const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
        expect(itemsContent).toContain('menu_item:main:KOReader');
        const firstMenuItem = itemsContent.split('\n').find((line) => line.startsWith('menu_item'));
        expect(firstMenuItem.startsWith('menu_item:main:KOReader')).toBe(true);
    });

    test('no device — the manual download bundles KOReader together with its plugin', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');
        test.skip(!hasSimpleUIAssets(), 'SimpleUI assets not found (run npm run setup:installables)');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await openNmSection(page, 'Alternative reading apps');
        // Drop the additional fonts so this run only depends on the two assets under test.
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.check('input[name="nm-cfg-koreader"]');
        await page.check('input[name="nm-cfg-simpleui"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-list')).toContainText('KOReader');
        await expect(page.locator('#nm-review-list')).toContainText('Simple UI');

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 120_000 });

        expect(download.suggestedFilename()).toBe('NickelMenu-install.zip');
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const zipFiles = Object.keys(zip.files);

        // The reader's own files, at the paths the device expects.
        expect(zipFiles).toContainEqual('.adds/koreader/koreader.sh');
        expect(zipFiles).toContainEqual('.adds/koreader/defaults.lua');

        // The plugin, nested inside the reader's plugins directory, with the real
        // archive's bytes rather than an empty placeholder.
        expect(zipFiles).toContainEqual('.adds/koreader/plugins/simpleui.koplugin/main.lua');
        const meta = await zip.file('.adds/koreader/plugins/simpleui.koplugin/_meta.lua').async('string');
        expect(meta).toMatch(/name\s*=\s*"simpleui"/);

        // KOReader ships its own plugins in that same directory; bundling one must
        // sit alongside them rather than replacing the folder.
        expect(zipFiles).toContainEqual('.adds/koreader/plugins/SSH.koplugin/main.lua');

        // The reader gets a Toggle entry; a plugin is launched from inside it, so
        // it contributes none.
        const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
        expect(itemsContent).toContain('menu_item:main:KOReader');
        expect(itemsContent).not.toContain('Simple UI');
    });

    test('with device — install with KOReader writes files to device', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');
        test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');

        // uiLocale: null omits CurrentLocale from the conf, so the overview shows "Unknown".
        await connectMockDevice(page, { hasNickelMenu: false, uiLocale: null });
        await expect(page.locator('#device-language')).toHaveText('Unknown');

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');

        // Select "Install NickelMenu with preset"
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        // Feature selection step
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        // Enable KOReader (in the collapsed "Alternative reading apps" section)
        await openNmSection(page, 'Alternative reading apps');
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
        expect(writtenFiles.some((f) => f.includes('koreader'))).toBe(true);

        // Verify the .adds/koreader directory was created in mock FS
        const koreaderDirExists = await mockPathExists(page, '.adds', 'koreader');
        expect(koreaderDirExists, '.adds/koreader/ should exist').toBe(true);
    });

    test('with device — installing KOReader together with its plugin lands both, nested correctly', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');
        test.skip(!hasSimpleUIAssets(), 'SimpleUI assets not found (run npm run setup:installables)');

        await connectMockDevice(page, { hasNickelMenu: false });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await openNmSection(page, 'Alternative reading apps');
        // Drop the additional fonts so this run only depends on the two assets under test.
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.check('input[name="nm-cfg-koreader"]');
        await page.check('input[name="nm-cfg-simpleui"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-list')).toContainText('KOReader');
        await expect(page.locator('#nm-review-list')).toContainText('Simple UI');

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        // The reader's own files land under .adds/koreader/.
        expect(await mockPathExists(page, '.adds', 'koreader', 'koreader.sh')).toBe(true);
        expect(await mockPathExists(page, '.adds', 'koreader', 'defaults.lua')).toBe(true);

        // The plugin lands nested inside the reader's plugins directory, and its
        // bytes are the real archive's rather than an empty placeholder.
        expect(await mockPathExists(page, '.adds', 'koreader', 'plugins', 'simpleui.koplugin', 'main.lua')).toBe(true);
        const meta = await readMockFile(page, '.adds', 'koreader', 'plugins', 'simpleui.koplugin', '_meta.lua');
        expect(meta).toMatch(/name\s*=\s*"simpleui"/);

        // KOReader ships its own plugins in that same directory; adding one must
        // sit alongside them rather than replacing the folder.
        expect(await mockPathExists(page, '.adds', 'koreader', 'plugins', 'SSH.koplugin', 'main.lua')).toBe(true);

        // The reader gets a Toggle entry; a plugin is launched from inside it, so
        // it contributes none.
        const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
        expect(items).toContain('menu_item:main:KOReader');
        expect(items).not.toContain('Simple UI');
    });

    test('with device — an installed app and its plugin both arrive selected when modifying', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');
        test.skip(!hasSimpleUIAssets(), 'SimpleUI assets not found (run npm run setup:installables)');

        await connectMockDevice(page, {
            hasNickelMenu: true,
            hasKOReader: true,
            hasSimpleUI: true,
            extraAddsFiles: [{ path: ['nm', 'webui-preset'], content: '# Generated by KoboPatch Web UI\n' }],
            extraRootFiles: [
                {
                    path: ['.kobopatch-webui', 'nickelmenu.json'],
                    content: JSON.stringify({ selected: ['custom-menu', 'koreader', 'simpleui'], features: {}, meta: { writer: { version: '1.60' } } }),
                },
            ],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await openNmSection(page, 'Alternative reading apps');

        // Both are on the device, so both arrive ticked rather than needing to be
        // re-picked — that is what makes unticking one mean "remove it".
        await expect(page.locator('input[name="nm-cfg-koreader"]')).toBeChecked();
        await expect(page.locator('input[name="nm-cfg-simpleui"]')).toBeChecked();

        // The app says so in a pill; the plugin row is one line, so it carries the
        // same check mark on its own with the words in its accessible name.
        const koreaderRow = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-koreader"]') });
        await expect(koreaderRow.locator('.nm-config-previous--installed')).toHaveText('Currently installed');
        const pluginRow = page.locator('.nm-config-subitem').filter({ hasText: 'Simple UI' });
        await expect(pluginRow.locator('.nm-config-subitem-installed')).toHaveAttribute('aria-label', 'Currently installed');
    });

    test('with device — unticking KOReader in a modify run takes its installed plugin with it', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');
        test.skip(!hasSimpleUIAssets(), 'SimpleUI assets not found (run npm run setup:installables)');

        await connectMockDevice(page, {
            hasNickelMenu: true,
            hasKOReader: true,
            hasSimpleUI: true,
            extraAddsFiles: [{ path: ['nm', 'webui-preset'], content: '# Generated by KoboPatch Web UI\n' }],
            extraRootFiles: [
                {
                    path: ['.kobopatch-webui', 'nickelmenu.json'],
                    content: JSON.stringify({ selected: ['custom-menu', 'koreader', 'simpleui'], features: {}, meta: { writer: { version: '1.60' } } }),
                },
            ],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await openNmSection(page, 'Alternative reading apps');

        const plugin = page.locator('input[name="nm-cfg-simpleui"]');
        await expect(plugin).toBeChecked();

        // The plugin lives inside KOReader's folder, so removing KOReader must
        // take it along: leaving it ticked would install a plugin into a folder
        // that is on its way out.
        await page.uncheck('input[name="nm-cfg-koreader"]');
        await expect(plugin).not.toBeChecked();
        await expect(plugin).toBeDisabled();

        await page.click('#btn-nm-features-next');
        await page.click('#btn-nm-backup-next');
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-list-label')).toHaveText('The following will be installed or reinstalled on your Kobo:');
        await expect(page.locator('#nm-review-kept-list')).toContainText('KOReader');
        await expect(page.locator('#nm-review-kept-list')).toContainText('Simple UI');

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        expect(await mockPathExists(page, '.adds', 'koreader')).toBe(false);
        expect(await mockPathExists(page, '.adds', 'koreader', 'plugins', 'simpleui.koplugin')).toBe(false);
    });

    test('no device — a KOReader plugin is a checkbox under it that follows KOReader', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasKOReaderAssets(), 'KOReader assets not found (run npm run setup:installables)');
        test.skip(!hasSimpleUIAssets(), 'SimpleUI assets not found (run npm run setup:installables)');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await openNmSection(page, 'Alternative reading apps');

        // The plugin is always visible under KOReader's description, but it
        // installs inside KOReader, so it says what it is waiting for.
        const plugin = page.locator('input[name="nm-cfg-simpleui"]');
        const pluginRow = page.locator('.nm-config-subitem').filter({ hasText: 'Simple UI' });
        await expect(pluginRow).toBeVisible();
        await expect(pluginRow).toContainText('Install Simple UI');
        await expect(pluginRow.locator('.nm-config-subitem-badge')).toHaveText('plugin');
        await expect(pluginRow.locator('.nm-config-version')).toHaveText('v2.5.0');
        // Greyed out, with no words: it sits directly under the thing it needs.
        await expect(plugin).toBeDisabled();
        await expect(pluginRow).not.toContainText('Requires');

        // Ticking KOReader frees it, in place — the section stays open.
        await page.check('input[name="nm-cfg-koreader"]');
        await expect(plugin).toBeEnabled();

        // Its "?" badge links to the plugin upstream, and following it must not
        // toggle the checkbox it sits beside.
        const pluginHelp = pluginRow.locator('.nm-config-help');
        await expect(pluginHelp).toHaveAttribute('href', 'https://github.com/doctorhetfield-cmd/simpleui.koplugin');
        await expect(pluginHelp).toHaveAttribute('target', '_blank');
        await pluginHelp.click();
        await expect(plugin).not.toBeChecked();

        // Clicking the plugin's label must not toggle KOReader above it, and
        // must not press it either — an add-on inside KOReader's <label> made
        // its checkbox flash on every click, which is why they are siblings.
        const koreader = page.locator('input[name="nm-cfg-koreader"]');
        await pluginRow.click();
        await expect(plugin).toBeChecked();
        await expect(koreader).toBeChecked();
        await expect(pluginRow.locator('input')).toHaveCount(1);
        await expect(page.locator('.nm-config-item .nm-config-subitem')).toHaveCount(0);

        // Unticking KOReader takes the plugin down with it.
        await page.uncheck('input[name="nm-cfg-koreader"]');
        await expect(plugin).toBeDisabled();
        await expect(plugin).not.toBeChecked();
    });

    test('with device — SimpleUI installs on its own when KOReader is already on the device', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasSimpleUIAssets(), 'SimpleUI assets not found (run npm run setup:installables)');

        await connectMockDevice(page, { hasNickelMenu: false, hasKOReader: true });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await openNmSection(page, 'Alternative reading apps');

        // The device already has .adds/koreader, so the plugin is selectable
        // without KOReader being ticked — it can be added on its own, without
        // redownloading the 42 MB reader.
        await expect(page.locator('input[name="nm-cfg-koreader"]')).not.toBeChecked();
        await expect(page.locator('input[name="nm-cfg-simpleui"]')).toBeEnabled();
        // Drop the additional fonts so this run only depends on the SimpleUI asset.
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.check('input[name="nm-cfg-simpleui"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-list')).toContainText('Simple UI');
        await expect(page.locator('#nm-review-list')).not.toContainText('Install KOReader');

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles.some((f) => f.includes('.adds/koreader/plugins/simpleui.koplugin/'))).toBe(true);
        expect(await mockPathExists(page, '.adds', 'koreader', 'plugins', 'simpleui.koplugin')).toBe(true);
        // KOReader itself was not part of this install, so nothing else was rewritten.
        expect(writtenFiles.some((f) => f.includes('.adds/koreader/koreader.sh'))).toBe(false);
        // And it is still there. Without this, the test passes even if KOReader
        // were deleted before the plugin installed — "not written" and "removed"
        // look identical from the written-files list alone.
        expect(await mockPathExists(page, '.adds', 'koreader', 'koreader.sh'), 'KOReader must survive a plugin-only install').toBe(true);
    });

    test('with device — install with Cadmus extracts its app directory to the device', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasCadmusAssets(), 'Cadmus assets not found (run npm run setup:installables)');

        await connectMockDevice(page, { hasNickelMenu: false });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await openNmSection(page, 'Alternative reading apps');
        await expect(page.locator('input[name="nm-cfg-cadmus"]')).not.toBeChecked();
        // Drop the additional fonts so this run only depends on the Cadmus assets.
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.check('input[name="nm-cfg-cadmus"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-list')).toContainText('Cadmus');
        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        // The Cadmus tarball is extracted onboard under .adds/cadmus/ (the same
        // payload the manual-download test verifies inside the ZIP).
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles.some((f) => f.includes('.adds/cadmus/'))).toBe(true);
        expect(await mockPathExists(page, '.adds', 'cadmus', 'cadmus.sh')).toBe(true);
        expect(await mockPathExists(page, '.adds', 'cadmus', 'cadmus')).toBe(true);

        // Its launcher is wired into the NickelMenu preset written to the device.
        const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
        expect(items).toContain('menu_item:main:Cadmus');
    });

    test('with device — install with NickelClock writes the merged KoboRoot.tgz and toggle script', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelClockAssets(), 'NickelClock assets not found (run npm run setup:installables)');

        await connectMockDevice(page, { hasNickelMenu: false });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        // NickelClock lives in Interface Tweaks; select only it
        // (and keep Better typography and fixes's merge out of this test).
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.uncheck('input[name="nm-cfg-better-typography"]');
        await page.check('input[name="nm-cfg-nickelclock"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-list')).toContainText('Display clock when reading');
        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        // NickelClock ships as a plugin inside KoboRoot.tgz, so the device write goes
        // through the merged .kobo/KoboRoot.tgz (the merge contents are verified in the
        // manual-download test). It also drops its onboard toggle script...
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles.some((f) => f.includes('KoboRoot.tgz'))).toBe(true);
        expect(await mockPathExists(page, '.adds', 'nm', 'scripts', 'toggle_nickelclock.sh')).toBe(true);

        // ...and contributes its Toggle item to the preset written to the device.
        const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
        expect(items).toContain('menu_item :main :NickelClock :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_nickelclock.sh');
    });

    test('with device — Better typography and fixes announces and installs NickelTypeFix on supported firmware', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelTypeFixAssets(), 'NickelTypeFix assets not found (run npm run setup:installables)');

        // The default mock firmware (4.46) is above the app's NickelMenu floor.
        await connectMockDevice(page, { hasNickelMenu: false });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await expect(page.locator('input[name="nm-cfg-better-typography"]')).toBeChecked();

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-notices')).toContainText('NickelTypeFix');
        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        // NickelTypeFix rides inside the single merged .kobo/KoboRoot.tgz (the
        // merge contents are verified in the manual-download test).
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles.some((f) => f.includes('KoboRoot.tgz'))).toBe(true);
    });

    test('with device — firmware at the 4.23 floor installs NickelTypeFix', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelTypeFixAssets(), 'NickelTypeFix assets not found (run npm run setup:installables)');

        await connectMockDevice(page, { hasNickelMenu: false, firmware: '4.23.15505' });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await expect(page.locator('input[name="nm-cfg-better-typography"]')).toBeChecked();

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-notices')).toContainText('NickelTypeFix');

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        const conf = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
        expect(conf).toContain('webkitTextRendering=optimizeLegibility');
    });

    test('with device — preset warns about Dark Mode on unsupported devices', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        // Kobo Aura HD (N204) is an older model that does not support Dark mode.
        await connectMockDevice(page, {
            serial: 'N204E0000000000',
            hardwareId: '00000000-0000-0000-0000-000000000350',
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
        // NickelClock coexists with NickelMenu (it's an installable Interface Tweaks feature),
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
    });

    test('with device — simplify-tabs localizes the tab labels to the device language', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        // A German device: the overview shows the language and the tabs are renamed
        // with the German labels instead of the English ones.
        await connectMockDevice(page, { hasNickelMenu: false, uiLocale: 'de' });
        await expect(page.locator('#device-language-row')).toBeVisible();
        await expect(page.locator('#device-language')).toHaveText('German');

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await page.check('input[name="nm-cfg-simplify-tabs"]');
        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

        const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
        // The structural overrides are still applied...
        expect(items).toContain('experimental :menu_main_15505_enabled: 1');
        expect(items).toContain('experimental :menu_main_15505_0_enabled: 1');
        // ...with German labels ("Stats" is kept as a short pan-European clipping),
        // and none of the English-only ones.
        expect(items).toContain('experimental :menu_main_15505_1_label: Bücher');
        expect(items).toContain('experimental :menu_main_15505_2_label: Stats');
        expect(items).toContain('experimental :menu_main_15505_3_label: Notizen');
        expect(items).not.toContain('_label: Books');
        expect(items).not.toContain('_label: Notes');
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

        // The toggle is inserted directly after the complete Screenshots item
        // (including its state-alert chain), and the sample image is written.
        const items = await readMockFile(page, '.adds', 'nm', 'webui-preset');
        expect(items).toContain('menu_item :main :Screensaver :cmd_output');
        expect(items).toMatch(
            /menu_item :main :Screenshots[^\n]*\n +chain_success :cmd_output :1000 :\/mnt\/onboard\/\.adds\/nm\/scripts\/toggle_screenshots\.sh\n\nmenu_item :main :Screensaver/,
        );
        expect(await mockPathExists(page, '.kobo', 'screensaver', 'moon.png')).toBe(true);
    });

    test('with device — reading defaults are untouched when Better typography and fixes is not selected', async ({ page }) => {
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

        // Turn off Better typography and fixes (on by default); leave the fonts installing.
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
});
