const { test, expect } = require('@playwright/test');

test.describe('App updated dialog', () => {
    test('the reload button reloads the page and there is no way to dismiss it', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            const dialog = document.getElementById('mobile-dialog');
            if (dialog?.open) dialog.close();
            document.getElementById('app-updated-dialog').showModal();
        });
        const dialog = page.locator('#app-updated-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('The website has been updated since you started using it');

        // Escape must not get rid of it: the page cannot carry on as it is.
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();

        // Pressing the button is what reloads, and nothing else does.
        await page.evaluate(() => {
            window.__reloadMarker = true;
        });
        await page.click('#btn-app-updated-reload');
        await page.waitForLoadState('load');
        expect(await page.evaluate(() => window.__reloadMarker)).toBeUndefined();
    });
});
