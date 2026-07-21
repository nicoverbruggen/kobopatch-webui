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

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);

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

    test('no device — default cog icon used when no customization is made', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        // Do NOT open the customize dialog — leave defaults
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');

        await page.click('#btn-nm-features-next');
        await page.click('#btn-nm-backup-next');

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

        const zipData = fs.readFileSync(await download.path());
        const zip = await JSZip.loadAsync(zipData);
        const zipFiles = Object.keys(zip.files);

        // No custom icon file should be present
        expect(zipFiles).not.toContainEqual('.adds/nm/.custom-icon.png');
        expect(zipFiles).not.toContainEqual('.adds/nm/.custom-icon.svg');

        // Items file should reference the default cog icon and label
        const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
        expect(itemsContent).toContain('experimental :menu_main_15505_label :Toggle');
        expect(itemsContent).toContain('experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png');
    });

    test('no device — reopen customize dialog retains previously saved values', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        // Open dialog, set icon and label, save
        await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
        await expect(page.locator('#nm-customize-dialog')).toBeVisible();
        await page.fill('#nm-customize-label', 'ReadMode');
        await page.getByRole('button', { name: 'Use Book icon' }).click();
        await page.click('#btn-nm-customize-save');
        await expect(page.locator('#nm-customize-dialog')).toBeHidden();

        // Reopen dialog
        await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
        await expect(page.locator('#nm-customize-dialog')).toBeVisible();

        // Label should be retained
        await expect(page.locator('#nm-customize-label')).toHaveValue('ReadMode');
        // Book icon should still be selected
        await expect(page.locator('button.nm-icon-choice--selected')).toHaveAttribute('data-icon-id', 'book');
    });

    test('no device — closing customize dialog without saving discards changes', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        // Open dialog, change label and icon, then close without saving
        await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
        await expect(page.locator('#nm-customize-dialog')).toBeVisible();
        await page.fill('#nm-customize-label', 'ReadMode');
        await page.getByRole('button', { name: 'Use Book icon' }).click();
        await page.click('#btn-nm-customize-close');
        await expect(page.locator('#nm-customize-dialog')).toBeHidden();

        // Proceed to download without reopening the dialog
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.click('#btn-nm-features-next');
        await page.click('#btn-nm-backup-next');

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

        const zipData = fs.readFileSync(await download.path());
        const zip = await JSZip.loadAsync(zipData);
        const zipFiles = Object.keys(zip.files);

        // No custom icon file should be present
        expect(zipFiles).not.toContainEqual('.adds/nm/.custom-icon.png');

        // Items file should reference the default cog icon and default label
        const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
        expect(itemsContent).toContain('experimental :menu_main_15505_label :Toggle');
        expect(itemsContent).toContain('experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png');
        // The custom values must NOT appear
        expect(itemsContent).not.toContain('ReadMode');
        expect(itemsContent).not.toContain('.custom-icon');
    });

    test('no device — customize label is sanitized live and Save is gated on a valid label', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
        await expect(page.locator('#nm-customize-dialog')).toBeVisible();

        const labelInput = page.locator('#nm-customize-label');
        const counter = page.locator('#nm-customize-counter');
        const status = page.locator('#nm-customize-status');
        const saveBtn = page.locator('#btn-nm-customize-save');

        // Spaces and punctuation are stripped as the user types.
        await labelInput.fill('My Menu!!');
        await expect(labelInput).toHaveValue('MyMenu');
        await expect(counter).toHaveText('6/10');
        await expect(saveBtn).toBeEnabled();

        // Input longer than the max is truncated to 10 alphanumeric characters.
        await labelInput.fill('ABCDEFGHIJKLMNOP');
        await expect(labelInput).toHaveValue('ABCDEFGHIJ');
        await expect(counter).toHaveText('10/10');

        // A label that sanitizes to empty is invalid: Save is disabled with guidance.
        await labelInput.fill('!!!');
        await expect(labelInput).toHaveValue('');
        await expect(counter).toHaveText('0/10');
        await expect(saveBtn).toBeDisabled();
        await expect(status).toHaveText('Use 1-10 letters or numbers.');

        // Clearing the field is likewise invalid.
        await labelInput.fill('');
        await expect(saveBtn).toBeDisabled();
        await expect(status).toHaveText('Use 1-10 letters or numbers.');

        // A valid label re-enables Save and persists once saved.
        await labelInput.fill('Reader');
        await expect(saveBtn).toBeEnabled();
        await expect(status).toHaveText('');
        await page.click('#btn-nm-customize-save');
        await expect(page.locator('#nm-customize-dialog')).toBeHidden();

        await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
        await expect(page.locator('#nm-customize-dialog')).toBeVisible();
        await expect(labelInput).toHaveValue('Reader');
    });

    test('no device — uploaded PNG tab icon is resized to 64x64 PNG', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        // Minimal valid 1x1 red PNG (base64)
        const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');

        await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
        await expect(page.locator('#nm-customize-dialog')).toBeVisible();
        await page.setInputFiles('#nm-customize-upload', {
            name: 'reddot.png',
            mimeType: 'image/png',
            buffer: minimalPng,
        });
        await expect(page.locator('#nm-customize-status')).toHaveText('Image resized to 64x64 PNG.');
        await page.click('#btn-nm-customize-save');

        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        await page.click('#btn-nm-features-next');
        await page.click('#btn-nm-backup-next');

        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });

        const zipData = fs.readFileSync(await download.path());
        const zip = await JSZip.loadAsync(zipData);
        const zipFiles = Object.keys(zip.files);

        // Must contain the custom icon as PNG (not SVG)
        expect(zipFiles).toContainEqual('.adds/nm/.custom-icon.png');
        expect(zipFiles).not.toContainEqual('.adds/nm/.custom-icon.svg');
        const iconBytes = await zip.file('.adds/nm/.custom-icon.png').async('uint8array');
        // Verify valid PNG signature
        expect(Array.from(iconBytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

        const itemsContent = await zip.file('.adds/nm/webui-preset').async('string');
        expect(itemsContent).toContain('experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.custom-icon.png');
    });
});
