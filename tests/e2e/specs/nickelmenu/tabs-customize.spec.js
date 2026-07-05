// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const JSZip = require('jszip');

const { hasNickelMenuAssets } = require('../../support/assets');
const { goToManualMode } = require('../../support/mock-device');

// Drive the "Customize simplified tabs" dialog (the tab-bar counterpart of the
// NickelMenu icon/label customizer) and assert the choices land in the
// generated NickelMenu items file.
test.describe('NickelMenu — simplified tabs customization', () => {
    async function goToFeatures(page) {
        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        // Fonts pull in extra assets that this test does not need.
        const fonts = page.locator('input[name="nm-cfg-additional-fonts"]');
        if (await fonts.isChecked()) await fonts.uncheck();
    }

    async function downloadItems(page) {
        await page.click('#btn-nm-features-next');
        await page.click('#btn-nm-backup-next');
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        return zip.file('.adds/nm/webui-preset').async('string');
    }

    test('no device — visibility toggles and a custom label reach the config', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToFeatures(page);

        // Enable the feature so its tab override is written.
        await page.check('input[name="nm-cfg-simplify-tabs"]');

        // Open the customizer, flip every optional tab, and set the Books label.
        await page.getByRole('button', { name: 'Customize simplified navigation tabs' }).click();
        await expect(page.locator('#nm-tabs-dialog')).toBeVisible();
        await page.uncheck('#nm-tabs-vis-stats');
        await page.check('#nm-tabs-vis-notes');
        await page.check('#nm-tabs-vis-store');
        await page.fill('#nm-tabs-label-books', 'Reads');
        await page.click('#btn-nm-tabs-save');
        await expect(page.locator('#nm-tabs-dialog')).toBeHidden();

        // The summary chip reflects the new visible-tab count (Home, Books, More
        // + Notes + store = 5).
        await expect(page.locator('#nm-simplify-tabs-summary .nm-config-summary-label')).toHaveText('5 tabs');

        const items = await downloadItems(page);
        expect(items).toContain('experimental :menu_main_15505_2_enabled: 0'); // Stats hidden
        expect(items).toContain('experimental :menu_main_15505_3_enabled: 1'); // Notes shown
        expect(items).toContain('experimental :menu_main_15505_4_enabled: 1'); // store shown
        expect(items).toContain('experimental :menu_main_15505_1_label: Reads');
    });

    test('no device — closing without saving keeps the defaults', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToFeatures(page);
        await page.check('input[name="nm-cfg-simplify-tabs"]');

        await page.getByRole('button', { name: 'Customize simplified navigation tabs' }).click();
        await expect(page.locator('#nm-tabs-dialog')).toBeVisible();
        await page.check('#nm-tabs-vis-store');
        await page.fill('#nm-tabs-label-books', 'Reads');
        await page.click('#btn-nm-tabs-close');
        await expect(page.locator('#nm-tabs-dialog')).toBeHidden();

        const items = await downloadItems(page);
        // Defaults: Stats shown, Notes + store hidden, and no forced Books label
        // (manual mode has an unknown locale, so the device keeps its own names).
        expect(items).toContain('experimental :menu_main_15505_2_enabled: 1');
        expect(items).toContain('experimental :menu_main_15505_3_enabled: 0');
        expect(items).toContain('experimental :menu_main_15505_4_enabled: 0');
        expect(items).not.toContain('Reads');
        expect(items).not.toMatch(/_label:/);
    });
});
