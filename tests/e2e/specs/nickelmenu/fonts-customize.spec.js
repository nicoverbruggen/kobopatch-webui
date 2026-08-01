// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const { hasNickelMenuAssets, hasFontAssets, hasFontPreviews } = require('../../support/assets');
const { goToManualMode } = require('../../support/mock-device');

// The committed catalogue the app itself uses, so expectations track the pinned
// ebook-fonts release instead of hardcoding family counts.
const cataloguePath = path.join(__dirname, '..', '..', '..', '..', 'src', 'js', 'nickelmenu', 'features', 'additional-fonts', 'FontCatalogue.js');

/** @type {Array<{id: string, name: string, collection: string, files: string[]}>} */
let FONT_FAMILIES;
/** @type {Array<{id: string, name: string, collection: string, files: string[]}>} */
let coreFamilies;

test.beforeAll(async () => {
    ({ FONT_FAMILIES } = await import(pathToFileURL(cataloguePath).href));
    coreFamilies = FONT_FAMILIES.filter((family) => family.collection === 'core');
});

// Drive the "Select additional fonts" dialog (the fonts counterpart of the
// icon/tabs customizers) and assert the selection controls which archives are
// downloaded and which .ttf files land in the generated ZIP.
test.describe('NickelMenu — additional fonts customization', () => {
    async function goToFeatures(page) {
        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();
    }

    async function downloadZip(page) {
        await page.click('#btn-nm-features-next');
        await page.click('#btn-nm-backup-next');
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        return JSZip.loadAsync(fs.readFileSync(await download.path()));
    }

    function zipFontFiles(zip) {
        return Object.keys(zip.files)
            .filter((file) => file.startsWith('fonts/') && file.endsWith('.ttf'))
            .sort();
    }

    test('no device — the default selection installs the core collection without downloading the extra archive', async ({ page }) => {
        test.skip(!hasNickelMenuAssets() || !hasFontAssets(), 'NickelMenu/font assets not found in webroot');

        const extraRequests = [];
        page.on('request', (request) => {
            if (request.url().includes('kobo-extra-fonts.zip')) extraRequests.push(request.url());
        });

        await goToFeatures(page);
        await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();
        await expect(page.locator('#nm-fonts-summary .nm-config-summary-label')).toHaveText(`${coreFamilies.length} fonts`);

        const zip = await downloadZip(page);
        expect(zipFontFiles(zip)).toEqual(coreFamilies.flatMap((family) => family.files.map((file) => 'fonts/' + file)).sort());
        // Only the core archive is needed for the default selection.
        expect(extraRequests).toEqual([]);

        // Libron is part of the default selection, so Better typography (on by
        // default) sets it as the reading font in the bundled instructions.
        const instructions = await zip.file('instructions.txt').async('string');
        expect(instructions).toContain('readingFontFamily=KF Libron');
    });

    test('no device — a customized selection changes the installed families and the default font', async ({ page }) => {
        test.skip(!hasNickelMenuAssets() || !hasFontAssets(), 'NickelMenu/font assets not found in webroot');

        await goToFeatures(page);

        await page.getByRole('button', { name: 'Select which additional fonts are installed' }).click();
        await expect(page.locator('#nm-fonts-dialog')).toBeVisible();
        await expect(page.locator('#nm-fonts-core-count')).toHaveText(`${coreFamilies.length} of ${coreFamilies.length} selected`);

        // Every family shows its pre-rendered type specimen (lazily fetched).
        if (hasFontPreviews()) {
            await expect(page.locator('#nm-fonts-dialog .nm-fonts-item-preview')).toHaveCount(FONT_FAMILIES.length);
        }

        // Drop Libron from the core set, add Readerly from the extra set.
        await page.uncheck('#nm-fonts-core-list input[data-family-id="libron"]');
        await page.check('#nm-fonts-extra-list input[data-family-id="readerly"]');
        await expect(page.locator('#nm-fonts-status')).toHaveText(`${coreFamilies.length} of ${FONT_FAMILIES.length} font families selected.`);
        await page.click('#btn-nm-fonts-save');
        await expect(page.locator('#nm-fonts-dialog')).toBeHidden();

        await expect(page.locator('#nm-fonts-summary .nm-config-summary-label')).toHaveText(`${coreFamilies.length} fonts`);

        const readerly = FONT_FAMILIES.find((family) => family.id === 'readerly');
        const libron = FONT_FAMILIES.find((family) => family.id === 'libron');
        const expected = [...coreFamilies.filter((family) => family.id !== 'libron'), readerly].flatMap((family) =>
            family.files.map((file) => 'fonts/' + file),
        );

        const zip = await downloadZip(page);
        const fontFiles = zipFontFiles(zip);
        expect(fontFiles).toEqual(expected.sort());
        for (const file of libron.files) expect(fontFiles).not.toContain('fonts/' + file);

        // Without Libron in the selection, no default reading font is set.
        const instructions = await zip.file('instructions.txt').async('string');
        expect(instructions).not.toContain('readingFontFamily');
    });

    test('no device — bulk actions, the empty-selection guard, and reset defaults', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToFeatures(page);
        await page.getByRole('button', { name: 'Select which additional fonts are installed' }).click();
        await expect(page.locator('#nm-fonts-dialog')).toBeVisible();

        // Clearing everything disables Save and explains why.
        await page.click('#btn-nm-fonts-core-none');
        await expect(page.locator('#nm-fonts-core-count')).toHaveText(`0 of ${coreFamilies.length} selected`);
        await expect(page.locator('#btn-nm-fonts-save')).toBeDisabled();
        await expect(page.locator('#nm-fonts-status')).toHaveText('Select at least one font family.');

        // Selecting the whole extra set re-enables Save.
        const extraCount = FONT_FAMILIES.length - coreFamilies.length;
        await page.click('#btn-nm-fonts-extra-all');
        await expect(page.locator('#nm-fonts-extra-count')).toHaveText(`${extraCount} of ${extraCount} selected`);
        await expect(page.locator('#btn-nm-fonts-save')).toBeEnabled();

        // Reset restores the core-only default.
        await page.click('#btn-nm-fonts-reset');
        await expect(page.locator('#nm-fonts-status')).toHaveText('Defaults restored.');
        await expect(page.locator('#nm-fonts-core-count')).toHaveText(`${coreFamilies.length} of ${coreFamilies.length} selected`);
        await expect(page.locator('#nm-fonts-extra-count')).toHaveText(`0 of ${extraCount} selected`);

        // Closing without saving keeps the default summary.
        await page.click('#btn-nm-fonts-cancel');
        await expect(page.locator('#nm-fonts-dialog')).toBeHidden();
        await expect(page.locator('#nm-fonts-summary .nm-config-summary-label')).toHaveText(`${coreFamilies.length} fonts`);
    });

    test('no device — closing without saving keeps the defaults', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToFeatures(page);
        await page.getByRole('button', { name: 'Select which additional fonts are installed' }).click();
        await expect(page.locator('#nm-fonts-dialog')).toBeVisible();
        await page.uncheck('#nm-fonts-core-list input[data-family-id="libron"]');
        await page.click('#btn-nm-fonts-close');
        await expect(page.locator('#nm-fonts-dialog')).toBeHidden();
        await expect(page.locator('#nm-fonts-summary .nm-config-summary-label')).toHaveText(`${coreFamilies.length} fonts`);

        // Reopening shows the untouched default selection again.
        await page.getByRole('button', { name: 'Select which additional fonts are installed' }).click();
        await expect(page.locator('#nm-fonts-core-list input[data-family-id="libron"]')).toBeChecked();
        await page.click('#btn-nm-fonts-cancel');
    });
});
