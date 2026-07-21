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
        expect(writtenFiles.some((f) => f.includes('webui-preset'))).toBe(true);
        expect(removed.some((e) => e.path.includes('items'))).toBe(true);
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
        expect(writtenFiles.some((f) => f.includes('webui-preset'))).toBe(true);
        expect(removed.some((e) => e.path.includes('items'))).toBe(false);
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
});
